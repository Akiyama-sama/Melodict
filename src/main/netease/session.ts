import { app, safeStorage } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import type { NeteaseSessionProfile } from '../../common/netease';
import logger from '../logger';

const SESSION_FILE_NAME = 'netease-session.json';

interface StoredNeteaseSession {
  version: 1;
  /** base64 of `safeStorage.encryptString(cookie)` when OS encryption is available. */
  cookieEncrypted?: string;
  /** Fallback for environments without OS-level encryption (some Linux setups). */
  cookiePlain?: string;
  profile?: NeteaseSessionProfile;
  lastAuthCheckAt?: number;
}

export interface StoredNeteaseSessionData {
  cookie: string;
  profile?: NeteaseSessionProfile;
  lastAuthCheckAt?: number;
}

const getSessionPath = () => path.join(app.getPath('userData'), SESSION_FILE_NAME);

const createEmptySessionFileVersion = (): StoredNeteaseSession => ({ version: 1 });

const encryptCookie = (cookie: string): Pick<StoredNeteaseSession, 'cookieEncrypted' | 'cookiePlain'> => {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return { cookieEncrypted: safeStorage.encryptString(cookie).toString('base64') };
    }
  } catch (error) {
    logger.warn('Failed to encrypt the NetEase session cookie; storing it plainly.', { error });
  }

  return { cookiePlain: cookie };
};

const decryptCookie = (stored: StoredNeteaseSession): string | undefined => {
  if (stored.cookieEncrypted) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.cookieEncrypted, 'base64'));
    } catch (error) {
      logger.warn('Failed to decrypt the stored NetEase session cookie.', { error });
      return undefined;
    }
  }

  return stored.cookiePlain;
};

const readJsonFile = async (filePath: string): Promise<StoredNeteaseSession | undefined> => {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data) as StoredNeteaseSession;
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch (error) {
    // Missing file is the normal first-run state, not worth logging loudly.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      logger.warn('Failed to read the NetEase session file.', { error, filePath });
    return undefined;
  }
};

const writeSessionFile = async (state: StoredNeteaseSession) => {
  const sessionPath = getSessionPath();
  const tempPath = `${sessionPath}.tmp`;

  await fs.mkdir(path.dirname(sessionPath), { recursive: true });
  await fs.writeFile(tempPath, JSON.stringify(state, null, 2), { mode: 0o600 });
  await fs.rename(tempPath, sessionPath);
};

/** Returns the decrypted cookie together with the cached profile snapshot, if any. */
export const readNeteaseSession = async (): Promise<StoredNeteaseSessionData | undefined> => {
  const stored = await readJsonFile(getSessionPath());
  if (!stored) return undefined;

  const cookie = decryptCookie(stored);
  if (!cookie?.includes('MUSIC_U')) return undefined;

  return {
    cookie,
    profile: stored.profile,
    lastAuthCheckAt: stored.lastAuthCheckAt
  };
};

export const writeNeteaseSession = async (
  cookie: string,
  profile?: NeteaseSessionProfile
): Promise<void> => {
  const current = await readJsonFile(getSessionPath());
  const next: StoredNeteaseSession = {
    ...createEmptySessionFileVersion(),
    ...encryptCookie(cookie),
    profile: profile ?? current?.profile,
    lastAuthCheckAt: Date.now()
  };

  await writeSessionFile(next);
  logger.debug('Updated the NetEase session file.', { hasProfile: Boolean(next.profile) });
};

export const updateNeteaseSessionProfile = async (profile: NeteaseSessionProfile): Promise<void> => {
  const stored = await readJsonFile(getSessionPath());
  if (!stored) return;

  await writeSessionFile({ ...stored, profile, lastAuthCheckAt: Date.now() });
};

export const clearNeteaseSession = async (): Promise<void> => {
  try {
    await fs.rm(getSessionPath(), { force: true });
    logger.debug('Cleared the NetEase session file.');
  } catch (error) {
    logger.warn('Failed to clear the NetEase session file.', { error });
  }
};

/** Cookie joined for direct use as the `cookie` param of the npm package calls. */
export const readNeteaseSessionCookie = async (): Promise<string | undefined> =>
  (await readNeteaseSession())?.cookie;
