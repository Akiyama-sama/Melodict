import { buildNeteaseSongPath, type NeteaseQualityTypes, type NeteaseSongSummary } from '@common/netease';

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
        typeof neteaseIdOrSummary === 'number' ? neteaseIdOrSummary : neteaseIdOrSummary.neteaseSongId
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
    isAFavorite: false,
    album: summary.album,
    isKnownSource: false,
    isBlacklisted: false
  };

  return songData;
};
