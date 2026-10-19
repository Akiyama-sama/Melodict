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
  }) => void;
  reject: (error: LyricsAnalysisError) => void;
  onLine: (line: LyricsAnalysisLine, source: 'first' | 'repair') => void;
  onRepairing?: (failedLineIds: string[]) => void;
  onPassCompleted?: (pass: AnalysisPassTelemetryEvent) => void;
}

const pendingAnalyses = new Map<string, PendingAnalysis>();
const pendingTests = new Map<string, (result: LyricsAnalysisProviderTestResult) => void>();

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
        pending.onRepairing?.(message.failedLineIds);
        break;
      case 'pass':
        pending.onPassCompleted?.(message.pass);
        break;
      case 'done':
        pending.resolve({
          lines: message.lines,
          failedLineIds: message.failedLineIds,
          passStats: message.passStats
        });
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
  onLine: (line: LyricsAnalysisLine, source: 'first' | 'repair') => void;
  onRepairing?: (failedLineIds: string[]) => void;
  onPassCompleted?: (pass: AnalysisPassTelemetryEvent) => void;
}) =>
  new Promise<{
    lines: LyricsAnalysisLine[];
    failedLineIds: string[];
    passStats: { outputTokens: number | undefined; inputTokens: number | undefined };
  }>((resolve, reject) => {
    const requestId = nextRequestId();

    pendingAnalyses.set(requestId, {
      resolve,
      reject,
      onLine: input.onLine,
      onRepairing: input.onRepairing,
      onPassCompleted: input.onPassCompleted
    });

    getWorker().postMessage({
      type: 'analyze',
      requestId,
      config: input.config,
      uiLanguage: input.uiLanguage,
      songTitle: input.songTitle,
      songArtists: input.songArtists,
      lines: input.lines,
      sessionId: input.sessionId
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
