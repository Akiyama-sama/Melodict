import { createOpenAI } from '@ai-sdk/openai';
import {
  APICallError,
  generateText,
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
import { buildLanguageDirective } from '../../common/lyricsLanguageProfiles';

// This module runs inside the lyrics-analysis utility process, which cannot import Electron
// modules (`app` is not exported there — importing the main logger crashes the worker), so
// diagnostics go to stderr, which `stdio: 'inherit'` pipes into the main-process console.
const logWorkerWarning = (message: string, data: Record<string, unknown>) => {
  console.warn(`[lyrics-analysis] ${message}`, JSON.stringify(data));
};

const MAX_REPAIR_LINES = 40;

const SYSTEM_PROMPT_TEMPLATE = [
  'You annotate song lyrics for a language-learning music player.',
  'Return ONLY a JSON object. Do not wrap it in markdown fences and do not add any prose before or after it.',
  'The JSON must have this shape: {"elements":[{"lineId":"...","translation":"...","tokens":[...]}]}',
  'Rules:',
  '- Echo back the exact lineId you were given. Never invent lineIds and never rewrite the lyric text.',
  '- Split each line into 1-6 clickable learning tokens: words, particles, set phrases, or inflections worth studying.',
  '- startChar/endChar are 0-based character offsets into that exact line, endChar exclusive. They must be ordered, non-overlapping, and within the line length.',
  '- Every token needs card.meaning (what it means in this line, not a dictionary dump) and card.grammarFunction (its role in this sentence).',
  '- Include card.term (dictionary form) and card.pronunciation when useful: kana/romaji for Japanese, ipa/us/uk for English, hangul/romanized for Korean, pinyin for Chinese.',
  '- Set language to one of: en, ja, ko, zh, unknown.',
  '- translation is the natural meaning of the whole line.',
  '- Cover every line you are given, in the given order.',
  // Language discipline: without an explicit per-request instruction, models drift between
  // output languages mid-song (first lines English, later lines Chinese) because nothing in the
  // prompt pins the gloss language to the user's UI language.
  'OUTPUT LANGUAGE (critical): every value the user reads — card.meaning, card.grammarFunction, and translation — MUST be written in %OUTPUT_LANGUAGE%. Never switch languages between elements: the first element and the last element use the same language. Do not mix languages within one JSON object.',
  'The only exceptions are quoted source-language words inside a meaning (e.g. the lyric word itself) and the pronunciation fields, which stay in their script.',
  // Human romanization reference: when the source provides one, it outranks the model's own
  // romanization knowledge — copy it verbatim instead of re-deriving. Token granularity stays
  // word/particle level; the reference must never be read as a per-syllable tokenization cue
  // (observed: the model started emitting one token per mora and produced single-token lines).
  'ROMANIZED REFERENCE: some lines carry a "romanizedText" field — a HUMAN-AUTHORED romanization of that exact line. Use it as the ground truth for pronunciation: for each of your tokens, copy the matching segment(s) of the reference into card.pronunciation (keep the author\'s spacing). Do NOT change token granularity to match it — keep your normal word/particle-level tokens (1-6 per line); the reference is pronounced syllable-by-syllable but your tokens are not.'
].join('\n');

const OUTPUT_LANGUAGE_BY_UI_LANGUAGE: Record<string, string> = {
  zh: 'Simplified Chinese (简体中文)',
  'zh-CN': 'Simplified Chinese (简体中文)',
  'zh-TW': 'Traditional Chinese (繁體中文)',
  en: 'English',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)'
};

const getOutputLanguageDirective = (uiLanguage: string) => {
  const normalized = (uiLanguage || 'en').toLowerCase();
  return (
    OUTPUT_LANGUAGE_BY_UI_LANGUAGE[normalized] ??
    OUTPUT_LANGUAGE_BY_UI_LANGUAGE[normalized.split('-')[0] ?? ''] ??
    `English (the UI language code was ${uiLanguage}; default to English)`
  );
};

const buildSystemPrompt = (uiLanguage: string, languageDirective?: string) =>
  SYSTEM_PROMPT_TEMPLATE.replace(
    '%OUTPUT_LANGUAGE%',
    getOutputLanguageDirective(uiLanguage)
  ) + (languageDirective ? `\n\n${languageDirective}` : '');

const buildUserPrompt = (input: {
  uiLanguage: string;
  songTitle: string;
  songArtists: string[];
  lines: LyricsAnalysisInputLine[];
}) =>
  JSON.stringify(
    {
      uiLanguage: input.uiLanguage,
      outputLanguageRequirement: `All human-readable fields (meaning, grammarFunction, translation) must be in ${getOutputLanguageDirective(input.uiLanguage)}, consistently for every element.`,
      songTitle: input.songTitle,
      songArtists: input.songArtists,
      lines: input.lines
    },
    null,
    2
  );

const buildRepairPrompt = (input: {
  uiLanguage: string;
  songTitle: string;
  songArtists: string[];
  lines: Array<LyricsAnalysisInputLine & { reason: string }>;
}) =>
  JSON.stringify(
    {
      uiLanguage: input.uiLanguage,
      outputLanguageRequirement: `All human-readable fields (meaning, grammarFunction, translation) must be in ${getOutputLanguageDirective(input.uiLanguage)}, consistently for every element.`,
      songTitle: input.songTitle,
      songArtists: input.songArtists,
      task: 'A previous pass failed on these lines. Return corrected analysis for exactly these lineIds only.',
      lines: input.lines
    },
    null,
    2
  );

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

const createModel = (config: LyricsAnalysisProviderConfig) => {
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

/**
 * Best-effort recovery when the model's completion defies the all-or-nothing final parse. The
 * SDK's complete-output parse is strict: one structurally-broken token voids the entire batch even
 * when most lines are perfectly usable. The raw completion text (`failure.text`) is intact, so we
 * reparse it leniently instead:
 *
 * 1. Strip any markdown fence and slice the text into per-element chunks at each `{"lineId"`
 *    anchor, so a broken element never poisons its neighbors.
 * 2. Scan each chunk with a bracket stack. On a closing character that does not match the stack
 *    top, rewrite it as what the stack expects — weak models systematically transpose the
 *    closing-bracket sequence of an element (`}]}]` for `}}]}`), and this single rule absorbs the
 *    whole family. Stray closers with an empty stack are dropped.
 * 3. If the chunk ends mid-object (truncation) or mid-string, close what is open in reverse order.
 * 4. Strip residual separator characters, JSON.parse the repaired chunk, and hand it to the same
 *    app-side validation a streamed element would go through. Returns null when nothing survived.
 */
export const salvageEnvelopeElements = (failure: unknown): LyricsAnalysisTransportLine[] | null => {
  const text = NoObjectGeneratedError.isInstance(failure) ? (failure.text ?? '') : '';
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text;

  const elementsStart = fenced.indexOf('"elements"');
  if (elementsStart < 0) return null;

  // Cut per-element chunks: each starts at a `{"lineId"` anchor and runs to the next anchor (or
  // the end of the text). The outer envelope braces are deliberately excluded so each chunk can
  // be repaired and parsed in isolation.
  const anchors: number[] = [];
  const anchorRegex = /\{\s*"lineId"/g;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(fenced)) !== null) anchors.push(match.index);
  if (anchors.length === 0) return null;

  const repairChunk = (chunk: string): string | null => {
    const stack: string[] = [];
    let out = '';
    let inString = false;
    let escaped = false;

    for (let index = 0; index < chunk.length; index += 1) {
      const char = chunk[index];
      if (inString) {
        out += char;
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        out += char;
      } else if (char === '{') {
        stack.push('}');
        out += char;
      } else if (char === '[') {
        stack.push(']');
        out += char;
      } else if (char === '}' || char === ']') {
        if (stack.length === 0) continue; // stray closer — drop it
        // Rewrite the closer to whatever the structure expects: weak models systematically
        // transpose the closing sequence of an element (`}]}]` for `}}]}`), and emitting the
        // stack's expected character instead of the raw one absorbs the whole family.
        out += stack.pop();
      } else if (char === ',') {
        if (stack[stack.length - 1] === '}') {
          // In a valid JSON object a comma can only precede a quoted property name. A value
          // opener (or a value token) here means the model omitted the closing brace right
          // before the comma — emit it, then keep the comma for the enclosing array.
          let look = index + 1;
          while (look < chunk.length && /\s/.test(chunk[look] ?? '')) look += 1;
          const next = chunk[look] ?? '';
          if (next === '' || next === '}' || next === ']') continue; // trailing comma — drop it
          if (next === '{' || next === '[' || next === '-' || /^[0-9tfn]/.test(next)) out += stack.pop();
        }
        out += char;
      } else {
        out += char;
      }
    }

    let repaired = out;
    if (inString) {
      // Truncated mid-string: drop a dangling backslash, close the quote, then everything open.
      if (escaped) repaired = repaired.slice(0, -1);
      repaired += '"';
      while (stack.length > 0) repaired += stack.pop();
    } else if (stack.length > 0) {
      // Truncated mid-structure: the tail is a half-finished value; close what is open.
      while (stack.length > 0) repaired += stack.pop();
    } else {
      // Structurally closed with residue after the final closer (trailing punctuation, a stray
      // fragment of the next element): cut everything after the last structural closer.
      const lastCloser = Math.max(repaired.lastIndexOf('}'), repaired.lastIndexOf(']'));
      if (lastCloser >= 0) repaired = repaired.slice(0, lastCloser + 1);
    }
    return repaired;
  };

  const elements: LyricsAnalysisTransportLine[] = [];
  for (let index = 0; index < anchors.length; index += 1) {
    const chunkEnd = index + 1 < anchors.length ? anchors[index + 1] : fenced.length;
    const repaired = repairChunk(fenced.slice(anchors[index], chunkEnd));
    if (!repaired) continue;
    try {
      const parsed = JSON.parse(repaired) as unknown;
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as { lineId: unknown }).lineId === 'string'
      ) {
        elements.push(parsed as LyricsAnalysisTransportLine);
      }
    } catch {
      // Unrepairable chunk — skip it; the remaining chunks parse independently.
    }
  }

  return elements.length > 0 ? elements : null;
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
  const model = createModel(config);
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
          const line = { ...outcome.line, droppedTokenCount: outcome.droppedTokenCount };
          finalLines.set(lineId, line);
          onLine(line, input.passKind);
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
            const line = { ...outcome.line, droppedTokenCount: outcome.droppedTokenCount };
            finalLines.set(lineId, line);
            onLine(line, input.passKind);
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

    for (const line of input.targetLines) {
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
      v: 1,
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
  const firstPassFailures = new Map<string, string>();
  let firstPassBatchIndex = 0;

  for (let offset = 0; offset < lines.length; offset += ANALYSIS_BATCH_SIZE) {
    if (signal?.aborted) break;

    const batch = lines.slice(offset, offset + ANALYSIS_BATCH_SIZE);
    const pass = await streamPass({
      prompt: buildUserPrompt({ uiLanguage, songTitle, songArtists, lines: batch }),
      targetLines: batch,
      maxOutputTokens: 1000 + batch.length * 500,
      passKind: 'first'
    });
    emitPassTelemetry({
      sessionId,
      batchIndex: firstPassBatchIndex,
      passKind: 'first',
      targetLines: batch.length,
      okLines: batch.length - pass.failedIds.size,
      failedLines: pass.failedIds.size,
      passStartedAt: pass.passStartedAt,
      finishReason: pass.finishReason,
      outputTokens: pass.passOutputTokens,
      inputTokens: pass.passInputTokens
    });
    for (const [lineId, reason] of pass.failedIds) firstPassFailures.set(lineId, reason);
    firstPassBatchIndex += 1;
  }

  if (firstPassFailures.size > 0 && !signal?.aborted) {
    const repairTargets = lines
      .filter((line) => firstPassFailures.has(line.lineId))
      .slice(0, MAX_REPAIR_LINES)
      .map((line) => ({ ...line, reason: firstPassFailures.get(line.lineId) ?? 'invalid-analysis' }));

    options.onRepairStarted?.(repairTargets.map((line) => line.lineId));

    let repairedLines = 0;
    let repairBatchIndex = 0;

    try {
      for (let offset = 0; offset < repairTargets.length; offset += ANALYSIS_BATCH_SIZE) {
        if (signal?.aborted) break;

        const batch = repairTargets.slice(offset, offset + ANALYSIS_BATCH_SIZE);
        const pass = await streamPass({
          prompt: buildRepairPrompt({ uiLanguage, songTitle, songArtists, lines: batch }),
          targetLines: batch,
          maxOutputTokens: 600 + batch.length * 500,
          passKind: 'repair'
        });
        repairedLines += batch.length - pass.failedIds.size;
        emitPassTelemetry({
          sessionId,
          batchIndex: repairBatchIndex,
          passKind: 'repair',
          targetLines: batch.length,
          okLines: batch.length - pass.failedIds.size,
          failedLines: pass.failedIds.size,
          passStartedAt: pass.passStartedAt,
          finishReason: pass.finishReason,
          outputTokens: pass.passOutputTokens,
          inputTokens: pass.passInputTokens,
          repairedLines
        });
        repairBatchIndex += 1;
      }
    } catch (error) {
      // A failed repair pass must not discard the lines that already succeeded.
      if (signal?.aborted) throw error;
    }
  }

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

