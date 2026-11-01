import { dataUpdateEvent } from '../main';
import logger from '../logger';
import { callNetease, callNeteaseForBody, QR_STATE_CONFIRMED, QR_STATE_EXPIRED, QR_STATE_SCANNED, QR_STATE_WAITING } from './client';
import type { NeteaseSessionProfile } from '../../common/netease';
import { ensureNeteaseAnonymousSession } from './anonymousSession';
import {
  clearNeteaseSession,
  readNeteaseSession,
  updateNeteaseSessionProfile,
  writeNeteaseSession
} from './session';

export const startNeteaseQrLogin = async (): Promise<{
  key: string;
  qrImgUrl: string;
}> => {
  // The QR key must be minted under a plausible guest identity (stable deviceId + MUSIC_A), or
  // the risk engine blocks the scan with "当前设备环境异常,本次操作已拦截".
  await ensureNeteaseAnonymousSession();

  const keyBody = await callNeteaseForBody('login_qr_key', {});
  // The endpoint nests { code, unikey } under `data`.
  const keyData = (keyBody.data ?? keyBody) as { unikey?: string };
  const unikey = keyData.unikey;
  if (!unikey) throw new Error('NetEase QR login failed: missing unikey.');

  const createResult = await callNeteaseForBody('login_qr_create', { key: unikey, qrimg: true });
  const data = (createResult.data ?? {}) as { qrurl?: string; qrimg?: string };

  return { key: unikey, qrImgUrl: data.qrimg ?? '' };
};

export type NeteaseQrPollResult = {
  state: 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'error';
  profile?: NeteaseSessionProfile;
};

export const checkNeteaseQrLogin = async (key: string): Promise<NeteaseQrPollResult> => {
  let body: Record<string, unknown>;
  try {
    body = await callNeteaseForBody('login_qr_check', { key });
  } catch {
    // Network hiccups mid-polling should not kill the QR flow; report a transient error state.
    return { state: 'error' };
  }

  const code = typeof body.code === 'number' ? body.code : undefined;

  if (code === QR_STATE_WAITING || code === undefined) return { state: 'waiting' };
  if (code === QR_STATE_SCANNED) return { state: 'scanned' };
  if (code === QR_STATE_EXPIRED) return { state: 'expired' };
  if (code !== QR_STATE_CONFIRMED) return { state: 'error' };

  // Success: the body.cookie is the joined MUSIC_U session; persist it.
  const cookie = body.cookie;
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
    const body = await callNeteaseForBody('login_status', {});
    // login_status nests account/profile under `data`.
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

const broadcastNeteaseSessionChange = () => {
  dataUpdateEvent('userData/neteaseSession');
};
