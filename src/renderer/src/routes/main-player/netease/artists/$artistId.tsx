import MainContainer from '@renderer/components/MainContainer';
import NeteaseSongRow from '@renderer/components/Netease/NeteaseSongRow';
import TitleContainer from '@renderer/components/TitleContainer';
import VirtualizedList from '@renderer/components/VirtualizedList';
import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import Img from '@renderer/components/Img';
import { queryClient } from '@renderer/index';
import { neteaseQuery } from '@renderer/queries/netease';
import calculateTimeFromSeconds from '@renderer/utils/calculateTimeFromSeconds';
import { baseInfoPageSearchParamsSchema } from '@renderer/utils/zod/baseInfoPageSearchParamsSchema';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/main-player/netease/artists/$artistId')({
  validateSearch: baseInfoPageSearchParamsSchema,
  component: NeteaseArtistInfoPage,
  loader: async ({ params }) => {
    await queryClient.ensureQueryData(neteaseQuery.artistDetail(params.artistId));
  }
});

/**
 * Renders a NetEase artist page: round avatar + metadata header, hot songs controls and a
 * virtualized hot-song list, mirroring the artist detail route shape of local pages.
 */
function NeteaseArtistInfoPage() {
  const { artistId } = Route.useParams();
  const { scrollTopOffset } = Route.useSearch();

  const { createQueue, playSong, updateQueueData, addNewNotifications } =
    useContext(AppUpdateContext);
  const { t } = useTranslation();

  const { data } = useSuspenseQuery(neteaseQuery.artistDetail(artistId));
  const { artist, hotSongs } = data;

  const queueSongIds = useMemo(() => hotSongs.map((song) => song.songId), [hotSongs]);

  const artistSongsDuration = useMemo(
    () =>
      calculateTimeFromSeconds(hotSongs.reduce((prev, current) => prev + current.duration, 0))
        .timeString,
    [hotSongs]
  );

  const playAll = useCallback(() => {
    createQueue(queueSongIds, 'artist', false, artist.artistId, true);
  }, [artist.artistId, createQueue, queueSongIds]);

  const shuffleAndPlayAll = useCallback(() => {
    createQueue(queueSongIds, 'artist', true, artist.artistId, true);
  }, [artist.artistId, createQueue, queueSongIds]);

  const addToQueue = useCallback(() => {
    updateQueueData(undefined, [...queueSongIds]);
    addNewNotifications([
      {
        id: `netease-artist-${artist.artistId}`,
        duration: 5000,
        content: t('notifications.addedToQueue', { count: hotSongs.length })
      }
    ]);
  }, [addNewNotifications, artist.artistId, hotSongs.length, queueSongIds, t, updateQueueData]);

  const handleRowPlayClick = useCallback(
    (songId: number) => {
      createQueue(queueSongIds, 'artist', false, artist.artistId, false);
      playSong(songId, true);
    },
    [artist.artistId, createQueue, playSong, queueSongIds]
  );

  return (
    <MainContainer className="netease-artist-info-page-container appear-from-bottom h-full! px-8 pr-0! pb-0!">
      <TitleContainer
        title={artist.name}
        className="pr-4"
        buttons={[
          {
            label: t('common.playAll'),
            iconName: 'play_arrow',
            clickHandler: playAll,
            isDisabled: hotSongs.length === 0
          },
          {
            tooltipLabel: t('common.shuffleAndPlay'),
            iconName: 'shuffle',
            clickHandler: shuffleAndPlayAll,
            isDisabled: hotSongs.length === 0
          },
          {
            tooltipLabel: t('common.addToQueue'),
            iconName: 'add',
            clickHandler: addToQueue,
            isDisabled: hotSongs.length === 0
          }
        ]}
      />

      <VirtualizedList
        data={hotSongs}
        fixedItemHeight={60}
        scrollTopOffset={scrollTopOffset}
        components={{
          Header: () => (
            <div className="netease-artist-img-and-info-container text-font-color-black dark:text-font-color-white mb-8 flex flex-row items-center justify-start">
              <Img
                src={artist.cover || undefined}
                fallbackSrc={undefined}
                className="aspect-square w-52 rounded-full object-cover shadow-lg lg:w-48"
                alt="Netease Artist Avatar"
                loading="eager"
              />
              <div className="artist-info-container ml-8">
                <div className="font-semibold tracking-wider uppercase opacity-50">
                  {t('common.artist_one')}
                </div>
                <div className="artist-name text-font-color-highlight dark:text-dark-font-color-highlight mb-2 w-full overflow-hidden text-5xl text-ellipsis whitespace-nowrap">
                  {artist.name}
                </div>
                {artist.alias.length > 0 && (
                  <div className="artist-alias w-full overflow-hidden text-base text-ellipsis whitespace-nowrap opacity-70">
                    {artist.alias.join(' / ')}
                  </div>
                )}
                <div className="artist-song-count w-full overflow-hidden text-base text-ellipsis whitespace-nowrap">
                  {t('common.songWithCount', { count: hotSongs.length })}
                </div>
                {hotSongs.length > 0 && (
                  <div className="artist-total-duration">{artistSongsDuration}</div>
                )}
              </div>
            </div>
          )
        }}
        itemContent={(index, song) => (
          <NeteaseSongRow
            key={song.songId}
            index={index}
            summary={song}
            onPlayClick={handleRowPlayClick}
          />
        )}
      />
    </MainContainer>
  );
}
