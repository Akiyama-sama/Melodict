import { z } from 'zod';

/**
 * Typed telemetry for the lyrics-analysis pipeline.
 *
 * Events are a zod-validated discriminated union so the payload shape can evolve with a compile-time
 * guarantee that every producer (main process + utility worker) and the evaluation scripts all agree
 * on the same contract. Each event carries `kind` plus the canonical identifier of the run
 * (`sessionId`); batch metrics live on `analysis-pass` events so per-batch cost/latency stay
 * attributable while lines stream in independently.
 */

export const LYRICS_ANALYSIS_TELEMETRY_VERSION = 1;

/** Zoned wall-clock date key (local time), e.g. `2026-10-18` — the JSONL shard name. */
export const getTelemetryShardKey = (timestamp: number) => {
  const date = new Date(timestamp);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const baseEventShape = {
  /** Schema version for forward-compatible parsing of old shards. */
  v: z.number().int().min(1),
  /** Canonical identifier for the analysis run; batch/line events reference the same id. */
  sessionId: z.string().min(1),
  /** Epoch ms. */
  ts: z.number().int().nonnegative()
};

export const analysisPassEventSchema = z.object({
  ...baseEventShape,
  kind: z.literal('analysis-pass'),
  /** Zero-based batch index within the pass loop. */
  batchIndex: z.number().int().nonnegative(),
  /** `'first'` for the initial streaming pass, `'repair'` for the follow-up repair pass. */
  passKind: z.enum(['first', 'repair']),
  /** Lines requested in this batch. */
  targetLines: z.number().int().nonnegative(),
  /** Lines that produced a validated analysis in this batch. */
  okLines: z.number().int().nonnegative(),
  /** Lines that came back missing or semantically invalid. */
  failedLines: z.number().int().nonnegative(),
  /** Duration of this batch's LLM round-trip in ms. */
  durationMs: z.number().int().nonnegative(),
  finishReason: z.string().nullish(),
  outputTokens: z.number().int().nonnegative().nullish(),
  inputTokens: z.number().int().nonnegative().nullish(),
  /** How many of the failed lines came back after the repair pass. */
  repairedLines: z.number().int().nonnegative().optional()
});

export const lineResultEventSchema = z.object({
  ...baseEventShape,
  kind: z.literal('line-result'),
  lineId: z.string().min(1),
  /** 'first' = streamed from the main pass, 'repair' = recovered by the repair pass. */
  source: z.enum(['first', 'repair']),
  /** Length of the raw lyric line (chars). */
  textLength: z.number().int().nonnegative(),
  /** Tokens accepted by validation, after snapping/overlap rejection. */
  tokenCount: z.number().int().nonnegative(),
  /** Raw tokens the model emitted that validation dropped. */
  droppedTokenCount: z.number().int().nonnegative(),
  /**
   * Share of the line's characters covered by accepted token spans (0..1, rounded 3dp). A low value
   * means the model skipped chunks of the line — the cheapest proxy for "analysis quality".
   */
  coverage: z.number().min(0).max(1),
  status: z.enum(['ready', 'degraded'])
});

export const sessionStartEventSchema = z.object({
  ...baseEventShape,
  kind: z.literal('session-start'),
  /** Total non-empty lines submitted. */
  totalLines: z.number().int().nonnegative(),
  /** How many lines a partial cache hydration already satisfied before any LLM call. */
  preCachedLines: z.number().int().nonnegative(),
  /** Lines actually sent to the LLM this run. */
  requestedLines: z.number().int().nonnegative()
});

export const firstLineEventSchema = z.object({
  ...baseEventShape,
  kind: z.literal('first-line'),
  /** ms from session start to the first validated line landing. */
  latencyMs: z.number().int().nonnegative(),
  source: z.enum(['first', 'repair'])
});

export const sessionEndEventSchema = z.object({
  ...baseEventShape,
  kind: z.literal('session-end'),
  /** `'ready'` all lines analyzed; `'partial'` some lines never validated; `'error'` failed. */
  outcome: z.enum(['ready', 'partial', 'error']),
  durationMs: z.number().int().nonnegative(),
  /** Final per-line tally: total, validated, and lines that never produced tokens. */
  totalLines: z.number().int().nonnegative(),
  okLines: z.number().int().nonnegative(),
  failedLines: z.number().int().nonnegative(),
  /** Total LLM batches run (first + repair). */
  passCount: z.number().int().nonnegative(),
  /** Sum of output tokens across all passes when the provider reported them. */
  outputTokens: z.number().int().nonnegative().nullish(),
  modelId: z.string().min(1),
  /** Present only when outcome is 'error'. */
  errorCode: z.string().optional()
});

export const lyricsAnalysisTelemetryEventSchema = z.discriminatedUnion('kind', [
  sessionStartEventSchema,
  firstLineEventSchema,
  analysisPassEventSchema,
  lineResultEventSchema,
  sessionEndEventSchema
]);

export type AnalysisPassTelemetryEvent = z.infer<typeof analysisPassEventSchema>;
export type LineResultTelemetryEvent = z.infer<typeof lineResultEventSchema>;
export type SessionStartTelemetryEvent = z.infer<typeof sessionStartEventSchema>;
export type FirstLineTelemetryEvent = z.infer<typeof firstLineEventSchema>;
export type SessionEndTelemetryEvent = z.infer<typeof sessionEndEventSchema>;
export type LyricsAnalysisTelemetryEvent = z.infer<typeof lyricsAnalysisTelemetryEventSchema>;

export interface LyricsAnalysisTelemetrySession {
  sessionId: string;
  startedAt: number;
  preCachedLines: number;
  requestedLines: number;
  totalLines: number;
  modelId: string;
  /** Set when the first validated line lands; drives the first-line latency metric. */
  firstLineAt?: number;
  /** Set when the first batch completes; the "首字解析返回时间" headline metric. */
  firstPassAt?: number;
  /** Flips after the first-line event is written so it fires exactly once per session. */
  firstLineEmitted: boolean;
  passCount: number;
  outputTokens: number | undefined;
}
