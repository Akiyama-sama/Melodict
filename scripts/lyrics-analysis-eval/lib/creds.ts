/**
 * Credentials resolution for the evaluation harness. The app's provider profile file stores
 * safeStorage-encrypted keys, which these processes cannot decrypt; only the plaintext fallback is
 * readable here.
 */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export const readStoredCredentials = async (): Promise<
  { baseURL: string; modelId: string; apiKey?: string } | undefined
> => {
  const configPath = path.join(
    process.env.HOME ?? '',
    'Library/Application Support/knote/lyrics-analysis-providers.json'
  );
  try {
    const state = JSON.parse(await fsPromises.readFile(configPath, 'utf-8')) as {
      activeProfileId?: string;
      profiles: Array<{ id: string; baseURL: string; modelId: string; apiKeyPlain?: string }>;
    };
    const active = state.profiles.find((p) => p.id === state.activeProfileId) ?? state.profiles[0];
    return active ? { baseURL: active.baseURL, modelId: active.modelId, apiKey: active.apiKeyPlain } : undefined;
  } catch {
    return undefined;
  }
};

/** Reads provider credentials from the `/tmp/eval-creds.env` file used by manual CLI runs. */
export const readCredsFromEnvFile = (envFilePath = '/tmp/eval-creds.env') => {
  const env = fs.readFileSync(envFilePath, 'utf-8');
  const get = (key: string) =>
    new RegExp(`^(?:export\\s+)?${key}=(.*)$`, 'm').exec(env)?.[1]?.trim() ?? '';
  return {
    baseURL: get('LYRICS_ANALYSIS_BASE_URL'),
    apiKey: get('LYRICS_ANALYSIS_API_KEY')
  };
};
