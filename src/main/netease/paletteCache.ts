import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import generatePalette from '../other/generatePalette';
import logger from '../logger';

/**
 * Disk cache for NetEase cover palettes. NetEase songs stream from the CDN and have no library
 * artwork row for `generatePalettes` to fill, so their dynamic theme (and the lyrics token
 * colours that derive from it) would otherwise always fall back to the default blue palette.
 *
 * Mirrors `netease/lyricsCache.ts`: versioned JSON files under `userData`, TTL-based expiry, and
 * failures degrade to `undefined` so playback never waits on or fails because of a palette.
 */
export const NETEASE_PALETTE_CACHE_VERSION = 1;
const NETEASE_PALETTE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface NeteasePaletteCacheEntry {
  version: number;
  neteaseId: number;
  fetchedAt: number;
  palette: PaletteData;
}

const getCacheDir = () => path.join(app.getPath('userData'), 'netease-palette-cache');

const getEntryPath = (neteaseId: number) => path.join(getCacheDir(), `${neteaseId}.json`);

export const readNeteasePaletteCache = async (
  neteaseId: number
): Promise<PaletteData | undefined> => {
  try {
    const raw = await fs.readFile(getEntryPath(neteaseId), 'utf-8');
    const entry = JSON.parse(raw) as NeteasePaletteCacheEntry;

    if (
      entry?.version !== NETEASE_PALETTE_CACHE_VERSION ||
      entry.neteaseId !== neteaseId ||
      !entry.palette?.paletteId
    )
      return undefined;

    if (Date.now() - entry.fetchedAt > NETEASE_PALETTE_CACHE_TTL_MS) return undefined;

    return entry.palette;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      logger.warn('Failed to read the NetEase palette cache entry.', { error, neteaseId });
    return undefined;
  }
};

export const writeNeteasePaletteCache = async (
  neteaseId: number,
  palette: PaletteData
): Promise<void> => {
  const entryPath = getEntryPath(neteaseId);
  const tempPath = `${entryPath}.tmp`;

  try {
    await fs.mkdir(getCacheDir(), { recursive: true });
    await fs.writeFile(
      tempPath,
      JSON.stringify({
        version: NETEASE_PALETTE_CACHE_VERSION,
        neteaseId,
        fetchedAt: Date.now(),
        palette
      }),
      'utf-8'
    );
    await fs.rename(tempPath, entryPath);
  } catch (error) {
    logger.warn('Failed to write the NetEase palette cache entry.', { error, neteaseId });
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
};

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
