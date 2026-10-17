import { createRequire } from 'module';

import logger from '../logger';
import { readNeteaseSessionCookie } from './session';

// The package is CJS and the main bundle is ESM, so reach it through createRequire. The require is
// created lazily (inside callNetease) to keep test environments from paying package-load cost on
// module import.
let neteaseApi: Record<string, (data?: unknown) => Promise<NeteaseApiRawResult>> | undefined;

const getNeteaseApi = () => {
  if (!neteaseApi) {
    const require = createRequire(import.meta.url);
    neteaseApi = require('NeteaseCloudMusicApi') as typeof neteaseApi;
  }

  return neteaseApi;
};

export interface NeteaseApiRawResult {
  /** HTTP status reported by the library; usually 200 even for business errors. */
  status: number;
  /** Result body; code 200 means success, 301 means auth required, etc. */
  body: Record<string, unknown>;
  /** Set-Cookie lines returned by the server (used to keep sessions fresh). */
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

export const NETWORK_ERROR_MESSAGE = 'NETEASE_NETWORK_ERROR';

type NeteaseCallOptions = {
  /** Cookie string (joined `k=v; ...`), overriding the default session cookie. */
  cookie?: string;
};

/**
 * Calls one NCM module function (`login_qr_check`, `song_url_v1`, ...). Merges the caller's
 * cookie, unwraps into the response body and converts business errors into `NeteaseApiError`.
 *
 * Some endpoints return "success-ish" business codes (QR polling 800/801/802/803, etc.), so this
 * only throws when the code is clearly an error; callers inspect semantics themselves.
 */
export const callNetease = async (
  name: string,
  params: Record<string, unknown> = {},
  options: NeteaseCallOptions = {}
): Promise<NeteaseApiRawResult> => {
  const api = getNeteaseApi();
  if (!api) throw new NeteaseApiError('NetEase API failed to load.');
  const fn = api[name];
  if (!fn) throw new NeteaseApiError(`Unknown Netease API call: ${name}`);

  // An explicit cookie wins; otherwise default to the stored session so every endpoint (login_status,
  // user_playlist, ...) automatically behaves as the logged-in user, exactly as NCM deployments do.
  let cookie = options.cookie;
  if (!cookie) {
    try {
      cookie = await readNeteaseSessionCookie();
    } catch {
      // No session file yet (first run): proceed anonymously.
    }
  }
  const extraCookie = cookie ? { cookie } : {};

  try {
    const result = (await fn({ ...params, ...extraCookie })) as NeteaseApiRawResult;

    // HTTP-level failures without a business code (rare: the lib usually wraps them in a body).
    if (result?.status >= 400 && typeof result?.body?.code !== 'number') {
      throw new NeteaseApiError(`NetEase request failed: ${name}`, undefined, result?.status);
    }

    return result;
  } catch (error) {
    if (error instanceof NeteaseApiError) throw error;

    logger.error('NetEase API call failed.', { name, error });
    throw new NeteaseApiError(NETWORK_ERROR_MESSAGE, undefined, undefined);
  }
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

/** QR-login polling codes (800 expired, 801 waiting, 802 scanned, 803 confirmed). */
const isNeteasePollStateCode = (code: number) =>
  code === 800 || code === 801 || code === 802 || code === 803;
