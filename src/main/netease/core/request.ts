/**
 * Assembles requests per the client protocol and normalizes responses.
 *
 * Ported from SPlayer-Next (AGPL-3.0): every request carries a coherent device fingerprint
 * (deviceId / os / appver / channel / NMTID / MUSIC_A), which is what keeps the risk engine from
 * answering "当前设备环境异常,本次操作已拦截" on endpoints like QR-key creation.
 */

import { randomBytes } from 'node:crypto';
import {
  API_DOMAIN,
  DOMAIN,
  EAPI_DOMAIN,
  ENCRYPT_RESPONSE,
  OS_MAP,
  SPECIAL_STATUS_CODES,
  UA_MAP,
  XEAPI_DOMAIN,
  type CryptoMode
} from './config';
import { cookieObjToString, cookieToJson } from './cookie';
import * as encrypt from './crypto';
import { getAnonymousToken, getDeviceId } from './device';
import { ensureXeapiKey, getXeapiSession, updateXeapiSession } from './xeapi';
import { NeteaseRequestError, type RequestResponse } from './response';

/** Caller-supplied optional parameters. */
export interface RequestOptions {
  /** Encryption mode; defaults follow per-path rules (see createRequest). */
  crypto?: CryptoMode | '';
  /** Pre-injected cookie, string or object. */
  cookie?: string | Record<string, string>;
  /** Custom User-Agent. */
  ua?: string;
  /** Referer / domain override. */
  domain?: string;
  /** Real IP (X-Real-IP / X-Forwarded-For). */
  realIP?: string;
  ip?: string;
  /** Ask the server to encrypt the response body (weapi/eapi only). */
  e_r?: boolean;
}

export { NeteaseRequestError, type RequestResponse } from './response';

interface NeteaseBody {
  code?: number | string;
  [key: string]: unknown;
}

/** weapi-only CSRF token, taken from the cookie. */
const csrfFrom = (cookie: Record<string, string>): string => cookie['__csrf'] || '';

/** macOS client log endpoints expect a desktop browser UA. */
const OSX_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** WNMCID (process-level constant): 6 lowercase letters.timestamp.01.0. */
const WNMCID = (() => {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return `${s}.${Date.now()}.01.0`;
})();

/** Per-request incrementing `timestamp_XXXX` id. */
const generateRequestId = (): string => {
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(4, '0');
  return `${Date.now()}_${rand}`;
};

/** Cached server-issued valid NMTID. */
let cachedNmtid = '';
/** Probe retries left for requests without an NMTID (the server only issues one then). */
let nmtidRetriesLeft = 3;

/** Fills in the cookie: injects _ntes_nuid/_ntes_nnid/WNMCID/deviceId/appver and friends. */
const processCookieObject = (
  cookie: Record<string, string>,
  crypto: CryptoMode | ''
): Record<string, string> => {
  const ntesNuid = cookie._ntes_nuid || randomBytes(16).toString('hex');
  const os = OS_MAP[(cookie.os as keyof typeof OS_MAP) || 'pc'] || OS_MAP.pc;

  const processed: Record<string, string> = {
    ...cookie,
    __remember_me: 'true',
    ntes_kaola_ad: '1',
    _ntes_nuid: cookie._ntes_nuid || ntesNuid,
    _ntes_nnid: cookie._ntes_nnid || `${ntesNuid},${Date.now()}`,
    WNMCID: cookie.WNMCID || WNMCID,
    WEVNSM: cookie.WEVNSM || '1.0.0',
    osver: cookie.osver || os.osver,
    deviceId: cookie.deviceId || getDeviceId(),
    os: cookie.os || os.os,
    channel: cookie.channel || os.channel,
    appver: cookie.appver || os.appver
  };

  /** The server issues an NMTID via set-cookie on an eapi request sent without one. */
  if (cookie.NMTID) {
    processed.NMTID = cookie.NMTID;
  } else if (cachedNmtid) {
    processed.NMTID = cachedNmtid;
  } else if (nmtidRetriesLeft <= 0 || crypto !== 'eapi') {
    processed.NMTID = '00O' + randomBytes(19).toString('hex').slice(0, 38);
  }

  if (!processed.MUSIC_U) {
    processed.MUSIC_A = processed.MUSIC_A || getAnonymousToken();
    if (!processed.MUSIC_A) delete processed.MUSIC_A;
  }

  return processed;
};

/** Picks the User-Agent for the crypto mode + device type. */
const chooseUserAgent = (
  crypto: keyof typeof UA_MAP,
  uaType: 'pc' | 'android' | 'iphone' | 'linux' = 'pc'
): string => {
  const map = UA_MAP[crypto] as Record<string, string> | undefined;
  return (map && map[uaType]) || '';
};

/**
 * Builds and sends a request.
 * @param uri - API path, e.g. `/api/w/login`; weapi rewrites the prefix to `/weapi/`
 * @param data - business parameters (cookie/csrf are injected by this layer)
 * @param options - encryption mode / cookie overrides
 */
export const createRequest = async (
  uri: string,
  data: Record<string, unknown>,
  options: RequestOptions
): Promise<RequestResponse> => {
  const headers: Record<string, string> = {};
  const ip = options.realIP || options.ip || '';
  if (ip) {
    headers['X-Real-IP'] = ip;
    headers['X-Forwarded-For'] = ip;
  }

  let crypto: CryptoMode | '' = options.crypto ?? '';
  if (crypto === '') crypto = 'eapi';

  /** Normalizes the cookie to an object and fills in the client fields once. */
  let cookie: Record<string, string> =
    typeof options.cookie === 'string' ? cookieToJson(options.cookie) : options.cookie || {};
  cookie = processCookieObject(cookie, crypto);
  headers['Cookie'] = cookieObjToString(cookie);

  const csrfToken = csrfFrom(cookie);
  const useER = toBoolean(
    options.e_r !== undefined ? options.e_r : data.e_r !== undefined ? data.e_r : ENCRYPT_RESPONSE
  );
  data.e_r = useER;

  let url = '';
  let xeapiGeneration: number | undefined;
  let encryptData: Record<string, string | number | boolean> | typeof data;

  switch (crypto) {
    case 'weapi': {
      headers['Referer'] = options.domain || DOMAIN;
      headers['User-Agent'] = options.ua || chooseUserAgent('weapi');
      (data as Record<string, unknown>).csrf_token = csrfToken;
      encryptData = encrypt.weapi(data);
      url = (options.domain || DOMAIN) + '/weapi/' + uri.slice(5);
      break;
    }
    case 'linuxapi': {
      headers['User-Agent'] = options.ua || chooseUserAgent('linuxapi', 'linux');
      encryptData = encrypt.linuxapi({
        method: 'POST',
        url: (options.domain || DOMAIN) + uri,
        params: data
      });
      url = (options.domain || DOMAIN) + '/api/linux/forward';
      break;
    }
    case 'xeapi': {
      const session = getXeapiSession();
      xeapiGeneration = session.generation;
      const publicKeyState = await ensureXeapiKey(cookie.deviceId);
      const xeapiOs = cookie.os === 'android' ? cookie.os : 'android';
      const xeapiAppver = cookie.os === 'android' && cookie.appver ? cookie.appver : '9.1.65';
      const xeapiOsver = cookie.os === 'android' && cookie.osver ? cookie.osver : '16';
      const xeapiBuildver = cookie.buildver || Date.now().toString().slice(0, 10);
      headers['User-Agent'] = options.ua || chooseUserAgent('api', 'android');
      headers['X-Client-Enc-State'] = 'ENCRYPTED';
      headers['x-aeapi'] = 'true';
      headers['x-deviceid'] = cookie.deviceId;
      headers['x-os'] = xeapiOs;
      headers['x-osver'] = xeapiOsver;
      headers['x-appver'] = xeapiAppver;
      headers['x-sdeviceid'] = cookie.sDeviceId || cookie.deviceId;
      headers['x-buildver'] = xeapiBuildver;
      if (cookie.MUSIC_U) headers['x-music-u'] = cookie.MUSIC_U;
      headers['Cookie'] = cookieObjToString({
        ...cookie,
        os: xeapiOs,
        osver: xeapiOsver,
        appver: xeapiAppver,
        buildver: xeapiBuildver,
        sDeviceId: cookie.sDeviceId || cookie.deviceId
      });
      url = (options.domain || XEAPI_DOMAIN) + '/xeapi/' + uri.slice(5);
      encryptData = encrypt.xeapi(uri, data, {
        publicKeyState,
        sessionId: session.sessionId,
        sessionKey: session.sessionKey,
        appver: xeapiAppver,
        deviceId: cookie.deviceId,
        os: xeapiOs,
        uid: cookie.uid || cookie.userId || ''
      });
      break;
    }
    case 'eapi':
    case 'api': {
      const header: Record<string, string> = {
        osver: cookie.osver,
        deviceId: cookie.deviceId,
        os: cookie.os,
        appver: cookie.appver,
        versioncode: cookie.versioncode || '140',
        mobilename: cookie.mobilename || '',
        buildver: cookie.buildver || Date.now().toString().slice(0, 10),
        resolution: cookie.resolution || '1920x1080',
        __csrf: csrfToken,
        channel: cookie.channel,
        requestId: generateRequestId()
      };
      if (cookie.MUSIC_U) header.MUSIC_U = cookie.MUSIC_U;
      if (cookie.MUSIC_A) header.MUSIC_A = cookie.MUSIC_A;
      if (crypto === 'eapi' && cookie.NMTID) header.NMTID = cookie.NMTID;
      headers['Cookie'] = cookieObjToString(header);
      headers['User-Agent'] =
        options.ua || (cookie.os === 'osx' ? OSX_USER_AGENT : chooseUserAgent('api', 'iphone'));

      if (crypto === 'eapi') {
        (data as Record<string, unknown>).header = header;
        encryptData = encrypt.eapi(uri, data);
        url = (options.domain || EAPI_DOMAIN) + '/eapi/' + uri.slice(5);
      } else {
        url = (options.domain || API_DOMAIN) + uri;
        encryptData = data;
      }
      break;
    }
    default:
      throw new Error(`Unknown crypto: ${crypto}`);
  }

  const body = new URLSearchParams(encryptData as Record<string, string>).toString();
  headers['Content-Type'] = 'application/x-www-form-urlencoded';

  const answer: RequestResponse = { status: 500, body: {}, cookie: [] };
  const isXeapi = crypto === 'xeapi';
  const needDecrypt = isXeapi || ((crypto === 'eapi' || crypto === 'weapi') && useER);

  let res: Response | null = null;
  let lastErr: unknown = null;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(8000)
      });
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 200));
      }
    }
  }

  if (!res) {
    answer.status = 502;
    const cause = (lastErr as { cause?: { code?: string; message?: string } })?.cause;
    const errorMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    const detailMsg = cause?.code ? `${errorMsg} (${cause.code})` : errorMsg;
    answer.body = { code: 502, msg: detailMsg };
    throw new NeteaseRequestError(answer);
  }

  /** Collects set-cookie headers and extracts the server-issued NMTID. */
  const setCookie =
    (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
    (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : []);
  const cleanCookie = (x: string): string => x.replace(/\s*Domain=[^(;|$)]+;*/, '');

  if (crypto === 'eapi' && !cachedNmtid && nmtidRetriesLeft > 0 && !cookie.NMTID) {
    nmtidRetriesLeft--;
    answer.cookie = setCookie.map((x) => {
      const match = x.match(/(?:^|;\s*)NMTID=([^;]+)/);
      if (match) cachedNmtid = match[1];
      return cleanCookie(x);
    });
  } else {
    answer.cookie = setCookie.map(cleanCookie);
  }

  /** xeapi session keys arrive via response headers; cache them for reuse. */
  if (isXeapi) {
    const ssid = res.headers.get('x-encr-ssid');
    const sskey = res.headers.get('x-encr-sskey');
    if (ssid && sskey && xeapiGeneration !== undefined) {
      updateXeapiSession(ssid, sskey, xeapiGeneration);
    }
  }

  let parsed: NeteaseBody;
  try {
    if (needDecrypt) {
      const buf = Buffer.from(await res.arrayBuffer());
      parsed = (
        isXeapi
          ? encrypt.xeapiResDecrypt(buf)
          : encrypt.eapiResDecrypt(buf.toString('hex').toUpperCase(), headers['x-aeapi'] === 'true')
      ) as NeteaseBody;
    } else {
      const text = await res.text();
      parsed = JSON.parse(text);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Response is not a valid object');
    }
    answer.body = parsed;
    if (parsed?.code !== undefined) parsed.code = Number(parsed.code);
    answer.status = Number(parsed?.code || res.status);
    if (typeof parsed?.code === 'number' && SPECIAL_STATUS_CODES.has(parsed.code)) {
      answer.status = 200;
    }
  } catch {
    answer.status = res.status >= 400 ? res.status : 502;
    answer.body = { code: answer.status, msg: 'Response parsing failed' };
  }

  answer.status = answer.status > 100 && answer.status < 600 ? answer.status : 400;

  if (answer.status === 200) return answer;
  throw new NeteaseRequestError(answer);
};

/** Lenient boolean parsing. */
const toBoolean = (val: unknown): boolean => {
  if (typeof val === 'boolean') return val;
  if (val === '') return false;
  return val === 'true' || val === '1' || val === 1;
};
