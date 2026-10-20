import crypto from 'crypto';
import { app, safeStorage } from 'electron';
import path from 'path';

import type { LyricsAnalysisProviderProfileInput } from '../../common/lyricsAnalysis';
import logger from '../logger';
import { readJsonFileOrNull, writeJsonFileAtomic } from './fsJson';

const CONFIG_FILE_NAME = 'lyrics-analysis-providers.json';

interface StoredProfileFile {
  id: string;
  name: string;
  baseURL: string;
  modelId: string;
  /**
   * Ceiling for the analysis gateway's concurrent-batch window. Optional for backward
   * compatibility: profiles written before the field existed read as `undefined` and the
   * consumer applies the default (4).
   */
  maxConcurrency?: number;
  /** base64 of `safeStorage.encryptString(apiKey)` when OS encryption is available. */
  apiKeyEncrypted?: string;
  /** Only used when OS encryption is unavailable (e.g. minimal Linux environments). */
  apiKeyPlain?: string;
}

interface StoredProfilesFile {
  version: 2;
  activeProfileId?: string;
  profiles: StoredProfileFile[];
}

export interface StoredProviderProfile {
  id: string;
  name: string;
  baseURL: string;
  modelId: string;
  apiKeyHint?: string;
  hasApiKey: boolean;
  /** Undefined when the profile predates the field; consumers default to 4. */
  maxConcurrency?: number;
}

export interface StoredProviderProfileWithKey extends StoredProviderProfile {
  apiKey?: string;
}

// A factory, not a shared constant: callers mutate the returned state (push/remove profiles), and a
// shared empty object would silently leak profiles from one "no config yet" read into the next.
const createEmptyState = (): StoredProfilesFile => ({ version: 2, profiles: [] });

export const getLyricsAnalysisConfigPath = () =>
  path.join(app.getPath('userData'), CONFIG_FILE_NAME);

/** Pre-profile releases stored a single provider in this file; it is migrated on first read. */
const getLegacyConfigPath = () =>
  path.join(app.getPath('userData'), 'lyrics-analysis-provider.json');

const encryptApiKey = (
  apiKey: string
): Pick<StoredProfileFile, 'apiKeyEncrypted' | 'apiKeyPlain'> => {
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

const decryptApiKey = (stored: Pick<StoredProfileFile, 'apiKeyEncrypted' | 'apiKeyPlain'>) => {
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

const readJsonFile = async <T>(filePath: string): Promise<T | undefined> => {
  // ENOENT — the normal first-run case — already reads as undefined without noise inside
  // readJsonFileOrNull; only unexpected failures are logged.
  const parsed = await readJsonFileOrNull<T>(filePath, (error) =>
    logger.warn('Failed to read the lyrics analysis provider config.', { error, filePath })
  );
  return parsed && typeof parsed === 'object' ? parsed : undefined;
};

const writeState = async (state: StoredProfilesFile) => {
  // Failures propagate: provider settings actions surface a write error to the user, so unlike the
  // caches this write has no swallow-and-cleanup wrapper of its own.
  await writeJsonFileAtomic(getLyricsAnalysisConfigPath(), state, { spacing: 2, mode: 0o600 });
};

const deriveProfileName = (baseURL: string) => {
  try {
    const host = new URL(/^[a-z][a-z\d+\-.]*:\/\//i.test(baseURL) ? baseURL : `https://${baseURL}`)
      .hostname;
    return host.length > 0 ? host : baseURL;
  } catch {
    return baseURL;
  }
};

const createProfileId = () => crypto.randomBytes(6).toString('hex');

const maskApiKey = (apiKey?: string) => {
  const trimmed = apiKey?.trim();
  if (!trimmed) return undefined;
  // Enough of the tail to tell two keys apart, never enough to reuse one.
  return `••••${trimmed.slice(-4)}`;
};

const isStoredProfile = (value: unknown): value is StoredProfileFile => {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<StoredProfileFile>;
  return (
    typeof profile.id === 'string' &&
    typeof profile.baseURL === 'string' &&
    typeof profile.modelId === 'string'
  );
};

const migrateLegacyConfig = async (): Promise<StoredProfilesFile | undefined> => {
  const legacy = await readJsonFile<{
    baseURL?: string;
    modelId?: string;
    apiKeyEncrypted?: string;
    apiKeyPlain?: string;
  }>(getLegacyConfigPath());

  if (!legacy || typeof legacy.baseURL !== 'string') return undefined;

  const profile: StoredProfileFile = {
    id: createProfileId(),
    name: deriveProfileName(legacy.baseURL),
    baseURL: legacy.baseURL,
    modelId: legacy.modelId ?? '',
    apiKeyEncrypted: legacy.apiKeyEncrypted,
    apiKeyPlain: legacy.apiKeyPlain
  };
  const state: StoredProfilesFile = {
    version: 2,
    activeProfileId: profile.id,
    profiles: [profile]
  };

  await writeState(state);
  logger.debug('Migrated the legacy lyrics analysis provider config to profiles.');
  return state;
};

const readState = async (): Promise<StoredProfilesFile> => {
  const stored = await readJsonFile<Partial<StoredProfilesFile>>(getLyricsAnalysisConfigPath());

  if (!stored) return (await migrateLegacyConfig()) ?? createEmptyState();

  if (!Array.isArray(stored.profiles)) return createEmptyState();

  const profiles = stored.profiles.filter(isStoredProfile).map((profile) => ({
    ...profile,
    // Names were optional when the profile was written by an older build.
    name: typeof profile.name === 'string' && profile.name.trim() ? profile.name : deriveProfileName(profile.baseURL)
  }));

  return {
    version: 2,
    activeProfileId:
      typeof stored.activeProfileId === 'string' &&
      profiles.some((profile) => profile.id === stored.activeProfileId)
        ? stored.activeProfileId
        : profiles[0]?.id,
    profiles
  };
};

/** Profiles as the renderer is allowed to see them: masked keys, no secrets. */
export const getStoredProviderProfiles = async () => {
  const state = await readState();

  return {
    activeProfileId: state.activeProfileId,
    profiles: state.profiles.map((profile): StoredProviderProfile => {
      const apiKey = decryptApiKey(profile);
      return {
        id: profile.id,
        name: profile.name,
        baseURL: profile.baseURL,
        modelId: profile.modelId,
        hasApiKey: Boolean(apiKey?.trim()),
        apiKeyHint: maskApiKey(apiKey),
        ...(profile.maxConcurrency !== undefined ? { maxConcurrency: profile.maxConcurrency } : {})
      };
    })
  };
};

/** The active profile with its decrypted key, for the analysis worker. */
export const getStoredProviderConfig = async (): Promise<{
  id?: string;
  name?: string;
  baseURL: string;
  modelId: string;
  apiKey?: string;
  maxConcurrency?: number;
}> => {
  const state = await readState();
  const active =
    state.profiles.find((profile) => profile.id === state.activeProfileId) ?? state.profiles[0];

  if (!active) return { baseURL: '', modelId: '' };

  return {
    id: active.id,
    name: active.name,
    baseURL: active.baseURL,
    modelId: active.modelId,
    apiKey: decryptApiKey(active),
    ...(active.maxConcurrency !== undefined
      ? { maxConcurrency: active.maxConcurrency }
      : {})
  };
};

/** One profile by id, with its decrypted key. Used to test a profile that is not active. */
export const getStoredProviderProfile = async (profileId: string): Promise<StoredProviderProfileWithKey | undefined> => {
  const state = await readState();
  const profile = state.profiles.find((entry) => entry.id === profileId);
  if (!profile) return undefined;

  const apiKey = decryptApiKey(profile);
  return {
    id: profile.id,
    name: profile.name,
    baseURL: profile.baseURL,
    modelId: profile.modelId,
    hasApiKey: Boolean(apiKey?.trim()),
    apiKeyHint: maskApiKey(apiKey),
    apiKey,
    ...(profile.maxConcurrency !== undefined ? { maxConcurrency: profile.maxConcurrency } : {})
  };
};

/**
 * Clamps the user/probe-supplied concurrency ceiling to what the AIMD window can use: a whole
 * number 1..64. `undefined` (field absent) falls through and keeps/uses the default.
 */
const normalizeMaxConcurrency = (value: number | undefined): number | undefined => {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(64, Math.max(1, Math.round(value)));
};

export const saveStoredProviderProfile = async (input: LyricsAnalysisProviderProfileInput) => {
  const state = await readState();
  const baseURL = input.baseURL.trim();
  const modelId = input.modelId.trim();
  const name = input.name?.trim() || deriveProfileName(baseURL);
  const maxConcurrency = normalizeMaxConcurrency(input.maxConcurrency);
  const existingIndex = input.id
    ? state.profiles.findIndex((profile) => profile.id === input.id)
    : -1;

  if (existingIndex >= 0) {
    const existing = state.profiles[existingIndex];
    const next: StoredProfileFile = {
      id: existing.id,
      name,
      baseURL,
      modelId,
      // Absent input keeps the stored value; a number (including a re-saved default) overwrites.
      maxConcurrency: maxConcurrency ?? existing.maxConcurrency,
      apiKeyEncrypted: existing.apiKeyEncrypted,
      apiKeyPlain: existing.apiKeyPlain
    };

    if (input.apiKey !== undefined) Object.assign(next, encryptApiKey(input.apiKey.trim()));
    state.profiles[existingIndex] = next;
  } else {
    const profile: StoredProfileFile = {
      id: createProfileId(),
      name,
      baseURL,
      modelId,
      ...(maxConcurrency !== undefined ? { maxConcurrency } : {}),
      ...encryptApiKey(input.apiKey?.trim() ?? '')
    };

    state.profiles.push(profile);
    // A newly added profile is what the user wants to use next.
    state.activeProfileId = profile.id;
  }

  await writeState(state);

  logger.debug('Saved a lyrics analysis provider profile.', {
    name,
    baseURL,
    modelId,
    updated: existingIndex >= 0
  });

  return getStoredProviderProfiles();
};

export const setActiveProviderProfile = async (profileId: string) => {
  const state = await readState();

  if (!state.profiles.some((profile) => profile.id === profileId))
    throw new Error(`Unknown lyrics analysis provider profile: ${profileId}`);

  state.activeProfileId = profileId;
  await writeState(state);

  return getStoredProviderProfiles();
};

export const deleteProviderProfile = async (profileId: string) => {
  const state = await readState();
  const remaining = state.profiles.filter((profile) => profile.id !== profileId);

  if (remaining.length === state.profiles.length)
    throw new Error(`Unknown lyrics analysis provider profile: ${profileId}`);

  state.profiles = remaining;
  // Deleting the active profile can never leave the app pointing at a missing entry.
  if (state.activeProfileId === profileId) state.activeProfileId = remaining[0]?.id;

  await writeState(state);

  return getStoredProviderProfiles();
};
