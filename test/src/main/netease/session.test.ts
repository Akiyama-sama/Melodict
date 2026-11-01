import { beforeEach, describe, expect, test, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn()
}));

vi.mock('electron', async (importOriginal) => {
  const actual = await importOriginal<typeof import('electron')>();
  return {
    ...actual,
    app: { ...actual.app, getPath: vi.fn(() => '/mock/user/data') },
    safeStorage: { isEncryptionAvailable: vi.fn(() => false) }
  };
});

vi.mock('fs/promises', () => ({ default: fsMock }));

vi.mock('../../../../src/main/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('../../../../src/main/netease/core/xeapi', () => ({ resetXeapiKey: vi.fn() }));

import {
  clearNeteaseSession,
  patchNeteaseSession,
  readNeteaseSession,
  readNeteaseSessionCookies,
  writeNeteaseSession
} from '../../../../src/main/netease/session';

const storedFile = (cookies: Record<string, string>, profile?: unknown) =>
  JSON.stringify({ version: 2, cookiesPlain: cookies, profile });

beforeEach(() => {
  vi.clearAllMocks();
  fsMock.mkdir.mockResolvedValue(undefined);
  fsMock.rename.mockResolvedValue(undefined);
  fsMock.rm.mockResolvedValue(undefined);
});

describe('readNeteaseSession', () => {
  test('returns undefined when no session file exists', async () => {
    fsMock.readFile.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));

    expect(await readNeteaseSession()).toBeUndefined();
  });

  test('returns undefined when the map has no MUSIC_U (logged out / guest only)', async () => {
    fsMock.readFile.mockResolvedValue(storedFile({ MUSIC_A: 'anon', deviceId: 'D' }));

    expect(await readNeteaseSession()).toBeUndefined();
    // ...but the cookie map reader still exposes the guest state.
    expect(await readNeteaseSessionCookies()).toEqual({ MUSIC_A: 'anon', deviceId: 'D' });
  });

  test('returns the full cookie map + profile for a logged-in session', async () => {
    const cookies = { MUSIC_U: 'uv', deviceId: 'D'.repeat(52), __csrf: 'tok' };
    fsMock.readFile.mockResolvedValue(storedFile(cookies, { userId: 7, nickname: 'n' }));

    const session = await readNeteaseSession();
    expect(session?.cookies).toEqual(cookies);
    expect(session?.profile).toEqual({ userId: 7, nickname: 'n' });
  });
});

describe('writeNeteaseSession', () => {
  test('merges a cookie string into the existing map', async () => {
    fsMock.readFile.mockResolvedValue(storedFile({ deviceId: 'D'.repeat(52) }));

    await writeNeteaseSession('MUSIC_U=new; __csrf=t');

    const [, written] = fsMock.writeFile.mock.calls[0];
    const state = JSON.parse(written);
    expect(state.version).toBe(2);
    expect(state.cookiesPlain).toMatchObject({
      deviceId: 'D'.repeat(52),
      MUSIC_U: 'new',
      __csrf: 't'
    });
  });

  test('merges a cookie map and keeps the existing profile', async () => {
    fsMock.readFile.mockResolvedValue(
      storedFile({ MUSIC_U: 'old' }, { userId: 1, nickname: 'x', avatarUrl: '', vipType: 0 })
    );

    await writeNeteaseSession({ MUSIC_U: 'renewed' });

    const [, written] = fsMock.writeFile.mock.calls[0];
    const state = JSON.parse(written);
    expect(state.cookiesPlain.MUSIC_U).toBe('renewed');
    expect(state.profile.userId).toBe(1);
  });
});

describe('patchNeteaseSession', () => {
  test('merges parsed set-cookie lines into the stored session', async () => {
    fsMock.readFile.mockResolvedValue(storedFile({ MUSIC_U: 'old', deviceId: 'D' }));

    await patchNeteaseSession(['MUSIC_U=fresh; Path=/; Domain=music.163.com', 'NMTID=00Ox; Path=/']);

    const [, written] = fsMock.writeFile.mock.calls[0];
    const state = JSON.parse(written);
    expect(state.cookiesPlain).toMatchObject({ MUSIC_U: 'fresh', deviceId: 'D', NMTID: '00Ox' });
  });

  test('is a no-op when the patch is empty', async () => {
    fsMock.readFile.mockResolvedValue(storedFile({ MUSIC_U: 'old' }));

    await patchNeteaseSession([]);

    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });
});

describe('clearNeteaseSession', () => {
  test('removes the session file', async () => {
    await clearNeteaseSession();
    expect(fsMock.rm).toHaveBeenCalledWith('/mock/user/data/netease-session.json', { force: true });
  });
});
