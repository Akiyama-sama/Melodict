import OpenAI, { APIError } from 'openai';

import {
  LYRICS_ANALYSIS_DEFAULT_MODEL_ID,
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
import { EnvelopeStreamParser } from './envelopeStream';
import {
  ConcurrencyWindow,
  isThrottlingError,
  parseRetryAfterMs,
  runWithConcurrency
} from './concurrencyPool';
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

/**
 * The server-advised retry interval of a failed call, in milliseconds, when the transport carries
 * one (a 429's `Retry-After` header on the openai SDK's APIError). Everything else — timeouts,
 * resets, plain 5xx — has no advised interval and returns undefined; the window then applies its
 * own short default cooldown.
 */
const retryAfterMsFromError = (error: unknown): number | undefined => {
  if (!(error instanceof APIError)) return undefined;
  const retryAfter = error.headers?.get('retry-after');
  return parseRetryAfterMs(retryAfter ?? undefined);
};

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

export const createClient = (config: LyricsAnalysisProviderConfig) =>
  new OpenAI({
    apiKey: config.apiKey || 'not-needed',
    baseURL: normalizeBaseURL(config.baseURL),
    // Retries belong to the AIMD window, which owns back-off (Retry-After cooldowns, shrinking
    // concurrency). The SDK retrying silently underneath would multiply wire traffic against a
    // rate-limited endpoint and corrupt the window's view of what the endpoint tolerated.
    maxRetries: 0
  });

/** The wire type of the injected OpenAI client, so tests can script it without the real class. */
export type AnalysisOpenAIClient = Pick<OpenAI, 'chat'>;

export const mapProviderError = (error: unknown): LyricsAnalysisError => {
  const mapStatus = (statusCode: number | undefined): LyricsAnalysisErrorCode => {
    if (statusCode === 401 || statusCode === 403) return 'authFailed';
    if (statusCode === 404 || statusCode === 405) return 'endpointUnsupported';
    if (statusCode === 400 || statusCode === 422) return 'invalidResponse';
    return 'unknown';
  };

  if (error instanceof APIError) {
    const code = mapStatus(error.status);
    return {
      code,
      statusCode: error.status,
      message:
        code === 'authFailed'
          ? 'The API key was rejected by the endpoint (401/403).'
          : code === 'endpointUnsupported'
            ? 'The endpoint does not expose an OpenAI-compatible chat completions API.'
            : code === 'invalidResponse'
              ? 'The endpoint rejected the request. The model may not support JSON output.'
              : `The request failed${error.status ? ` with status ${error.status}` : ''}.`
    };
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

/**
 * Whether an endpoint's 400/422 names `response_format` (in any API's dialect) as the rejected
 * field — magpie's gateway refusal heuristic (internal/gateway/format.go), which per that file's
 * own comment already covers DeepSeek's "This response_format type is unavailable now". When this
 * matches, the request is retried with no `response_format` at all and the endpoint is remembered
 * (providerCapabilities) so future sessions skip the field from the start.
 */
const FORMAT_REFUSAL_REGEX =
  /response_format|json_schema|json_object|structured.?output|response_?mime_?type/i;

export const refusesResponseFormat = (error: unknown): boolean => {
  if (!(error instanceof APIError)) return false;
  if (error.status !== 400 && error.status !== 422) return false;
  // The SDK puts the parsed JSON body on `.error` and keeps the raw text in the message; check
  // both so relays that answer with a non-JSON error page still match.
  const body = error.error !== undefined ? JSON.stringify(error.error) : error.message;
  return FORMAT_REFUSAL_REGEX.test(body);
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
   * Starting in-flight-batch ceiling for the AIMD window. The caller (session manager) seeds it
   * from the cross-session concurrency memory so repeat runs start at what this endpoint last
   * converged on, instead of re-probing from the default every time. Absent = 4.
   */
  initialConcurrency?: number;
  /**
   * Set when this endpoint is known to reject the `response_format` field (a persisted refusal,
   * providerCapabilities). The wire request then carries no format at all — the system prompt
   * alone tells the model what shape to emit.
   */
  skipResponseFormat?: boolean;
  /** Fired when the endpoint live-refuses response_format, so the caller can persist the fact. */
  onFormatRefused?: () => void;
  /**
   * Test seam: overrides how the OpenAI client is constructed from the provider config. Defaults
   * to the real `openai` SDK client; orchestration tests inject a scripted fake here so they run
   * without an actual endpoint or Electron modules.
   */
  createClient?: (config: LyricsAnalysisProviderConfig) => AnalysisOpenAIClient;
}

/** Thrown when a pass produced no parsable element at all; carries the raw completion for tests. */
export class AnalysisOutputError extends Error {
  readonly responseText: string;
  readonly finishReason: string | undefined;

  constructor(responseText: string, finishReason?: string) {
    super('The model response contained no parsable analysis elements.');
    this.name = 'AnalysisOutputError';
    this.responseText = responseText;
    this.finishReason = finishReason;
  }
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
  const client = options.createClient?.(config) ?? createClient(config);
  const skipResponseFormat = options.skipResponseFormat ?? false;
  const onFormatRefused = options.onFormatRefused ?? (() => undefined);
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
    let textTail = '';

    // The completion text as it accumulates (for salvage), plus the tolerant parser that emits
    // each element the moment its brackets balance.
    let completionText = '';
    const parser = new EnvelopeStreamParser();
    const drafts: LyricsAnalysisTransportLine[] = [];
    let emittedAny = false;

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

    const acceptDraft = (draft: LyricsAnalysisTransportLine): boolean => {
      const lineId = typeof draft.lineId === 'string' ? draft.lineId.trim() : '';
      const text = textByLineId.get(lineId);
      if (!text) return false;
      drafts.push(draft);
      emittedAny = true;
      const outcome = validateAndNormalizeLineAnalysis({ draft, text });
      if (outcome.kind === 'ok') {
        acceptLine({ ...outcome.line, droppedTokenCount: outcome.droppedTokenCount }, outcome.droppedTokens);
        return true;
      }
      return false;
    };

    const consumeChunkDelta = (delta: string | undefined | null) => {
      if (!delta) return;
      completionText += delta;
      textTail = `${textTail}${delta}`.slice(-400);
      for (const element of parser.push(delta)) acceptDraft(element);
    };

    const readStream = async (askForJson: boolean) => {
      const stream = await client.chat.completions.create(
        {
          model: config.modelId || LYRICS_ANALYSIS_DEFAULT_MODEL_ID,
          messages: [
            { role: 'system', content: buildSystemPrompt(uiLanguage, languageDirective) },
            { role: 'user', content: input.prompt }
          ],
          temperature: 0,
          max_tokens: input.maxOutputTokens,
          stream: true,
          stream_options: { include_usage: true },
          // `json_object` is the OpenAI/DeepSeek/GLM common denominator. `json_schema` bought
          // nothing (the transport schema was deliberately lenient; app-side validation owns
          // correctness) and is exactly what DeepSeek's API answers 400 to. Endpoints that
          // reject even `json_object` are remembered and asked without the field entirely —
          // the system prompt already carries the full shape description.
          ...(askForJson ? { response_format: { type: 'json_object' as const } } : {})
        },
        { signal }
      );

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        consumeChunkDelta(choice?.delta?.content);
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        // `stream_options.include_usage` puts the token totals on a trailing choice-less chunk.
        if (chunk.usage) {
          passOutputTokens = chunk.usage.completion_tokens ?? undefined;
          passInputTokens = chunk.usage.prompt_tokens ?? undefined;
        }
      }
    };

    try {
      await readStream(true);
    } catch (error) {
      if (signal?.aborted) throw error;

      // A relay/server that turns `response_format` away is retried once without the field (the
      // caller persists the refusal so later sessions skip the field from the start). The system
      // prompt still tells the model exactly what shape to emit, so nothing else changes.
      if (refusesResponseFormat(error) && !skipResponseFormat) {
        logWorkerWarning('Endpoint refused response_format; retrying without it.', {
          baseURL: config.baseURL,
          modelId: config.modelId,
          status: error instanceof APIError ? error.status : undefined
        });
        onFormatRefused();
        await readStream(false);
      } else {
        throw error;
      }
    }

    if (typeof passOutputTokens === 'number') totalOutputTokens.push(passOutputTokens);
    if (typeof passInputTokens === 'number') totalInputTokens.push(passInputTokens);

    // Salvage: the tolerant parser drops elements it could not close (truncation, a runaway
    // middle), and a repair over the raw completion recovers exactly those. Already-emitted
    // lineIds are skipped, so salvage can never re-emit or downgrade a streamed line.
    let salvagedAny = false;
    const salvaged = salvageEnvelopeElements(completionText);
    if (salvaged) {
      for (const draft of salvaged) {
        const lineId = typeof draft.lineId === 'string' ? draft.lineId.trim() : '';
        if (finalLines.has(lineId)) continue;
        if (acceptDraft(draft)) salvagedAny = true;
      }
    }

    // A provider/network failure before anything streamed (or salvaged) is fatal.
    if (!emittedAny && !salvagedAny) {
      // The raw completion is the only way to see why the model defied the expected shape
      // (markdown fences, truncated JSON, a different shape entirely).
      logWorkerWarning('Analysis pass generated no parsable elements.', {
        finishReason,
        outputTokens: passOutputTokens,
        inputTokens: passInputTokens,
        responseText: completionText.slice(0, 600)
      });
      throw new AnalysisOutputError(completionText, finishReason);
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
      logWorkerWarning('Lyrics analysis pass finished with gaps.', {
        targetLines: input.targetLines.length,
        parsedElements: drafts.length,
        failed: failedIds.size,
        reasons: [...failedIds.values()].reduce((acc, reason) => {
          acc[reason] = (acc[reason] ?? 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        finishReason,
        outputTokens: passOutputTokens,
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

  // Batches run through a bounded pool (window starts at the cross-session seed, AIMD-adjusts per
  // batch settle) instead of a serial for/await — whole-song wall time then approaches
  // ceil(lines / window) × T_batch instead of sum over batches.
  const window = new ConcurrencyWindow(options.initialConcurrency);
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
   * Batch-level retry for the two failure shapes a single request can hit on its own:
   *
   * - A transient provider error (429/5xx/timeout/network): the AIMD window has already cooled
   *   down and shrunk when `pooledStreamPass` saw the error, so the retry rides that cooldown
   *   instead of hammering the endpoint.
   * - An empty output (`AnalysisOutputError`): a reasoning model that burned its whole budget on
   *   thinking. A fresh request is a new coin flip at temperature 0 (server-side batching/load
   *   changes the reasoning length), and Stay Alive's logs show repair is not enough on its own —
   *   the repair pass can hit the same wall the first pass did.
   *
   * Exactly one retry: a second failure means the endpoint/model is having a bad time with this
   * batch, and the normal degradation (first pass → repair queue; repair pass → failedLineIds)
   * takes over. Fatal errors (auth/abort/config) are re-thrown untouched.
   */
  const pooledStreamPassWithRetry = async (input: {
    batchIndex: number;
    prompt: string;
    targetLines: LyricsAnalysisInputLine[];
    maxOutputTokens: number;
    passKind: 'first' | 'repair';
    preferOver?: Map<string, LyricsAnalysisLine>;
  }) => {
    try {
      return await pooledStreamPass(input);
    } catch (error) {
      const retryable = !signal?.aborted && (isThrottlingError(error) || error instanceof AnalysisOutputError);
      if (!retryable) throw error;
      logWorkerWarning('Batch failed with a retryable error; retrying once.', {
        batchIndex: input.batchIndex,
        passKind: input.passKind,
        lines: input.targetLines.length,
        reason: error instanceof AnalysisOutputError ? 'empty-output' : 'transient',
        throttled: isThrottlingError(error)
      });
      // pooledStreamPass already taught the window (cooldown/shrink); waitThroughCooldown holds
      // this slot through the advised interval before the wire sees the retry.
      return pooledStreamPass(input);
    }
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
    // A Retry-After cooldown holds this batch's wire traffic without releasing its pool slot:
    // the batch stays counted in-flight (no idle deadlock in the pool) and simply sends nothing
    // until the window says the server is ready to be hit again.
    await window.waitThroughCooldown();
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
      // An empty model output (AnalysisOutputError) is NOT fatal and NOT a load signal: a
      // reasoning model that burns its whole budget thinking says nothing about endpoint
      // congestion, so the window neither shrinks nor cools — the batch-level retry (and the
      // repair queue) own the recovery.
      if (signal?.aborted || (!isThrottlingError(error) && !(error instanceof AnalysisOutputError))) {
        fatalFailure ??= error;
      } else if (isThrottlingError(error)) {
        window.onThrottled(retryAfterMsFromError(error));
        reportWindowStats();
      }
      throw error;
    }
  };

  const firstPassFailures = new Map<string, string>();

  const firstPassBatches = chunk(lines, ANALYSIS_BATCH_SIZE);
  const firstPassTasks = firstPassBatches.map((batch, batchIndex) => async () => {
    // A pass that produced nothing (AnalysisOutputError — a reasoning model burning its whole
    // budget before any content) still only costs its batch's lines: catch the throw, queue every
    // line for repair, and keep the batch's failure out of the pool's error list so it can never
    // surface as the run's outcome.
    let pass;
    try {
      pass = await pooledStreamPassWithRetry({
        batchIndex,
        prompt: buildUserPrompt({ uiLanguage, songTitle, songArtists, lines: batch }),
        targetLines: batch,
        // Reasoning models (deepseek-flash et al.) spend `reasoning_tokens` out of the same
        // max_tokens budget before any content streams — observed batches burning 6000/6000 with
        // an empty body and finishReason "length". The budget is a cap, not a prepayment, so
        // leave headroom for thinking instead of tuning the batch size around the tightest
        // reasoner; endpoints that clamp lower (the local gateway stops at 5000) just clamp
        // silently, which the tolerant parser and the repair pass already survive.
        maxOutputTokens: 1000 + batch.length * 500 + 5000,
        passKind: 'first'
      });
    } catch (error) {
      if (signal?.aborted || !(error instanceof AnalysisOutputError)) throw error;
      for (const line of batch) firstPassFailures.set(line.lineId, 'missing-line');
      return;
    }
    for (const [lineId, reason] of pass.failedIds) firstPassFailures.set(lineId, reason);
  });

  // Every batch runs even when siblings reject (PoolOutcome separates errors from results), so
  // one endpoint hiccup costs only its own lines — the repair pass covers them. A FATAL failure
  // (auth, abort) instead stops unstarted batches: there is no point paying for calls that will
  // fail identically. Either way the FIRST submission-order error is re-thrown, the same outcome
  // the serial loop propagated, with deterministic error identity for tests and callers.
  const firstPassOutcome = await runWithConcurrency(firstPassTasks, () => window.value, () =>
    fatalFailure !== undefined
  );
  const firstErrorIndex = [...firstPassOutcome.errors.keys()].sort((a, b) => a - b)[0];
  if (firstErrorIndex !== undefined) {
    throw firstPassOutcome.errors.get(firstErrorIndex);
  }

  if (firstPassFailures.size > 0 && !signal?.aborted) {
    // One repair wave: chunk the targets, run every batch (each with its own retry), emit one
    // telemetry event per batch. Returns the number of targets still missing after the wave, so
    // the caller can decide whether a second wave is worth its wire cost. Targets carry the
    // first-pass failure `reason`, which the repair prompt re-states for the model.
    const runRepairWave = async (
      targets: Array<LyricsAnalysisInputLine & { reason: string }>
    ): Promise<number> => {
      const repairBatches = chunk(targets, ANALYSIS_BATCH_SIZE);
      let repairedLines = 0;
      const repairTasks = repairBatches.map((batch, batchIndex) => async () => {
        const pass = await pooledStreamPassWithRetry({
          batchIndex,
          prompt: buildRepairPrompt({ uiLanguage, songTitle, songArtists, lines: batch }),
          targetLines: batch,
          maxOutputTokens: 600 + batch.length * 500 + 5000,
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
        const repairOutcome = await runWithConcurrency(repairTasks, () => window.value, () =>
          fatalFailure !== undefined
        );
        for (const entry of repairOutcome.results) {
          if (!entry) continue;
          // Telemetry for repair waves is emitted HERE ONLY — pooledStreamPass would also emit
          // one for the same pass, and Stay Alive's logs showed every repair event twice.
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

      return targets.filter((line) => !finalLines.has(line.lineId)).length;
    };

    const repairTargets = lines
      .filter((line) => firstPassFailures.has(line.lineId))
      .slice(0, MAX_REPAIR_LINES)
      .map((line) => ({ ...line, reason: firstPassFailures.get(line.lineId) ?? 'invalid-analysis' }));

    options.onRepairStarted?.(repairTargets.map((line) => line.lineId));

    const stillMissingAfterFirstWave = await runRepairWave(repairTargets);

    // A second wave only when the first made progress and gaps remain: repair re-asks the same
    // lines with the same model, so a wave that recovered nothing (the endpoint stuck on the same
    // wall — truncation, reasoning burnout) will not do better on repeat and the lines go to
    // failedLineIds instead of burning another round of tokens.
    if (stillMissingAfterFirstWave > 0 && stillMissingAfterFirstWave < repairTargets.length) {
      const secondWaveTargets = lines
        .filter((line) => !finalLines.has(line.lineId))
        .slice(0, MAX_REPAIR_LINES)
        .map((line) => ({
          ...line,
          reason: firstPassFailures.get(line.lineId) ?? 'invalid-analysis'
        }));
      logWorkerWarning('Repair pass left gaps with progress; running a second repair wave.', {
        stillMissing: stillMissingAfterFirstWave,
        firstWaveTargets: repairTargets.length
      });
      await runRepairWave(secondWaveTargets);
    }
  }

  reportWindowStats();

  return {
    // The run's convergence point goes back to the caller, which persists it per endpoint for
    // the next session's window seed (concurrencyMemory.ts). Read after the last settle so the
    // ceiling includes any final-pass corrections.
    learnedConcurrency: window.ceiling,
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
    const client = createClient({ ...options, baseURL: normalizeBaseURL(options.baseURL) });
    const completion = await client.chat.completions.create(
      {
        model: options.modelId || LYRICS_ANALYSIS_DEFAULT_MODEL_ID,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        max_tokens: 16,
        temperature: 0
      },
      { signal: options.signal }
    );

    const text = completion.choices[0]?.message?.content?.trim() ?? '';
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
