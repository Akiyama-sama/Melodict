import { buildNeteaseSongPath, type NeteaseQualityTypes } from '@common/netease';

import storage from '../utils/localStorage';

/** The localStorage-backed stream quality preference for NetEase playback. */
export const getNeteaseSongQuality = (): NeteaseQualityTypes => {
  const quality = storage.preferences.getPreferences('neteaseSongQuality');
  return quality === 'exhigh' || quality === 'lossless' ? quality : 'standard';
};

/**
 * Resolves a NetEase song summary into the same shape as a library `getSong` result so the regular
 * player pipeline (store, seekbar, lyrics, queue) treats it unchanged. The `path` streams through
 * the `nora://` protocol proxy, which resolves the CDN URL fresh on every request.
 */
export const buildNeteasePlayerSongData = async (
  neteaseId: number
): Promise<AudioPlayerData> => {
  const summary = await window.api.neteaseControls.getSongSummary(neteaseId);

  if (!summary) {
    throw new Error(`NetEase song ${neteaseId} could not be resolved.`);
  }

  const songData: AudioPlayerData = {
    songId: summary.songId,
    title: summary.title,
    artists: summary.artists.map((artist) => ({ artistId: artist.artistId, name: artist.name })),
    duration: summary.duration,
    artworkPath: summary.cover || undefined,
    path: buildNeteaseSongPath(neteaseId, getNeteaseSongQuality()),
    isAFavorite: false,
    album: summary.album,
    isKnownSource: false,
    isBlacklisted: false
  };

  return songData;
};
