// Shared NetEase Cloud Music integration contracts. Keep this module free of Electron/main-only
// imports so that both the main process and the renderer can use it.

export const NETEASE_SCHEME = 'nora';
export const NETEASE_PROTOCOL_HOST = 'netease';
export const NETEASE_SONG_PATH_PREFIX = `${NETEASE_PROTOCOL_HOST}://netease/song/`;

/** Audio quality levels exposed to the user; mapped 1:1 to NCM `song_url_v1.level`. */
export type NeteaseQualityTypes = 'standard' | 'exhigh' | 'lossless';

/**
 * Sentinel mapping between NetEase song ids and the app's local DB song id space. Local ids are
 * positive integers (DB serial), so online songs borrow the negative space: a NetEase song id `n`
 * (n >= 1) becomes `-(n + 1)`, which never collides and round-trips losslessly.
 *
 * `tryDecodeNeteaseSongId(0)` is `null` by design — the sentinel space cannot represent 0.
 */
export const encodeNeteaseSongId = (neteaseId: number): number => -(neteaseId + 1);

export const tryDecodeNeteaseSongId = (songId: number): number | null =>
  Number.isFinite(songId) && songId < 0 ? -(songId + 1) : null;

export const isNeteaseSongId = (songId: number): boolean => songId < 0;

/** Playable path used by the renderer player, proxied by the nora:// protocol handler. */
export const buildNeteaseSongPath = (neteaseId: number, quality: NeteaseQualityTypes): string =>
  `${NETEASE_SONG_PATH_PREFIX}${neteaseId}?level=${quality}`;

/**
 * Extracts a NetEase song id from a `nora://netease/song/<id>?...` path. Returns `null` for local
 * file paths, letting callers branch on a single object sentinel instead of extra flags.
 */
export const tryGetNeteaseIdFromPath = (protocolPath: string): number | null => {
  if (!protocolPath.startsWith(NETEASE_SONG_PATH_PREFIX)) return null;

  const rawPath = protocolPath.slice(NETEASE_SONG_PATH_PREFIX.length);
  const idSegment = rawPath.split('?')[0] ?? '';
  const neteaseId = Number.parseInt(idSegment, 10);

  return Number.isFinite(neteaseId) && neteaseId > 0 ? neteaseId : null;
};

export const getNeteaseQualityFromPath = (protocolPath: string): NeteaseQualityTypes => {
  try {
    const level = new URL(protocolPath).searchParams.get('level');
    if (level === 'exhigh' || level === 'lossless') return level;
  } catch {
    // NetEase paths are URL-shaped; an unparseable path falls through to the default.
  }
  return 'standard';
};

/** A song summary the renderer can display and play without the local library. */
export interface NeteaseSongSummary {
  /** Sentinel id safe for queues (negative space). */
  songId: number;
  neteaseSongId: number;
  title: string;
  artists: { artistId: number; name: string }[];
  album: { albumId: number; name: string } | undefined;
  /** Absolute CDN/cover URL; empty when the song has no cover. */
  cover: string;
  /** Duration in seconds. */
  duration: number;
  /** VIP-only song (fee 1 or 4 in NCM semantics). */
  isVip: boolean;
  /** A trial fragment is served when playing. */
  hasTrial: boolean;
  /** The song has an audible stream under the current quality or can fall back. */
  playable: boolean;
}

export interface NeteasePlaylistSummary {
  playlistId: string;
  name: string;
  coverImgUrl: string;
  /** Official track count reported by the platform. */
  trackCount: number;
  userId: number;
  nickname: string;
  /** Whether the logged-in user created this playlist. */
  isUserOwned: boolean;
  description?: string;
}

export interface NeteaseAlbumSummary {
  albumId: number;
  name: string;
  coverImgUrl: string;
  artistId: number;
  artistName: string;
  songCount: number;
  publishTime: number;
  company?: string;
  description?: string;
}

export interface NeteaseArtistSummary {
  artistId: number;
  name: string;
  cover: string;
  /** Small pictures / img1v2 urls array from NCM artist objects. */
  alias: string[];
  albumCount: number;
  songCount: number;
  isVip: boolean;
}

export type NeteaseSearchTypes = 1 | 10 | 100 | 1000;

export interface NeteaseSearchResult {
  songs: NeteaseSongSummary[];
  albums: NeteaseAlbumSummary[];
  artists: NeteaseArtistSummary[];
  playlists: NeteasePlaylistSummary[];
}

export const createEmptyNeteaseSearchResult = (): NeteaseSearchResult => ({
  songs: [],
  albums: [],
  artists: [],
  playlists: []
});

export interface NeteaseSessionProfile {
  userId: number;
  nickname: string;
  avatarUrl: string;
  vipType: number;
}

export type NeteaseLoginQrState = 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'error';

export interface NeteaseQrLoginStatus {
  state: NeteaseLoginQrState;
  qrImgUrl?: string;
  profile?: NeteaseSessionProfile;
}
