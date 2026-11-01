import { app, safeStorage } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import type { NeteaseSessionProfile } from '../../common/netease';
import logger from '../logger';
import { cookieToJson, parseSetCookie } from './core/cookie';
import { setAnonymousToken, setDeviceId } from './core/device';
import { resetXeapiKey } from './core/xeapi';

const SESSION_FILE_NAME = 'netease-session.json';

interface StoredNeteaseSession {
  version: 2;
  /**
   * The full cookie map (MUSIC_U plus the device/session fields the server issues). Encrypted as
   * base64 of `safeStorage.encryptString(JSON.stringify(cookies))` when OS encryption is available.
   */
  cookiesEncrypted?: string;
  /** Fallback for environments without OS-level encryption (some Linux setups). */
  cookiesPlain?: Record<string, string>;
  profile?: NeteaseSessionProfile;
  /** @deprecated v1 shape: the cookie was stored as one joined string. Migrated on read. */
  cookieEncrypted?: string;
  /** @deprecated v1 shape fallback for environments without OS-level encryption. */
  cookiePlain?: string;
}

export interface StoredNeteaseSessionData {
  /** The full cookie map (MUSIC_U, __csrf, NMTID, MUSIC_A, deviceId, ...). */
  cookies: Record<string, string>;
  profile?: NeteaseSessionProfile;
}

const getSessionPath = () => path.join(app.getPath('userData'), SESSION_FILE_NAME);

const encryptCookies = (
  cookies: Record<string, string>
): Pick<StoredNeteaseSession, 'cookiesEncrypted' | 'cookiesPlain'> => {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return { cookiesEncrypted: safeStorage.encryptString(JSON.stringify(cookies)).toString('base64') };
    }
  } catch (error) {
    logger.warn('Failed to encrypt the NetEase session cookies; storing them plainly.', { error });
  }

  return { cookiesPlain: cookies };
};

const decryptCookies = (stored: StoredNeteaseSession): Record<string, string> | undefined => {
  if (stored.cookiesEncrypted) {
    try {
      return JSON.parse(safeStorage.decryptString(Buffer.from(stored.cookiesEncrypted, 'base64')));
    } catch (error) {
      logger.warn('Failed to decrypt the stored NetEase session cookies.', { error });
      return undefined;
    }
  }

  if (stored.cookiesPlain) return stored.cookiesPlain;

  // v1 file (cookie stored as a single joined string): migrate it in place so existing users
  // keep their MUSIC_U across the upgrade instead of being silently logged out.
  const legacyEncrypted = stored.cookieEncrypted;
  const legacyPlain = stored.cookiePlain;
  if (!legacyEncrypted && !legacyPlain) return undefined;

  let cookie: string | undefined;
  if (legacyEncrypted) {
    try {
      cookie = safeStorage.decryptString(Buffer.from(legacyEncrypted, 'base64'));
    } catch (error) {
      logger.warn('Failed to decrypt the legacy NetEase session cookie.', { error });
      return undefined;
    }
  } else {
    cookie = legacyPlain;
  }

  const migrated = cookieToJson(cookie);
  if (!migrated.MUSIC_U) return undefined;

  logger.info('Migrated the NetEase session file to v2.');
  // best-effort rewrite; the in-memory map is already usable even if the disk write fails.
  void writeNeteaseSession(migrated, stored.profile).catch(() => undefined);
  return migrated;
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

/** Syncs the persisted fingerprint into the process-level device state. */
const syncDeviceState = (cookies: Record<string, string>): void => {
  if (cookies.deviceId) setDeviceId(cookies.deviceId);
  // Only overwrite when the map actually carries a token: some set-cookie patches arrive without
  // a MUSIC_A line, and clearing the in-process guest token then would force a re-registration.
  if (cookies.MUSIC_A) setAnonymousToken(cookies.MUSIC_A);
};

/** Reads the decrypted cookie map straight from the file (no logged-in gating). */
const readStoredCookies = async (): Promise<{
  cookies: Record<string, string>;
  profile?: NeteaseSessionProfile;
} | undefined> => {
  const stored = await readJsonFile(getSessionPath());
  if (!stored) return undefined;

  const cookies = decryptCookies(stored);
  if (!cookies) return undefined;

  return { cookies, profile: stored.profile };
};

/** Returns the decrypted cookie map together with the cached profile snapshot, if any. */
export const readNeteaseSession = async (): Promise<StoredNeteaseSessionData | undefined> => {
  const stored = await readStoredCookies();
  if (!stored?.cookies.MUSIC_U) return undefined;

  syncDeviceState(stored.cookies);
  return { cookies: stored.cookies, profile: stored.profile };
};

export const writeNeteaseSession = async (
  cookie: string | Record<string, string>,
  profile?: NeteaseSessionProfile
): Promise<void> => {
  const current = await readStoredCookies();
  const merged = {
    ...(current?.cookies ?? {}),
    ...(typeof cookie === 'string' ? cookieToJson(cookie) : cookie)
  };
  const next: StoredNeteaseSession = {
    version: 2,
    ...encryptCookies(merged),
    profile: profile ?? current?.profile
  };

  await writeSessionFile(next);
  syncDeviceState(merged);
  logger.debug('Updated the NetEase session file.', { hasProfile: Boolean(next.profile) });
};

/** Merges a cookie patch (set-cookie lines and/or pre-parsed entries) into the stored session. */
export const patchNeteaseSession = async (
  setCookie: string[],
  extra: Record<string, string> = {}
): Promise<void> => {
  const patch = { ...parseSetCookie(setCookie), ...extra };
  if (!Object.keys(patch).length) return;

  const stored = await readStoredCookies();
  // No file yet (e.g. guest registration on first launch): the patch *is* the initial state.
  await writeNeteaseSession({ ...(stored?.cookies ?? {}), ...patch }, stored?.profile);
};

export const updateNeteaseSessionProfile = async (profile: NeteaseSessionProfile): Promise<void> => {
  const stored = await readStoredCookies();
  if (!stored) return;

  await writeNeteaseSession(stored.cookies, profile);
};

export const clearNeteaseSession = async (): Promise<void> => {
  try {
    await fs.rm(getSessionPath(), { force: true });
    setAnonymousToken('');
    resetXeapiKey();
    logger.debug('Cleared the NetEase session file.');
  } catch (error) {
    logger.warn('Failed to clear the NetEase session file.', { error });
  }
};

/** The stored cookie map, or undefined when logged out. */
export const readNeteaseSessionCookies = async (): Promise<Record<string, string> | undefined> =>
  (await readStoredCookies())?.cookies;
