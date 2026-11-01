import { beforeEach, describe, expect, test, vi } from 'vitest';

import { NeteaseApiError, callNetease, callNeteaseForBody, isNeteaseAuthError } from '@main/netease/client';

// The dispatcher routes by module name; stub the module map and the session store.
const createRequestMock = vi.fn();

vi.mock('../../../../src/main/netease/core/request', () => ({
  createRequest: (...args: unknown[]) => createRequestMock(...args),
  NeteaseRequestError: class extends Error {
    response: unknown;
    constructor(response: unknown) {
      super('netease error');
      this.name = 'NeteaseRequestError';
      this.response = response;
    }
  }
}));

vi.mock('../../../../src/main/netease/modules', () => ({
  modules: {
    login_qr_key: vi.fn(),
    song_url_v1: vi.fn(),
    register_anonimous: vi.fn(),
    login_status: vi.fn()
  }
}));

vi.mock('../../../../src/main/netease/session', () => ({
  readNeteaseSessionCookies: vi.fn(),
  patchNeteaseSession: vi.fn()
}));

vi.mock('../../../../src/main/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { modules } from '../../../../src/main/netease/modules';
import { patchNeteaseSession, readNeteaseSessionCookies } from '../../../../src/main/netease/session';

const ok = (body: Record<string, unknown> = {}, cookie: string[] = []) => ({
  status: 200,
  body: { code: 200, ...body },
  cookie
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readNeteaseSessionCookies).mockResolvedValue({ MUSIC_U: 'session-uv' });
});

describe('callNetease', () => {
  test('routes by module name and injects the stored session cookie', async () => {
    vi.mocked(modules.song_url_v1!).mockResolvedValue(ok({ data: [] }));

    await callNetease('song_url_v1', { id: 1, level: 'lossless' });

    expect(modules.song_url_v1).toHaveBeenCalledTimes(1);
    const [query] = vi.mocked(modules.song_url_v1!).mock.calls[0];
    expect(query).toMatchObject({ id: 1, level: 'lossless', cookie: { MUSIC_U: 'session-uv' } });
  });

  test('an explicit cookie overrides the stored session (passed through as-is)', async () => {
    vi.mocked(modules.song_url_v1!).mockResolvedValue(ok());

    await callNetease('song_url_v1', { id: 1 }, { cookie: 'MUSIC_U=explicit' });

    const [query] = vi.mocked(modules.song_url_v1!).mock.calls[0];
    expect(query.cookie).toBe('MUSIC_U=explicit');
  });

  test('logged out: no cookie is injected (the request layer applies the guest identity)', async () => {
    vi.mocked(readNeteaseSessionCookies).mockResolvedValue(undefined);
    vi.mocked(modules.song_url_v1!).mockResolvedValue(ok());

    await callNetease('song_url_v1', { id: 1 });

    const [query] = vi.mocked(modules.song_url_v1!).mock.calls[0];
    expect(query.cookie).toBeUndefined();
  });

  test('persists set-cookie patches from session-mutating endpoints', async () => {
    vi.mocked(modules.login_status!).mockResolvedValue(
      ok({ profile: { nickname: 'n' } }, ['MUSIC_U=renewed; Path=/', '__csrf=fresh; Path=/'])
    );

    await callNetease('login_status', {});

    expect(patchNeteaseSession).toHaveBeenCalledWith(['MUSIC_U=renewed; Path=/', '__csrf=fresh; Path=/']);
  });

  test('does not persist set-cookie from plain catalog endpoints', async () => {
    vi.mocked(modules.song_url_v1!).mockResolvedValue(ok({}, ['MUSIC_U=ignored']));

    await callNetease('song_url_v1', { id: 1 });

    expect(patchNeteaseSession).not.toHaveBeenCalled();
  });

  test('maps NeteaseRequestError business codes onto NeteaseApiError', async () => {
    const requestError = Object.assign(new Error('netease 301'), {
      name: 'NeteaseRequestError',
      response: { status: 200, body: { code: 301 } }
    });
    vi.mocked(modules.login_qr_key!).mockRejectedValue(requestError);

    const error = await callNetease('login_qr_key', {}).catch((e) => e);
    expect(error).toBeInstanceOf(NeteaseApiError);
    expect((error as NeteaseApiError).code).toBe(301);
    expect(isNeteaseAuthError(error)).toBe(true);
  });

  test('unknown transport failures become NETEASE_NETWORK_ERROR', async () => {
    vi.mocked(modules.song_url_v1!).mockRejectedValue(new TypeError('fetch failed'));

    const error = await callNetease('song_url_v1', {}).catch((e) => e);
    expect((error as NeteaseApiError).message).toBe('NETEASE_NETWORK_ERROR');
  });

  test('unknown module names throw', async () => {
    await expect(callNetease('no_such_module', {})).rejects.toThrow('Unknown Netease API call');
  });
});

describe('callNeteaseForBody', () => {
  test('returns the body on success', async () => {
    vi.mocked(modules.song_url_v1!).mockResolvedValue(ok({ data: [{ url: 'https://x' }] }));

    const body = await callNeteaseForBody('song_url_v1', { id: 1 });
    expect(body.data).toEqual([{ url: 'https://x' }]);
  });

  test('throws NeteaseApiError with the business code on failures', async () => {
    vi.mocked(modules.song_url_v1!).mockResolvedValue(ok({ code: -460 }));

    await expect(callNeteaseForBody('song_url_v1', { id: 1 })).rejects.toMatchObject({ code: -460 });
  });
});
