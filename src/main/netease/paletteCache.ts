import generatePalette from '../other/generatePalette';
import logger from '../logger';
import { createJsonEntryCache } from './jsonEntryCache';

/**
 * Disk cache for NetEase cover palettes. NetEase songs stream from the CDN and have no library
 * artwork row for `generatePalettes` to fill, so their dynamic theme (and the lyrics token
 * colours that derive from it) would otherwise always fall back to the default blue palette.
 *
 * Composes with the shared `createJsonEntryCache` (mirrors `netease/lyricsCache.ts`): versioned
 * JSON files under `userData`, TTL-based expiry, and failures degrade to `undefined` so playback
 * never waits on or fails because of a palette.
 */
export const NETEASE_PALETTE_CACHE_VERSION = 1;
const NETEASE_PALETTE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const cache = createJsonEntryCache<PaletteData>({
  dirName: 'netease-palette-cache',
  version: NETEASE_PALETTE_CACHE_VERSION,
  payloadKey: 'palette',
  isValidPayload: (payload) => Boolean((payload as PaletteData | undefined)?.paletteId),
  label: 'NetEase palette',
  ttlMs: NETEASE_PALETTE_CACHE_TTL_MS
});

export const readNeteasePaletteCache = (neteaseId: number): Promise<PaletteData | undefined> =>
  cache.read(neteaseId);

export const writeNeteasePaletteCache = (neteaseId: number, palette: PaletteData): Promise<void> =>
  cache.write(neteaseId, palette);

/**
 * Returns the song's cover palette, generating and caching it on first request. Covers are
 * remote CDN URLs; `generatePalette` accepts a URL string directly (it feeds node-vibrant).
 */
export const getNeteaseSongPalette = async (
  neteaseId: number,
  coverUrl: string | undefined
): Promise<PaletteData | undefined> => {
  if (!coverUrl) return undefined;

  const cached = await readNeteasePaletteCache(neteaseId);
  if (cached) return cached;

  try {
    const palette = await generatePalette(coverUrl);
    if (palette) await writeNeteasePaletteCache(neteaseId, palette);
    return palette;
  } catch (error) {
    logger.warn('Failed to generate a palette for a NetEase cover.', { error, neteaseId });
    return undefined;
  }
};
