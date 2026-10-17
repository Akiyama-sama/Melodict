import { dataUpdateEvent } from '../main';
import logger from '../logger';
import { callNetease, isNeteaseAuthError } from './client';
import type { NeteaseApiRawResult } from './client';
import type { NeteaseSessionProfile } from '../../common/netease';
import {
  clearNeteaseSession,
  readNeteaseSession,
  updateNeteaseSessionProfile,
  writeNeteaseSession
} from './session';

// QR login polling codes, mirroring https://docs-neteasecloudmusicapi.focalors.ltd
const QR_STATE_EXPIRED = 800;
const QR_STATE_WAITING = 801;
const QR_STATE_SCANNED = 802;
const QR_STATE_CONFIRMED = 803;

export const startNeteaseQrLogin = async (): Promise<{
  key: string;
  qrImgUrl: string;
}> => {
  const keyBody = await callNeteaseForBodyChecked('login_qr_key', {});
  // The endpoint nests { code, unikey } under `data` (some deployments unwrap it to the body).
  const keyData = (keyBody.data ?? keyBody) as { unikey?: string };
  const unikey = keyData.unikey;
  if (!unikey) throw new Error('NetEase QR login failed: missing unikey.');

  const createResult = await callNetease('login_qr_create', { key: unikey, qrimg: true });
  const data = (createResult.body?.data ?? {}) as { qrurl?: string; qrimg?: string };

  return { key: unikey, qrImgUrl: data.qrimg ?? '' };
};

/** Thin variant of callNeteaseForBody that also throws on a bare HTTP failure body. */
const callNeteaseForBodyChecked = async (
  name: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const result = await callNetease(name, params);
  if (typeof result.body?.code !== 'number') return result.body ?? {};
  if (result.body.code === 200) return result.body;
  throw new Error(`NetEase ${name} failed with code ${result.body.code}`);
};

export type NeteaseQrPollResult = {
  state: 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'error';
  profile?: NeteaseSessionProfile;
};

export const checkNeteaseQrLogin = async (key: string): Promise<NeteaseQrPollResult> => {
  let result: NeteaseApiRawResult;
  try {
    result = await callNetease('login_qr_check', { key });
  } catch {
    // Network hiccups mid-polling should not kill the QR flow; report a transient error state.
    return { state: 'error' };
  }

  const code = typeof result.body?.code === 'number' ? result.body.code : undefined;

  if (code === QR_STATE_WAITING || code === undefined) return { state: 'waiting' };
  if (code === QR_STATE_SCANNED) return { state: 'scanned' };
  if (code === QR_STATE_EXPIRED) return { state: 'expired' };
  if (code !== QR_STATE_CONFIRMED) return { state: 'error' };

  // Success: the body.cookie is the joined MUSIC_U session; persist it.
  const cookie = result.body?.cookie;
  if (typeof cookie !== 'string' || !cookie.includes('MUSIC_U')) {
    logger.warn('NetEase QR login confirmed without a MUSIC_U cookie.', { code });
    return { state: 'error' };
  }

  await writeNeteaseSession(cookie);

  const profile = await fetchNeteaseProfile();
  if (profile) await updateNeteaseSessionProfile(profile);

  broadcastNeteaseSessionChange();
  return { state: 'confirmed', profile };
};

const fetchNeteaseProfile = async (): Promise<NeteaseSessionProfile | undefined> => {
  try {
    const body = await callNeteaseForBodyChecked('login_status', {});
    // login_status nests account/profile under `data` (plain-body deployments are handled too).
    const payload = (body.data ?? body) as {
      account?: { id?: number } | null;
      profile?: { nickname?: string; avatarUrl?: string; vipType?: number } | null;
      anonimous?: boolean;
    };
    const account = payload.account ?? undefined;
    const profile = payload.profile ?? undefined;

    // An anonymous ("anonimous" in NCM spelling) account is not a real login.
    if (!account?.id || payload.anonimous === true) return undefined;

    return {
      userId: account.id,
      nickname: profile?.nickname ?? '',
      avatarUrl: profile?.avatarUrl ?? '',
      vipType: profile?.vipType ?? 0
    };
  } catch (error) {
    logger.warn('Failed to fetch the NetEase profile snapshot.', { error });
    return undefined;
  }
};

export const getNeteaseMe = async (): Promise<NeteaseSessionProfile | undefined> => {
  const session = await readNeteaseSession();
  if (session?.profile) return session.profile;

  const profile = await fetchNeteaseProfile();
  if (profile) {
    await updateNeteaseSessionProfile(profile);
    broadcastNeteaseSessionChange();
  }
  return profile;
};

/**
 * Validates a persisted cookie at app startup; cookie lifetimes are long but not immortal, so a
 * failed validation clears the session and lets the UI show its logged-out state.
 */
export const revalidateNeteaseSession = async (): Promise<void> => {
  const session = await readNeteaseSession();
  if (!session) return;

  try {
    const profile = await fetchNeteaseProfile();
    if (profile) {
      await updateNeteaseSessionProfile(profile);
    } else {
      await clearNeteaseSession();
      logger.info('NetEase session cookie is no longer valid; cleared it.');
    }
  } catch (error) {
    // Offline / network error: keep the cookie and let a later check retry, don't log out.
    logger.warn('NetEase session revalidation failed; keeping the stored cookie.', { error });
    return;
  }

  broadcastNeteaseSessionChange();
};

export const neteaseLogout = async (): Promise<void> => {
  try {
    await callNetease('logout', {}).catch(() => undefined);
  } finally {
    await clearNeteaseSession();
  }

  broadcastNeteaseSessionChange();
};

/**
 * Refreshes the login token; NetEase asks clients to refresh at most daily. Called rarely, and an
 * expiry is handled by the next revalidation instead of a forced logout.
 */
export const refreshNeteaseSession = async (): Promise<void> => {
  const session = await readNeteaseSession();
  if (!session) return;

  try {
    const result = await callNetease('login_refresh', {}, { cookie: session.cookie });
    const cookie = result.cookie;

    // The refresh endpoint resets MUSIC_U only occasionally; when it does, persist the new one.
    const refreshedCookie = Array.isArray(cookie)
      ? (cookie.find((line: string) => line.includes('MUSIC_U')) as string | undefined)
      : undefined;

    if (refreshedCookie) await writeNeteaseSession(refreshedCookie);
  } catch (error) {
    if (isNeteaseAuthError(error)) {
      await clearNeteaseSession();
      broadcastNeteaseSessionChange();
      return;
    }
    logger.warn('NetEase login refresh failed; skipping.', { error });
  }
};

const broadcastNeteaseSessionChange = () => {
  dataUpdateEvent('userData/neteaseSession');
};
