import { tryDecodeNeteaseSongId } from '@common/netease';
import i18n from '@renderer/i18n';
import { neteaseQuery } from '@renderer/queries/netease';

import { queryClient } from '..';

/**
 * NetEase likes for the _player surfaces_ (heart buttons and the Ctrl+H shortcut), shared by the
 * main controls, fullscreen and mini players and the NetEase song rows. NetEase's `like` endpoint
 * can only add or remove — the liked state is not queryable per song — so liked ids are fetched
 * once per session through the `likedSongIds` query and mirrored into this cache; every toggle
 * keeps it in sync so initial heart states stay correct without a per-song round-trip.
 */
const neteaseLikes = {
  /** NetEase song ids currently liked, in the NetEase id space. */
  likedIds: new Set<number>(),
  /** The userId whose likes are cached, so a logout/login switch drops stale ids. */
  ownerId: null as number | null,
  /** In-flight toggles, to dedupe rapid double-clicks on the same song. */
  pending: new Set<number>()
};

/** Ensures the liked-ids cache mirrors the given user's likes; resolves when ready to consult. */
export const ensureNeteaseLikes = async (userId: number): Promise<void> => {
  if (neteaseLikes.ownerId === userId) return;

  const ids = await queryClient.fetchQuery({
    ...neteaseQuery.likedSongIds(userId),
    staleTime: Number.POSITIVE_INFINITY
  });
  neteaseLikes.likedIds = new Set(ids);
  neteaseLikes.ownerId = userId;
};

/**
 * Resolves the logged-in user and loads their likes into the cache. Resolves to `false` when nobody
 * is logged in (nothing to consult), `true` when the cache is ready.
 */
export const ensureNeteaseLikesForCurrentUser = async (): Promise<boolean> => {
  const profile = await queryClient.fetchQuery(neteaseQuery.session);
  if (!profile?.userId) return false;
  await ensureNeteaseLikes(profile.userId);
  return true;
};

/** Drops the cache (logout / account switch); the next toggle re-fetches it. */
export const resetNeteaseLikes = (): void => {
  neteaseLikes.likedIds = new Set();
  neteaseLikes.ownerId = null;
};

/** Whether the song (local or NetEase id space) is currently liked, consulting the cache. */
export const isNeteaseSongLiked = (songId: number): boolean => {
  const neteaseId = tryDecodeNeteaseSongId(songId);
  return (
    neteaseId !== null && neteaseLikes.ownerId !== null && neteaseLikes.likedIds.has(neteaseId)
  );
};

/**
 * Adds or removes the song from the user's NetEase likes. The cache is updated immediately
 * (optimistic); on failure the previous state is restored and the error rethrown for the caller's
 * UI feedback. Resolves to the final liked state, so the caller can persist it in the store.
 */
export const setNeteaseSongLiked = async (songId: number, isLiked: boolean): Promise<boolean> => {
  const neteaseId = tryDecodeNeteaseSongId(songId);
  if (neteaseId === null) throw new Error(`${songId} is not a NetEase song id.`);

  // The cache is normally warmed by `usePlaybackSettings` at startup, but a row click can land
  // before that resolves — load it on demand instead of failing the toggle.
  if (neteaseLikes.ownerId === null && !(await ensureNeteaseLikesForCurrentUser()))
    throw new Error('NetEase likes are not loaded (not logged in?).');
  const { ownerId: userId } = neteaseLikes;
  if (userId === null) throw new Error('NetEase likes are not loaded (not logged in?).');

  if (neteaseLikes.pending.has(neteaseId)) return isNeteaseSongLiked(songId);
  neteaseLikes.pending.add(neteaseId);

  const wasLiked = neteaseLikes.likedIds.has(neteaseId);
  if (wasLiked === isLiked) {
    neteaseLikes.pending.delete(neteaseId);
    return wasLiked;
  }
  if (isLiked) neteaseLikes.likedIds.add(neteaseId);
  else neteaseLikes.likedIds.delete(neteaseId);

  try {
    const ok = await window.api.neteaseControls.likeUnlikeSong(neteaseId, isLiked);
    if (!ok) throw new Error(`NetEase rejected the like update for ${neteaseId}.`);

    // Refresh the liked-songs page if it is open; the ids cache itself was updated above.
    queryClient.invalidateQueries({ queryKey: neteaseQuery.likedSongs(userId).queryKey });
    neteaseLikes.pending.delete(neteaseId);
    return isLiked;
  } catch (err) {
    if (wasLiked) neteaseLikes.likedIds.add(neteaseId);
    else neteaseLikes.likedIds.delete(neteaseId);
    neteaseLikes.pending.delete(neteaseId);
    throw err;
  }
};

/** Like/unlike success or failure toast for a NetEase song, ready to pass to notifications. */
export const getNeteaseLikeNotification = (
  title: string,
  isLiked: boolean,
  failed = false
): AppNotification => ({
  id: failed ? `neteaseLikeError-${title}` : `neteaseLike-${title}`,
  duration: failed ? 5000 : 4000,
  content: failed
    ? i18n.t('song.toggleLikeFailed')
    : isLiked
      ? i18n.t('netease.addedToNeteaseLikes', { title })
      : i18n.t('netease.removedFromNeteaseLikes', { title }),
  iconName: failed ? 'error' : isLiked ? 'favorite' : 'favorite_border'
});

/**
 * The NetEase branch of the player heart toggle (see `usePlaybackSettings.toggleIsFavorite`):
 * routes into the NetEase likes module when the playing song is an online one, mirroring the local
 * flow's semantics — optimistic store update first, IPC result settles it, failure reverts and
 * notifies. Resolves to the final liked state, or `undefined` when the toggle was swallowed
 * (deduped in-flight request) or rejected (notification shown here).
 */
export const toggleNeteaseSongFavorite = async (
  songData: Pick<AudioPlayerData, 'songId' | 'title'>,
  isFavorite?: boolean
): Promise<boolean | undefined> => {
  if (tryDecodeNeteaseSongId(songData.songId) === null) return undefined;

  try {
    if (!(await ensureNeteaseLikesForCurrentUser())) {
      addNotification(getNeteaseLikeNotification(songData.title, false, true));
      return undefined;
    }

    const nextFavorite = isFavorite ?? !isNeteaseSongLiked(songData.songId);
    return await setNeteaseSongLiked(songData.songId, nextFavorite);
  } catch (err) {
    console.error(err);
    addNotification(getNeteaseLikeNotification(songData.title, false, true));
    return undefined;
  }
};

/** Fire-and-forget toast helper so call sites don't each need the notifications hook. */
let addNotification: (notification: AppNotification) => void = () => undefined;

/**
 * Called once from `App` after the notifications hook is ready, so this module can push toasts
 * (like/unlike success and failure) through the app's notification panel.
 */
export const registerNeteaseLikeNotifier = (
  notify: (notification: AppNotification) => void
): void => {
  addNotification = notify;
};
