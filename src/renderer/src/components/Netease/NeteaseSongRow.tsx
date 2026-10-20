import { tryDecodeNeteaseSongId } from '@common/netease';
import { type DraggableProvided } from '@hello-pangea/dnd';
import { useNavigate } from '@tanstack/react-router';
import {
  type CSSProperties,
  type ForwardedRef,
  forwardRef,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState
} from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@tanstack/react-store';

import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import useDurationParts from '../../hooks/useDurationParts';
import { useQueueOperations } from '../../hooks/useQueueOperations';
import {
  getNeteaseLikeNotification,
  isNeteaseSongLiked,
  setNeteaseSongLiked
} from '../../other/neteaseLikes';
import { store } from '../../store/store';
import Button from '../Button';
import Img from '../Img';
import NavLink from '../NavLink';
import NeteaseVipBadge from './NeteaseVipBadge';
import buildNeteasePlaybackMenuItems from './neteaseMenuItems';

/**
 * A queue/list row for a NetEase song summary. Mirrors the local `Song` row layout (cover, title,
 * artists, duration) but swaps every local-library concern: artwork comes from the CDN URL, artists
 * link to NetEase artist pages, and the context menu only carries the actions that make sense for
 * an online song (play / play next / add to queue / navigate) — no playlists, tags or blacklist.
 */
interface NeteaseSongRowProp {
  summary: NeteaseSongSummary;
  index: number;
  className?: string;
  style?: CSSProperties;
  isDraggable?: boolean;
  /** Draggable wiring as passed down by react-beautiful-dnd (queue page). */
  provided?: DraggableProvided;
  /** Overrides the play action when the enclosing page wants to setup queue context first. */
  onPlayClick?: (songId: number) => void;
  /** Extra items prepended to the context menu (e.g. "remove from queue" on the queue page). */
  additionalContextMenuItems?: ContextMenuItem[];
}

const NeteaseSongRow = forwardRef((props: NeteaseSongRowProp, ref: ForwardedRef<HTMLDivElement>) => {
  const { summary, index, className, style, provided, onPlayClick, additionalContextMenuItems } =
    props;

  const currentSongData = useStore(store, (state) => state.currentSongData);
  const isCurrentSongPlaying = useStore(store, (state) => state.player.isCurrentSongPlaying);

  const { playSong, updateContextMenuData, addNewNotifications } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const { addToNext, addToEnd } = useQueueOperations();

  const navigate = useNavigate();

  const { songId, title, artists, album, duration, isVip, hasTrial } = summary;

  const neteaseId = tryDecodeNeteaseSongId(songId) ?? summary.neteaseSongId;

  const [likeState, setLikeState] = useState<'unknown' | 'liked' | 'notLiked'>(() =>
    // The shared likes cache is session-scoped and warmed by `usePlaybackSettings`; when it has
    // already loaded, rows render the real state instead of a neutral guess.
    isNeteaseSongLiked(neteaseId) ? 'liked' : 'notLiked'
  );
  const likeErrorShown = useRef(false);

  const isCurrentSong = currentSongData.songId === songId && isCurrentSongPlaying;

  const { minutes, seconds } = useDurationParts(duration, '--');

  const handlePlayBtnClick = useCallback(() => {
    if (onPlayClick) return onPlayClick(songId);
    return playSong(songId, true);
  }, [onPlayClick, playSong, songId]);

  const songArtists = useMemo(() => {
    if (Array.isArray(artists) && artists.length > 0)
      return artists.flatMap((artist, i) => [
        <NavLink
          key={`${artist.artistId}-${artist.name}`}
          to="/main-player/netease/artists/$artistId"
          params={{ artistId: String(artist.artistId) }}
          title={artist.name}
          className="hover:underline"
        >
          {artist.name}
        </NavLink>,
        ...(i !== artists.length - 1
          ? [
              <span key={`${artist.artistId},${i}`} className="mr-1">
                ,
              </span>
            ]
          : [])
      ]);
    return <span className="text-xs font-normal">{t('common.unknownArtist')}</span>;
  }, [artists, t]);

  // The NetEase like endpoint can only add or remove — the current liked-state is not queryable per
  // song — so the row consults the shared session-wide likes cache for its initial state and
  // routes the toggle through it (which also keeps other surfaces in sync); failures roll back.
  const toggleLike = useCallback(() => {
    const isLike = likeState !== 'liked';
    setLikeState(isLike ? 'liked' : 'notLiked');
    setNeteaseSongLiked(neteaseId, isLike)
      .then(() => addNewNotifications([getNeteaseLikeNotification(title, isLike)]))
      .catch((err) => {
        console.error(err);
        setLikeState(isNeteaseSongLiked(neteaseId) ? 'liked' : 'notLiked');
        if (!likeErrorShown.current) {
          likeErrorShown.current = true;
          setTimeout(() => {
            likeErrorShown.current = false;
          }, 5000);
        }
        addNewNotifications([getNeteaseLikeNotification(title, isLike, true)]);
      });
  }, [addNewNotifications, likeState, neteaseId, title]);

  const contextMenuItems: ContextMenuItem[] = useMemo(() => {
    const items: ContextMenuItem[] = [
      ...buildNeteasePlaybackMenuItems(
        { songId, title, album },
        { addToNext, addToEnd, addNewNotifications, navigate, handlePlayBtnClick },
        t
      ),
      {
        label:
          likeState === 'liked'
            ? t('netease.unlikeSong')
            : t('netease.likeSong'),
        iconName: 'favorite',
        iconClassName: likeState === 'liked' ? 'material-icons-round' : 'material-icons-round-outlined',
        handlerFunction: toggleLike
      },
      {
        label: t('song.goToArtist'),
        iconName: 'people',
        isDisabled: !artists || artists.length === 0,
        handlerFunction: () => {
          const artist = artists?.[0];
          if (artist)
            navigate({
              to: '/main-player/netease/artists/$artistId',
              params: { artistId: String(artist.artistId) }
            });
        }
      }
    ];

    if (additionalContextMenuItems) items.unshift(...additionalContextMenuItems);

    return items;
  }, [
    addNewNotifications,
    addToEnd,
    addToNext,
    additionalContextMenuItems,
    album,
    artists,
    handlePlayBtnClick,
    likeState,
    navigate,
    songId,
    t,
    title,
    toggleLike
  ]);

  const contextMenuItemData: ContextMenuAdditionalData = {
    title,
    subTitle: artists?.map((artist) => artist.name).join(', ') ?? t('common.unknownArtist'),
    artworkPath: summary.cover || DefaultSongCover
  };

  return (
    <div
      style={style}
      data-index={index}
      {...provided?.draggableProps}
      {...(provided?.dragHandleProps ?? {})}
      className={`${songId} group relative mr-4 mb-2 flex h-13 w-[98%] overflow-hidden rounded-lg p-[0.2rem] px-2 -outline-offset-2 transition-[background,color,opacity] ease-in-out focus-visible:outline! ${className ?? ''} ${
        currentSongData.songId === songId
          ? 'bg-background-color-3 text-font-color-black dark:bg-dark-background-color-3 shadow-lg dark:text-font-color-black!'
          : 'odd:bg-background-color-2/70 hover:!bg-background-color-2 dark:odd:bg-dark-background-color-2/50 dark:hover:!bg-dark-background-color-2'
      }`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        updateContextMenuData(true, contextMenuItems, e.pageX, e.pageY, contextMenuItemData);
      }}
      onDoubleClick={handlePlayBtnClick}
      ref={ref}
    >
      <div className="song-cover-and-play-btn-container flex w-[clamp(4rem,10%,6rem)] shrink-0 items-center justify-center">
        <div className="song-cover-container relative mr-4 ml-2 flex h-[90%] w-12 flex-row items-center justify-center overflow-hidden rounded-md">
          <div className="play-btn-container absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
            <Button
              className="m-0! rounded-none! border-0! bg-transparent p-0! outline-offset-1 transition-colors! hover:bg-transparent focus-visible:outline! dark:bg-transparent dark:hover:bg-transparent"
              iconClassName={`text-3xl! text-font-color-white/0 leading-none! ${
                isCurrentSong && 'text-font-color-white/100'
              } group-focus-within:text-font-color-white/100 group-hover:text-font-color-white/100`}
              clickHandler={handlePlayBtnClick}
              iconName={isCurrentSong ? 'pause_circle' : 'play_circle'}
            />
          </div>
          <Img
            src={summary.cover || DefaultSongCover}
            fallbackSrc={DefaultSongCover}
            loading="eager"
            alt="Song cover"
            className={`aspect-square max-h-full min-w-full object-contain py-[0.1rem] transition-[filter]! duration-300 group-focus-within:brightness-50 group-hover:brightness-50 ${
              isCurrentSong ? 'brightness-50' : ''
            }`}
            enableImgFadeIns={false}
          />
        </div>
      </div>
      <div className="song-info-container text-font-color-black dark:text-font-color-white grid grow grid-cols-[45%_1fr_minmax(4.5rem,6rem)] items-center gap-2 lg:grid-cols-[40%_1fr_minmax(4rem,5rem)_minmax(4.5rem,6.5rem)] lg:gap-0!">
        <button
          type="button"
          className="song-title cursor-pointer truncate text-left text-base font-normal outline-offset-1 transition-none hover:underline focus-visible:outline!"
          title={title}
          onClick={(e) => {
            e.stopPropagation();
            if (album)
              navigate({
                to: '/main-player/netease/albums/$albumId',
                params: { albumId: String(album.albumId) }
              });
          }}
        >
          {isVip && <NeteaseVipBadge />}
          {title}
        </button>
        <div className="song-artists w-full truncate text-xs font-normal">{songArtists}</div>
        <div className="song-album w-full truncate text-xs transition-none sm:hidden lg:hidden">
          {album?.name || t('common.unknownAlbum')}
        </div>
        <div className="song-duration flex w-full! items-center justify-between pr-4 pl-2 text-center transition-none sm:pr-1">
          {hasTrial && (
            <span
              className="material-icons-round-outlined text-font-color-highlight dark:text-dark-background-color-3 text-sm leading-none!"
              title={t('netease.trialBadge')}
            >
              graphic_eq
            </span>
          )}
          <span className="">
            {minutes ?? '--'}:{seconds ?? '--'}
          </span>
        </div>
      </div>
    </div>
  );
});

NeteaseSongRow.displayName = 'NeteaseSongRow';
export default NeteaseSongRow;
