import { createJsonEntryCache } from './jsonEntryCache';

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

const cache = createJsonEntryCache<SongLyrics>({
  dirName: 'netease-lyrics-cache',
  version: NETEASE_LYRICS_CACHE_VERSION,
  payloadKey: 'lyrics',
  isValidPayload: (payload) => Boolean((payload as SongLyrics | undefined)?.lyrics),
  label: 'NetEase lyrics',
  ttlMs: NETEASE_LYRICS_CACHE_TTL_MS
});

export const readNeteaseLyricsCache = (neteaseId: number): Promise<SongLyrics | undefined> =>
  cache.read(neteaseId);

export const writeNeteaseLyricsCache = (neteaseId: number, lyrics: SongLyrics): Promise<void> =>
  cache.write(neteaseId, lyrics);
