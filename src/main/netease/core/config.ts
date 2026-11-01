/**
 * NetEase API constants: crypto keys, endpoint domains and the client-impersonation profiles that
 * make requests look like a real desktop/mobile client instead of a bare HTTP bot.
 */

/** AES-CBC initial vector. */
export const IV = '0102030405060708';
/** weapi first-layer AES preset key. */
export const PRESET_KEY = '0CoJUm6Qyw8W8jud';
/** linuxapi AES key. */
export const LINUX_API_KEY = 'rFgB&h#%2?^eDg:Q';
/** eapi AES key. */
export const EAPI_KEY = 'e82ckenh8dichen8';
/** weapi random secretKey charset. */
export const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
/** weapi RSA public key (1024bit). */
export const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`;

/** Web domain (weapi). */
export const DOMAIN = 'https://music.163.com';
/** Client generic API domain (api). */
export const API_DOMAIN = 'https://interface.music.163.com';
/** Client eapi encrypted API domain. */
export const EAPI_DOMAIN = 'https://interfacepc.music.163.com';
/** xeapi domain (anti-crawler endpoints such as guest registration). */
export const XEAPI_DOMAIN = 'https://interface3.music.163.com';

/** Whether the server should encrypt response bodies by default (e_r) for weapi/eapi. */
export const ENCRYPT_RESPONSE = false;

/** Business codes treated as HTTP-200 success (login/redirect/rate-limit semantics). */
export const SPECIAL_STATUS_CODES: ReadonlySet<number> = new Set([
  201, 302, 400, 502, 800, 801, 802, 803
]);

/**
 * Client impersonation profiles: the appver/osver/channel a given `os` cookie value implies.
 * These must stay coherent with the User-Agent chosen for the same crypto mode or the risk
 * engine flags the request ("当前设备环境异常").
 */
export const OS_MAP = {
  pc: {
    os: 'pc',
    appver: '3.1.29.205117',
    osver: 'Microsoft-Windows-10-Professional-build-19045-64bit',
    channel: 'netease'
  },
  linux: {
    os: 'linux',
    appver: '1.2.1.0428',
    osver: 'Deepin 20.9',
    channel: 'netease'
  },
  android: {
    os: 'android',
    appver: '8.20.20.231215173437',
    osver: '14',
    channel: 'xiaomi'
  },
  iphone: {
    os: 'iPhone OS',
    appver: '9.0.90',
    osver: '16.2',
    channel: 'distribution'
  },
  osx: {
    os: 'osx',
    appver: '3.1.10.5100',
    osver: '15.5',
    channel: 'netease'
  }
} as const;

/** User-Agent per crypto mode + device type. */
export const UA_MAP = {
  weapi: {
    pc: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0'
  },
  linuxapi: {
    linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36'
  },
  api: {
    pc: 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/3.1.29.205117',
    android: 'NeteaseMusic/9.5.61.260802021928(9005061);Dalvik/2.1.0 (Linux; U; Android 12; HBN-AL00 Build/cd737a2.0)',
    iphone: 'NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)'
  }
} as const;

/** Supported request encryption modes. */
export type CryptoMode = 'weapi' | 'linuxapi' | 'eapi' | 'api' | 'xeapi';
