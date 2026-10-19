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
import { analyzeLyricsLanguageMix } from '../../common/lyricsLanguageProfiles';
import logger from '../logger';
import { analyzeLyricsInWorker } from './analysisWorkerClient';
import {
  buildLyricsAnalysisFingerprint,
  mergeLyricsAnalysisCache,
  readLyricsAnalysisPartialCache
} from './cacheRepository';
import {
  buildLineAnalysisCacheKey,
  hydrateLineAnalysisFromCache,
  readLineAnalysisCache,
  remapLineAnalysisLineId,
  writeLineAnalysisCache
} from './lineCacheRepository';
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

/**
 * Lines of this request the run has NOT landed yet, derived from the landed-lines map instead of
 * being maintained as a second mutable tally next to it. Every streamed key is always a request
 * lineId (hydrated pre-cached lines, landed siblings, and worker lines alike are request lines or
 * their same-text siblings), so the derivation below is exactly the tally the deleted
 * `failedLineIds` set used to hold.
 */
const deriveUnlandedLineIds = (input: {
  requestLines: LyricsAnalysisInputLine[];
  landedByLineId: Map<string, LyricsAnalysisLine>;
}): Set<string> => {
  const unlanded = new Set<string>();
  for (const line of input.requestLines) {
    if (!input.landedByLineId.has(line.lineId)) unlanded.add(line.lineId);
  }
  return unlanded;
};

const buildTelemetrySession = (input: {
  sessionId: string;
  startedAt: number;
  request: LyricsAnalysisRequest;
  modelId: string;
  preCachedLines: number;
  /** Distinct lines actually sent; lower than total-preCached when repeated lines are deduped. */
  requestedLines?: number;
}): LyricsAnalysisTelemetrySession => ({
  sessionId: input.sessionId,
  startedAt: input.startedAt,
  modelId: input.modelId,
  totalLines: input.request.lines.length,
  preCachedLines: input.preCachedLines,
  requestedLines: input.requestedLines ?? input.request.lines.length - input.preCachedLines,
  passCount: 0,
  outputTokens: undefined,
  firstLineEmitted: false
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

  // Line-level cache: a line whose exact text was analyzed before (this song's earlier runs, a
  // repeated chorus line, or the same line in a different song) hydrates without an LLM call. The
  // per-line language comes from the song-level mix, so a Japanese song's kanji-only lines key as
  // Japanese rather than Chinese. Keys ignore lineId, which is what makes them reusable.
  const languageMix = analyzeLyricsLanguageMix(request.lines);
  const lineKeys = new Map<string, string>();
  request.lines.forEach((line, index) => {
    lineKeys.set(
      line.lineId,
      buildLineAnalysisCacheKey({
        text: line.text,
        romanizedText: line.romanizedText,
        uiLanguage: request.uiLanguage,
        modelId,
        language: languageMix.lineLanguages[index] ?? 'unknown'
      })
    );
  });

  // Line-cache entries that were NOT already covered by the song artifact (those are the ones
  // worth writing back to it — the artifact merge would be a no-op for the rest).
  let lineCacheHits: LyricsAnalysisLine[] = [];
  if (!request.forceRefresh) {
    const cachedByLineId = new Map(preCachedLines.map((line) => [line.lineId, line]));
    const entries = await Promise.all(
      request.lines.map(async (line) => {
        const existing = cachedByLineId.get(line.lineId);
        if (existing) return { line: existing, fromLineCache: false };
        const key = lineKeys.get(line.lineId);
        if (!key) return undefined;
        const entry = await readLineAnalysisCache(key);
        return entry
          ? {
              line: hydrateLineAnalysisFromCache({ entry, lineId: line.lineId, text: line.text }),
              fromLineCache: true
            }
          : undefined;
      })
    );
    const hits = entries.filter(
      (entry): entry is { line: LyricsAnalysisLine; fromLineCache: boolean } => entry !== undefined
    );
    lineCacheHits = hits.filter((hit) => hit.fromLineCache).map((hit) => hit.line);
    // Union of the song artifact and the line cache: lines found in either skip the LLM.
    preCachedLines = hits.map((hit) => hit.line);
  }

  if (isCurrent() && lineCacheHits.length > 0) {
    // Hydrated lines are real analysis results for this fingerprint, so they belong in the
    // song-level artifact too — the next open of this exact song is then a plain full-cache hit.
    await mergeLyricsAnalysisCache({
      fingerprint,
      schemaVersion: LYRICS_ANALYSIS_SCHEMA_VERSION,
      promptVersion: LYRICS_ANALYSIS_PROMPT_VERSION,
      modelId,
      uiLanguage: request.uiLanguage,
      songPath: request.songPath,
      songTitle: request.songTitle,
      lines: lineCacheHits,
      generatedAt: Date.now()
    }).catch(() => undefined);
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

  // Resume inputs exclude lines the cache already covers, so the LLM only sees the gaps.
  const cachedLineIds = new Set(preCachedLines.map((line) => line.lineId));
  const resumeLines = request.lines.filter((line) => !cachedLineIds.has(line.lineId));

  // Repeated lines within one song (choruses) share a cache key: send each distinct line once,
  // then fan the result out to its siblings on arrival. `lineId` stays the source of truth for
  // the artifact, so the fan-out is id-level only.
  const siblingLineIds = new Map<string, string[]>();
  for (const line of resumeLines) {
    const key = lineKeys.get(line.lineId);
    if (!key) continue;
    const ids = siblingLineIds.get(key);
    if (ids) ids.push(line.lineId);
    else siblingLineIds.set(key, [line.lineId]);
  }
  const requestedKeys = new Set<string>();
  const dedupedResumeLines = resumeLines.filter((line) => {
    const key = lineKeys.get(line.lineId);
    if (!key) return true;
    if (requestedKeys.has(key)) return false;
    requestedKeys.add(key);
    return true;
  });

  const sessionId = `${fingerprint.slice(0, 12)}-${startedAt.toString(36)}`;
  const telemetrySession = buildTelemetrySession({
    sessionId,
    startedAt,
    request,
    modelId,
    preCachedLines: preCachedLines.length,
    requestedLines: dedupedResumeLines.length
  });
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
    // One LLM element can stand for several identical lines (a chorus): fan the analysis out to
    // every sibling lineId and persist it under each, so the artifact stays per-line complete.
    const key = lineKeys.get(input.line.lineId);
    const siblings = key ? (siblingLineIds.get(key) ?? [input.line.lineId]) : [input.line.lineId];
    // Siblings share the key, and the key includes the text, so the surface text is identical —
    // remapping the analysis onto each sibling's lineId is exactly what the line cache does on
    // hydration.
    const landedLines = siblings.map((lineId) =>
      lineId === input.line.lineId
        ? input.line
        : remapLineAnalysisLineId({ line: input.line, lineId, text: input.line.text })
    );

    for (const landed of landedLines) {
      streamedLines.set(landed.lineId, landed);
      // One event per landed line, siblings included: telemetry consumers count per-line coverage.
      emitLineResultTelemetry({ session: telemetrySession, line: landed, source: input.source });
    }
    telemetrySession.firstLineAt ??= Date.now();
    emitFirstLineTelemetry({ session: telemetrySession, source: input.source });

    // Persist to the cross-song line cache once per distinct line text.
    if (key && !request.forceRefresh) {
      void writeLineAnalysisCache({ key, line: input.line });
    }

    // Persistence and renderer fan-out must NOT be gated on isCurrent(). A superseded session
    // (the user reopened the fullscreen view or switched songs mid-run, bumping the generation)
    // still owns the lines its worker streams: skipping the flush silently lost them from the
    // song artifact (only the line cache survived), and skipping the send left the previous
    // view frozen — lines landed per telemetry but never appeared until a full re-analyze.
    // The renderer filters by songPath, so a stale view ignores events for other songs.
    // activeSession stays owned by the newest generation (set below only when current).
    for (const landed of landedLines) {
      sendToRenderer(LYRICS_ANALYSIS_LINE_CHANNEL, {
        songPath: request.songPath,
        fingerprint,
        line: landed
      });
    }

    // Mid-run persistence: an exit or crash at any moment keeps every line landed so far.
    flushIfDue(false);

    if (!isCurrent()) return;

    const snapshot: LyricsAnalysisSnapshot = {
      songPath: request.songPath,
      fingerprint,
      status: 'analyzing',
      lines: [...streamedLines.values()],
      updatedAt: Date.now()
    };
    activeSession = snapshot;
  };

  try {
    const outcome = await analyzeLyricsInWorker({
      config: { baseURL: provider.baseURL, modelId, apiKey: provider.apiKey },
      uiLanguage: request.uiLanguage,
      songTitle: request.songTitle,
      songArtists: request.songArtists,
      lines: dedupedResumeLines,
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
      // Superseded by a newer session: its lines were still fanned out and flushed on arrival
      // (see onValidatedLine), but its final forced flush must still run — a superseded run can
      // hold the last few lines of the song, and skipping this flush is exactly how lines went
      // missing from the artifact while telemetry claimed the run complete.
      flushIfDue(true);
      await flushPromise;
      // Still close this run's telemetry so evaluation data stays complete.
      const unlandedCount = deriveUnlandedLineIds({
        requestLines: request.lines,
        landedByLineId: streamedLines
      }).size;
      emitSessionEndTelemetry({
        session: telemetrySession,
        finishedAt: Date.now(),
        outcome: unlandedCount === 0 ? 'ready' : 'partial',
        failedLines: unlandedCount
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
      errorCode: mapped.code,
      failedLines: deriveUnlandedLineIds({
        requestLines: request.lines,
        landedByLineId: streamedLines
      }).size
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
