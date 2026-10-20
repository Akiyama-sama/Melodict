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
import type { ProbeConcurrencyResult } from './providerGateway';
import workerModulePath from './worker?modulePath';
import type { WorkerResponse as WorkerMessage } from './workerProtocol';

type ProbeOutcome =
  | { ok: true; result: ProbeConcurrencyResult }
  | { ok: false; error: string };

interface PendingAnalysis {
  resolve: (value: {
    lines: LyricsAnalysisLine[];
    failedLineIds: string[];
    passStats: { outputTokens: number | undefined; inputTokens: number | undefined };
  }) => void;
  reject: (error: LyricsAnalysisError) => void;
  onLine: (line: LyricsAnalysisLine, source: 'first' | 'repair') => void;
  onRepairStarted?: (failedLineIds: string[]) => void;
  onPassCompleted?: (pass: AnalysisPassTelemetryEvent) => void;
}

const pendingAnalyses = new Map<string, PendingAnalysis>();
const pendingTests = new Map<string, (result: LyricsAnalysisProviderTestResult) => void>();
const pendingProbes = new Map<string, (outcome: ProbeOutcome) => void>();

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

    if (message.type === 'probe-result') {
      pendingProbes.get(message.requestId)?.(
        message.result
          ? { ok: true, result: message.result }
          : { ok: false, error: message.error ?? 'Unknown probe failure.' }
      );
      pendingProbes.delete(message.requestId);
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
    for (const [requestId, resolve] of pendingProbes) {
      resolve({ ok: false, error: 'The background analysis process stopped unexpectedly.' });
      pendingProbes.delete(requestId);
    }
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
  onRepairStarted?: (failedLineIds: string[]) => void;
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
      onRepairStarted: input.onRepairStarted,
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

export const probeProviderConcurrencyInWorker = (config: LyricsAnalysisProviderConfig) =>
  new Promise<ProbeConcurrencyResult>((resolve, reject) => {
    const requestId = nextRequestId();

    pendingProbes.set(requestId, (outcome) => {
      if (outcome.ok) resolve(outcome.result);
      else reject(new Error(outcome.error));
    });

    try {
      getWorker().postMessage({ type: 'probe', requestId, config });
    } catch (error) {
      pendingProbes.delete(requestId);
      reject(error);
    }
  });
