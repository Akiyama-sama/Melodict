import {
  buildNeteaseSongPath,
  isNeteaseSongId,
  tryGetNeteaseIdFromPath,
  type NeteaseQualityTypes,
  type NeteaseSongSummary
} from '@common/netease';

import { isNeteaseSongLiked } from '../other/neteaseLikes';
import storage from '../utils/localStorage';

/** The localStorage-backed stream quality preference for NetEase playback. */
export const getNeteaseSongQuality = (): NeteaseQualityTypes => {
  const quality = storage.preferences.getPreferences('neteaseSongQuality');
  return quality === 'exhigh' || quality === 'lossless' ? quality : 'standard';
};

/**
 * Resolves a NetEase song into the same shape as a library `getSong` result so the regular player
 * pipeline (store, seekbar, lyrics, queue) treats it unchanged. The `path` streams through the
 * `nora://` protocol proxy, which resolves the CDN URL fresh on every request.
 *
 * Accepts either the NetEase id (resolves the summary over IPC first) or an already-fetched
 * summary, so list rows avoid the extra round-trip.
 */
export const buildNeteasePlayerSongData = async (
  neteaseIdOrSummary: number | NeteaseSongSummary
): Promise<AudioPlayerData> => {
  const summary =
    typeof neteaseIdOrSummary === 'number'
      ? await window.api.neteaseControls.getSongSummary(neteaseIdOrSummary)
      : neteaseIdOrSummary;

  if (!summary) {
    throw new Error(
      `NetEase song ${
        typeof neteaseIdOrSummary === 'number'
          ? neteaseIdOrSummary
          : neteaseIdOrSummary.neteaseSongId
      } could not be resolved.`
    );
  }

  const songData: AudioPlayerData = {
    songId: summary.songId,
    title: summary.title,
    artists: summary.artists.map((artist) => ({ artistId: artist.artistId, name: artist.name })),
    duration: summary.duration,
    artworkPath: summary.cover || undefined,
    path: buildNeteaseSongPath(summary.neteaseSongId, getNeteaseSongQuality()),
    // Consulted against the warm likes cache; if it has not loaded yet the session effect in
    // `usePlaybackSettings` corrects the heart once it lands.
    isAFavorite: isNeteaseSongId(summary.songId) && isNeteaseSongLiked(summary.songId),
    album: summary.album,
    isKnownSource: false,
    isBlacklisted: false
  };

  return songData;
};

/**
 * Fills in `paletteData` for NetEase songs after playback has started. Local songs carry their
 * artwork palette in the library DB, but NetEase covers are remote and their palettes live in the
 * main-process disk cache instead — resolving one is a network round-trip on first play, so it must
 * never block `buildNeteasePlayerSongData`.
 *
 * Resolves to `undefined` when the song is not a NetEase stream (nothing to fill) or the palette
 * could not be produced; callers dispatch the result into the store when it resolves.
 */
export const resolveNeteaseSongPalette = async (
  songData: AudioPlayerData
): Promise<PaletteData | undefined> => {
  const neteaseId = tryGetNeteaseIdFromPath(songData.path);
  if (neteaseId === null) return undefined;

  return window.api.neteaseControls.getSongPalette(neteaseId, songData.artworkPath);
};
