import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import DefaultPlaylistCover from '../../assets/images/webp/playlist_cover_default.webp';
import Button from '../Button';
import Img from '../Img';
import NavLink from '../NavLink';

interface NeteasePlaylistCardProp {
  playlist: NeteasePlaylistSummary;
  className?: string;
}

/** A NetEase playlist tile modeled on the local `Playlist` card: cover, name, song count. */
export const NeteasePlaylistCard = (props: NeteasePlaylistCardProp) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { playlist } = props;

  const openPlaylist = useCallback(
    () =>
      navigate({
        to: '/main-player/netease/playlists/$playlistId',
        params: { playlistId: playlist.playlistId }
      }),
    [navigate, playlist.playlistId]
  );

  return (
    <NavLink
      to={'/main-player/netease/playlists/$playlistId'}
      params={{ playlistId: playlist.playlistId }}
      className={`netease-playlist group hover:bg-background-color-2/50 dark:hover:bg-dark-background-color-2/50 text-font-color-black dark:text-font-color-white mr-12 mb-8 flex h-fit max-h-52 min-h-40 w-36 flex-col justify-between rounded-md p-4 ${props.className ?? ''}`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        openPlaylist();
      }}
    >
      <div className="playlist-cover-and-play-btn-container relative aspect-square w-full cursor-pointer overflow-hidden rounded-xl before:invisible before:absolute before:z-10 before:h-full before:w-full before:bg-linear-to-b before:from-[hsla(0,0%,0%,0%)] before:to-[hsla(0,0%,0%,40%)] before:opacity-0 before:transition-[visibility,opacity] before:duration-300 before:content-[''] group-focus-within:before:visible group-focus-within:before:opacity-100 group-hover:before:visible group-hover:before:opacity-100">
        <Button
          className="text-font-color-white dark:text-font-color-white! absolute right-2 bottom-2 z-10 m-0! translate-y-10 scale-90 rounded-none! border-0! bg-transparent p-0! opacity-0 outline-offset-1 transition-[opacity,transform] delay-100 duration-200 ease-in-out group-focus-within:translate-y-0 group-focus-within:scale-100 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 hover:bg-transparent focus-visible:outline! dark:bg-transparent dark:hover:bg-transparent"
          clickHandler={(e) => {
            e.stopPropagation();
            openPlaylist();
          }}
          iconName="play_circle"
          iconClassName="text-4xl! leading-none! text-inherit!"
        />
        <Img
          src={playlist.coverImgUrl || DefaultPlaylistCover}
          fallbackSrc={DefaultPlaylistCover}
          alt="Netease Playlist Cover"
          loading="lazy"
          className="h-full w-full"
        />
      </div>
      <div className="playlist-info-container mt-2">
        <Button
          className="playlist-title m-0! block! w-full truncate rounded-none! border-0! bg-transparent p-0! text-left! text-xl! outline-offset-1 hover:bg-transparent hover:underline focus-visible:outline! dark:bg-transparent dark:hover:bg-transparent"
          tooltipLabel={playlist.name}
          clickHandler={openPlaylist}
          label={playlist.name}
        />
        <div className="playlist-no-of-songs text-sm font-light">
          {t('common.songWithCount', { count: playlist.trackCount })}
        </div>
      </div>
    </NavLink>
  );
};

NeteasePlaylistCard.displayName = 'NeteasePlaylistCard';
export default NeteasePlaylistCard;
