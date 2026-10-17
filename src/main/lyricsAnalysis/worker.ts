import type {
  LyricsAnalysisError,
  LyricsAnalysisInputLine,
  LyricsAnalysisLine,
  LyricsAnalysisProviderConfig,
  LyricsAnalysisProviderTestResult
} from '../../common/lyricsAnalysis';
import { analyzeLyrics, mapProviderError, testLyricsAnalysisProvider } from './providerGateway';

type WorkerRequest =
  | {
      type: 'analyze';
      requestId: string;
      config: LyricsAnalysisProviderConfig;
      uiLanguage: string;
      songTitle: string;
      songArtists: string[];
      lines: LyricsAnalysisInputLine[];
    }
  | {
      type: 'test';
      requestId: string;
      config: LyricsAnalysisProviderConfig;
    }
  | { type: 'cancel'; requestId: string };

type WorkerResponse =
  | { type: 'line'; requestId: string; line: LyricsAnalysisLine }
  | { type: 'repairing'; requestId: string; failedLineIds: string[] }
  | { type: 'done'; requestId: string; lines: LyricsAnalysisLine[]; failedLineIds: string[] }
  | { type: 'error'; requestId: string; error: LyricsAnalysisError }
  | { type: 'test-result'; requestId: string; result: LyricsAnalysisProviderTestResult };

const port = process.parentPort;
const abortControllers = new Map<string, AbortController>();

const post = (message: WorkerResponse) => port.postMessage(message);

const runAnalysis = async (
  request: Extract<WorkerRequest, { type: 'analyze' }>
) => {
  const controller = new AbortController();
  abortControllers.set(request.requestId, controller);

  try {
    const outcome = await analyzeLyrics({
      config: request.config,
      uiLanguage: request.uiLanguage,
      songTitle: request.songTitle,
      songArtists: request.songArtists,
      lines: request.lines,
      signal: controller.signal,
      onLine: (line) => post({ type: 'line', requestId: request.requestId, line }),
      onRepairStarted: (failedLineIds) =>
        post({ type: 'repairing', requestId: request.requestId, failedLineIds })
    });

    post({
      type: 'done',
      requestId: request.requestId,
      lines: outcome.lines,
      failedLineIds: outcome.failedLineIds
    });
  } catch (error) {
    if (controller.signal.aborted) return;
    post({ type: 'error', requestId: request.requestId, error: mapProviderError(error) });
  } finally {
    abortControllers.delete(request.requestId);
  }
};

const runTest = async (request: Extract<WorkerRequest, { type: 'test' }>) => {
  const result = await testLyricsAnalysisProvider({
    baseURL: request.config.baseURL,
    modelId: request.config.modelId,
    apiKey: request.config.apiKey ?? ''
  });

  post({ type: 'test-result', requestId: request.requestId, result });
};

port.on('message', (messageEvent) => {
  const request = messageEvent.data as WorkerRequest;

  switch (request.type) {
    case 'analyze':
      void runAnalysis(request);
      break;
    case 'test':
      void runTest(request);
      break;
    case 'cancel':
      abortControllers.get(request.requestId)?.abort();
      abortControllers.delete(request.requestId);
      break;
    default:
      break;
  }
});
