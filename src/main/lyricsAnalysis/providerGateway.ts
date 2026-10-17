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

// This module runs inside the lyrics-analysis utility process, which cannot import Electron
// modules (`app` is not exported there — importing the main logger crashes the worker), so
// diagnostics go to stderr, which `stdio: 'inherit'` pipes into the main-process console.
const logWorkerWarning = (message: string, data: Record<string, unknown>) => {
  console.warn(`[lyrics-analysis] ${message}`, JSON.stringify(data));
};

const MAX_REPAIR_LINES = 40;

const SYSTEM_PROMPT = [
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
  '- Cover every line you are given, in the given order.'
].join('\n');

const buildUserPrompt = (input: {
  uiLanguage: string;
  songTitle: string;
  songArtists: string[];
  lines: LyricsAnalysisInputLine[];
}) =>
  JSON.stringify(
    {
      uiLanguage: input.uiLanguage,
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

export interface AnalyzeLyricsOptions {
  config: LyricsAnalysisProviderConfig;
  uiLanguage: string;
  songTitle: string;
  songArtists: string[];
  lines: LyricsAnalysisInputLine[];
  signal?: AbortSignal;
  onLine: (line: LyricsAnalysisLine) => void;
  onRepairStarted?: (failedLineIds: string[]) => void;
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

  const finalLines = new Map<string, LyricsAnalysisLine>();

  const streamPass = async (input: {
    prompt: string;
    targetLines: LyricsAnalysisInputLine[];
    maxOutputTokens: number;
  }) => {
    // `result.output` only surfaces `NoOutputGeneratedError`, which hides the real provider failure
    // (e.g. a 401). The stream error callback is where the status-bearing APICallError shows up.
    let streamError: unknown;

    const result = streamText({
      model,
      system: SYSTEM_PROMPT,
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

    for await (const element of result.elementStream) {
      emittedAny = true;
      drafts.push(element);
      const lineId = typeof element.lineId === 'string' ? element.lineId.trim() : '';
      const text = textByLineId.get(lineId);
      if (!text) continue;

      const outcome = validateAndNormalizeLineAnalysis({ draft: element, text });
      if (outcome.kind === 'ok') {
        finalLines.set(lineId, outcome.line);
        onLine(outcome.line);
      }
    }

    for await (const textChunk of result.textStream) {
      textTail = `${textTail}${textChunk}`.slice(-400);
    }

    // `result.output` is the authoritative pass/fail signal; a partial element stream is not success.
    try {
      await result.output;
    } catch (error) {
      if (signal?.aborted) throw error;

      const failure = streamError ?? error;
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

      // A provider/network failure before anything streamed is fatal and must reach the caller.
      if (!emittedAny) throw failure;

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

    return failedIds;
  };

  const firstPassFailures = await streamPass({
    prompt: buildUserPrompt({ uiLanguage, songTitle, songArtists, lines }),
    targetLines: lines,
    maxOutputTokens: Math.min(32000, 1000 + lines.length * 500)
  });

  if (firstPassFailures.size > 0 && !signal?.aborted) {
    const repairTargets = lines
      .filter((line) => firstPassFailures.has(line.lineId))
      .slice(0, MAX_REPAIR_LINES)
      .map((line) => ({ ...line, reason: firstPassFailures.get(line.lineId) ?? 'invalid-analysis' }));

    options.onRepairStarted?.(repairTargets.map((line) => line.lineId));

    try {
      await streamPass({
        prompt: buildRepairPrompt({ uiLanguage, songTitle, songArtists, lines: repairTargets }),
        targetLines: repairTargets,
        maxOutputTokens: Math.min(16000, 600 + repairTargets.length * 500)
      });
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
      .map((line) => line.lineId)
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

