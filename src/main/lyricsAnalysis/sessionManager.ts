import { BrowserWindow } from 'electron';

import {
  LYRICS_ANALYSIS_DEFAULT_MODEL_ID,
  LYRICS_ANALYSIS_PROMPT_VERSION,
  LYRICS_ANALYSIS_SCHEMA_VERSION,
  type LyricsAnalysisInputLine,
  type LyricsAnalysisLine,
  type LyricsAnalysisRequest,
  type LyricsAnalysisSnapshot
} from '../../common/lyricsAnalysis';
import logger from '../logger';
import { analyzeLyricsInWorker } from './analysisWorkerClient';
import {
  buildLyricsAnalysisFingerprint,
  readLyricsAnalysisCache,
  writeLyricsAnalysisCache
} from './cacheRepository';
import { getStoredProviderConfig } from './providerConfigRepository';

export const LYRICS_ANALYSIS_LINE_CHANNEL = 'app/lyricsAnalysis/line';
export const LYRICS_ANALYSIS_SNAPSHOT_CHANNEL = 'app/lyricsAnalysis/snapshot';

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

export const prepareLyricsAnalysisSession = async (request: LyricsAnalysisRequest) => {
  const generation = ++activeGeneration;
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

  if (!request.forceRefresh) {
    const cached = await readLyricsAnalysisCache(fingerprint);

    if (cached && isCurrent()) {
      const snapshot: LyricsAnalysisSnapshot = {
        songPath: request.songPath,
        fingerprint,
        status: 'cached',
        lines: buildLinesWithStatuses({ requestLines: request.lines, analyzed: cached.lines }),
        updatedAt: Date.now()
      };
      emitSnapshot(snapshot);
      return snapshot;
    }
  }

  if (!isCurrent()) return activeSession;

  emitSnapshot({
    songPath: request.songPath,
    fingerprint,
    status: 'analyzing',
    updatedAt: Date.now()
  });

  const streamedLines = new Map<string, LyricsAnalysisLine>();

  try {
    const outcome = await analyzeLyricsInWorker({
      config: { baseURL: provider.baseURL, modelId, apiKey: provider.apiKey },
      uiLanguage: request.uiLanguage,
      songTitle: request.songTitle,
      songArtists: request.songArtists,
      lines: request.lines,
      onLine: (line) => {
        if (!isCurrent()) return;
        streamedLines.set(line.lineId, line);

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
          line
        });
      },
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
      }
    });

    if (!isCurrent()) return activeSession;

    const lines = buildLinesWithStatuses({ requestLines: request.lines, analyzed: outcome.lines });
    const readyLines = lines.filter((line) => line.status !== 'unavailable');

    if (readyLines.length > 0) {
      await writeLyricsAnalysisCache({
        fingerprint,
        schemaVersion: LYRICS_ANALYSIS_SCHEMA_VERSION,
        promptVersion: LYRICS_ANALYSIS_PROMPT_VERSION,
        modelId,
        uiLanguage: request.uiLanguage,
        songPath: request.songPath,
        songTitle: request.songTitle,
        lines: readyLines,
        generatedAt: Date.now()
      });
    }

    const snapshot: LyricsAnalysisSnapshot = {
      songPath: request.songPath,
      fingerprint,
      status: 'ready',
      lines,
      updatedAt: Date.now()
    };
    emitSnapshot(snapshot);
    return snapshot;
  } catch (error) {
    if (!isCurrent()) return activeSession;

    const mapped =
      error && typeof error === 'object' && 'code' in error && 'message' in error
        ? (error as LyricsAnalysisSnapshot['error'])
        : { code: 'unknown' as const, message: String(error) };

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
