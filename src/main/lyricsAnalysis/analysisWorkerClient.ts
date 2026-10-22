import { utilityProcess, type UtilityProcess } from 'electron';

import type {
  LyricsAnalysisError,
  LyricsAnalysisInputLine,
  LyricsAnalysisLine,
  LyricsAnalysisProviderConfig,
  LyricsAnalysisProviderTestResult
} from '../../common/lyricsAnalysis';
import type { AnalysisPassTelemetryEvent } from '../../common/lyricsAnalysisTelemetry';
import logger from '../logger';
import workerModulePath from './worker?modulePath';
import type { WorkerResponse as WorkerMessage } from './workerProtocol';

interface PendingAnalysis {
  resolve: (value: {
    lines: LyricsAnalysisLine[];
    failedLineIds: string[];
    passStats: { outputTokens: number | undefined; inputTokens: number | undefined };
    learnedConcurrency: number;
  }) => void;
  reject: (error: LyricsAnalysisError) => void;
  onLine: (line: LyricsAnalysisLine, source: 'first' | 'repair') => void;
  onRepairStarted?: (failedLineIds: string[]) => void;
  onPassCompleted?: (pass: AnalysisPassTelemetryEvent) => void;
  onConcurrencyStats?: (stats: { max: number; mean: number; rateLimitedCount: number }) => void;
  onLearnedConcurrency?: (ceiling: number) => void;
}

const pendingAnalyses = new Map<string, PendingAnalysis>();
const pendingTests = new Map<string, (result: LyricsAnalysisProviderTestResult) => void>();

/** RequestIds currently running an analysis in the worker (used to cancel superseded runs). */
export const inFlightAnalysisRequestIds = () => new Set(pendingAnalyses.keys());

let worker: UtilityProcess | undefined;
let requestCounter = 0;

const createWorker = () => {
  const child = utilityProcess.fork(workerModulePath, [], {
    serviceName: 'lyrics-analysis',
    stdio: 'inherit'
  });

  child.on('message', (message: WorkerMessage) => {
    if (message.type === 'test-result') {
      pendingTests.get(message.requestId)?.(message.result);
      pendingTests.delete(message.requestId);
      return;
    }

    const pending = pendingAnalyses.get(message.requestId);
    if (!pending) return;

    switch (message.type) {
      case 'line':
        pending.onLine(message.line, message.source);
        break;
      case 'repairing':
        pending.onRepairStarted?.(message.failedLineIds);
        break;
      case 'pass':
        pending.onPassCompleted?.(message.pass);
        break;
      case 'concurrency':
        pending.onConcurrencyStats?.(message.stats);
        break;
      case 'done':
        pending.resolve({
          lines: message.lines,
          failedLineIds: message.failedLineIds,
          passStats: message.passStats,
          learnedConcurrency: message.learnedConcurrency
        });
        pending.onLearnedConcurrency?.(message.learnedConcurrency);
        pendingAnalyses.delete(message.requestId);
        break;
      case 'error':
        pending.reject(message.error);
        pendingAnalyses.delete(message.requestId);
        break;
      default:
        break;
    }
  });

  child.on('exit', (code) => {
    logger.warn('The lyrics analysis worker exited.', { code });

    if (worker === child) worker = undefined;

    for (const [requestId, pending] of pendingAnalyses) {
      pending.reject({
        code: 'unknown',
        message: 'The background analysis process stopped unexpectedly.'
      });
      pendingAnalyses.delete(requestId);
    }
    pendingTests.clear();
  });

  return child;
};

const getWorker = () => {
  if (!worker) worker = createWorker();
  return worker;
};

const nextRequestId = () => `req-${++requestCounter}`;

export const analyzeLyricsInWorker = (input: {
  config: LyricsAnalysisProviderConfig;
  uiLanguage: string;
  songTitle: string;
  songArtists: string[];
  lines: LyricsAnalysisInputLine[];
  sessionId?: string;
  /** Seeds the worker's AIMD window from the cross-session concurrency memory. */
  initialConcurrency?: number;
  onLine: (line: LyricsAnalysisLine, source: 'first' | 'repair') => void;
  onRepairStarted?: (failedLineIds: string[]) => void;
  onPassCompleted?: (pass: AnalysisPassTelemetryEvent) => void;
  onConcurrencyStats?: (stats: { max: number; mean: number; rateLimitedCount: number }) => void;
  /** Called once with the window ceiling the run converged on (for the memory write-back). */
  onLearnedConcurrency?: (ceiling: number) => void;
}) =>
  new Promise<{
    lines: LyricsAnalysisLine[];
    failedLineIds: string[];
    passStats: { outputTokens: number | undefined; inputTokens: number | undefined };
    learnedConcurrency: number;
  }>((resolve, reject) => {
    const requestId = nextRequestId();

    pendingAnalyses.set(requestId, {
      resolve,
      reject,
      onLine: input.onLine,
      onRepairStarted: input.onRepairStarted,
      onPassCompleted: input.onPassCompleted,
      onConcurrencyStats: input.onConcurrencyStats,
      onLearnedConcurrency: input.onLearnedConcurrency
    });

    getWorker().postMessage({
      type: 'analyze',
      requestId,
      config: input.config,
      uiLanguage: input.uiLanguage,
      songTitle: input.songTitle,
      songArtists: input.songArtists,
      lines: input.lines,
      sessionId: input.sessionId,
      ...(input.initialConcurrency !== undefined
        ? { initialConcurrency: input.initialConcurrency }
        : {})
    });
  });

export const testLyricsAnalysisProviderInWorker = (config: LyricsAnalysisProviderConfig) =>
  new Promise<LyricsAnalysisProviderTestResult>((resolve, reject) => {
    const requestId = nextRequestId();

    pendingTests.set(requestId, resolve);

    try {
      getWorker().postMessage({ type: 'test', requestId, config });
    } catch (error) {
      pendingTests.delete(requestId);
      reject(error);
    }
  });

/**
 * Cancels one in-flight worker analysis. Superseding a session must stop the old run's gateway
 * traffic: with the app-level trigger a new song's prepare fires the moment playback starts,
 * and the old run's remaining in-flight batches would otherwise share the provider's real
 * concurrency with the new run — doubling the load right when the new song needs the window
 * (its batches then slow down or trip 429s, showing the ⚠/partial state).
 *
 * The worker answers an abort silently (its runAnalysis just returns), so the pending entry is
 * settled and removed here instead of waiting for a message that will never come; the worker
 * keeps its own abortControllers cleanup. Late 'line'/'done' messages from batches already in
 * flight find no pending entry and are dropped — the superseded session has already flushed
 * whatever landed before the cut.
 */
export const cancelLyricsAnalysisRequest = (requestId: string) => {
  const pending = pendingAnalyses.get(requestId);
  if (!pending) return;

  pendingAnalyses.delete(requestId);
  try {
    getWorker().postMessage({ type: 'cancel', requestId });
  } catch {
    // Worker is gone; its exit handler already rejected everything pending.
  }
  pending.reject({
    code: 'unknown',
    message: 'Superseded by a newer lyrics analysis session.'
  });
};
