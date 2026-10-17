import { app, safeStorage } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import logger from '../logger';

const CONFIG_FILE_NAME = 'lyrics-analysis-provider.json';

interface StoredProviderConfigFile {
  baseURL?: string;
  modelId?: string;
  /** base64 of `safeStorage.encryptString(apiKey)` when OS encryption is available. */
  apiKeyEncrypted?: string;
  /** Only used when OS encryption is unavailable (e.g. minimal Linux environments). */
  apiKeyPlain?: string;
}

export interface StoredProviderConfig {
  baseURL: string;
  modelId: string;
  apiKey?: string;
}

export const getLyricsAnalysisConfigPath = () =>
  path.join(app.getPath('userData'), CONFIG_FILE_NAME);

const encryptApiKey = (apiKey: string): Pick<StoredProviderConfigFile, 'apiKeyEncrypted' | 'apiKeyPlain'> => {
  if (apiKey.length === 0) return {};

  try {
    if (safeStorage.isEncryptionAvailable()) {
      return { apiKeyEncrypted: safeStorage.encryptString(apiKey).toString('base64') };
    }
  } catch (error) {
    logger.warn('Failed to encrypt the lyrics analysis API key; falling back to plain storage.', {
      error
    });
  }

  return { apiKeyPlain: apiKey };
};

const decryptApiKey = (stored: StoredProviderConfigFile) => {
  if (stored.apiKeyEncrypted) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.apiKeyEncrypted, 'base64'));
    } catch (error) {
      logger.warn('Failed to decrypt the stored lyrics analysis API key.', { error });
      return undefined;
    }
  }

  return stored.apiKeyPlain;
};

const readConfigFile = async (): Promise<StoredProviderConfigFile> => {
  try {
    const data = await fs.readFile(getLyricsAnalysisConfigPath(), 'utf-8');
    const parsed = JSON.parse(data) as StoredProviderConfigFile;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    // A missing file is the normal first-run case, not an error worth logging loudly.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      logger.warn('Failed to read the lyrics analysis provider config.', { error });
    return {};
  }
};

export const getStoredProviderConfig = async (): Promise<StoredProviderConfig> => {
  const stored = await readConfigFile();

  return {
    baseURL: typeof stored.baseURL === 'string' ? stored.baseURL : '',
    modelId: typeof stored.modelId === 'string' ? stored.modelId : '',
    apiKey: decryptApiKey(stored)
  };
};

export const saveStoredProviderConfig = async (input: {
  baseURL: string;
  modelId: string;
  /** `undefined` keeps the existing key, `''` clears it. */
  apiKey?: string;
}) => {
  const stored = await readConfigFile();
  const next: StoredProviderConfigFile = {
    baseURL: input.baseURL.trim(),
    modelId: input.modelId.trim()
  };

  if (input.apiKey === undefined) {
    next.apiKeyEncrypted = stored.apiKeyEncrypted;
    next.apiKeyPlain = stored.apiKeyPlain;
  } else {
    Object.assign(next, encryptApiKey(input.apiKey.trim()));
  }

  const configPath = getLyricsAnalysisConfigPath();
  const tempPath = `${configPath}.tmp`;

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(tempPath, JSON.stringify(next, null, 2), { mode: 0o600 });
  await fs.rename(tempPath, configPath);

  logger.debug('Saved lyrics analysis provider config.', {
    baseURL: next.baseURL,
    modelId: next.modelId,
    hasApiKey: Boolean(next.apiKeyEncrypted ?? next.apiKeyPlain)
  });
};
