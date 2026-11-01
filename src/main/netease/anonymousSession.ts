/**
 * Guest session bootstrap: makes sure an anonymous identity (MUSIC_A + stable deviceId) exists
 * before any logged-out request is sent. Without it, requests go out with no MUSIC_A and an
 * inconsistent fingerprint, which the risk engine answers with
 * "当前设备环境异常,本次操作已拦截".
 */

import logger from '../logger';
import { getAnonymousToken, getDeviceId } from './core/device';
import { readNeteaseSessionCookies, writeNeteaseSession } from './session';

let anonymousSessionPromise: Promise<void> | null = null;

const REGISTER_ATTEMPTS = 5;
const REGISTER_RETRY_DELAY_MS = 400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Registers a guest account through the anti-crawler xeapi channel. The server randomly answers
 * a bare `code 400` to registration bursts (observed ~30-50% on repeated same-IP calls), so a
 * couple of retries are part of the normal flow, not an error path.
 */
const registerGuestSession = async (): Promise<string> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= REGISTER_ATTEMPTS; attempt++) {
    try {
      // The token arrives as a MUSIC_A set-cookie; callNetease persists the whole patch
      // (token + deviceId + __csrf) into the session map so it survives restarts.
      const { callNetease } = await import('./client');
      const result = await callNetease('register_anonimous', {});
      const setCookie = (result.cookie as string[] | undefined) ?? [];
      const token =
        typeof result.body.token === 'string'
          ? result.body.token
          : setCookie.find((line) => line.startsWith('MUSIC_A='))?.split(';')[0].split('=')[1];

      if (token) return token;
      lastError = new Error(`netease anonymous registration missing MUSIC_A (code ${result.body.code})`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < REGISTER_ATTEMPTS) await sleep(REGISTER_RETRY_DELAY_MS * attempt);
  }

  throw lastError ?? new Error('netease anonymous registration failed');
};

/**
 * Ensures a logged-out caller has a stable MUSIC_A + deviceId before hitting the API.
 * Rejects when registration keeps failing so callers (QR login) can surface a distinct
 * error instead of proceeding with the fingerprint that gets risk-blocked.
 */
export const ensureNeteaseAnonymousSession = async (): Promise<void> => {
  const cookies = await readNeteaseSessionCookies().catch(() => undefined);
  if (cookies?.MUSIC_U || cookies?.MUSIC_A || getAnonymousToken()) return;
  if (anonymousSessionPromise) return anonymousSessionPromise;

  anonymousSessionPromise = (async () => {
    try {
      const token = await registerGuestSession();
      // Seed the persisted session map. The MUSIC_U-less map is still a valid session state;
      // readNeteaseSession treats it as logged out while readNeteaseSessionCookies exposes it.
      await writeNeteaseSession({ MUSIC_A: token, deviceId: getDeviceId() });
      logger.info('Initialized the NetEase guest session.');
    } catch (error) {
      // Logged-out catalog calls degrade gracefully (see callNetease); QR login rethrows.
      logger.warn('Failed to initialize the NetEase guest session.', { error });
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      anonymousSessionPromise = null;
    }
  })();

  return anonymousSessionPromise;
};
