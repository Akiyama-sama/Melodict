import { ipcMain } from 'electron';

import {
  LYRICS_ANALYSIS_DEFAULT_MODEL_ID,
  type LyricsAnalysisProviderConfigSummary,
  type LyricsAnalysisProviderTestResult,
  type LyricsAnalysisRequest
} from '../../common/lyricsAnalysis';
import logger from '../logger';
import { testLyricsAnalysisProviderInWorker } from './analysisWorkerClient';
import {
  getStoredProviderConfig,
  saveStoredProviderConfig
} from './providerConfigRepository';
import {
  getLyricsAnalysisSession,
  prepareLyricsAnalysisSession
} from './sessionManager';

export const registerLyricsAnalysisIpc = () => {
  ipcMain.handle(
    'app/lyricsAnalysis/prepareSession',
    (_, request: LyricsAnalysisRequest) => prepareLyricsAnalysisSession(request)
  );

  ipcMain.handle('app/lyricsAnalysis/getSession', () => getLyricsAnalysisSession());

  ipcMain.handle(
    'app/lyricsAnalysis/getProviderConfig',
    async (): Promise<LyricsAnalysisProviderConfigSummary> => {
      const stored = await getStoredProviderConfig();

      return {
        baseURL: stored.baseURL,
        modelId: stored.modelId || LYRICS_ANALYSIS_DEFAULT_MODEL_ID,
        hasApiKey: Boolean(stored.apiKey?.trim())
      };
    }
  );

  ipcMain.handle(
    'app/lyricsAnalysis/saveProviderConfig',
    async (
      _,
      input: { baseURL: string; modelId: string; apiKey?: string }
    ): Promise<LyricsAnalysisProviderConfigSummary> => {
      await saveStoredProviderConfig(input);
      const stored = await getStoredProviderConfig();

      return {
        baseURL: stored.baseURL,
        modelId: stored.modelId || LYRICS_ANALYSIS_DEFAULT_MODEL_ID,
        hasApiKey: Boolean(stored.apiKey?.trim())
      };
    }
  );

  ipcMain.handle(
    'app/lyricsAnalysis/testProvider',
    async (
      _,
      input?: { baseURL?: string; modelId?: string; apiKey?: string }
    ): Promise<LyricsAnalysisProviderTestResult> => {
      const stored = await getStoredProviderConfig();
      const baseURL = input?.baseURL?.trim() || stored.baseURL;
      // An empty apiKey from the form means "reuse the saved key".
      const apiKey = input?.apiKey?.trim() || stored.apiKey || '';

      try {
        return await testLyricsAnalysisProviderInWorker({
          baseURL,
          modelId: input?.modelId?.trim() || stored.modelId || LYRICS_ANALYSIS_DEFAULT_MODEL_ID,
          apiKey
        });
      } catch (error) {
        logger.warn('Failed to test the lyrics analysis provider.', { error });
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          latencyMs: 0,
          errorCode: 'unknown'
        };
      }
    }
  );
};
