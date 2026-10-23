import { createQueryKeys } from '@lukemorales/query-key-factory';

export const neteaseQuery = createQueryKeys('netease', {
  // React Query rejects undefined results; map a logged-out null over the absent profile.
  session: {
    queryKey: null,
    queryFn: async () => (await window.api.neteaseControls.getMe()) ?? null
  },
  /** Daily-recommended songs; login required (gate with `enabled` at the call site). */
  recommendations: {
    queryKey: null,
    queryFn: () => window.api.neteaseControls.getRecommendations()
  },
  personalized: {
    queryKey: null,
    queryFn: () => window.api.neteaseControls.getPersonalizedPlaylists()
  },
  toplists: {
    queryKey: null,
    queryFn: () => window.api.neteaseControls.getToplists()
  },
  userPlaylists: (userId: number) => ({
    queryKey: [`${userId}`],
    queryFn: () => window.api.neteaseControls.getUserPlaylists(userId)
  }),
  likedSongIds: (userId: number) => ({
    queryKey: [`${userId}`],
    queryFn: () => window.api.neteaseControls.getLikedSongIds(userId)
  }),
  /** Liked songs joined to their summaries (potentially many ids → batched inside). */
  likedSongs: (userId: number) => ({
    queryKey: [`${userId}`],
    queryFn: async () => {
      const ids = await window.api.neteaseControls.getLikedSongIds(userId);
      if (ids.length === 0) return [];
      return window.api.neteaseControls.getSongSummaries(ids);
    }
  }),
  playlistDetail: (playlistId: string) => ({
    queryKey: [playlistId],
    queryFn: () => window.api.neteaseControls.getPlaylist(playlistId)
  }),
  albumDetail: (albumId: string) => ({
    queryKey: [albumId],
    queryFn: () => window.api.neteaseControls.getAlbum(albumId)
  }),
  artistDetail: (artistId: string) => ({
    queryKey: [artistId],
    queryFn: () => window.api.neteaseControls.getArtist(artistId)
  }),
  search: (data: { keywords: string; type: NeteaseSearchTypes }) => ({
    queryKey: [`${data.type}`, data.keywords],
    queryFn: () => window.api.neteaseControls.search(data.keywords, data.type)
  }),
  /** Keyword-completion suggestions for the search input's dropdown. */
  searchSuggest: (keywords: string) => ({
    queryKey: ['suggest', keywords],
    queryFn: () => window.api.neteaseControls.searchSuggest(keywords)
  }),
  songSummaries: (neteaseIds: number[]) => ({
    queryKey: [
      [...neteaseIds].sort((a, b) => a - b).join(',')
    ],
    queryFn: () => window.api.neteaseControls.getSongSummaries(neteaseIds)
  })
});
