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

/** Whether the user opted into playing 30 s trial fragments of VIP songs (default: off). */
export const getAllowNeteaseTrialPlay = (): boolean =>
  storage.preferences.getPreferences('allowNeteaseTrialPlay') === true;

/** Why a NetEase song could not be played as requested; drives the notification copy. */
export type NeteasePlaybackBlockReason =
  | 'NETEASE_VIP_REQUIRED'
  | 'NETEASE_TRIAL_DISABLED'
  | 'NETEASE_STREAM_UNAVAILABLE';

/** A typed playback block so callers can surface the real reason instead of a generic one. */
export class NeteasePlaybackBlockedError extends Error {
  reason: NeteasePlaybackBlockReason;

  constructor(reason: NeteasePlaybackBlockReason) {
    super(reason);
    this.name = 'NeteasePlaybackBlockedError';
    this.reason = reason;
  }
}

/** Narrowing guard for the typed NetEase playback blocks. */
export const isNeteasePlaybackBlockedError = (error: unknown): error is NeteasePlaybackBlockedError =>
  error instanceof NeteasePlaybackBlockedError;

/**
 * Builds the corner notification for a blocked NetEase song. Copy comes from the shared
 * `netease.playbackBlocked.<reason>` keys so the settings page and this notification stay in sync.
 * `t` is typed loosely: i18next's strict `TFunction` key union resists a dynamic template key.
 */
export const getNeteaseBlockNotification = (
  error: NeteasePlaybackBlockedError,
  t: (key: string, ...args: unknown[]) => string
): AppNotification => ({
  id: `netease-block-${error.reason}`,
  duration: 8000,
  content: t(`netease.playbackBlocked.${error.reason}`),
  iconName: 'error_outline',
  iconClassName: 'material-icons-round-outlined'
});

type NeteaseBlockNotifier = (error: NeteasePlaybackBlockedError) => void;

let neteaseBlockNotifier: NeteaseBlockNotifier | null = null;

/**
 * Registers the sink for blocked-playback notifications. Non-React code paths (the queue's
 * auto-advance in `player.ts`) raise blocks too, where hooks are unreachable — the app root hands
 * over the notification panel's add function once, mirroring `registerNeteaseLikeNotifier`.
 */
export const registerNeteaseBlockNotifier = (notifier: NeteaseBlockNotifier): void => {
  neteaseBlockNotifier = notifier;
};

/** Raises the corner notification for a blocked song; a no-op before the app root registers. */
export const notifyNeteaseBlock = (error: NeteasePlaybackBlockedError): void => {
  neteaseBlockNotifier?.(error);
};

/**
 * Probes the stream resolution before the audio element ever gets a source, so blocked songs
 * surface as typed errors instead of a bare 404 mid-playback. The requested quality is passed
 * through unchanged — this only classifies playability, it never adjusts the tier.
 *
 * @returns The stream path to hand the player, carrying an inert trial marker when applicable.
 * @throws NeteasePlaybackBlockedError when the song cannot play under the current preferences.
 */
export const resolveNeteaseStreamPath = async (
  neteaseId: number,
  quality: NeteaseQualityTypes
): Promise<string> => {
  const streamInfo = await window.api.neteaseControls.getStream(neteaseId, quality);

  if (!streamInfo || !streamInfo.playable) {
    throw new NeteasePlaybackBlockedError(
      streamInfo?.vipRequired ? 'NETEASE_VIP_REQUIRED' : 'NETEASE_STREAM_UNAVAILABLE'
    );
  }

  if (streamInfo.hasTrial && !getAllowNeteaseTrialPlay()) {
    // Trials are opt-in: the default is a hard block with a pointer at the setting, mirroring
    // how other open-source players keep paywalled fragments off unless asked for.
    throw new NeteasePlaybackBlockedError('NETEASE_TRIAL_DISABLED');
  }

  const path = buildNeteaseSongPath(neteaseId, quality);
  // An inert display marker: the player bar reads it to badge trial fragments; the protocol
  // handler only reads `level` and ignores the rest.
  return streamInfo.hasTrial ? `${path}&trial=1` : path;
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

  const requestedQuality = getNeteaseSongQuality();
  // The probe is the single gate: it upgrades the path's quality when the ladder fell back and
  // throws typed errors for VIP paywalls / disabled trials before the audio element loads.
  const streamPath = await resolveNeteaseStreamPath(
    summary.neteaseSongId,
    requestedQuality
  );

  const songData: AudioPlayerData = {
    songId: summary.songId,
    title: summary.title,
    artists: summary.artists.map((artist) => ({ artistId: artist.artistId, name: artist.name })),
    duration: summary.duration,
    artworkPath: summary.cover || undefined,
    path: streamPath,
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
