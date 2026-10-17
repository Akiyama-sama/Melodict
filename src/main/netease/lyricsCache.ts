import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import logger from '../logger';

/**
 * Disk cache for fetched NetEase lyrics. NetEase songs have no local library row to store lyrics
 * in, and `lyric_new` is a network round-trip per open — this keeps lyrics (with their merged
 * translations) readable offline and instantly on every later open.
 *
 * It composes with the lyrics-analysis cache: the analysis artifact is keyed by a hash of the
 * lyric lines themselves, so lyrics restored from this cache hit the same analysis fingerprint as
 * a fresh fetch would. Audio is deliberately not cached (streamed CDN URLs expire in ~20 minutes).
 */

export const NETEASE_LYRICS_CACHE_VERSION = 1;
const NETEASE_LYRICS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface NeteaseLyricsCacheEntry {
  version: number;
  neteaseId: number;
  fetchedAt: number;
  lyrics: SongLyrics;
}

const getCacheDir = () => path.join(app.getPath('userData'), 'netease-lyrics-cache');

const getEntryPath = (neteaseId: number) => path.join(getCacheDir(), `${neteaseId}.json`);

export const readNeteaseLyricsCache = async (
  neteaseId: number
): Promise<SongLyrics | undefined> => {
  try {
    const raw = await fs.readFile(getEntryPath(neteaseId), 'utf-8');
    const entry = JSON.parse(raw) as NeteaseLyricsCacheEntry;

    if (
      entry?.version !== NETEASE_LYRICS_CACHE_VERSION ||
      entry.neteaseId !== neteaseId ||
      !entry.lyrics?.lyrics
    )
      return undefined;

    if (Date.now() - entry.fetchedAt > NETEASE_LYRICS_CACHE_TTL_MS) return undefined;

    return entry.lyrics;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      logger.warn('Failed to read the NetEase lyrics cache entry.', { error, neteaseId });
    return undefined;
  }
};

export const writeNeteaseLyricsCache = async (
  neteaseId: number,
  lyrics: SongLyrics
): Promise<void> => {
  const entryPath = getEntryPath(neteaseId);
  const tempPath = `${entryPath}.tmp`;

  try {
    await fs.mkdir(getCacheDir(), { recursive: true });
    await fs.writeFile(
      tempPath,
      JSON.stringify({
        version: NETEASE_LYRICS_CACHE_VERSION,
        neteaseId,
        fetchedAt: Date.now(),
        lyrics
      }),
      'utf-8'
    );
    await fs.rename(tempPath, entryPath);
  } catch (error) {
    logger.warn('Failed to write the NetEase lyrics cache entry.', { error, neteaseId });
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
};
