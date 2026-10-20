import { createOpenAI } from '@ai-sdk/openai';
import {
  APICallError,
  generateText,
  type LanguageModel,
  NoObjectGeneratedError,
  Output,
  streamText,
  TypeValidationError
} from 'ai';

import {
  LYRICS_ANALYSIS_DEFAULT_MODEL_ID,
  lyricsAnalysisTransportSchema,
  type LyricsAnalysisError,
  type LyricsAnalysisErrorCode,
  type LyricsAnalysisInputLine,
  type LyricsAnalysisLine,
  type LyricsAnalysisProviderConfig,
  type LyricsAnalysisProviderTestResult,
  type LyricsAnalysisTransportLine,
  validateAndNormalizeLineAnalysis
} from '../../common/lyricsAnalysis';
import type { AnalysisPassTelemetryEvent } from '../../common/lyricsAnalysisTelemetry';
import { LYRICS_ANALYSIS_TELEMETRY_VERSION } from '../../common/lyricsAnalysisTelemetry';
import { buildLanguageDirective } from '../../common/lyricsLanguageProfiles';
import {
  buildRepairPrompt,
  buildSystemPrompt,
  buildUserPrompt
} from './analysisPrompts';
import { ConcurrencyWindow, isThrottlingError, runWithConcurrency } from './concurrencyPool';
import { salvageEnvelopeElements } from './salvageEnvelopeElements';

// The prompt/salvage modules moved out of this file (see analysisPrompts.ts /
// salvageEnvelopeElements.ts). This re-export keeps the historical import path — and the
// existing salvage tests + eval scripts that import from here — working unchanged.
export { salvageEnvelopeElements } from './salvageEnvelopeElements';

// This module runs inside the lyrics-analysis utility process, which cannot import Electron
// modules (`app` is not exported there — importing the main logger crashes the worker), so
// diagnostics go to stderr, which `stdio: 'inherit'` pipes into the main-process console.
const logWorkerWarning = (message: string, data: Record<string, unknown>) => {
  console.warn(`[lyrics-analysis] ${message}`, JSON.stringify(data));
};

const MAX_REPAIR_LINES = 40;

const normalizeBaseURL = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';

  const withScheme = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);
    const pathname = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${pathname === '/' ? '' : pathname}`;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
};

export const createModel = (config: LyricsAnalysisProviderConfig) => {
  const provider = createOpenAI({
    apiKey: config.apiKey,
    baseURL: normalizeBaseURL(config.baseURL)
    // The default `openai` provider name matters: `providerOptions.openai` keys off it.
  });

  return provider.chat(config.modelId || LYRICS_ANALYSIS_DEFAULT_MODEL_ID);
};

export const mapProviderError = (error: unknown): LyricsAnalysisError => {
  const mapStatus = (statusCode: number | undefined): LyricsAnalysisErrorCode => {
    if (statusCode === 401 || statusCode === 403) return 'authFailed';
    if (statusCode === 404 || statusCode === 405) return 'endpointUnsupported';
    if (statusCode === 400 || statusCode === 422) return 'invalidResponse';
    return 'unknown';
  };

  if (APICallError.isInstance(error)) {
    const code = mapStatus(error.statusCode);
    return {
      code,
      statusCode: error.statusCode,
      message:
        code === 'authFailed'
          ? 'The API key was rejected by the endpoint (401/403).'
          : code === 'endpointUnsupported'
            ? 'The endpoint does not expose an OpenAI-compatible chat completions API.'
            : code === 'invalidResponse'
              ? 'The endpoint rejected the request. The model may not support JSON output.'
              : `The request failed${error.statusCode ? ` with status ${error.statusCode}` : ''}.`
    };
  }

  if (NoObjectGeneratedError.isInstance(error)) {
    return {
      code: 'invalidResponse',
      message: 'The model did not return valid JSON for the expected schema.'
    };
  }

  if (TypeValidationError.isInstance(error)) {
    return { code: 'invalidResponse', message: 'The model response failed schema validation.' };
  }

  const message = error instanceof Error ? error.message : String(error);
  const isNetworkError = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(message);

  return {
    code: isNetworkError ? 'networkFailed' : 'unknown',
    message: isNetworkError
      ? 'Could not reach the endpoint. Check the base URL and your connection.'
      : message
  };
};

export interface AnalyzeLyricsOptions {
  config: LyricsAnalysisProviderConfig;
  uiLanguage: string;
  songTitle: string;
  songArtists: string[];
  lines: LyricsAnalysisInputLine[];
  /** Telemetry correlation id stamped onto every pass event of this run. */
  sessionId?: string;
  signal?: AbortSignal;
  onLine: (line: LyricsAnalysisLine, source: 'first' | 'repair') => void;
  onRepairStarted?: (failedLineIds: string[]) => void;
  /** Fired after every batch (first or repair) with its timing/token/loss metrics. */
  onPassCompleted?: (pass: AnalysisPassTelemetryEvent) => void;
  /** AIMD window stats aggregated across every pass, surfaced for the session-end event. */
  onConcurrencyStats?: (stats: {
    max: number;
    mean: number;
    rateLimitedCount: number;
  }) => void;
  /**
   * Test seam: overrides how the AI SDK model is constructed from the provider config. Defaults
   * to the real OpenAI-compatible adapter; orchestration tests inject a scripted fake here so
   * they run without an actual endpoint or Electron modules.
   */
  createModel?: (config: LyricsAnalysisProviderConfig) => LanguageModel;
}

/** Final aggregate for telemetry: token totals across every pass of a run. */
export interface AnalyzeLyricsPassStats {
  outputTokens: number | undefined;
  inputTokens: number | undefined;
}

/**
 * Runs one streaming pass (+ at most one bounded repair pass) and returns every line whose analysis
 * could be produced. The repair pass is application logic: `elementStream` only hands us elements it
 * managed to parse, so we track missing/invalid lineIds ourselves and re-ask for exactly those.
 */
export const analyzeLyrics = async (options: AnalyzeLyricsOptions) => {
  const { config, uiLanguage, songTitle, songArtists, lines, signal, onLine } = options;
  const textByLineId = new Map(lines.map((line) => [line.lineId, line.text]));
  const model = options.createModel?.(config) ?? createModel(config);
  // The per-language rules cover the whole song's script mix, so they belong in the system
  // prompt once — not in each batch's user JSON, where they read as row data.
  const languageDirective = buildLanguageDirective(lines);

  const finalLines = new Map<string, LyricsAnalysisLine>();

  // Aggregate across every pass (first + repair) for the session-end telemetry event.
  const totalOutputTokens: number[] = [];
  const totalInputTokens: number[] = [];

  const streamPass = async (input: {
    prompt: string;
    targetLines: LyricsAnalysisInputLine[];
    maxOutputTokens: number;
    passKind: 'first' | 'repair';
    /**
     * Repair passes replace lines the first pass already emitted, but a repair can come back
     * worse (fewer tokens, a fresh coverage gap). When supplied, a line is only accepted if it
     * scores strictly better than what is already held; rejected replacements leave the earlier
     * line — and what the user already saw — untouched.
     */
    preferOver?: Map<string, LyricsAnalysisLine>;
  }) => {
    const passStartedAt = Date.now();
    let finishReason: string | undefined;
    let passOutputTokens: number | undefined;
    let passInputTokens: number | undefined;
    // `result.output` only surfaces `NoOutputGeneratedError`, which hides the real provider failure
    // (e.g. a 401). The stream error callback is where the status-bearing APICallError shows up.
    let streamError: unknown;

    const result = streamText({
      model,
      system: buildSystemPrompt(uiLanguage, languageDirective),
      prompt: input.prompt,
      temperature: 0,
      maxOutputTokens: input.maxOutputTokens,
      abortSignal: signal,
      onError: ({ error }) => {
        streamError ??= error;
      },
      // Our transport schema has optional fields, which OpenAI's `strict` mode rejects. Most
      // third-party gateways also only implement the non-strict `json_schema` variant.
      providerOptions: { openai: { strictJsonSchema: false } },
      // The lenient transport schema keeps semantically broken tokens visible to us.
      output: Output.array({
        element: lyricsAnalysisTransportSchema,
        name: 'lyric_lines',
        description: 'One annotated lyric line'
      })
    });

    const drafts: LyricsAnalysisTransportLine[] = [];
    let emittedAny = false;
    let textTail = '';

    // Quality of an emitted line, higher is better: covering the whole line first, then how many
    // words it carries. A repair that loses a word or shrinks the annotation never wins.
    const lineQuality = (line: LyricsAnalysisLine) =>
      (line.status === 'degraded' ? 0 : 1_000_000) + line.tokens.length;

    // Diagnostic sample of rejected raw tokens, bounded per pass so a pathological batch cannot
    // flood the log. Shape only (the fields that decide rejection), never the whole element.
    const droppedSamples: Array<Record<string, unknown>> = [];
    const acceptLine = (line: LyricsAnalysisLine, dropped?: unknown[]) => {
      if (dropped && dropped.length > 0 && droppedSamples.length < 6) {
        for (const token of dropped.slice(0, 2)) {
          droppedSamples.push({ lineId: line.lineId, text: line.text, ...(token as object) });
        }
      }
      const incumbent = input.preferOver?.get(line.lineId);
      if (incumbent && lineQuality(line) <= lineQuality(incumbent)) return;
      finalLines.set(line.lineId, line);
      onLine(line, input.passKind);
    };

    // The element stream rejects (terminates with a throw) when the final envelope parse fails —
    // the same failure `result.output` reports. Catch it here so the salvage pass below still
    // runs over the raw completion instead of the exception bubbling out of streamPass.
    let streamFailure: unknown;
    try {
      for await (const element of result.elementStream) {
        emittedAny = true;
        drafts.push(element);
        const lineId = typeof element.lineId === 'string' ? element.lineId.trim() : '';
        const text = textByLineId.get(lineId);
        if (!text) continue;

        const outcome = validateAndNormalizeLineAnalysis({ draft: element, text });
        if (outcome.kind === 'ok') {
          acceptLine({ ...outcome.line, droppedTokenCount: outcome.droppedTokenCount }, outcome.droppedTokens);
        }
      }
    } catch (error) {
      streamFailure = error;
    }

    try {
      for await (const textChunk of result.textStream) {
        textTail = `${textTail}${textChunk}`.slice(-400);
      }
    } catch {
      // Text stream errors ride along with the output failure handled below.
    }

    try {
      const [passFinishReason, passUsage] = await Promise.all([
        result.finishReason,
        result.usage
      ]);
      finishReason = passFinishReason ?? undefined;
      passOutputTokens = passUsage?.outputTokens ?? undefined;
      passInputTokens = passUsage?.inputTokens ?? undefined;
      if (typeof passOutputTokens === 'number') totalOutputTokens.push(passOutputTokens);
      if (typeof passInputTokens === 'number') totalInputTokens.push(passInputTokens);
    } catch {
      // usage is best-effort; a rejected output promise is handled below.
    }

    // `result.output` is the authoritative pass/fail signal; a partial element stream is not success.
    try {
      await result.output;
    } catch (error) {
      if (signal?.aborted) throw error;

      const failure = streamError ?? streamFailure ?? error;
      if (NoObjectGeneratedError.isInstance(failure)) {
        // The raw completion is the only way to see why the model output defied the schema
        // (markdown fences, truncated JSON, a different shape entirely).
        logWorkerWarning('Analysis pass generated no parsable elements.', {
          finishReason: failure.finishReason,
          usage: failure.usage,
          responseText: (failure.text ?? '').slice(0, 600),
          causeMessage:
            failure.cause instanceof Error ? failure.cause.message : String(failure.cause ?? '')
        });
      }

      // Envelope salvage: when the all-or-nothing final parse voids the batch, the raw
      // completion is usually still full of usable lines. Extract every recoverable element
      // (fences, transposed closers, truncation are tolerated) and run the same validation
      // streamed elements would have gone through. This runs even when some elements streamed:
      // partial parsing stops at the first corruption point, and everything after it is exactly
      // what salvage exists for. Already-finalized lineIds are skipped so streamed lines are
      // never re-emitted; the pass only stays failed if nothing usable came out of either path.
      let salvagedAny = false;
      const salvaged = salvageEnvelopeElements(failure);
      if (salvaged) {
        for (const draft of salvaged) {
          const lineId = typeof draft.lineId === 'string' ? draft.lineId.trim() : '';
          if (finalLines.has(lineId)) continue;
          const text = textByLineId.get(lineId);
          if (!text) continue;
          drafts.push(draft);
          emittedAny = true;
          const outcome = validateAndNormalizeLineAnalysis({ draft, text });
          if (outcome.kind === 'ok') {
            salvagedAny = true;
            acceptLine({ ...outcome.line, droppedTokenCount: outcome.droppedTokenCount }, outcome.droppedTokens);
          }
        }
      }

      // A provider/network failure before anything streamed (or salvaged) is fatal.
      if (!emittedAny && !salvagedAny) throw failure;

      // Config-level failures will fail every pass, so surface them instead of repairing.
      // Everything else keeps the lines that did stream; the repair pass covers the gaps.
      const failureCode = mapProviderError(failure).code;
      if (failureCode === 'authFailed' || failureCode === 'endpointUnsupported') throw failure;
    }

    const receivedIds = new Set(drafts.map((draft) => `${draft.lineId ?? ''}`.trim()));
    const failedIds = new Map<string, string>();

    // Incomplete annotations are re-asked like invalid ones: a line whose trailing word was never
    // emitted is unusable for study even though every span it did emit is well-formed. Repair
    // passes are excluded (the line already had its second chance); the degraded status the
    // validator set is what surfaces any gap that survives.
    if (input.passKind === 'first') {
      for (const [lineId, line] of finalLines) {
        if (line.status !== 'degraded') continue;
        if (!input.targetLines.some((target) => target.lineId === lineId)) continue;
        failedIds.set(lineId, 'incomplete-coverage');
      }
    }

    for (const line of input.targetLines) {
      if (failedIds.has(line.lineId)) continue;
      if (finalLines.has(line.lineId)) continue;
      failedIds.set(line.lineId, receivedIds.has(line.lineId) ? 'invalid-analysis' : 'missing-line');
    }

    if (failedIds.size > 0) {
      const [finishReason, usage] = await Promise.all([
        result.finishReason,
        result.usage
      ]);
      logWorkerWarning('Lyrics analysis pass finished with gaps.', {
        targetLines: input.targetLines.length,
        parsedElements: drafts.length,
        failed: failedIds.size,
        reasons: [...failedIds.values()].reduce((acc, reason) => {
          acc[reason] = (acc[reason] ?? 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        finishReason,
        outputTokens: usage.outputTokens,
        droppedSamples,
        textTail
      });
    }

    return { failedIds, passStartedAt, finishReason, passOutputTokens, passInputTokens };
  };

  const emitPassTelemetry = (input: {
    sessionId: string;
    batchIndex: number;
    passKind: 'first' | 'repair';
    targetLines: number;
    okLines: number;
    failedLines: number;
    passStartedAt: number;
    finishReason: string | undefined;
    outputTokens: number | undefined;
    inputTokens: number | undefined;
    repairedLines?: number;
  }) => {
    if (!options.onPassCompleted) return;

    const event: AnalysisPassTelemetryEvent = {
      v: LYRICS_ANALYSIS_TELEMETRY_VERSION,
      sessionId: input.sessionId,
      ts: Date.now(),
      kind: 'analysis-pass',
      batchIndex: input.batchIndex,
      passKind: input.passKind,
      targetLines: input.targetLines,
      okLines: input.okLines,
      failedLines: input.failedLines,
      durationMs: Date.now() - input.passStartedAt,
      finishReason: input.finishReason ?? null,
      outputTokens: input.outputTokens ?? null,
      inputTokens: input.inputTokens ?? null,
      ...(input.repairedLines !== undefined ? { repairedLines: input.repairedLines } : {})
    };
    options.onPassCompleted(event);
  };

  // Gateways cap max_tokens per request (this one clamps at 5000 completion tokens) and clamp
  // silently — the run just ends with finishReason "length" mid-array. Since the language
  // profiles demand full pronunciation on every token (kana+romaji / IPA), a dense line runs
  // ~1000 output tokens, so keep batches small enough that the worst case fits under the cap.
  const ANALYSIS_BATCH_SIZE = 4;
  const sessionId = options.sessionId ?? '';

  // Batches run through a bounded pool (window starts at min(4, cap), AIMD-adjusts per batch
  // settle) instead of a serial for/await — whole-song wall time then approaches
  // ceil(lines / window) × T_batch instead of sum over batches.
  const window = new ConcurrencyWindow(config.maxConcurrency ?? 4);
  const reportWindowStats = () => options.onConcurrencyStats?.(window.stats);
  // First abort/permanent-config failure seen by any batch. Transient failures do NOT set this —
  // their batch's lines simply join the repair queue. Checked before every pool launch so a
  // fatal failure stops the remaining batches from starting.
  let fatalFailure: unknown;

  const chunk = <T>(items: T[], size: number): T[][] => {
    const chunks: T[][] = [];
    for (let offset = 0; offset < items.length; offset += size) chunks.push(items.slice(offset, offset + size));
    return chunks;
  };

  /**
   * Runs one streamPass wrapped for the pool:AIMD settles on the pass outcome (a thrown pass is
   * a failure only when the cause is transient — config/abort failures are fatal and reported
   * as-is), and the pass event carries the window value that was in effect for the batch.
   */
  const pooledStreamPass = async (input: {
    batchIndex: number;
    prompt: string;
    targetLines: LyricsAnalysisInputLine[];
    maxOutputTokens: number;
    passKind: 'first' | 'repair';
    preferOver?: Map<string, LyricsAnalysisLine>;
  }) => {
    try {
      const pass = await streamPass({
        prompt: input.prompt,
        targetLines: input.targetLines,
        maxOutputTokens: input.maxOutputTokens,
        passKind: input.passKind,
        ...(input.preferOver ? { preferOver: input.preferOver } : {})
      });
      window.onSuccess();
      emitPassTelemetry({
        sessionId,
        batchIndex: input.batchIndex,
        passKind: input.passKind,
        targetLines: input.targetLines.length,
        okLines: input.targetLines.length - pass.failedIds.size,
        failedLines: pass.failedIds.size,
        passStartedAt: pass.passStartedAt,
        finishReason: pass.finishReason,
        outputTokens: pass.passOutputTokens,
        inputTokens: pass.passInputTokens
      });
      reportWindowStats();
      return pass;
    } catch (error) {
      // Aborts and permanent config failures end the run either way; only transient
      // provider trouble (429/5xx/timeout/network) teaches the window something.
      if (signal?.aborted || !isThrottlingError(error)) fatalFailure ??= error;
      else {
        window.onFailure();
        reportWindowStats();
      }
      throw error;
    }
  };

  const firstPassFailures = new Map<string, string>();

  const firstPassBatches = chunk(lines, ANALYSIS_BATCH_SIZE);
  const firstPassTasks = firstPassBatches.map((batch, batchIndex) => async () => {
    const pass = await pooledStreamPass({
      batchIndex,
      prompt: buildUserPrompt({ uiLanguage, songTitle, songArtists, lines: batch }),
      targetLines: batch,
      maxOutputTokens: 1000 + batch.length * 500,
      passKind: 'first'
    });
    for (const [lineId, reason] of pass.failedIds) firstPassFailures.set(lineId, reason);
  });

  // Every batch runs even when siblings reject (PoolOutcome separates errors from results), so
  // one endpoint hiccup costs only its own lines — the repair pass covers them. A FATAL failure
  // (auth, abort) instead stops unstarted batches: there is no point paying for calls that will
  // fail identically. Either way the FIRST submission-order error is re-thrown, the same outcome
  // the serial loop propagated, with deterministic error identity for tests and callers.
  const firstPassOutcome = await runWithConcurrency(
    firstPassTasks,
    () => window.value,
    () => fatalFailure !== undefined
  );
  const firstErrorIndex = [...firstPassOutcome.errors.keys()].sort((a, b) => a - b)[0];
  if (firstErrorIndex !== undefined) {
    throw firstPassOutcome.errors.get(firstErrorIndex);
  }

  if (firstPassFailures.size > 0 && !signal?.aborted) {
    const repairTargets = lines
      .filter((line) => firstPassFailures.has(line.lineId))
      .slice(0, MAX_REPAIR_LINES)
      .map((line) => ({ ...line, reason: firstPassFailures.get(line.lineId) ?? 'invalid-analysis' }));

    options.onRepairStarted?.(repairTargets.map((line) => line.lineId));

    const repairBatches = chunk(repairTargets, ANALYSIS_BATCH_SIZE);
    let repairedLines = 0;
    const repairTasks = repairBatches.map((batch, batchIndex) => async () => {
      const pass = await pooledStreamPass({
        batchIndex,
        prompt: buildRepairPrompt({ uiLanguage, songTitle, songArtists, lines: batch }),
        targetLines: batch,
        maxOutputTokens: 600 + batch.length * 500,
        passKind: 'repair',
        preferOver: finalLines
      });
      repairedLines += batch.length - pass.failedIds.size;
      return { batch, pass, batchIndex, repairedLinesAfter: repairedLines };
    });

    try {
      // Repair quality gate: `preferOver` reads `finalLines`, which every pass mutates through
      // acceptLine — running batches concurrently means a repair may compare against a line a
      // sibling repair just improved. That is safe (strictly-better-only acceptance is
      // order-insensitive for the final state) and the same guarantee the serial loop had.
      const repairOutcome = await runWithConcurrency(
        repairTasks,
        () => window.value,
        () => fatalFailure !== undefined
      );
      for (const entry of repairOutcome.results) {
        if (!entry) continue;
        emitPassTelemetry({
          sessionId,
          batchIndex: entry.batchIndex,
          passKind: 'repair',
          targetLines: entry.batch.length,
          okLines: entry.batch.length - entry.pass.failedIds.size,
          failedLines: entry.pass.failedIds.size,
          passStartedAt: entry.pass.passStartedAt,
          finishReason: entry.pass.finishReason,
          outputTokens: entry.pass.passOutputTokens,
          inputTokens: entry.pass.passInputTokens,
          repairedLines: entry.repairedLinesAfter
        });
      }
      const repairErrorIndex = [...repairOutcome.errors.keys()].sort((a, b) => a - b)[0];
      if (repairErrorIndex !== undefined) throw repairOutcome.errors.get(repairErrorIndex);
    } catch (error) {
      // A failed repair pass must not discard the lines that already succeeded.
      if (signal?.aborted) throw error;
    }
  }

  reportWindowStats();

  return {
    lines: lines
      .map((line) => finalLines.get(line.lineId))
      .filter((line): line is LyricsAnalysisLine => line !== undefined),
    failedLineIds: lines
      .filter((line) => !finalLines.has(line.lineId))
      .map((line) => line.lineId),
    passStats: {
      outputTokens: totalOutputTokens.length > 0 ? totalOutputTokens.reduce((a, b) => a + b, 0) : undefined,
      inputTokens: totalInputTokens.length > 0 ? totalInputTokens.reduce((a, b) => a + b, 0) : undefined
    }
  };
};

export interface TestProviderOptions {
  baseURL: string;
  modelId: string;
  apiKey: string;
  signal?: AbortSignal;
}

/** Cheap round-trip used by the "Test connection" button in Settings. */
export const testLyricsAnalysisProvider = async (
  options: TestProviderOptions
): Promise<LyricsAnalysisProviderTestResult> => {
  const startedAt = Date.now();

  if (!options.baseURL.trim())
    return {
      ok: false,
      message: 'Base URL is empty.',
      latencyMs: 0,
      errorCode: 'endpointUnsupported'
    };

  if (!options.apiKey.trim())
    return { ok: false, message: 'API key is empty.', latencyMs: 0, errorCode: 'authFailed' };

  try {
    const result = await generateText({
      model: createModel({ ...options, baseURL: normalizeBaseURL(options.baseURL) }),
      prompt: 'Reply with the single word: ok',
      maxOutputTokens: 16,
      temperature: 0,
      abortSignal: options.signal,
      providerOptions: { openai: { strictJsonSchema: false } }
    });

    const text = result.text.trim();
    const hasContent = text.length > 0;

    return {
      ok: hasContent,
      message: hasContent
        ? `Connected. Model replied in ${Date.now() - startedAt} ms.`
        : 'The endpoint responded but returned an empty message.',
      latencyMs: Date.now() - startedAt,
      ...(hasContent ? {} : { errorCode: 'invalidResponse' as const })
    };
  } catch (error) {
    const mapped = mapProviderError(error);

    return {
      ok: false,
      message: mapped.message,
      statusCode: mapped.statusCode,
      latencyMs: Date.now() - startedAt,
      errorCode: mapped.code
    };
  }
};
