import { expect, test, vi } from 'vitest';

vi.mock('electron', async (importOriginal) => {
  const actual = await importOriginal<typeof import('electron')>();
  return { ...actual, app: { ...actual.app, getPath: vi.fn(() => '/tmp/knote-smoke-final') }, safeStorage: { isEncryptionAvailable: vi.fn(() => false) } };
});
vi.mock('@main/logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/main', () => ({ dataUpdateEvent: vi.fn() }));

import { startNeteaseQrLogin, checkNeteaseQrLogin } from '../../src/main/netease/auth';
import { ensureNeteaseAnonymousSession } from '../../src/main/netease/anonymousSession';
import { getAnonymousToken } from '../../src/main/netease/core/device';
import { callNeteaseForBody } from '../../src/main/netease/client';
import { readNeteaseSessionCookies } from '../../src/main/netease/session';

test('smoke: QR key + poll returns waiting (real network)', { timeout: 30000 }, async () => {
  const { key, qrImgUrl } = await startNeteaseQrLogin();
  expect(key).toMatch(/^[0-9a-f-]{20,}$/i);
  expect(qrImgUrl).toContain('data:image/png');
  const poll = await checkNeteaseQrLogin(key);
  console.log('poll state:', poll.state);
  expect(['waiting', 'scanned', 'error']).toContain(poll.state);
});

test('smoke: guest bootstrap persists MUSIC_A + deviceId (real network)', { timeout: 30000 }, async () => {
  await ensureNeteaseAnonymousSession();
  const cookies = await readNeteaseSessionCookies();
  expect(cookies?.MUSIC_A).toBeTruthy();
  expect(cookies?.deviceId).toMatch(/^[0-9A-F]{52}$/);
  expect(getAnonymousToken()).toBe(cookies?.MUSIC_A);
  console.log('guest identity persisted OK');
});

test('smoke: anonymous catalog + eapi search/stream (guest, real network)', { timeout: 30000 }, async () => {
  const personalized = await callNeteaseForBody('personalized', { limit: 3 });
  expect(personalized.code).toBe(200);

  const search = await callNeteaseForBody('cloudsearch', { keywords: 'yorushika', type: 1, limit: 3 });
  expect(search.code).toBe(200);
  const first = ((search.result as { songs?: { id: number }[] }).songs ?? [])[0];
  expect(first?.id).toBeGreaterThan(0);

  const url = await callNeteaseForBody('song_url_v1', { id: first.id, level: 'standard' });
  const data = (url.data as { url?: string }[] | undefined)?.[0];
  console.log('stream url ok:', Boolean(data?.url));
  expect(url.code).toBe(200);
});
