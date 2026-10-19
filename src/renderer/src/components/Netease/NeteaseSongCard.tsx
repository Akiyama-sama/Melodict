import { useNavigate } from '@tanstack/react-router';
import { useCallback, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { useQueueOperations } from '../../hooks/useQueueOperations';
import { store } from '../../store/store';
import Button from '../Button';
import Img from '../Img';
import NavLink from '../NavLink';
import { useStore } from '@tanstack/react-store';

interface NeteaseSongCardProp {
  summary: NeteaseSongSummary;
  className?: string;
}

/**
 * A NetEase variant of the local `SongCard`: artwork tile with a hover play button and the
 * title/artists below. Carries only online-safe actions (play / play next / add to queue / go to
 * album); no favorites, playlists, blacklist or library navigation.
 */
const NeteaseSongCard = (props: NeteaseSongCardProp) => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const isCurrentSongPlaying = useStore(store, (state) => state.player.isCurrentSongPlaying);

  const { playSong, updateContextMenuData, addNewNotifications } = useContext(AppUpdateContext);
  const { addToNext, addToEnd } = useQueueOperations();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { summary, className } = props;
  const { songId, title, artists, album, isVip } = summary;

  const isSongPlaying = currentSongData.songId === songId && isCurrentSongPlaying;

  const handlePlayBtnClick = useCallback(() => {
    playSong(songId, true);
  }, [playSong, songId]);

  const contextMenuItems: ContextMenuItem[] = useMemo(
    () => [
      {
        label: t('common.play'),
        iconName: 'play_arrow',
        handlerFunction: handlePlayBtnClick
      },
      {
        label: t('common.playNext'),
        iconName: 'shortcut',
        handlerFunction: () => {
          addToNext([songId], { removeDuplicates: false });
          addNewNotifications([
            {
              id: `${title}PlayNext`,
              content: t('notifications.playingNext', { title }),
              iconName: 'shortcut'
            }
          ]);
        }
      },
      {
        label: t('common.addToQueue'),
        iconName: 'queue',
        handlerFunction: () => {
          addToEnd([songId], { removeDuplicates: false });
          addNewNotifications([
            {
              id: `${title}AddedToQueue`,
              content: t('notifications.addedToQueue', { count: 1 }),
              iconName: 'queue'
            }
          ]);
        }
      },
      {
        label: 'Hr',
        isContextMenuItemSeperator: true,
        handlerFunction: () => true
      },
      {
        label: t('song.goToAlbum'),
        iconName: 'album',
        isDisabled: !album,
        handlerFunction: () =>
          album &&
          navigate({
            to: '/main-player/netease/albums/$albumId',
            params: { albumId: String(album.albumId) }
          })
      }
    ],
    [addToEnd, addToNext, album, handlePlayBtnClick, navigate, songId, t, title]
  );

  const contextMenuItemData: ContextMenuAdditionalData = {
    title,
    subTitle: artists?.map((artist) => artist.name).join(', ') ?? t('common.unknownArtist'),
    artworkPath: summary.cover || DefaultSongCover
  };

  return (
    <div
      className={`netease-song-card group relative mb-2 flex h-68 w-48 flex-col justify-between overflow-hidden rounded-md p-4 hover:bg-background-color-2/50 dark:hover:bg-dark-background-color-2/50 ${className ?? ''}`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        updateContextMenuData(true, contextMenuItems, e.pageX, e.pageY, contextMenuItemData);
      }}
      onDoubleClick={handlePlayBtnClick}
    >
      <div className="song-cover-and-play-btn-container relative h-[70%] cursor-pointer overflow-hidden">
        <Button
          className="text-font-color-white! absolute right-[5%] bottom-[5%] z-1 m-0! rounded-none! border-0! bg-transparent p-0! opacity-0 outline-offset-1 transition-opacity group-focus-within:opacity-75 group-hover:opacity-75 hover:bg-transparent hover:opacity-100! focus-visible:opacity-100! focus-visible:outline! dark:bg-transparent dark:hover:bg-transparent"
          iconName={isSongPlaying ? 'pause_circle' : 'play_circle'}
          iconClassName="text-5xl! leading-none!"
          clickHandler={handlePlayBtnClick}
        />
        <div className="song-cover-container relative h-full overflow-hidden rounded-lg before:invisible before:absolute before:h-full before:w-full before:bg-linear-to-b before:from-[hsla(0,0%,0%,0%)] before:to-[hsla(0,0%,0%,50%)] before:opacity-0 before:transition-[visibility,opacity] before:duration-300 before:content-[''] group-focus-within:before:visible group-focus-within:before:opacity-100 group-hover:before:visible group-hover:before:opacity-100">
          <Img
            src={summary.cover || DefaultSongCover}
            fallbackSrc={DefaultSongCover}
            loading="lazy"
            alt="Netease Song Cover"
            className="aspect-square h-full max-h-full w-full object-cover object-center"
          />
        </div>
      </div>
      <div className="song-info-container text-font-color-black dark:text-font-color-white mt-2 h-fit w-full pl-2">
        <Button
          className="song-title pointer !m-0 !block w-full truncate !rounded-none !border-0 bg-transparent !p-0 !text-left text-xl outline-offset-1 hover:bg-transparent hover:underline focus-visible:!outline dark:bg-transparent dark:hover:bg-transparent"
          label={title}
          clickHandler={handlePlayBtnClick}
        />
        <div className="song-artists w-full truncate text-sm" title={artists.map((a) => a.name).join(', ')}>
          {isVip && (
            <span className="mr-1 rounded bg-amber-500 px-1 align-middle text-[0.6rem] leading-tight text-white">
              VIP
            </span>
          )}
          {artists.length > 0 ? (
            <NavLink
              to="/main-player/netease/artists/$artistId"
              params={{ artistId: String(artists[0].artistId) }}
              className="hover:underline"
            >
              {artists[0].name}
            </NavLink>
          ) : (
            t('common.unknownArtist')
          )}
          {artists.length > 1 && <span className="opacity-70"> +{artists.length - 1}</span>}
        </div>
      </div>
    </div>
  );
};

NeteaseSongCard.displayName = 'NeteaseSongCard';
export default NeteaseSongCard;
