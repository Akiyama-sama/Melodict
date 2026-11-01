/**
 * xeapi public key acquisition and session state.
 *
 * Anti-crawler endpoints (guest registration) go through xeapi: first fetch the X25519 public-key
 * bundle from /api/bsr/sk/get (cached in-process); after the first request the server delivers a
 * session key via response headers, which is then reused.
 */

import { API_DOMAIN, UA_MAP } from './config';
import { xeapiSign, xeapiDecryptPublicKey, type XeapiPublicKey } from './crypto';

let publicKeyState: XeapiPublicKey | null = null;
let sessionId = '';
let sessionKey = '';
let publicKeyPromise: Promise<XeapiPublicKey> | null = null;
let publicKeyGeneration = 0;

/** 16-digit numeric nonce. */
const generateNonce = (): string => {
  let nonce = '';
  for (let i = 0; i < 16; i++) nonce += Math.floor(Math.random() * 10).toString();
  return nonce;
};

/** Fetches and decrypts the public-key bundle from the anti-crawler endpoint. */
const fetchPublicKey = async (
  deviceId: string,
  currentKeyVersion: string
): Promise<XeapiPublicKey> => {
  const nonce = generateNonce();
  const timestamp = String(Date.now());
  const data: Record<string, string> = {
    appVersion: '9.5.61',
    currentKeyVersion,
    deviceId,
    nonce,
    os: 'android',
    requestType: 'active',
    signature: xeapiSign(timestamp, nonce),
    t1: '',
    t2: '',
    timestamp,
    uid: ''
  };

  const res = await fetch(`${API_DOMAIN}/api/bsr/sk/get`, {
    method: 'POST',
    headers: {
      'User-Agent': UA_MAP.api.android,
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: deviceId ? `deviceId=${encodeURIComponent(deviceId)}` : ''
    },
    body: new URLSearchParams(data).toString(),
    signal: AbortSignal.timeout(8000)
  });

  const json = (await res.json()) as {
    code?: number;
    data?: { encryptedData?: string; signature?: string; timestamp?: string };
  };
  const payload = json?.data;
  if (json?.code !== 200 || !payload?.encryptedData) {
    throw new Error('xeapi public key request failed');
  }
  if (!payload.signature || xeapiSign(payload.timestamp ?? '', nonce) !== payload.signature) {
    throw new Error('xeapi public key response signature mismatch');
  }
  const key = xeapiDecryptPublicKey(payload.encryptedData);
  if (!key.sk) throw new Error('xeapi public key response missing sk');
  return key;
};

/** Returns the current public key, fetching and caching one when missing. */
export const ensureXeapiKey = async (deviceId: string): Promise<XeapiPublicKey> => {
  if (publicKeyState?.sk) return publicKeyState;
  if (!publicKeyPromise) {
    const generation = publicKeyGeneration;
    const promise = fetchPublicKey(deviceId, publicKeyState?.version ?? '')
      .then((key) => {
        if (!key.sk && publicKeyState?.sk) key.sk = publicKeyState.sk;
        if (generation === publicKeyGeneration) publicKeyState = key;
        return key;
      })
      .finally(() => {
        if (publicKeyPromise === promise) publicKeyPromise = null;
      });
    publicKeyPromise = promise;
  }
  return publicKeyPromise;
};

/** Reads the current session (empty on the first request). */
export const getXeapiSession = (): {
  sessionId: string;
  sessionKey: string;
  generation: number;
} => ({
  sessionId,
  sessionKey,
  generation: publicKeyGeneration
});

/** Session key delivered via response headers by the server. */
export const updateXeapiSession = (id: string, key: string, generation: number): void => {
  if (generation !== publicKeyGeneration) return;
  sessionId = id;
  sessionKey = key;
};

/** Clears the state so the next call re-fetches. */
export const resetXeapiKey = (): void => {
  publicKeyGeneration += 1;
  publicKeyState = null;
  publicKeyPromise = null;
  sessionId = '';
  sessionKey = '';
};
