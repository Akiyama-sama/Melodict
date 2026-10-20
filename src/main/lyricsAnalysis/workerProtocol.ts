import type {
  LyricsAnalysisError,
  LyricsAnalysisInputLine,
  LyricsAnalysisLine,
  LyricsAnalysisProviderConfig,
  LyricsAnalysisProviderTestResult
} from '../../common/lyricsAnalysis';
import type { AnalysisPassTelemetryEvent } from '../../common/lyricsAnalysisTelemetry';
import type { ProbeConcurrencyResult } from './providerGateway';

/**
 * The postMessage contract between the main-process client (analysisWorkerClient.ts) and the
 * lyrics-analysis utility process (worker.ts). Both sides import these types from here so the
 * request/response envelopes cannot drift apart. Wire shape must stay stable — these objects cross
 * a process boundary.
 */

export type WorkerRequest =
  | {
      type: 'analyze';
      requestId: string;
      config: LyricsAnalysisProviderConfig;
      uiLanguage: string;
      songTitle: string;
      songArtists: string[];
      lines: LyricsAnalysisInputLine[];
      sessionId?: string;
    }
  | {
      type: 'test';
      requestId: string;
      config: LyricsAnalysisProviderConfig;
    }
  | {
      type: 'probe';
      requestId: string;
      config: LyricsAnalysisProviderConfig;
    }
  | { type: 'cancel'; requestId: string };

export type WorkerResponse =
  | { type: 'line'; requestId: string; line: LyricsAnalysisLine; source: 'first' | 'repair' }
  | { type: 'repairing'; requestId: string; failedLineIds: string[] }
  | {
      type: 'done';
      requestId: string;
      lines: LyricsAnalysisLine[];
      failedLineIds: string[];
      passStats: { outputTokens: number | undefined; inputTokens: number | undefined };
    }
  | { type: 'error'; requestId: string; error: LyricsAnalysisError }
  | { type: 'test-result'; requestId: string; result: LyricsAnalysisProviderTestResult }
  | {
      type: 'probe-result';
      requestId: string;
      result?: ProbeConcurrencyResult;
      error?: string;
    }
  | { type: 'pass'; requestId: string; pass: AnalysisPassTelemetryEvent };
