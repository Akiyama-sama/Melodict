import {
  getLineTokenCoverage,
  type LyricsAnalysisLine
} from '../../common/lyricsAnalysis';
import {
  type AnalysisPassTelemetryEvent,
  type LyricsAnalysisTelemetrySession,
  type SessionEndTelemetryEvent,
  type SessionStartTelemetryEvent
} from '../../common/lyricsAnalysisTelemetry';
import { appendLyricsAnalysisTelemetryEvent } from './telemetryRepository';

/**
 * Bridges the telemetry session state to the persisted event stream. All events share one
 * `sessionId` so evaluation scripts can group a run's start / first-line / pass / line / end rows.
 */

const eventBase = (session: LyricsAnalysisTelemetrySession) => ({
  v: 1 as const,
  sessionId: session.sessionId,
  ts: Date.now()
});

export const emitSessionStartTelemetry = (session: LyricsAnalysisTelemetrySession) => {
  const event: SessionStartTelemetryEvent = {
    ...eventBase(session),
    kind: 'session-start',
    totalLines: session.totalLines,
    preCachedLines: session.preCachedLines,
    requestedLines: session.requestedLines
  };
  void appendLyricsAnalysisTelemetryEvent(event);
};

export const emitFirstLineTelemetry = (input: {
  session: LyricsAnalysisTelemetrySession;
  source: 'first' | 'repair';
}) => {
  // The headline "首字延迟" metric fires exactly once per session: at the first validated line,
  // then the flag flips so subsequent lines never re-emit a first-line event.
  if (input.session.firstLineAt === undefined || input.session.firstLineEmitted) return;
  input.session.firstLineEmitted = true;

  const event = {
    ...eventBase(input.session),
    kind: 'first-line' as const,
    latencyMs: input.session.firstLineAt - input.session.startedAt,
    source: input.source
  };
  void appendLyricsAnalysisTelemetryEvent(event);
};

export const emitLineResultTelemetry = (input: {
  session: LyricsAnalysisTelemetrySession;
  line: LyricsAnalysisLine;
  source: 'first' | 'repair';
}) => {
  const event = {
    ...eventBase(input.session),
    kind: 'line-result' as const,
    lineId: input.line.lineId,
    source: input.source,
    textLength: input.line.text.length,
    tokenCount: input.line.tokens.length,
    droppedTokenCount: input.line.droppedTokenCount ?? 0,
    coverage: getLineTokenCoverage(input.line.text, input.line.tokens),
    status: input.line.status === 'degraded' ? 'degraded' : 'ready'
  };
  void appendLyricsAnalysisTelemetryEvent(event);
};

export const emitAnalysisPassTelemetry = (input: {
  session: LyricsAnalysisTelemetrySession;
  pass: AnalysisPassTelemetryEvent;
}) => {
  input.session.passCount += 1;
  if (typeof input.pass.outputTokens === 'number') {
    input.session.outputTokens = (input.session.outputTokens ?? 0) + input.pass.outputTokens;
  }
  void appendLyricsAnalysisTelemetryEvent(input.pass);
};

export const emitSessionEndTelemetry = (input: {
  session: LyricsAnalysisTelemetrySession;
  finishedAt: number;
  outcome: 'ready' | 'partial' | 'error';
  /** Unanalyzed lines left after the final tally; the emitter's own count covers error paths. */
  failedLines?: number;
  errorCode?: string;
  passStats?: { outputTokens: number | undefined };
}) => {
  // The ready/partial path passes the exact tally; on the error path failedLineIds already holds
  // every line that never landed (initialized with all ids, removed as lines arrive). Derived
  // okLines stays exact even when the model emits duplicate elements for the same line.
  const failedLines = input.failedLines ?? input.session.failedLineIds.size;
  const okLines = Math.max(0, input.session.totalLines - input.session.preCachedLines - failedLines) + input.session.preCachedLines;

  const event: SessionEndTelemetryEvent = {
    ...eventBase(input.session),
    kind: 'session-end',
    outcome: input.outcome,
    durationMs: input.finishedAt - input.session.startedAt,
    totalLines: input.session.totalLines,
    okLines,
    failedLines,
    passCount: input.session.passCount,
    outputTokens: input.passStats?.outputTokens ?? input.session.outputTokens,
    modelId: input.session.modelId,
    ...(input.errorCode ? { errorCode: input.errorCode } : {})
  };
  void appendLyricsAnalysisTelemetryEvent(event);
};
