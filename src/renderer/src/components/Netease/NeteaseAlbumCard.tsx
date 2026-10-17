import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import DefaultAlbumCover from '../../assets/images/webp/album_cover_default.webp';
import Button from '../Button';
import Img from '../Img';
import NavLink from '../NavLink';

interface NeteaseAlbumCardProp {
  album: NeteaseAlbumSummary;
  className?: string;
}

/** A NetEase album tile modeled on the local `Album` card: cover, title, artist, song count. */
export const NeteaseAlbumCard = (props: NeteaseAlbumCardProp) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { album } = props;

  const openAlbum = useCallback(
    () =>
      navigate({
        to: '/main-player/netease/albums/$albumId',
        params: { albumId: String(album.albumId) }
      }),
    [navigate, album.albumId]
  );

  return (
    <NavLink
      to="/main-player/netease/albums/$albumId"
      params={{ albumId: String(album.albumId) }}
      className={`netease-album group mr-6 mb-2 flex h-68 w-48 flex-col justify-between overflow-hidden rounded-md p-4 hover:bg-background-color-2/50 dark:hover:bg-dark-background-color-2/50 ${props.className ?? ''}`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        openAlbum();
      }}
    >
      <div className="album-cover-and-play-btn-container relative h-[70%] cursor-pointer overflow-hidden">
        <Button
          className="text-font-color-white! absolute right-[5%] bottom-[5%] z-1 m-0! rounded-none! border-0! bg-transparent p-0! opacity-0 outline-offset-1 transition-opacity group-focus-within:opacity-75 group-hover:opacity-75 hover:bg-transparent hover:opacity-100! focus-visible:opacity-100! focus-visible:outline! dark:bg-transparent dark:hover:bg-transparent"
          iconName="play_circle"
          iconClassName="text-5xl! leading-none!"
          clickHandler={(e) => {
            e.stopPropagation();
            openAlbum();
          }}
        />
        <div className="album-cover-container relative h-full overflow-hidden rounded-lg before:invisible before:absolute before:h-full before:w-full before:bg-linear-to-b before:from-[hsla(0,0%,0%,0%)] before:to-[hsla(0,0%,0%,50%)] before:opacity-0 before:transition-[visibility,opacity] before:duration-300 before:content-[''] group-focus-within:before:visible group-focus-within:before:opacity-100 group-hover:before:visible group-hover:before:opacity-100">
          <Img
            src={album.coverImgUrl || DefaultAlbumCover}
            fallbackSrc={DefaultAlbumCover}
            loading="lazy"
            alt="Netease Album Cover"
            className="aspect-square h-full max-h-full w-full object-cover object-center"
          />
        </div>
      </div>
      <div className="album-info-container text-font-color-black dark:text-font-color-white mt-2 h-fit w-full pl-2">
        <Button
          className="album-title pointer !m-0 !block w-full truncate !rounded-none !border-0 bg-transparent !p-0 !text-left text-xl outline-offset-1 hover:bg-transparent hover:underline focus-visible:!outline dark:bg-transparent dark:hover:bg-transparent"
          label={album.name}
          clickHandler={openAlbum}
        />
        <div className="album-artists w-full truncate text-sm" title={album.artistName}>
          {album.artistName || t('common.unknownArtist')}
        </div>
        <div className="album-no-of-songs w-full overflow-hidden text-xs text-ellipsis whitespace-nowrap">
          {t('common.songWithCount', { count: album.songCount })}
        </div>
      </div>
    </NavLink>
  );
};

NeteaseAlbumCard.displayName = 'NeteaseAlbumCard';
export default NeteaseAlbumCard;
