import { NoObjectGeneratedError } from 'ai';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type {
  LyricsAnalysisInputLine,
  LyricsAnalysisLine,
  LyricsAnalysisTransportLine
} from '../../../../src/common/lyricsAnalysis';

/**
 * Orchestration tests for `analyzeLyrics` (providerGateway): batching, the repair gate, the
 * repair quality gate (`preferOver` / lineQuality), and the auth-failure short circuit.
 *
 * The AI SDK's `streamText` is mocked at module level with a scripted fake. Each scenario
 * provides a queue of per-call behaviors — `elements(...)` for a successful envelope of
 * transport lines, `failWith(...)` for a thrown error — consumed in call order. The fake never
 * imports Electron, and the model itself is injected through the `createModel` seam, so the
 * real OpenAI client is never constructed.
 */

type CallBehavior =
  | { kind: 'elements'; elements: LyricsAnalysisTransportLine[] }
  | { kind: 'error'; error: unknown };

interface StreamCall {
  prompt: string;
  system: string;
  maxOutputTokens: number;
}

const calls: StreamCall[] = [];
let behaviors: CallBehavior[] = [];

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();

  const streamTextMock = (input: {
    prompt: string;
    system: string;
    maxOutputTokens: number;
    onError: (event: { error: unknown }) => void;
    output: unknown;
  }) => {
    calls.push({ prompt: input.prompt, system: input.system, maxOutputTokens: input.maxOutputTokens });
    const behavior = behaviors.shift() ?? { kind: 'elements', elements: [] };

    if (behavior.kind === 'error') {
      const error = behavior.error;
      const failed = () => Promise.reject(error);
      return {
        elementStream: {
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              throw error;
            }
          })
        },
        textStream: { [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true }) }) },
        finishReason: Promise.resolve('error' as const),
        usage: Promise.resolve({ inputTokens: undefined, outputTokens: undefined }),
        output: failed()
      };
    }

    const elements = behavior.elements;
    return {
      elementStream: {
        [Symbol.asyncIterator]: () => {
          let index = 0;
          return {
            next: async () =>
              index < elements.length
                ? { value: elements[index++], done: false }
                : { value: undefined, done: true }
          };
        }
      },
      textStream: { [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true }) }) },
      finishReason: Promise.resolve('stop' as const),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }),
      output: Promise.resolve([elements])
    };
  };

  return {
    ...actual,
    streamText: streamTextMock,
    // mapProviderError dispatches on these; re-export the real classes so instanceof still works.
    APICallError: actual.APICallError,
    NoObjectGeneratedError: actual.NoObjectGeneratedError,
    TypeValidationError: actual.TypeValidationError
  };
});

const providerGateway = await import('../../../../src/main/lyricsAnalysis/providerGateway');

const fullDraft = (lineId: string, text: string, tokenCount = 2): LyricsAnalysisTransportLine => ({
  lineId,
  translation: `译:${text}`,
  // One token per word atom. For CJK lines the whole line is a single regex atom, so a per-character
  // split would duplicate spans and get tokens dropped (degrading the line); for Latin lines each
  // word is its own atom and a per-character split would collapse via word-snapping. Slice the
  // line into `tokenCount` word-sized chunks instead: any split of distinct non-empty slices
  // covers every character and validates clean.
  tokens: (() => {
    if (tokenCount <= 1) {
      return [{ startChar: 0, endChar: text.length, text, card: { meaning: '意思', grammarFunction: '成分' } }];
    }
    // Split on whitespace first; if the line has no whitespace (CJK), split at even offsets.
    const boundaries: number[] = [0];
    const words = text.split(/(?<=\s)/).filter((word) => word.length > 0);
    if (words.length >= tokenCount) {
      let cursor = 0;
      for (const word of words.slice(0, tokenCount - 1)) {
        cursor += word.length;
        boundaries.push(cursor);
      }
    } else {
      for (let index = 1; index < tokenCount; index += 1) {
        boundaries.push(Math.round((text.length * index) / tokenCount));
      }
    }
    boundaries.push(text.length);
    return boundaries.slice(0, -1).map((start, index) => {
      const end = boundaries[index + 1] ?? text.length;
      return {
        startChar: start,
        endChar: end,
        text: text.slice(start, end),
        card: { meaning: '意思', grammarFunction: '成分' }
      };
    });
  })()
});

/** A draft whose tokens cover only the first word — validation flags it degraded. */
const partialDraft = (lineId: string, text: string): LyricsAnalysisTransportLine => ({
  lineId,
  translation: `译:${text}`,
  tokens: [{ startChar: 0, endChar: 1, text: text.slice(0, 1), card: { meaning: 'x', grammarFunction: 'y' } }]
});

/** The degenerate output qwen-flash emits on quote-wrapped lines: the WHOLE line as one token. */
const wholeLineDraft = (lineId: string, text: string): LyricsAnalysisTransportLine => ({
  lineId,
  translation: `译:${text}`,
  tokens: [{ startChar: 0, endChar: text.length, text, card: { meaning: 'x', grammarFunction: 'y' } }]
});

const lines = (...texts: string[]): LyricsAnalysisInputLine[] =>
  texts.map((text, index) => ({ lineId: `line-${index}`, text }));

const elements = (...elements_: LyricsAnalysisTransportLine[]): CallBehavior => ({
  kind: 'elements',
  elements: elements_
});

const failWith = (error: unknown): CallBehavior => ({ kind: 'error', error });

const runAnalyze = async (
  inputLines: LyricsAnalysisInputLine[],
  overrides: Partial<Parameters<typeof providerGateway.analyzeLyrics>[0]> = {}
) => {
  const onLine = vi.fn<(line: LyricsAnalysisLine, source: 'first' | 'repair') => void>();
  const onRepairStarted = vi.fn<(failedLineIds: string[]) => void>();
  const outcome = await providerGateway.analyzeLyrics({
    config: { baseURL: 'http://127.0.0.1:9/v1', modelId: 'test-model', apiKey: 'test-key' },
    uiLanguage: 'zh-CN',
    songTitle: 'Song',
    songArtists: ['Artist'],
    lines: inputLines,
    onLine,
    onRepairStarted,
    createModel: () => ({}) as never,
    ...overrides
  });
  return { outcome, onLine, onRepairStarted };
};

beforeEach(() => {
  calls.length = 0;
  behaviors = [];
});

describe('analyzeLyrics orchestration', () => {
  test('batches lines four at a time', async () => {
    const inputLines = lines('a', 'b', 'c', 'd', 'e', 'f');
    behaviors = [
      elements(...inputLines.slice(0, 4).map((line) => fullDraft(line.lineId, line.text, line.text.length))),
      elements(...inputLines.slice(4).map((line) => fullDraft(line.lineId, line.text, line.text.length)))
    ];

    const { outcome } = await runAnalyze(inputLines);

    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0]?.prompt ?? '{}').lines.map((l: { lineId: string }) => l.lineId)).toEqual([
      'line-0',
      'line-1',
      'line-2',
      'line-3'
    ]);
    expect(JSON.parse(calls[1]?.prompt ?? '{}').lines.map((l: { lineId: string }) => l.lineId)).toEqual([
      'line-4',
      'line-5'
    ]);
    // Every line validated: nothing failed, no repair pass ran.
    expect(outcome.failedLineIds).toEqual([]);
    expect(outcome.lines).toHaveLength(6);
  });

  test('a coverage failure on the first pass triggers exactly one repair pass for the failed line only', async () => {
    const inputLines = lines('hello world', 'どれほどの夜');
    // line-0's draft drops its trailing word ("world") — a Latin atom, so validation flags the
    // line degraded → incomplete-coverage. line-1 is complete.
    behaviors = [
      elements(partialDraft('line-0', 'hello world'), fullDraft('line-1', 'どれほどの夜', 3)),
      // Repair pass returns the full line.
      elements(fullDraft('line-0', 'hello world', 2))
    ];

    const { outcome, onRepairStarted, onLine } = await runAnalyze(inputLines);

    expect(calls).toHaveLength(2);
    expect(onRepairStarted).toHaveBeenCalledTimes(1);
    expect(onRepairStarted).toHaveBeenCalledWith(['line-0']);
    // The repair prompt re-asks only for the failed line.
    const repairLines = JSON.parse(calls[1]?.prompt ?? '{}').lines;
    expect(repairLines.map((l: { lineId: string }) => l.lineId)).toEqual(['line-0']);
    expect(repairLines[0]?.reason).toBe('incomplete-coverage');

    // The repaired line supersedes the degraded first-pass line.
    const repaired = outcome.lines.find((line) => line.lineId === 'line-0');
    expect(repaired?.status).toBe('ready');
    expect(repaired?.tokens).toHaveLength(2);
    expect(outcome.failedLineIds).toEqual([]);
    const sources = onLine.mock.calls.map(([, source]) => source);
    expect(sources).toContain('first');
    expect(sources).toContain('repair');
  });

  test('a repair that comes back worse never replaces the already-shown line', async () => {
    const inputLines = lines('hello world');
    // First pass: a degraded (coverage-gap) line so the repair gate triggers; the degraded line
    // still lands and is what the user sees.
    behaviors = [
      elements(partialDraft('line-0', 'hello world')),
      // Repair is *equal* quality to the incumbent (same status, same token count) → the
      // strictly-better rule must reject it, so the shown line is never replaced by a no-op.
      elements(partialDraft('line-0', 'hello world'))
    ];

    const { outcome, onLine } = await runAnalyze(inputLines);

    expect(calls).toHaveLength(2);
    // The line is only ever emitted once — the repair replacement was rejected, so nothing
    // re-fired onLine for the same lineId with a second (worse) analysis.
    const lineEmissions = onLine.mock.calls.filter(([line]) => line.lineId === 'line-0');
    expect(lineEmissions).toHaveLength(1);
    expect(lineEmissions[0]?.[0].tokens).toHaveLength(1);

    // Whatever the repair outcome, the final line keeps the first pass's content.
    const finalLine = outcome.lines.find((line) => line.lineId === 'line-0');
    expect(finalLine?.tokens).toHaveLength(1);
  });

  test('a repair that strictly improves the line does replace it', async () => {
    const inputLines = lines('hello world');
    behaviors = [
      elements(partialDraft('line-0', 'hello world')),
      elements(fullDraft('line-0', 'hello world', 2))
    ];

    const { outcome, onLine } = await runAnalyze(inputLines);

    const emissions = onLine.mock.calls.filter(([line]) => line.lineId === 'line-0');
    expect(emissions).toHaveLength(2);
    expect(emissions[0]?.[0].tokens).toHaveLength(1);
    expect(emissions[1]?.[0].tokens).toHaveLength(2);
    const finalLine = outcome.lines.find((line) => line.lineId === 'line-0');
    expect(finalLine?.tokens).toHaveLength(2);
    expect(finalLine?.status).toBe('ready');
  });

  test('an authFailed error from the model short-circuits: no retries, no repair', async () => {
    const authError = new actual_APICallError({
      message: 'Invalid API key',
      url: 'http://127.0.0.1:9/v1/chat/completions',
      requestBodyValues: {},
      statusCode: 401,
      isRetryable: false
    });
    // Two batches' worth of lines. The run must reject with the 401 and never reach a repair
    // pass. Since batches now run through a bounded concurrent pool, the batch holding the 401
    // stops all UNSTARTED batches, but batches already launched inside the same window wave
    // still fire (they are concurrent, not retries) — so the call count is bounded by the
    // initial window (min(4, cap) = 4), never by a serial re-run.
    const inputLines = lines('a', 'b', 'c', 'd', 'e', 'f');
    behaviors = [failWith(authError), elements(), elements(), elements()];

    await expect(runAnalyze(inputLines)).rejects.toMatchObject({
      name: 'AI_APICallError',
      statusCode: 401
    });

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.length).toBeLessThanOrEqual(4);
  });

  test('telemetry pass events carry per-batch metrics', async () => {
    const inputLines = lines('a', 'b', 'c', 'd');
    behaviors = [elements(fullDraft('line-0', 'a', 1), fullDraft('line-1', 'b', 1), fullDraft('line-2', 'c', 1), fullDraft('line-3', 'd', 1))];
    const onPassCompleted = vi.fn();
    const onLine = vi.fn();

    await providerGateway.analyzeLyrics({
      config: { baseURL: 'http://127.0.0.1:9/v1', modelId: 'test-model', apiKey: 'k' },
      uiLanguage: 'en',
      songTitle: 'S',
      songArtists: [],
      lines: inputLines,
      sessionId: 'sess-1',
      onLine,
      onPassCompleted
    });

    expect(onPassCompleted).toHaveBeenCalledTimes(1);
    const pass = onPassCompleted.mock.calls[0]?.[0];
    expect(pass).toMatchObject({
      v: 1,
      sessionId: 'sess-1',
      kind: 'analysis-pass',
      batchIndex: 0,
      passKind: 'first',
      targetLines: 4,
      okLines: 4,
      failedLines: 0,
      outputTokens: 20,
      inputTokens: 10
    });
  });

  test('a whole-line single token is flagged degraded and re-asked by the repair pass', async () => {
    // Regression: qwen-flash returned '"Oh my God, who is she?"' as ONE token spanning the whole
    // line — spans legal, coverage perfect, so nothing else flags it. The validator must mark it
    // degraded (multi-word line) so the repair gate re-asks, and a proper repair replaces it.
    const inputLines = lines('"Oh my God, who is she?"', 'Grab your passport');
    behaviors = [
      elements(wholeLineDraft('line-0', '"Oh my God, who is she?"'), fullDraft('line-1', 'Grab your passport', 2)),
      elements(fullDraft('line-0', '"Oh my God, who is she?"', 3))
    ];

    const { outcome, onRepairStarted } = await runAnalyze(inputLines);

    expect(onRepairStarted).toHaveBeenCalledWith(['line-0']);
    const repaired = outcome.lines.find((line) => line.lineId === 'line-0');
    expect(repaired?.tokens).toHaveLength(3);
    expect(outcome.failedLineIds).toEqual([]);
  });

  test('a genuinely single-word line as one token is NOT flagged', async () => {
    const inputLines = lines('Ayy');
    behaviors = [elements(wholeLineDraft('line-0', 'Ayy'))];

    const { outcome, onRepairStarted } = await runAnalyze(inputLines);

    expect(onRepairStarted).not.toHaveBeenCalled();
    expect(outcome.failedLineIds).toEqual([]);
    expect(outcome.lines[0]?.status).toBe('ready');
  });

  test('salvage recovers usable lines from a NoObjectGeneratedError completion', async () => {
    // Element 0 is truncated mid-structure: its closing `}}` never arrives before the next
    // `{"lineId"` anchor. Salvage slices each element into an independent chunk, closes what is
    // open, and both lines must validate.
    const truncated = [
      'Here is your analysis:',
      '```json',
      '{"elements":[{"lineId":"line-0","translation":"译:a","tokens":[{"startChar":0,"endChar":1,"text":"a","card":{"meaning":"m","grammarFunction":"g"}}',
      '{"lineId":"line-1","translation":"译:b","tokens":[{"startChar":0,"endChar":1,"text":"b","card":{"meaning":"m","grammarFunction":"g"}}]}]}',
      '```'
    ].join('\n');
    behaviors = [failWith(new NoObjectGeneratedError({ message: 'no object', text: truncated }))];

    const { outcome, onLine } = await runAnalyze(lines('a', 'b'));

    expect(outcome.failedLineIds).toEqual([]);
    expect(outcome.lines.map((line) => line.lineId)).toEqual(['line-0', 'line-1']);
    expect(onLine).toHaveBeenCalledTimes(2);
  });
});

// Import after the mock declaration so the class identity matches what the mock re-exports.
const { APICallError: actual_APICallError } = await import('ai');
