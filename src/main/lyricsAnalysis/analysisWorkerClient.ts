import { utilityProcess, type UtilityProcess } from 'electron';

import type {
  LyricsAnalysisError,
  LyricsAnalysisInputLine,
  LyricsAnalysisLine,
  LyricsAnalysisProviderConfig,
  LyricsAnalysisProviderTestResult
} from '../../common/lyricsAnalysis';
import logger from '../logger';
import workerModulePath from './worker?modulePath';

interface PendingAnalysis {
  resolve: (value: { lines: LyricsAnalysisLine[]; failedLineIds: string[] }) => void;
  reject: (error: LyricsAnalysisError) => void;
  onLine: (line: LyricsAnalysisLine) => void;
  onRepairing?: (failedLineIds: string[]) => void;
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
        pending.onLine(message.line);
        break;
      case 'repairing':
        pending.onRepairing?.(message.failedLineIds);
        break;
      case 'done':
        pending.resolve({ lines: message.lines, failedLineIds: message.failedLineIds });
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

type WorkerMessage =
  | { type: 'line'; requestId: string; line: LyricsAnalysisLine }
  | { type: 'repairing'; requestId: string; failedLineIds: string[] }
  | { type: 'done'; requestId: string; lines: LyricsAnalysisLine[]; failedLineIds: string[] }
  | { type: 'error'; requestId: string; error: LyricsAnalysisError }
  | { type: 'test-result'; requestId: string; result: LyricsAnalysisProviderTestResult };

export const analyzeLyricsInWorker = (input: {
  config: LyricsAnalysisProviderConfig;
  uiLanguage: string;
  songTitle: string;
  songArtists: string[];
  lines: LyricsAnalysisInputLine[];
  onLine: (line: LyricsAnalysisLine) => void;
  onRepairing?: (failedLineIds: string[]) => void;
}) =>
  new Promise<{ lines: LyricsAnalysisLine[]; failedLineIds: string[] }>((resolve, reject) => {
    const requestId = nextRequestId();

    pendingAnalyses.set(requestId, {
      resolve,
      reject,
      onLine: input.onLine,
      onRepairing: input.onRepairing
    });

    getWorker().postMessage({
      type: 'analyze',
      requestId,
      config: input.config,
      uiLanguage: input.uiLanguage,
      songTitle: input.songTitle,
      songArtists: input.songArtists,
      lines: input.lines
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

export const cancelLyricsAnalysisRequest = (requestId: string) => {
  worker?.postMessage({ type: 'cancel', requestId });
};

export const disposeLyricsAnalysisWorker = () => {
  worker?.kill();
  worker = undefined;
};
