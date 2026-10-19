import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import Button from '../Button';
import NeteasePlaylistCard from './NeteasePlaylistCard';
import NeteaseSongCard from './NeteaseSongCard';
import SecondaryContainer from '../SecondaryContainer';

type Props = {
  recommendations: NeteaseSongSummary[];
  personalizedPlaylists: NeteasePlaylistSummary[];
  noOfVisibleSongCards: number;
};

/**
 * The NetEase section of the home page: the daily-recommended songs as a card row and the
 * personalized playlists as a tile row. Sections render only when their data is present (the
 * recommendations require a logged-in NetEase account; the personalized list works anonymously).
 */
const NeteaseRecommendations = (props: Props) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { recommendations, personalizedPlaylists, noOfVisibleSongCards = 6 } = props;

  const visibleRecommendations = useMemo(
    () => recommendations.slice(0, noOfVisibleSongCards),
    [recommendations, noOfVisibleSongCards]
  );

  const visiblePersonalizedPlaylists = useMemo(
    () => personalizedPlaylists.slice(0, noOfVisibleSongCards),
    [personalizedPlaylists, noOfVisibleSongCards]
  );

  if (recommendations.length === 0 && personalizedPlaylists.length === 0) return null;

  return (
    <>
      {visibleRecommendations.length > 0 && (
        <SecondaryContainer className="netease-recommendations-container appear-from-bottom flex h-fit max-h-full flex-col pb-8 pl-8">
          <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-4 flex items-center justify-between text-2xl font-medium">
            {t('homePage.neteaseDailyRecommendations')}
            <Button
              label={t('common.showAll')}
              tooltipLabel={t('homePage.openNeteaseSearch')}
              iconName="apps"
              className="show-all-btn text-sm font-normal"
              clickHandler={() => navigate({ to: '/main-player/netease/search' })}
            />
          </div>
          <div
            style={{
              gridTemplateColumns: `repeat(${Math.floor(noOfVisibleSongCards / 2)},1fr)`
            }}
            className="songs-container grid grid-rows-2 gap-2 pr-2"
          >
            {visibleRecommendations.map((song) => (
              <NeteaseSongCard key={song.songId} summary={song} />
            ))}
          </div>
        </SecondaryContainer>
      )}

      {visiblePersonalizedPlaylists.length > 0 && (
        <SecondaryContainer className="netease-personalized-playlists-container appear-from-bottom flex h-fit max-h-full flex-col pb-8 pl-8">
          <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-4 flex items-center justify-between text-2xl font-medium">
            {t('homePage.neteasePersonalizedPlaylists')}
          </div>
          <div className="playlists-container flex flex-wrap">
            {visiblePersonalizedPlaylists.map((playlist) => (
              <NeteasePlaylistCard key={playlist.playlistId} playlist={playlist} />
            ))}
          </div>
        </SecondaryContainer>
      )}
    </>
  );
};

NeteaseRecommendations.displayName = 'NeteaseRecommendations';
export default NeteaseRecommendations;
