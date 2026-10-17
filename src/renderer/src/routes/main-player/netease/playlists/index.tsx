import NoPlaylistsImage from '@assets/images/svg/Empty Inbox _Monochromatic.svg';
import Img from '@renderer/components/Img';
import MainContainer from '@renderer/components/MainContainer';
import NeteaseNotLoggedInNotice from '@renderer/components/Netease/NeteaseNotLoggedInNotice';
import NeteasePlaylistCard from '@renderer/components/Netease/NeteasePlaylistCard';
import { useNeteaseSession } from '@renderer/hooks/useNeteaseSession';
import { neteaseQuery } from '@renderer/queries/netease';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/main-player/netease/playlists/')({
  component: NeteaseUserPlaylistsPage
});

/** The logged-in user's NetEase playlists as a card grid ("my playlists" sidebar entry). */
function NeteaseUserPlaylistsPage() {
  const { profile, isLoggedIn, isLoading } = useNeteaseSession();
  const { t } = useTranslation();

  const { data: playlists = [], isFetching } = useQuery({
    ...neteaseQuery.userPlaylists(profile?.userId ?? 0),
    enabled: isLoggedIn && !!profile?.userId,
    staleTime: 5 * 60_000
  });

  return (
    <MainContainer className="netease-user-playlists-container appear-from-bottom h-full! overflow-hidden pb-0! pl-8!">
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-8 flex items-center pr-4 text-3xl font-medium">
        <div className="container flex">
          {t('netease.myPlaylists')}
          {playlists.length > 0 && (
            <div className="other-stats-container text-font-color-black dark:text-font-color-white ml-12 flex items-center text-xs">
              <span>{t('common.playlistWithCount', { count: playlists.length })}</span>
            </div>
          )}
        </div>
      </div>

      {!isLoggedIn && !isLoading && <NeteaseNotLoggedInNotice />}

      {isLoggedIn && playlists.length > 0 && (
        <div className="playlists-container appear-from-bottom flex flex-wrap">
          {playlists.map((playlist) => (
            <NeteasePlaylistCard key={playlist.playlistId} playlist={playlist} />
          ))}
        </div>
      )}

      {isLoggedIn && playlists.length === 0 && (isFetching || isLoading) && (
        <div className="loading-container flex h-full items-center justify-center">
          <span className="material-icons-round-outlined animate-spin text-4xl opacity-60">
            progress_activity
          </span>
        </div>
      )}

      {isLoggedIn && !isFetching && playlists.length === 0 && (
        <div className="no-playlists-container text-font-color-black dark:text-font-color-white my-[10%] flex h-full w-full flex-col items-center justify-center text-center text-xl">
          <Img src={NoPlaylistsImage} alt="" className="mb-8 w-60" />
          <div>{t('netease.noPlaylists')}</div>
        </div>
      )}
    </MainContainer>
  );
}


