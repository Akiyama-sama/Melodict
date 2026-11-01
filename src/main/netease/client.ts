import logger from '../logger';
import { parseSetCookie } from './core/cookie';
import { getDeviceId } from './core/device';
import { createRequest } from './core/request';
import { modules } from './modules';
import type { Query } from './core/option';
import { patchNeteaseSession, readNeteaseSessionCookies } from './session';

export interface NeteaseApiRawResult {
  /** Business status reported by the request layer; 200 means success. */
  status: number;
  /** Result body; code 200 means success, 301 means auth required, etc. */
  body: Record<string, unknown>;
  /** Set-Cookie lines returned by the server (persisted to keep the session fresh). */
  cookie: unknown;
}

export class NeteaseApiError extends Error {
  /** NCM business code, e.g. 200 success, 301 not logged in / auth required, 800+ QR states. */
  code: number | undefined;
  httpStatus?: number;

  constructor(message: string, code?: number, httpStatus?: number) {
    super(message);
    this.name = 'NeteaseApiError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const NETWORK_ERROR_MESSAGE = 'NETEASE_NETWORK_ERROR';

/** Endpoints whose set-cookie responses update the stored session credentials. */
const SESSION_MUTATING: ReadonlySet<string> = new Set([
  'login_qr_check',
  'login_status',
  'login_refresh',
  'logout',
  'register_anonimous'
]);

type NeteaseCallOptions = {
  /** Cookie string (joined `k=v; ...`) or map, overriding the default session cookie. */
  cookie?: string | Record<string, string>;
};

/**
 * Calls one NCM endpoint by module name (`login_qr_check`, `song_url_v1`, ...). Merges the
 * caller's cookie with the stored session, keeps server-issued session state, and converts
 * business errors into `NeteaseApiError`.
 *
 * Some endpoints return "success-ish" business codes (QR polling 800/801/802/803, etc.), so this
 * only throws when the code is clearly an error; callers inspect semantics themselves.
 */
export const callNetease = async (
  name: string,
  params: Record<string, unknown> = {},
  options: NeteaseCallOptions = {}
): Promise<NeteaseApiRawResult> => {
  const fn = modules[name];
  if (!fn) throw new NeteaseApiError(`Unknown Netease API call: ${name}`);

  // An explicit cookie wins; otherwise default to the stored session so every endpoint
  // (login_status, user_playlist, ...) automatically behaves as the logged-in user. While logged
  // out the request layer injects the anonymous token + stable deviceId itself.
  let cookie = options.cookie;
  if (!cookie) {
    try {
      cookie = await readNeteaseSessionCookies();
    } catch {
      // No session file yet (first run): proceed anonymously.
    }
  }

  const query: Query = { ...params };
  if (cookie) query.cookie = cookie;

  let result;
  try {
    result = await fn(query, createRequest);
  } catch (error) {
    // Non-200 outcomes arrive as NeteaseRequestError carrying the business body; map that onto
    // the NeteaseApiError contract the rest of the app already switches on.
    if (error instanceof Error && error.name === 'NeteaseRequestError') {
      const response = (error as { response?: { status?: number; body?: Record<string, unknown> } })
        .response;
      const body = response?.body ?? {};
      const code = typeof body.code === 'number' ? body.code : undefined;
      logger.warn('NetEase API call failed.', { name, code, error });
      throw new NeteaseApiError(`NetEase ${name} failed`, code, response?.status);
    }

    logger.error('NetEase API call failed.', { name, error });
    throw new NeteaseApiError(NETWORK_ERROR_MESSAGE, undefined, undefined);
  }

  // Keep login renewals and server-issued session state (NMTID, __csrf, MUSIC_U refreshes).
  if (SESSION_MUTATING.has(name)) {
    const patch = parseSetCookie(result.cookie ?? []);
    if (name === 'register_anonimous') {
      const token = (result.body as { token?: unknown }).token;
      if (typeof token === 'string') patch.MUSIC_A = token;
      patch.deviceId = getDeviceId();
    }
    if (Object.keys(patch).length) await patchNeteaseSession(result.cookie ?? []);
  }

  return result;
};

/** The body of a successful call, throwing on non-200 business codes (except QR poll states). */
export const callNeteaseForBody = async (
  name: string,
  params: Record<string, unknown> = {},
  options: NeteaseCallOptions = {}
): Promise<Record<string, unknown>> => {
  const result = await callNetease(name, params, options);
  return unwrapNeteaseBody(name, result);
};

export const unwrapNeteaseBody = (
  name: string,
  result: NeteaseApiRawResult
): Record<string, unknown> => {
  const body = result.body ?? {};
  const code = typeof body.code === 'number' ? body.code : undefined;

  // QR polling states are data, not errors; callers map them into NeteaseLoginQrState values.
  if (code === undefined || code === 200 || isNeteasePollStateCode(code)) return body;

  throw new NeteaseApiError(`NetEase ${name} failed with code ${code}`, code, result.status);
};

/** 301 is the canonical "not logged in" body code; let callers branch on it explicitly. */
export const isNeteaseAuthError = (error: unknown): error is NeteaseApiError =>
  error instanceof NeteaseApiError && error.code === 301;

// QR login polling codes, mirroring https://docs-neteasecloudmusicapi.focalors.ltd
export const QR_STATE_EXPIRED = 800;
export const QR_STATE_WAITING = 801;
export const QR_STATE_SCANNED = 802;
export const QR_STATE_CONFIRMED = 803;

/** QR-login polling codes (800 expired, 801 waiting, 802 scanned, 803 confirmed). */
const isNeteasePollStateCode = (code: number) =>
  code === QR_STATE_EXPIRED ||
  code === QR_STATE_WAITING ||
  code === QR_STATE_SCANNED ||
  code === QR_STATE_CONFIRMED;
