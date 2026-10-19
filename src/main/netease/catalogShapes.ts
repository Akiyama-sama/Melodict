/**
 * Raw NetEase API response shapes. These describe the JSON bodies returned by the NCM web API
 * endpoints (`song_detail`, `playlist_detail`, `album`, `artists`, `cloudsearch`,
 * `song_url_v1`, ...) before normalization; the app-facing summaries are produced in
 * `catalog.ts`. Field names intentionally mirror the upstream payloads (e.g. `dt`, `al`, `ar`).
 */

export interface NeteaseArtistLike {
  id?: number;
  name?: string;
}

export interface NeteaseSongLike {
  id?: number;
  name?: string;
  duration?: number;
  /** `song_detail` (v3 payload) reports the duration in milliseconds as `dt`. */
  dt?: number;
  fee?: number;
  /** First element of freeTrialInfo marks a trial fragment (its play duration in ms). */
  freeTrialInfo?: { start?: number; end?: number } | unknown[] | null;
  artists?: NeteaseArtistLike[];
  artist?: NeteaseArtistLike | null;
  ar?: NeteaseArtistLike | null;
  album?: NeteaseAlbumLike | null;
  al?: NeteaseAlbumLike | null;
  picUrl?: string;
  alia?: string[];
}

export interface NeteaseAlbumLike {
  id?: number;
  name?: string;
  picUrl?: string;
  coverImgUrl?: string;
  artist?: NeteaseArtistLike | null;
  artists?: NeteaseArtistLike[];
  size?: number;
  publishTime?: number;
  company?: string;
  description?: string;
}

export interface NeteasePlaylistLike {
  id?: number;
  name?: string;
  coverImgUrl?: string;
  /** `personalized` entries carry `picUrl` instead of `coverImgUrl`. */
  picUrl?: string;
  trackCount?: number;
  userId?: number;
  creator?: NeteaseArtistLike | null;
  description?: string;
  playCount?: number;
}

export interface NeteaseArtistEntryLike {
  id?: number;
  name?: string;
  img1v1Url?: string;
  picUrl?: string;
  alias?: string[];
  albumSize?: number;
  musicSize?: number;
  accountId?: number;
}
