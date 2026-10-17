import MainContainer from '@renderer/components/MainContainer';
import NeteaseSongRow from '@renderer/components/Netease/NeteaseSongRow';
import TitleContainer from '@renderer/components/TitleContainer';
import VirtualizedList from '@renderer/components/VirtualizedList';
import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import NeteaseNotLoggedInNotice from '@renderer/components/Netease/NeteaseNotLoggedInNotice';
import { useNeteaseSession } from '@renderer/hooks/useNeteaseSession';
import { queryClient } from '@renderer/index';
import { neteaseQuery } from '@renderer/queries/netease';
import calculateTimeFromSeconds from '@renderer/utils/calculateTimeFromSeconds';
import { baseInfoPageSearchParamsSchema } from '@renderer/utils/zod/baseInfoPageSearchParamsSchema';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/main-player/netease/liked/')({
  validateSearch: baseInfoPageSearchParamsSchema,
  component: NeteaseLikedSongsPage,
  loader: async () => {
    await queryClient.ensureQueryData(neteaseQuery.session);
  }
});

/** The logged-in user's liked ("favorite") NetEase songs, mirroring local playlist detail lists. */
function NeteaseLikedSongsPage() {
  const { profile, isLoggedIn, isLoading } = useNeteaseSession();
  const { scrollTopOffset } = Route.useSearch({ select: (s) => ({ scrollTopOffset: s.scrollTopOffset }) });

  const { createQueue, playSong } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const { data: songs = [], isFetching } = useQuery({
    ...neteaseQuery.likedSongs(profile?.userId ?? 0),
    enabled: isLoggedIn && !!profile?.userId,
    staleTime: 5 * 60_000
  });

  const handleRowPlayClick = useCallback(
    (songId: number) => {
      createQueue(
        songs.map((song) => song.songId),
        'playlist',
        false,
        undefined,
        false
      );
      playSong(songId, true);
    },
    [createQueue, playSong, songs]
  );

  const playlistDuration = calculateTimeFromSeconds(
    songs.reduce((prev, current) => prev + current.duration, 0)
  ).timeString;

  return (
    <MainContainer className="netease-liked-songs-container appear-from-bottom h-full! px-8 pr-0! pb-0!">
      <TitleContainer
        title={t('netease.likedSongs')}
        className="pr-4"
        buttons={[
          {
            label: t('common.playAll'),
            iconName: 'play_arrow',
            isDisabled: songs.length === 0,
            clickHandler: () =>
              createQueue(
                songs.map((song) => song.songId),
                'playlist',
                false,
                undefined,
                true
              )
          },
          {
            tooltipLabel: t('common.shuffleAndPlay'),
            iconName: 'shuffle',
            isDisabled: songs.length === 0,
            clickHandler: () =>
              createQueue(
                songs.map((song) => song.songId),
                'playlist',
                true,
                undefined,
                true
              )
          }
        ]}
      />

      {!isLoggedIn && !isLoading && <NeteaseNotLoggedInNotice />}

      {isLoggedIn && (
        <VirtualizedList
          data={songs}
          fixedItemHeight={60}
          scrollTopOffset={scrollTopOffset}
          itemContent={(index, song) => (
            <NeteaseSongRow
              key={song.songId}
              index={index}
              summary={song}
              onPlayClick={handleRowPlayClick}
            />
          )}
        />
      )}

      {isLoggedIn && songs.length > 0 && (
        <div className="netease-liked-summary text-font-color-black dark:text-font-color-white ml-8 mt-4 text-sm opacity-60">
          {t('common.songWithCount', { count: songs.length })} • {playlistDuration}
        </div>
      )}

      {isLoggedIn && songs.length === 0 && (isFetching || isLoading) && (
        <div className="loading-container flex h-full items-center justify-center">
          <span className="material-icons-round-outlined animate-spin text-4xl opacity-60">
            progress_activity
          </span>
        </div>
      )}

      {isLoggedIn && songs.length === 0 && !isFetching && (
        <div className="no-songs-container flex h-full w-full flex-col items-center justify-center text-center text-xl">
          <span className="material-icons-round-outlined text-font-color-highlight dark:text-dark-font-color-highlight mb-4 text-6xl">
            favorite_border
          </span>
          <p className="text-sm opacity-70">{t('netease.noLikedSongs')}</p>
        </div>
      )}
    </MainContainer>
  );
}
