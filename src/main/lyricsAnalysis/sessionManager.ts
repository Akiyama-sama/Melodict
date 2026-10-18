import { BrowserWindow } from 'electron';

import {
  LYRICS_ANALYSIS_DEFAULT_MODEL_ID,
  LYRICS_ANALYSIS_PROMPT_VERSION,
  LYRICS_ANALYSIS_SCHEMA_VERSION,
  type LyricsAnalysisError,
  type LyricsAnalysisInputLine,
  type LyricsAnalysisLine,
  type LyricsAnalysisRequest,
  type LyricsAnalysisSnapshot
} from '../../common/lyricsAnalysis';
import { type LyricsAnalysisTelemetrySession } from '../../common/lyricsAnalysisTelemetry';
import logger from '../logger';
import { analyzeLyricsInWorker } from './analysisWorkerClient';
import {
  buildLyricsAnalysisFingerprint,
  mergeLyricsAnalysisCache,
  readLyricsAnalysisPartialCache
} from './cacheRepository';
import { getStoredProviderConfig } from './providerConfigRepository';
import {
  emitAnalysisPassTelemetry,
  emitFirstLineTelemetry,
  emitLineResultTelemetry,
  emitSessionEndTelemetry,
  emitSessionStartTelemetry
} from './telemetryEmitter';

export const LYRICS_ANALYSIS_LINE_CHANNEL = 'app/lyricsAnalysis/line';
export const LYRICS_ANALYSIS_SNAPSHOT_CHANNEL = 'app/lyricsAnalysis/snapshot';

/** How often a running analysis flushes its lines into the cache artifact. */
const FLUSH_INTERVAL_MS = 1500;

let activeSession: LyricsAnalysisSnapshot | undefined;
let activeGeneration = 0;

const sendToRenderer = (channel: string, payload: unknown) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
};

const emitSnapshot = (snapshot: LyricsAnalysisSnapshot) => {
  activeSession = snapshot;
  sendToRenderer(LYRICS_ANALYSIS_SNAPSHOT_CHANNEL, snapshot);
};

export const getLyricsAnalysisSession = () => activeSession;

const buildLinesWithStatuses = (input: {
  requestLines: LyricsAnalysisInputLine[];
  analyzed: LyricsAnalysisLine[];
}): LyricsAnalysisLine[] => {
  const analyzedById = new Map(input.analyzed.map((line) => [line.lineId, line]));

  return input.requestLines.map(
    (line) =>
      analyzedById.get(line.lineId) ?? {
        lineId: line.lineId,
        text: line.text,
        tokens: [],
        status: 'unavailable'
      }
  );
};

const isAnalyzed = (line: LyricsAnalysisLine) => line.tokens.length > 0;

const buildTelemetrySession = (input: {
  sessionId: string;
  startedAt: number;
  request: LyricsAnalysisRequest;
  modelId: string;
  preCachedLines: number;
}): LyricsAnalysisTelemetrySession => ({
  sessionId: input.sessionId,
  startedAt: input.startedAt,
  modelId: input.modelId,
  totalLines: input.request.lines.length,
  preCachedLines: input.preCachedLines,
  requestedLines: input.request.lines.length - input.preCachedLines,
  passCount: 0,
  outputTokens: undefined,
  okLines: 0,
  firstLineEmitted: false,
  failedLineIds: new Set(input.request.lines.map((line) => line.lineId))
});

export const prepareLyricsAnalysisSession = async (request: LyricsAnalysisRequest) => {
  const generation = ++activeGeneration;
  const startedAt = Date.now();
  const provider = await getStoredProviderConfig();
  const modelId = provider.modelId || LYRICS_ANALYSIS_DEFAULT_MODEL_ID;
  const fingerprint = buildLyricsAnalysisFingerprint({
    lines: request.lines,
    uiLanguage: request.uiLanguage,
    modelId
  });

  const isCurrent = () => generation === activeGeneration;

  if (!provider.baseURL.trim() || !provider.apiKey?.trim()) {
    const snapshot: LyricsAnalysisSnapshot = {
      songPath: request.songPath,
      fingerprint,
      status: 'notConfigured',
      updatedAt: Date.now()
    };
    emitSnapshot(snapshot);
    return snapshot;
  }

  // A partial artifact (crashed or interrupted run) hydrates whatever it already holds, then the
  // run resumes for just the missing lines. `forceRefresh` bypasses the cache entirely.
  let preCachedLines: LyricsAnalysisLine[] = [];
  if (!request.forceRefresh) {
    const cached = await readLyricsAnalysisPartialCache(fingerprint);
    if (cached && isCurrent()) preCachedLines = cached.lines.filter(isAnalyzed);
  }

  const hasFullCache =
    preCachedLines.length > 0 && preCachedLines.length >= request.lines.length;

  if (hasFullCache && isCurrent()) {
    const snapshot: LyricsAnalysisSnapshot = {
      songPath: request.songPath,
      fingerprint,
      status: 'cached',
      lines: buildLinesWithStatuses({
        requestLines: request.lines,
        analyzed: preCachedLines
      }),
      updatedAt: Date.now()
    };
    emitSnapshot(snapshot);
    return snapshot;
  }

  if (!isCurrent()) return activeSession;

  // Resume inputs exclude lines the partial cache already covers, so the LLM only sees the gaps.
  const resumeLines = request.lines.filter(
    (line) => !preCachedLines.some((analyzed) => analyzed.lineId === line.lineId)
  );

  const sessionId = `${fingerprint.slice(0, 12)}-${startedAt.toString(36)}`;
  const telemetrySession = buildTelemetrySession({
    sessionId,
    startedAt,
    request,
    modelId,
    preCachedLines: preCachedLines.length
  });
  // Only the resume lines are up for grabs this run; pre-cached lines start out accounted for.
  for (const line of preCachedLines) telemetrySession.failedLineIds.delete(line.lineId);
  emitSessionStartTelemetry(telemetrySession);

  emitSnapshot({
    songPath: request.songPath,
    fingerprint,
    status: 'analyzing',
    lines: preCachedLines,
    updatedAt: Date.now()
  });

  const streamedLines = new Map<string, LyricsAnalysisLine>(preCachedLines.map((line) => [line.lineId, line]));

  let lastFlushAt = 0;
  let flushPromise: Promise<unknown> = Promise.resolve();

  const flushIfDue = (force: boolean) => {
    if (streamedLines.size === 0) return;
    if (!force && Date.now() - lastFlushAt < FLUSH_INTERVAL_MS) return;

    lastFlushAt = Date.now();
    const artifactLines = [...streamedLines.values()];
    // Serialized so flush N+1 reads the file flush N wrote (never overwrites it with stale data).
    flushPromise = flushPromise.then(() =>
      mergeLyricsAnalysisCache({
        fingerprint,
        schemaVersion: LYRICS_ANALYSIS_SCHEMA_VERSION,
        promptVersion: LYRICS_ANALYSIS_PROMPT_VERSION,
        modelId,
        uiLanguage: request.uiLanguage,
        songPath: request.songPath,
        songTitle: request.songTitle,
        lines: artifactLines,
        generatedAt: Date.now()
      })
    );
  };

  const onValidatedLine = (input: { line: LyricsAnalysisLine; source: 'first' | 'repair' }) => {
    streamedLines.set(input.line.lineId, input.line);
    telemetrySession.okLines += 1;
    telemetrySession.failedLineIds.delete(input.line.lineId);
    telemetrySession.firstLineAt ??= Date.now();

    emitLineResultTelemetry({
      session: telemetrySession,
      line: input.line,
      source: input.source
    });
    emitFirstLineTelemetry({ session: telemetrySession, source: input.source });

    if (!isCurrent()) return;

    const snapshot: LyricsAnalysisSnapshot = {
      songPath: request.songPath,
      fingerprint,
      status: 'analyzing',
      lines: [...streamedLines.values()],
      updatedAt: Date.now()
    };
    activeSession = snapshot;
    sendToRenderer(LYRICS_ANALYSIS_LINE_CHANNEL, {
      songPath: request.songPath,
      fingerprint,
      line: input.line
    });

    // Mid-run persistence: an exit or crash at any moment keeps every line landed so far.
    flushIfDue(false);
  };

  try {
    const outcome = await analyzeLyricsInWorker({
      config: { baseURL: provider.baseURL, modelId, apiKey: provider.apiKey },
      uiLanguage: request.uiLanguage,
      songTitle: request.songTitle,
      songArtists: request.songArtists,
      lines: resumeLines,
      sessionId,
      onLine: (line, source) => onValidatedLine({ line, source }),
      onRepairing: (failedLineIds) => {
        if (!isCurrent()) return;
        emitSnapshot({
          songPath: request.songPath,
          fingerprint,
          status: 'repairing',
          lines: [...streamedLines.values()],
          updatedAt: Date.now()
        });
        logger.debug('Lyrics analysis repair pass started.', { failedLineIds });
      },
      onPassCompleted: (pass) =>
        emitAnalysisPassTelemetry({ session: telemetrySession, pass })
    });

    await flushPromise;
    if (!isCurrent()) {
      // Superseded by a newer session: still close this run's telemetry so evaluation data stays
      // complete (the lines that did land are already persisted by the flush above).
      emitSessionEndTelemetry({
        session: telemetrySession,
        finishedAt: Date.now(),
        outcome: telemetrySession.failedLineIds.size === 0 ? 'ready' : 'partial'
      });
      return activeSession;
    }

    // One final forced flush guarantees the complete run is durable even if a periodic flush
    // landed within the throttle window a moment ago.
    flushIfDue(true);
    await flushPromise;

    const lines = buildLinesWithStatuses({
      requestLines: request.lines,
      analyzed: [...streamedLines.values()]
    });
    const failedCount = lines.filter((line) => !isAnalyzed(line)).length;

    const snapshot: LyricsAnalysisSnapshot = {
      songPath: request.songPath,
      fingerprint,
      status: 'ready',
      lines,
      updatedAt: Date.now()
    };
    emitSnapshot(snapshot);

    emitSessionEndTelemetry({
      session: telemetrySession,
      finishedAt: Date.now(),
      outcome: failedCount === 0 ? 'ready' : 'partial',
      failedLines: failedCount,
      passStats: outcome.passStats
    });
    return snapshot;
  } catch (error) {
    await flushPromise;
    if (!isCurrent()) return activeSession;

    const mapped: LyricsAnalysisError =
      error && typeof error === 'object' && 'code' in error && 'message' in error
        ? (error as LyricsAnalysisError)
        : { code: 'unknown', message: String(error) };

    // The flush(es) above already persisted every line that landed, so this run's work survives.
    emitSessionEndTelemetry({
      session: telemetrySession,
      finishedAt: Date.now(),
      outcome: 'error',
      errorCode: mapped.code
    });

    const snapshot: LyricsAnalysisSnapshot = {
      songPath: request.songPath,
      fingerprint,
      status: 'error',
      error: mapped,
      updatedAt: Date.now()
    };
    emitSnapshot(snapshot);
    logger.warn('Lyrics analysis failed.', { error: mapped });
    return snapshot;
  }
};
