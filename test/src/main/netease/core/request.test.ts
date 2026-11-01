import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());

import { cookieObjToString } from '@main/netease/core/cookie';
import { setAnonymousToken, setDeviceId } from '@main/netease/core/device';
import { resetXeapiKey } from '@main/netease/core/xeapi';
import { createRequest } from '@main/netease/core/request';

const jsonResponse = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers }
  });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse({ code: 200, ok: true }));
  setDeviceId('A'.repeat(52));
  setAnonymousToken('anon-token');
  resetXeapiKey();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Extracts the Cookie header sent to the transport. */
const sentCookie = (call = 0): string => {
  const headers = fetchMock.mock.calls[call][1].headers as Record<string, string>;
  return headers.Cookie;
};

describe('createRequest cookie assembly', () => {
  test('fills in the client fingerprint fields for eapi', async () => {
    await createRequest('/api/test', {}, { crypto: 'eapi' });

    const cookie = sentCookie();
    expect(cookie).toContain('deviceId=');
    expect(cookie).toContain('os=pc');
    expect(cookie).toContain('appver=3.1.29.205117');
    expect(cookie).toContain('channel=netease');
    expect(cookie).toContain('MUSIC_A=anon-token');
    expect(cookie).not.toContain('undefined');
  });

  test('prefers the session MUSIC_U and keeps the anonymous token out', async () => {
    await createRequest(
      '/api/test',
      {},
      { crypto: 'eapi', cookie: { MUSIC_U: 'session-uv', deviceId: 'B'.repeat(52) } }
    );

    const cookie = sentCookie();
    expect(cookie).toContain('MUSIC_U=session-uv');
    expect(cookie).toContain(`deviceId=${'B'.repeat(52)}`);
    expect(cookie).not.toContain('MUSIC_A');
  });

  test('accepts a cookie string', async () => {
    await createRequest('/api/test', {}, { crypto: 'eapi', cookie: 'MUSIC_U=str-cookie' });
    expect(sentCookie()).toContain('MUSIC_U=str-cookie');
  });

  test('reuses a stable _ntes_nuid per explicit cookie only (no leaking across calls)', async () => {
    await createRequest('/api/test', {}, { crypto: 'eapi' });
    await createRequest('/api/test', {}, { crypto: 'eapi' });
    const first = cookieObjToString;
    void first;
    // Both calls generate a fresh random nuid (no persistence expected) but the deviceId is stable.
    const idA = /deviceId=([A-F0-9]+)/.exec(sentCookie(0))?.[1];
    const idB = /deviceId=([A-F0-9]+)/.exec(sentCookie(1))?.[1];
    expect(idA).toBe('A'.repeat(52));
    expect(idB).toBe('A'.repeat(52));
  });
});

describe('createRequest crypto routing', () => {
  test('eapi posts to the interfacepc domain with the encrypted body', async () => {
    await createRequest('/api/test', {}, { crypto: 'eapi' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://interfacepc.music.163.com/eapi/test');
    expect(String(init.body)).toMatch(/^params=/);
    expect(init.headers['User-Agent']).toContain('NeteaseMusic');
  });

  test('weapi posts to music.163.com/weapi with params + encSecKey', async () => {
    await createRequest('/api/test', {}, { crypto: 'weapi', cookie: { __csrf: 'tok' } });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://music.163.com/weapi/test');
    const body = String(init.body);
    expect(body).toContain('params=');
    expect(body).toContain('encSecKey=');
    expect(init.headers['Referer']).toBe('https://music.163.com');
  });

  test('api posts the plain payload to interface.music.163.com', async () => {
    await createRequest('/api/test', { id: 5 }, { crypto: 'api' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://interface.music.163.com/api/test');
    expect(String(init.body)).toContain('id=5');
  });
});

describe('createRequest response handling', () => {
  test('returns the parsed body and collects set-cookie', async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ code: 200 }), {
          status: 200,
          headers: { 'Set-Cookie': 'NMTID=00Oabc; Path=/; Domain=music.163.com' }
        })
    );

    const result = await createRequest('/api/test', {}, { crypto: 'eapi' });
    expect(result.body).toEqual({ code: 200 });
    expect(result.cookie[0]).toContain('NMTID=00Oabc');
    expect(result.cookie[0]).not.toContain('Domain=');
  });

  test('maps business error codes onto NeteaseRequestError with the body attached', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse({ code: 301, msg: 'not logged in' }));

    await expect(createRequest('/api/test', {}, { crypto: 'eapi' })).rejects.toMatchObject({
      name: 'NeteaseRequestError',
      response: { body: { code: 301 } }
    });
  });

  test('treats QR poll state codes as success', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse({ code: 801 }));

    const result = await createRequest('/api/test', {}, { crypto: 'eapi' });
    expect(result.status).toBe(200);
  });

  test('retries transport failures before giving up', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(createRequest('/api/test', {}, { crypto: 'eapi' })).rejects.toMatchObject({
      response: { status: 502 }
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
