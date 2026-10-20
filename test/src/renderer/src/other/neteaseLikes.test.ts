import { describe, expect, test, vi, beforeEach } from 'vitest';

const likeUnlikeSong = vi.fn();

vi.mock('../../../../../src/renderer/src/index', () => ({
  queryClient: {
    fetchQuery: vi.fn(async () => [101, 205]),
    invalidateQueries: vi.fn()
  }
}));

vi.mock('../../../../../src/renderer/src/i18n', () => ({
  default: { t: (key: string, opts?: Record<string, unknown>) => `${key}:${opts?.title ?? ''}` }
}));

vi.mock('../../../../../src/renderer/src/queries/netease', () => ({
  neteaseQuery: {
    session: { queryKey: null },
    likedSongIds: (userId: number) => ({ queryKey: [`${userId}`] }),
    likedSongs: (userId: number) => ({ queryKey: [`${userId}`] })
  }
}));

(globalThis as { window?: unknown }).window = {
  api: { neteaseControls: { likeUnlikeSong } }
};

import {
  ensureNeteaseLikes,
  getNeteaseLikeNotification,
  isNeteaseSongLiked,
  resetNeteaseLikes,
  setNeteaseSongLiked
} from '../../../../../src/renderer/src/other/neteaseLikes';

// NetEase ids encode into the negative songId space: 101 -> -102, 205 -> -206.
describe('neteaseLikes', () => {
  beforeEach(() => {
    resetNeteaseLikes();
    likeUnlikeSong.mockReset();
    likeUnlikeSong.mockResolvedValue(true);
  });

  test('consults the liked-ids cache for a song in the encoded id space', async () => {
    await ensureNeteaseLikes(1);
    expect(isNeteaseSongLiked(-102)).toBe(true);
    expect(isNeteaseSongLiked(-206)).toBe(true);
    expect(isNeteaseSongLiked(-999)).toBe(false);
  });

  test('ignores local library song ids (positive space)', async () => {
    await ensureNeteaseLikes(1);
    expect(isNeteaseSongLiked(101)).toBe(false);
  });

  test('reports nothing liked before the cache is loaded', () => {
    expect(isNeteaseSongLiked(-102)).toBe(false);
  });

  test('optimistically adds and removes through the API', async () => {
    await ensureNeteaseLikes(1);
    await expect(setNeteaseSongLiked(-999, true)).resolves.toBe(true);
    expect(isNeteaseSongLiked(-999)).toBe(true);

    await expect(setNeteaseSongLiked(-102, false)).resolves.toBe(false);
    expect(isNeteaseSongLiked(-102)).toBe(false);
  });

  test('rolls the cache back when the API rejects', async () => {
    await ensureNeteaseLikes(1);
    likeUnlikeSong.mockRejectedValueOnce(new Error('network down'));

    await expect(setNeteaseSongLiked(-999, true)).rejects.toThrow();
    expect(isNeteaseSongLiked(-999)).toBe(false);

    // A liked song stays liked when the unlike call fails.
    likeUnlikeSong.mockRejectedValueOnce(new Error('network down'));
    await expect(setNeteaseSongLiked(-102, false)).rejects.toThrow();
    expect(isNeteaseSongLiked(-102)).toBe(true);
  });

  test('refuses to toggle when nobody is logged in', async () => {
    await expect(setNeteaseSongLiked(-102, true)).rejects.toThrow('not logged in');
    expect(likeUnlikeSong).not.toHaveBeenCalled();
  });

  test('is a no-op when the requested state already matches', async () => {
    await ensureNeteaseLikes(1);
    await expect(setNeteaseSongLiked(-102, true)).resolves.toBe(true);
    expect(likeUnlikeSong).not.toHaveBeenCalled();
  });

  test('builds localized success and failure notifications', () => {
    expect(getNeteaseLikeNotification('Song', true)).toMatchObject({
      id: 'neteaseLike-Song',
      content: 'netease.addedToNeteaseLikes:Song',
      iconName: 'favorite'
    });
    expect(getNeteaseLikeNotification('Song', false)).toMatchObject({
      iconName: 'favorite_border'
    });
    expect(getNeteaseLikeNotification('Song', true, true)).toMatchObject({
      id: 'neteaseLikeError-Song',
      content: 'song.toggleLikeFailed:',
      iconName: 'error'
    });
  });
});
