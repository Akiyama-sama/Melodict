import {
  analyzeLyrics,
  mapProviderError,
  probeProviderConcurrency,
  testLyricsAnalysisProvider
} from './providerGateway';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

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
      sessionId: request.sessionId,
      signal: controller.signal,
      onLine: (line, source) =>
        post({ type: 'line', requestId: request.requestId, line, source }),
      onRepairStarted: (failedLineIds) =>
        post({ type: 'repairing', requestId: request.requestId, failedLineIds }),
      onPassCompleted: (pass) => post({ type: 'pass', requestId: request.requestId, pass })
    });

    post({
      type: 'done',
      requestId: request.requestId,
      lines: outcome.lines,
      failedLineIds: outcome.failedLineIds,
      passStats: outcome.passStats
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

const runProbe = async (request: Extract<WorkerRequest, { type: 'probe' }>) => {
  try {
    const result = await probeProviderConcurrency({
      baseURL: request.config.baseURL,
      modelId: request.config.modelId,
      apiKey: request.config.apiKey ?? ''
    });
    post({ type: 'probe-result', requestId: request.requestId, result });
  } catch (error) {
    // Probe failures are data, not crashes: the settings page shows the reason inline.
    post({
      type: 'probe-result',
      requestId: request.requestId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
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
    case 'probe':
      void runProbe(request);
      break;
    case 'cancel':
      abortControllers.get(request.requestId)?.abort();
      abortControllers.delete(request.requestId);
      break;
    default:
      break;
  }
});
