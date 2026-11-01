/**
 * NetEase API encryption/decryption layer.
 *
 * Modes: weapi (web), linuxapi (Linux client), eapi (desktop/mobile client), xeapi (anti-crawler).
 * Each has its own symmetric key + RSA public key; everything is implemented with node:crypto —
 * no third-party crypto dependency.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  publicEncrypt,
  constants,
  randomBytes,
  randomInt
} from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { BASE62, EAPI_KEY, IV, LINUX_API_KEY, PRESET_KEY, PUBLIC_KEY } from './config';

/** AES encryption used by the classic modes. */
export const aesEncrypt = (
  text: string | Buffer,
  mode: 'cbc' | 'ecb',
  key: string,
  iv: string,
  format: 'base64' | 'hex' = 'base64'
): string => {
  const algorithm = mode === 'cbc' ? 'aes-128-cbc' : 'aes-128-ecb';
  const ivBuf = mode === 'cbc' ? Buffer.from(iv, 'utf8') : Buffer.alloc(0);
  const cipher = createCipheriv(algorithm, Buffer.from(key, 'utf8'), ivBuf);
  const encrypted = Buffer.concat([
    cipher.update(typeof text === 'string' ? Buffer.from(text, 'utf8') : text),
    cipher.final()
  ]);
  return format === 'base64' ? encrypted.toString('base64') : encrypted.toString('hex').toUpperCase();
};

/** AES decryption used by the classic modes. */
export const aesDecrypt = (
  ciphertext: string,
  key: string,
  format: 'base64' | 'hex' = 'base64'
): Buffer => {
  const decipher = createDecipheriv('aes-128-ecb', Buffer.from(key, 'utf8'), Buffer.alloc(0));
  const input = Buffer.from(ciphertext, format);
  return Buffer.concat([decipher.update(input), decipher.final()]);
};

/**
 * "Raw" RSA for weapi: left-pad the plaintext to the 128-byte (1024-bit) modulus, then one
 * modular exponentiation, hex output. node:crypto's RSA_NO_PADDING maps to exactly that.
 */
export const rsaEncrypt = (str: string, publicKey: string = PUBLIC_KEY): string => {
  const buffer = Buffer.alloc(128);
  const data = Buffer.from(str, 'utf8');
  data.copy(buffer, 128 - data.length);
  const encrypted = publicEncrypt({ key: publicKey, padding: constants.RSA_NO_PADDING }, buffer);
  return encrypted.toString('hex');
};

/**
 * weapi encryption:
 * 1) generate a 16-char random base62 secretKey
 * 2) AES-CBC(PRESET_KEY) once, then AES-CBC(secretKey) again
 * 3) RSA-encrypt the reversed secretKey as encSecKey
 */
export const weapi = (object: unknown): { params: string; encSecKey: string } => {
  const text = JSON.stringify(object);
  let secretKey = '';
  for (let i = 0; i < 16; i++) {
    secretKey += BASE62.charAt(randomInt(0, 62));
  }
  const first = aesEncrypt(text, 'cbc', PRESET_KEY, IV);
  const params = aesEncrypt(first, 'cbc', secretKey, IV);
  const encSecKey = rsaEncrypt(secretKey.split('').reverse().join(''));
  return { params, encSecKey };
};

/** linuxapi encryption. */
export const linuxapi = (object: unknown): { eparams: string } => {
  const text = JSON.stringify(object);
  return { eparams: aesEncrypt(text, 'ecb', LINUX_API_KEY, '', 'hex') };
};

/**
 * eapi encryption:
 * 1) MD5 of `url + plaintext + salt` as the signature digest
 * 2) AES-ECB(hex) of `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
 */
export const eapi = (url: string, object: unknown): { params: string } => {
  const text = typeof object === 'object' ? JSON.stringify(object) : String(object);
  const message = `nobody${url}use${text}md5forencrypt`;
  const digest = createHash('md5').update(message).digest('hex');
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  return { params: aesEncrypt(data, 'ecb', EAPI_KEY, '', 'hex') };
};

/** Decrypts an eapi-encrypted response body. */
export const eapiResDecrypt = (encryptedHex: string, aeapi = false): unknown => {
  try {
    const decrypted = aesDecrypt(encryptedHex, EAPI_KEY, 'hex');
    if (aeapi) {
      const decompressed = gunzipSync(decrypted);
      return JSON.parse(decompressed.toString('utf8'));
    }
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    return null;
  }
};

// ---- xeapi (anti-crawler encryption) ----

/** xeapi fixed symmetric key (AES-256-ECB). */
const XEAPI_STATIC_KEY = Buffer.from(
  'ab1d5a430f6bb04a3f01e81ddd72bd916d5ce591248ac128714806d7f8fb1b84',
  'hex'
);
/** xeapi signature key (HMAC-SHA256, the string is used as-is). */
const XEAPI_SIGN_KEY =
  'mUHCwVNWJbunMqAHf5MImuirT6plvs6VSFW62MGHstFQxhBGdEoIhLItH3djc4+FB/OKty3+lL2rGeoFBpVe5g==';
/** Fixed RFC 8410 SPKI prefix for importing a bare 32-byte X25519 public key. */
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

/** xeapi server public key state (returned by the anti-crawler endpoint and cached). */
export interface XeapiPublicKey {
  version: string;
  publicKey: string;
  sk?: string;
  [key: string]: unknown;
}

/** xeapi encryption options. */
export interface XeapiOptions {
  publicKeyState: XeapiPublicKey;
  sessionId?: string;
  sessionKey?: string;
  os?: string;
  appver?: string;
  deviceId?: string;
  uid?: string;
  method?: string;
  contentType?: string;
}

/** Variable-length-key AES-ECB encrypt (picks 128/256 by key length, PKCS7 padding). */
const aesEcbEncrypt = (key: Buffer, plaintext: Buffer): Buffer => {
  const cipher = createCipheriv(`aes-${key.length * 8}-ecb`, key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
};

/** Variable-length-key AES-ECB decrypt. */
const aesEcbDecrypt = (key: Buffer, ciphertext: Buffer): Buffer => {
  const decipher = createDecipheriv(`aes-${key.length * 8}-ecb`, key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
};

/** Imports a bare 32-byte X25519 public key by prefixing the SPKI header. */
const createX25519PublicKey = (raw: Buffer) =>
  createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });

/** Derives a 16-byte AES key from the ECDH shared secret + ephemeral public key (HKDF style). */
const deriveX25519AesKey = (sharedSecret: Buffer, ephemeralPublicKey: Buffer): Buffer => {
  const prk = createHmac('sha256', Buffer.alloc(32))
    .update(sharedSecret.length ? sharedSecret : Buffer.alloc(32))
    .digest();
  return createHmac('sha256', prk)
    .update(Buffer.concat([ephemeralPublicKey, Buffer.from([1])]))
    .digest()
    .subarray(0, 16);
};

/** xeapi anti-crawler signature: HMAC-SHA256(signKey, timestamp+nonce) -> base64. */
export const xeapiSign = (timestamp: string | number, nonce: string): string =>
  createHmac('sha256', XEAPI_SIGN_KEY)
    .update(String(timestamp) + nonce)
    .digest('base64');

/** Intermediate transform: random XOR then rotation by the original bytes. */
const xeapiMidTransform = (ciphertext: Buffer): Buffer => {
  const random = randomBytes(16);
  const xored = Buffer.alloc(ciphertext.length);
  for (let i = 0; i < ciphertext.length; i++) xored[i] = ciphertext[i] ^ random[i & 0x0f];
  const rot = xored.length ? (random[0] & 0x0f) % xored.length : 0;
  return Buffer.concat([random, xored.subarray(rot), xored.subarray(0, rot)]);
};

/** Wraps the dynamic key with X25519 ECDH + AES-GCM (the S field). */
const xeapiEncryptS = (dynamicKey: Buffer, publicKeyState: XeapiPublicKey, os: string): Buffer => {
  const peerKey = createX25519PublicKey(Buffer.from(publicKeyState.publicKey, 'base64'));
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const ephemeralRaw = Buffer.from(publicKey.export({ format: 'der', type: 'spki' })).subarray(-32);
  const sharedSecret = diffieHellman({ privateKey, publicKey: peerKey });
  const aesKey = deriveX25519AesKey(sharedSecret, ephemeralRaw);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-128-gcm', aesKey, iv);
  const plaintext = Buffer.from(`${dynamicKey.toString('base64')}|${os}|${publicKeyState.sk || ''}`);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([ephemeralRaw, iv, encrypted, cipher.getAuthTag()]);
};

/** Builds the xeapi plaintext (JSON: body/queryString/...). */
const buildXeapiPlaintext = (
  uri: string,
  data: Record<string, unknown>,
  options: XeapiOptions
): string => {
  const fields: Record<string, string> = {};
  const contentType = options.contentType || 'application/x-www-form-urlencoded;charset=utf-8';
  const mediaType = contentType.split(';', 1)[0].toLowerCase();
  if (mediaType !== 'application/x-www-form-urlencoded') {
    fields.contentType = contentType;
  }
  const method = (options.method || 'POST').toUpperCase();
  if (method !== 'POST') fields.method = method;
  const url = new URL(uri, 'https://interface.music.163.com');
  if (url.search) fields.queryString = url.search.slice(1);
  if (data !== undefined && data !== null) {
    const bodyData = { ...data };
    delete bodyData.e_r;
    const body = new URLSearchParams(bodyData as Record<string, string>).toString();
    if (body.length) {
      if (mediaType === 'application/x-www-form-urlencoded') fields.content = body;
      else fields.body = Buffer.from(body).toString('base64');
    }
  }
  fields.queryString = fields.queryString ? `${fields.queryString}&e_r=true` : 'e_r=true';
  return JSON.stringify(fields);
};

/** xeapi encryption: C uses base64url, S / R use base64. */
export const xeapi = (
  uri: string,
  data: Record<string, unknown>,
  options: XeapiOptions
): { C: string; S: string; R: string } => {
  const { publicKeyState } = options;
  const activeSessionKey = options.sessionKey ? Buffer.from(String(options.sessionKey)) : null;
  const activeSessionId = options.sessionId || '';
  const dynamicKey = activeSessionKey || randomBytes(16);
  const plaintext = Buffer.from(buildXeapiPlaintext(uri, data, options));
  const c = aesEcbEncrypt(dynamicKey, xeapiMidTransform(aesEcbEncrypt(XEAPI_STATIC_KEY, plaintext)));
  const s = xeapiEncryptS(dynamicKey, publicKeyState, options.os || 'android');
  const r = aesEcbEncrypt(
    XEAPI_STATIC_KEY,
    Buffer.from(`${publicKeyState.version}|${activeSessionKey ? activeSessionId : ''}`)
  );
  return { C: c.toString('base64url'), S: s.toString('base64'), R: r.toString('base64') };
};

/** Decrypts an xeapi response: AES-ECB(eapiKey) + optional gunzip + JSON. */
export const xeapiResDecrypt = (body: Buffer): unknown => {
  const decrypted = aesEcbDecrypt(Buffer.from(EAPI_KEY, 'utf8'), body);
  const plaintext = decrypted[0] === 0x1f && decrypted[1] === 0x8b ? gunzipSync(decrypted) : decrypted;
  return JSON.parse(plaintext.toString());
};

/** Decrypts the public-key bundle returned by the anti-crawler endpoint. */
export const xeapiDecryptPublicKey = (encryptedData: string): XeapiPublicKey =>
  JSON.parse(aesEcbDecrypt(XEAPI_STATIC_KEY, Buffer.from(encryptedData, 'base64')).toString());
