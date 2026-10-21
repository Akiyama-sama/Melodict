import { beforeEach, describe, expect, test, vi } from 'vitest';

import { getNeteaseStream } from '../../../../src/main/netease/catalog';
import { NeteaseApiError, callNeteaseForBody } from '../../../../src/main/netease/client';

vi.mock('../../../../src/main/netease/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/main/netease/client')>();
  return {
    ...actual,
    callNeteaseForBody: vi.fn(),
    isNeteaseAuthError: vi.fn(() => false)
  };
});

vi.mock('../../../../src/main/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

const mockBody = (data: Record<string, unknown> | undefined) =>
  vi.mocked(callNeteaseForBody).mockResolvedValueOnce(data === undefined ? {} : { data: [data] });

/** A full-lossless reply as `song_url_v1` would answer a VIP account. */
const streamData = (overrides: Record<string, unknown> = {}) => ({
  url: 'https://m704.music.126.net/object/full.flac',
  br: 999000,
  size: 31457280,
  fee: 0,
  freeTrialInfo: null,
  type: 'flac',
  ...overrides
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getNeteaseStream', () => {
  test('passes the requested level through as-is', async () => {
    mockBody(streamData({ type: 'mp3' }));

    const info = await getNeteaseStream(1, 'standard');

    expect(callNeteaseForBody).toHaveBeenCalledTimes(1);
    expect(callNeteaseForBody).toHaveBeenCalledWith('song_url_v1', { id: 1, level: 'standard' });
    expect(info?.playable).toBe(true);
    expect(info?.vipRequired).toBe(false);
  });

  test('does not fall back when the requested tier has no URL', async () => {
    // A free account asking for lossless gets no URL; there is no downgrade retry.
    mockBody(streamData({ url: '', fee: 8 }));

    const info = await getNeteaseStream(2, 'lossless');

    expect(callNeteaseForBody).toHaveBeenCalledTimes(1);
    expect(info?.playable).toBe(false);
    expect(info?.vipRequired).toBe(false);
  });

  test('reports vipRequired when the miss is a fee 1/4 song', async () => {
    mockBody(streamData({ url: '', fee: 1, freeTrialInfo: null }));

    const info = await getNeteaseStream(3, 'standard');

    expect(info?.playable).toBe(false);
    expect(info?.vipRequired).toBe(true);
    expect(info?.hasTrial).toBe(false);
  });

  test('flags trial fragments from freeTrialInfo', async () => {
    mockBody(
      streamData({
        url: 'https://m704.music.126.net/object/trial.mp3',
        fee: 1,
        freeTrialInfo: { start: 0, end: 30000 }
      })
    );

    const info = await getNeteaseStream(4, 'standard');

    expect(info?.playable).toBe(true);
    expect(info?.hasTrial).toBe(true);
    expect(info?.vipRequired).toBe(false);
  });

  test('propagates API errors instead of swallowing them', async () => {
    vi.mocked(callNeteaseForBody).mockRejectedValueOnce(
      new NeteaseApiError('NetEase request failed', 301)
    );

    await expect(getNeteaseStream(5, 'standard')).rejects.toBeInstanceOf(NeteaseApiError);
  });
});
