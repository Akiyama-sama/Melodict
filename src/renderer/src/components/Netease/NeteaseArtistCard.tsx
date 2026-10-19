import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import Img from '../Img';
import NavLink from '../NavLink';

interface NeteaseArtistCardProp {
  artist: NeteaseArtistSummary;
  className?: string;
}

/** A NetEase artist tile modeled on the local artist cards: round avatar, name, alias. */
export const NeteaseArtistCard = (props: NeteaseArtistCardProp) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { artist } = props;

  const openArtist = useCallback(
    () =>
      navigate({
        to: '/main-player/netease/artists/$artistId',
        params: { artistId: String(artist.artistId) }
      }),
    [navigate, artist.artistId]
  );

  return (
    <NavLink
      to="/main-player/netease/artists/$artistId"
      params={{ artistId: String(artist.artistId) }}
      className={`netease-artist group mr-4 mb-4 flex h-fit w-44 flex-col items-center justify-between rounded-md p-4 hover:bg-background-color-2/50 dark:hover:bg-dark-background-color-2/50 ${props.className ?? ''}`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        openArtist();
      }}
    >
      <Img
        src={artist.cover}
        fallbackSrc={undefined}
        loading="lazy"
        alt={artist.name}
        className="aspect-square w-40 max-w-full rounded-full object-cover shadow-lg"
      />
      <div className="artist-info-container text-font-color-black dark:text-font-color-white mt-2 w-full truncate text-center">
        <div className="artist-name truncate text-lg font-medium" title={artist.name}>
          {artist.name}
        </div>
        <div className="artist-alias truncate text-xs opacity-60">
          {artist.alias.length > 0 ? artist.alias.join(', ') : t('common.artist_one')}
        </div>
      </div>
    </NavLink>
  );
};

NeteaseArtistCard.displayName = 'NeteaseArtistCard';
export default NeteaseArtistCard;
