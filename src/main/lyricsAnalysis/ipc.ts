import { clipboard, ipcMain } from 'electron';

import {
  LYRICS_ANALYSIS_DEFAULT_MODEL_ID,
  type LyricsAnalysisProviderProfileInput,
  type LyricsAnalysisProviderProfilesState,
  type LyricsAnalysisProviderTestResult,
  type LyricsAnalysisRequest
} from '../../common/lyricsAnalysis';
import type { ProbeConcurrencyResult } from './providerGateway';
import logger from '../logger';
import {
  probeProviderConcurrencyInWorker,
  testLyricsAnalysisProviderInWorker
} from './analysisWorkerClient';

/** Result of the settings-page concurrency probe: verdict + per-level detail, or a reason. */
export interface ProbeConcurrencyIpcResult extends Partial<ProbeConcurrencyResult> {
  ok: boolean;
  message: string;
}
import {
  deleteProviderProfile,
  getStoredProviderProfile,
  getStoredProviderProfiles,
  saveStoredProviderProfile,
  setActiveProviderProfile
} from './providerConfigRepository';
import { getLyricsAnalysisSession, prepareLyricsAnalysisSession } from './sessionManager';

const toProfilesState = async (): Promise<LyricsAnalysisProviderProfilesState> => {
  const { profiles, activeProfileId } = await getStoredProviderProfiles();

  return {
    activeProfileId,
    profiles: profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      baseURL: profile.baseURL,
      modelId: profile.modelId,
      hasApiKey: profile.hasApiKey,
      apiKeyHint: profile.apiKeyHint,
      isActive: profile.id === activeProfileId,
      ...(profile.maxConcurrency !== undefined
        ? { maxConcurrency: profile.maxConcurrency }
        : {})
    }))
  };
};

export const registerLyricsAnalysisIpc = () => {
  ipcMain.handle(
    'app/lyricsAnalysis/prepareSession',
    (_, request: LyricsAnalysisRequest) => prepareLyricsAnalysisSession(request)
  );

  ipcMain.handle('app/lyricsAnalysis/getSession', () => getLyricsAnalysisSession());

  ipcMain.handle('app/lyricsAnalysis/getProviderProfiles', () => toProfilesState());

  ipcMain.handle(
    'app/lyricsAnalysis/saveProviderProfile',
    async (_, input: LyricsAnalysisProviderProfileInput) => {
      await saveStoredProviderProfile(input);
      return toProfilesState();
    }
  );

  ipcMain.handle('app/lyricsAnalysis/setActiveProviderProfile', async (_, profileId: string) => {
    await setActiveProviderProfile(profileId);
    return toProfilesState();
  });

  ipcMain.handle('app/lyricsAnalysis/deleteProviderProfile', async (_, profileId: string) => {
    await deleteProviderProfile(profileId);
    return toProfilesState();
  });

  // Only the "copy key" and reveal controls use this; the value never appears in the profile list.
  ipcMain.handle('app/lyricsAnalysis/revealProviderApiKey', async (_, profileId: string) => {
    const profile = await getStoredProviderProfile(profileId);
    return profile?.apiKey;
  });

  // Electron's clipboard works even when the renderer's `navigator.clipboard` call is not focused.
  ipcMain.handle('app/lyricsAnalysis/copyProviderApiKey', async (_, profileId: string) => {
    const profile = await getStoredProviderProfile(profileId);
    if (!profile?.apiKey) return false;
    clipboard.writeText(profile.apiKey);
    return true;
  });

  // Concurrency probe for the provider form's advanced section: fires tiny requests through the
  // analysis worker and reports the tolerated burst ceiling. A probe against an unsaved draft
  // uses the draft's values; a probe of a saved profile falls back to its stored key.
  ipcMain.handle(
    'app/lyricsAnalysis/probeConcurrency',
    async (
      _,
      input?: { profileId?: string; baseURL?: string; modelId?: string; apiKey?: string }
    ): Promise<ProbeConcurrencyIpcResult> => {
      const saved = input?.profileId ? await getStoredProviderProfile(input.profileId) : undefined;
      const baseURL = input?.baseURL?.trim() || saved?.baseURL || '';
      const apiKey = input?.apiKey?.trim() || saved?.apiKey || '';
      const modelId =
        input?.modelId?.trim() || saved?.modelId || LYRICS_ANALYSIS_DEFAULT_MODEL_ID;

      if (!baseURL || !apiKey) {
        return { ok: false, message: 'Base URL and API key are required before probing.' };
      }

      try {
        const result = await probeProviderConcurrencyInWorker({ baseURL, modelId, apiKey });
        return { ok: true, ...result, message: `Probed ${result.probedMaxConcurrency}.` };
      } catch (error) {
        logger.warn('Failed to probe the lyrics analysis concurrency.', { error });
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );

  ipcMain.handle(
    'app/lyricsAnalysis/testProvider',
    async (
      _,
      input?: { profileId?: string; baseURL?: string; modelId?: string; apiKey?: string }
    ): Promise<LyricsAnalysisProviderTestResult> => {
      // Testing a saved but inactive profile must use that profile's own key, not the active one.
      const saved = input?.profileId ? await getStoredProviderProfile(input.profileId) : undefined;
      const baseURL = input?.baseURL?.trim() || saved?.baseURL || '';
      // An empty apiKey from the form means "reuse the saved key".
      const apiKey = input?.apiKey?.trim() || saved?.apiKey || '';

      try {
        return await testLyricsAnalysisProviderInWorker({
          baseURL,
          modelId:
            input?.modelId?.trim() || saved?.modelId || LYRICS_ANALYSIS_DEFAULT_MODEL_ID,
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
