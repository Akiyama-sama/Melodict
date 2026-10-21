import type {
  NeteaseAlbumSummary,
  NeteaseArtistSummary,
  NeteasePlaylistSummary,
  NeteaseQualityTypes,
  NeteaseSearchTypes,
  NeteaseSongSummary
} from '../../common/netease';
import { encodeNeteaseSongId } from '../../common/netease';
import logger from '../logger';
import { callNeteaseForBody, isNeteaseAuthError } from './client';
import type {
  NeteaseAlbumLike,
  NeteaseArtistEntryLike,
  NeteaseArtistLike,
  NeteasePlaylistLike,
  NeteaseSongLike
} from './catalogShapes';

const isTrialInfo = (value: unknown): value is { start?: number; end?: number } =>
  Boolean(value && typeof value === 'object' && ('start' in (value as object) || 'end' in (value as object)));

export const normalizeNeteaseSongSummary = (song: NeteaseSongLike): NeteaseSongSummary => {
  const neteaseId = song.id ?? 0;
  const artistsSource = ([] as NeteaseArtistLike[]).concat(
    song.artists ?? song.ar ?? (song.artist ? [song.artist] : [])
  );
  const albumSource = song.album ?? song.al ?? undefined;

  return {
    songId: encodeNeteaseSongId(neteaseId),
    neteaseSongId: neteaseId,
    title: song.name ?? '',
    artists: artistsSource
      .filter(
        (artist): artist is { id: number; name: string } => Boolean(artist?.id && artist?.name)
      )
      .map((artist) => ({ artistId: artist.id, name: artist.name ?? '' })),
    album: albumSource ? { albumId: albumSource.id ?? 0, name: albumSource.name ?? '' } : undefined,
    cover: albumSource?.picUrl ?? song.picUrl ?? '',
    duration: ((song.dt ?? song.duration) ?? 0) / 1000,
    isVip: song.fee === 1 || song.fee === 4,
    hasTrial: isTrialInfo(song.freeTrialInfo),
    playable: true
  };
};

export const normalizeNeteasePlaylistSummary = (
  playlist: NeteasePlaylistLike
): NeteasePlaylistSummary => ({
  playlistId: `${playlist.id ?? 0}`,
  name: playlist.name ?? '',
  coverImgUrl: playlist.coverImgUrl ?? playlist.picUrl ?? '',
  trackCount: playlist.trackCount ?? 0,
  userId: playlist.userId ?? playlist.creator?.id ?? 0,
  nickname: playlist.creator?.name ?? '',
  isUserOwned: Boolean(playlist.creator?.id),
  description: playlist.description
});

export const normalizeNeteaseAlbumSummary = (
  album: NeteaseAlbumLike
): NeteaseAlbumSummary => ({
  albumId: album.id ?? 0,
  name: album.name ?? '',
  coverImgUrl: album.picUrl ?? album.coverImgUrl ?? '',
  artistId: (album.artist?.id ?? album.artists?.[0]?.id ?? 0) as number,
  artistName: (album.artist?.name ?? album.artists?.[0]?.name ?? '') as string,
  songCount: album.size ?? 0,
  publishTime: album.publishTime ?? 0,
  company: album.company,
  description: album.description
});

export const normalizeNeteaseArtistSummary = (
  artist: NeteaseArtistEntryLike
): NeteaseArtistSummary => ({
  artistId: artist.id ?? 0,
  name: artist.name ?? '',
  cover: artist.img1v1Url ?? artist.picUrl ?? '',
  alias: artist.alias ?? [],
  albumCount: artist.albumSize ?? 0,
  songCount: artist.musicSize ?? 0,
  isVip: Boolean(artist.accountId && artist.accountId > 0)
});

/** Catalog wrapper that translates auth failures into the renderer-facing error code. */
const callCatalog = async (
  name: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>> => {
  try {
    return await callNeteaseForBody(name, params);
  } catch (error) {
    if (isNeteaseAuthError(error)) {
      logger.warn(`NetEase ${name} requires a logged-in session.`);
      throw new Error('NETEASE_AUTH_REQUIRED');
    }
    throw error;
  }
};

const asSongSummaries = (value: unknown): NeteaseSongSummary[] =>
  Array.isArray(value)
    ? (value as NeteaseSongLike[]).map((song) => normalizeNeteaseSongSummary(song))
    : [];

export const getNeteaseSongSummary = async (
  neteaseId: number
): Promise<NeteaseSongSummary | undefined> => {
  // The NCM `song_detail` module does `ids.split(',')`, so the id must arrive as a string.
  const body = await callNeteaseForBody('song_detail', { ids: String(neteaseId) });
  const song = (Array.isArray(body.songs) ? body.songs[0] : undefined) as NeteaseSongLike | undefined;
  return song ? normalizeNeteaseSongSummary(song) : undefined;
};

/** Fetches summaries in batches of 500; playlist detail bodies only carry ~1000 inline tracks. */
export const getNeteaseSongSummaries = async (
  neteaseIds: number[]
): Promise<NeteaseSongSummary[]> => {
  const summaries: NeteaseSongSummary[] = [];
  const batchSize = 500;

  for (let index = 0; index < neteaseIds.length; index += batchSize) {
    const batch = neteaseIds.slice(index, index + batchSize).join(',');
    const body = await callNeteaseForBody('song_detail', { ids: batch });
    summaries.push(...asSongSummaries(body.songs));
  }

  return summaries;
};

/** Tracks as displayed by the app, queried per playlist id. */
export const getNeteasePlaylist = async (
  playlistId: string
): Promise<{ playlist: NeteasePlaylistSummary; songs: NeteaseSongSummary[] }> => {
  const body = await callNeteaseForBody('playlist_detail', {
    id: playlistId,
    n: 1000,
    s: 8
  });

  const playlistRaw = (body.playlist ?? {}) as NeteasePlaylistLike & {
    tracks?: unknown[];
    trackIds?: { id: number }[];
  };
  const playlist = normalizeNeteasePlaylistSummary(playlistRaw);

  const inlineSongs = asSongSummaries(playlistRaw.tracks ?? body.songs);
  const inlineIds = new Set(inlineSongs.map((song) => song.neteaseSongId));
  const missingIds = (playlistRaw.trackIds ?? [])
    .map((trackId) => trackId.id)
    .filter((id) => id > 0 && !inlineIds.has(id));

  const missingSongs = missingIds.length > 0 ? await getNeteaseSongSummaries(missingIds) : [];
  const summaries = [...inlineSongs, ...missingSongs];

  return { playlist, songs: summaries };
};

export const getNeteaseAlbum = async (albumId: string | number): Promise<{
  album: NeteaseAlbumSummary;
  songs: NeteaseSongSummary[];
}> => {
  const body = await callNeteaseForBody('album', { id: albumId });
  const album = normalizeNeteaseAlbumSummary((body.album ?? {}) as NeteaseAlbumLike);

  const songs = asSongSummaries(body.songs).map((song) => ({
    ...song,
    cover: song.cover || album.coverImgUrl
  }));

  return { album, songs };
};

export const getNeteaseArtist = async (
  artistId: string | number
): Promise<{ artist: NeteaseArtistSummary; hotSongs: NeteaseSongSummary[] }> => {
  const body = await callNeteaseForBody('artists', { id: artistId });
  const artist = normalizeNeteaseArtistSummary((body.artist ?? {}) as NeteaseArtistEntryLike);

  return { artist, hotSongs: asSongSummaries(body.hotSongs) };
};

export const searchNetease = async (
  keywords: string,
  type: NeteaseSearchTypes
): Promise<{
  key: string;
  songs: NeteaseSongSummary[];
  albums: NeteaseAlbumSummary[];
  artists: NeteaseArtistSummary[];
  playlists: NeteasePlaylistSummary[];
}> => {
  const body = await callNeteaseForBody('cloudsearch', { keywords, type, limit: 30 });
  const result = (body.result ?? {}) as {
    songs?: NeteaseSongLike[];
    albums?: NeteaseAlbumLike[];
    artists?: NeteaseArtistEntryLike[];
    playlists?: NeteasePlaylistLike[];
  };

  return {
    key: keywords,
    songs: (result.songs ?? []).map((song) => normalizeNeteaseSongSummary(song)),
    albums: (result.albums ?? []).map((album) => normalizeNeteaseAlbumSummary(album)),
    artists: (result.artists ?? []).map((artist) => normalizeNeteaseArtistSummary(artist)),
    playlists: (result.playlists ?? []).map((playlist) => normalizeNeteasePlaylistSummary(playlist))
  };
};

export const getNeteaseUserPlaylists = async (userId: number): Promise<NeteasePlaylistSummary[]> => {
  const body = await callCatalog('user_playlist', { uid: userId, limit: 1000 });
  const playlists = Array.isArray(body.playlist)
    ? (body.playlist as NeteasePlaylistLike[])
    : [];

  return playlists.map((playlist) => normalizeNeteasePlaylistSummary(playlist));
};

/**
 * Liked song ids ordered newest-like first. `likelist` returns ids in no particular order
 * (the package labels it 无序 and takes only `uid`), so read the auto-created "liked music"
 * playlist instead — the first playlist the user owns in `user_playlist` — whose `trackIds`
 * follow like time, newest first.
 */
export const getNeteaseLikedSongIds = async (userId: number): Promise<number[]> => {
  const playlists = await getNeteaseUserPlaylists(userId);
  const likedPlaylist = playlists.find((playlist) => playlist.userId === userId);
  if (!likedPlaylist) return [];

  const body = await callNeteaseForBody('playlist_detail', { id: likedPlaylist.playlistId });
  const playlistRaw = (body.playlist ?? {}) as { trackIds?: { id: number }[] };
  return (playlistRaw.trackIds ?? [])
    .map((trackId) => trackId.id)
    .filter((id) => typeof id === 'number' && id > 0);
};

export const likeUnlikeNeteaseSong = async (
  neteaseId: number,
  isLike: boolean
): Promise<boolean> => {
  const body = await callCatalog('like', { id: neteaseId, like: isLike ? 'true' : 'false' });
  return body.code === 200 || body.playlistId !== undefined;
};

export interface NeteaseStreamInfo {
  url: string;
  br: number;
  size: number;
  /** Trial fragment present => limited-length playback. */
  hasTrial: boolean;
  fee: number;
  playable: boolean;
  type: string;
  /** VIP-only song with no URL under the current account (fee 1/4); playback is paywalled. */
  vipRequired: boolean;
}

/**
 * Resolves a fresh CDN stream URL at the requested quality; NetEase URLs expire in ~20 minutes,
 * so never cache these. The requested `level` is passed through as-is — no fallback ladder: a
 * free account asking for a tier it cannot hear simply gets no URL, and `vipRequired` reports
 * the paywall so the renderer can pause with a clear notification.
 */
export const getNeteaseStream = async (
  neteaseId: number,
  quality: NeteaseQualityTypes
): Promise<NeteaseStreamInfo | undefined> => {
  const body = await callNeteaseForBody('song_url_v1', { id: neteaseId, level: quality });
  const data = Array.isArray(body.data)
    ? (body.data[0] as Record<string, unknown> | undefined)
    : undefined;

  if (!data) return undefined;

  const url = typeof data.url === 'string' ? data.url : '';
  const fee = typeof data.fee === 'number' ? data.fee : 0;
  const isTrial = isTrialInfo(data.freeTrialInfo);
  // A URL is the single source of truth for playability; VIP songs without a URL are restricted.
  const playable = url.startsWith('http');

  return {
    url,
    br: typeof data.br === 'number' ? data.br : 0,
    size: typeof data.size === 'number' ? data.size : 0,
    hasTrial: isTrial,
    fee,
    playable,
    type: typeof data.type === 'string' ? data.type : 'mp3',
    vipRequired: !playable && (fee === 1 || fee === 4)
  };
};

export const getNeteaseRecommendSongs = async (): Promise<NeteaseSongSummary[]> => {
  const body = await callCatalog('recommend_songs', {});
  return asSongSummaries(
    ((body.data ?? {}) as { dailySongs?: unknown[] }).dailySongs ?? body.dailySongs
  );
};

export const getNeteasePersonalizedPlaylists = async (): Promise<NeteasePlaylistSummary[]> => {
  const body = await callNeteaseForBody('personalized', { limit: 12 });
  const playlists = Array.isArray(body.result) ? (body.result as NeteasePlaylistLike[]) : [];
  return playlists.map((playlist) => normalizeNeteasePlaylistSummary(playlist));
};

export const getNeteaseToplists = async (): Promise<NeteasePlaylistSummary[]> => {
  const body = await callNeteaseForBody('toplist', {});
  const lists = Array.isArray(body.list) ? (body.list as NeteasePlaylistLike[]) : [];
  return lists.slice(0, 30).map((list) => normalizeNeteasePlaylistSummary(list));
};
