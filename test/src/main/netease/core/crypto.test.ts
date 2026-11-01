import { createCipheriv, createDecipheriv } from 'node:crypto';
import { describe, expect, test } from 'vitest';

import { EAPI_KEY, IV, PRESET_KEY } from '@main/netease/core/config';
import {
  aesDecrypt,
  aesEncrypt,
  eapi,
  eapiResDecrypt,
  linuxapi,
  rsaEncrypt,
  weapi,
  xeapi,
  xeapiDecryptPublicKey,
  xeapiResDecrypt,
  xeapiSign,
  type XeapiPublicKey
} from '@main/netease/core/crypto';

const XEAPI_STATIC_KEY = Buffer.from(
  'ab1d5a430f6bb04a3f01e81ddd72bd916d5ce591248ac128714806d7f8fb1b84',
  'hex'
);

describe('aesEncrypt / aesDecrypt', () => {
  test('cbc round-trips through base64', () => {
    const encrypted = aesEncrypt('hello netease', 'cbc', PRESET_KEY, IV);
    expect(encrypted).not.toContain('hello');

    // Decrypt with a raw cipher: the classic layer uses PKCS7 padding + the fixed IV.
    const decipher = createDecipheriv('aes-128-cbc', Buffer.from(PRESET_KEY), Buffer.from(IV));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final()
    ]);
    expect(decrypted.toString('utf8')).toBe('hello netease');
  });

  test('ecb hex output is uppercase', () => {
    const encrypted = aesEncrypt('payload', 'ecb', EAPI_KEY, '', 'hex');
    expect(encrypted).toMatch(/^[0-9A-F]+$/);
    expect(aesDecrypt(encrypted, EAPI_KEY, 'hex').toString('utf8')).toBe('payload');
  });
});

describe('weapi', () => {
  test('the random second layer keeps the payload unreadable with the preset key alone', () => {
    const { params, encSecKey } = weapi({ id: 123, csrf_token: 'token' });

    // params is the double-encrypted blob; with only the preset key the final() padding check
    // fails (bad decrypt), which is exactly the "second random layer" property under test.
    // encSecKey is the RSA-encrypted reversed secretKey (hex, 128 bytes).
    expect(() => aesDecrypt(params, PRESET_KEY)).toThrow(/bad decrypt/i);
    expect(encSecKey).toMatch(/^[0-9a-f]{256}$/);
  });

  test('produces a fresh secretKey per call', () => {
    expect(weapi({ a: 1 }).params).not.toBe(weapi({ a: 1 }).params);
  });
});

describe('eapi', () => {
  test('embeds the url + payload + digest in the encrypted body', () => {
    const uri = '/api/song/enhance/player/url/v1';
    const { params } = eapi(uri, { ids: '[1]', level: 'lossless' });

    // eapi is AES-ECB over `url-36cd479b6b5-text-36cd479b6b5-digest`; the separator proves shape.
    const decrypted = aesDecrypt(params, EAPI_KEY, 'hex').toString('utf8');
    expect(decrypted).toContain(`${uri}-36cd479b6b5-`);
    expect(decrypted).toContain('"ids":"[1]"');
  });
});

describe('linuxapi', () => {
  test('wraps method/url/params into an uppercase-hex eparams', () => {
    const { eparams } = linuxapi({ method: 'POST', url: 'https://music.163.com/api/x', params: {} });
    expect(eparams).toMatch(/^[0-9A-F]+$/);
  });
});

describe('rsaEncrypt', () => {
  test('produces a 128-byte modulus-sized hex blob', () => {
    expect(rsaEncrypt('0123456789abcdef')).toMatch(/^[0-9a-f]{256}$/);
  });
});

describe('xeapi', () => {
  test('sign is a stable HMAC over timestamp+nonce', () => {
    expect(xeapiSign('123', '456')).toBe(xeapiSign('123', '456'));
    expect(xeapiSign('123', '456')).not.toBe(xeapiSign('124', '456'));
  });

  test('C/S/R fields are present with their respective encodings', () => {
    // Any 32 bytes import as an X25519 point for a shape-level check.
    const keyState: XeapiPublicKey = {
      version: 'v1',
      publicKey: Buffer.alloc(32, 7).toString('base64'),
      sk: 'sk-value'
    };
    const result = xeapi('/api/register/anonimous', { username: 'abc' }, {
      publicKeyState: keyState,
      os: 'android'
    });
    expect(result.C).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    expect(result.S).toMatch(/^[A-Za-z0-9+/]+={0,2}$/); // base64
    expect(result.R).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  test('response decryptor round-trips through the eapi key', () => {
    const payload = JSON.stringify({ code: 200, data: { ok: true } });
    const encrypted = Buffer.from(aesEncrypt(payload, 'ecb', EAPI_KEY, '', 'hex'), 'hex');
    expect(xeapiResDecrypt(encrypted)).toEqual({ code: 200, data: { ok: true } });
  });
});

describe('eapiResDecrypt', () => {
  test('decrypts a plain eapi response', () => {
    const encrypted = aesEncrypt(JSON.stringify({ code: 200 }), 'ecb', EAPI_KEY, '', 'hex');
    expect(eapiResDecrypt(encrypted)).toEqual({ code: 200 });
  });

  test('returns null on garbage input', () => {
    expect(eapiResDecrypt('FFFF')).toBeNull();
  });
});

describe('xeapiDecryptPublicKey', () => {
  test('decrypts a bundle encrypted under the static key', () => {
    const bundle = { version: 'v3', publicKey: 'pk!', sk: 'sk!' };
    const cipher = createCipheriv('aes-256-ecb', XEAPI_STATIC_KEY, null);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(bundle)), cipher.final()]);
    expect(xeapiDecryptPublicKey(encrypted.toString('base64'))).toEqual(bundle);
  });
});
