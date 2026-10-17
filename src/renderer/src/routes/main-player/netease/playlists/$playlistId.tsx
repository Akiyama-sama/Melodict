import DefaultPlaylistCover from '@renderer/assets/images/webp/playlist_cover_default.webp';
import Img from '@renderer/components/Img';
import MainContainer from '@renderer/components/MainContainer';
import NeteaseSongRow from '@renderer/components/Netease/NeteaseSongRow';
import TitleContainer from '@renderer/components/TitleContainer';
import VirtualizedList from '@renderer/components/VirtualizedList';
import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import { queryClient } from '@renderer/index';
import { neteaseQuery } from '@renderer/queries/netease';
import calculateTimeFromSeconds from '@renderer/utils/calculateTimeFromSeconds';
import { baseInfoPageSearchParamsSchema } from '@renderer/utils/zod/baseInfoPageSearchParamsSchema';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/main-player/netease/playlists/$playlistId')({
  validateSearch: baseInfoPageSearchParamsSchema,
  component: NeteasePlaylistInfoPage,
  loader: async ({ params }) => {
    await queryClient.ensureQueryData(neteaseQuery.playlistDetail(params.playlistId));
  }
});

/**
 * Renders a NetEase playlist: cover + metadata header, play/shuffle/add-to-queue controls and a
 * virtualized track list of the playlist's songs, mirroring the local playlist detail page.
 */
function NeteasePlaylistInfoPage() {
  const { playlistId } = Route.useParams();
  const { scrollTopOffset } = Route.useSearch();

  const { createQueue, playSong, updateQueueData, addNewNotifications } =
    useContext(AppUpdateContext);
  const { t } = useTranslation();

  const { data } = useSuspenseQuery(neteaseQuery.playlistDetail(playlistId));
  const { playlist, songs } = data;

  const queueSongIds = useMemo(() => songs.map((song) => song.songId), [songs]);

  const playlistDuration = useMemo(
    () =>
      calculateTimeFromSeconds(songs.reduce((prev, current) => prev + current.duration, 0))
        .timeString,
    [songs]
  );

  const playAll = useCallback(() => {
    createQueue(queueSongIds, 'playlist', false, playlist.playlistId, true);
  }, [createQueue, playlist.playlistId, queueSongIds]);

  const shuffleAndPlayAll = useCallback(() => {
    createQueue(queueSongIds, 'playlist', true, playlist.playlistId, true);
  }, [createQueue, playlist.playlistId, queueSongIds]);

  const addToQueue = useCallback(() => {
    updateQueueData(undefined, [...queueSongIds]);
    addNewNotifications([
      {
        id: `netease-playlist-${playlist.playlistId}`,
        duration: 5000,
        content: t('notifications.addedToQueue', { count: songs.length })
      }
    ]);
  }, [addNewNotifications, playlist.playlistId, queueSongIds, songs.length, t, updateQueueData]);

  const handleRowPlayClick = useCallback(
    (songId: number) => {
      createQueue(queueSongIds, 'playlist', false, playlist.playlistId, false);
      playSong(songId, true);
    },
    [createQueue, playSong, playlist.playlistId, queueSongIds]
  );

  return (
    <MainContainer className="netease-playlist-info-page-container appear-from-bottom h-full! px-8 pr-0! pb-0!">
      <TitleContainer
        title={playlist.name}
        className="pr-4"
        buttons={[
          {
            label: t('common.playAll'),
            iconName: 'play_arrow',
            clickHandler: playAll,
            isDisabled: songs.length === 0
          },
          {
            tooltipLabel: t('common.shuffleAndPlay'),
            iconName: 'shuffle',
            clickHandler: shuffleAndPlayAll,
            isDisabled: songs.length === 0
          },
          {
            tooltipLabel: t('common.addToQueue'),
            iconName: 'add',
            clickHandler: addToQueue,
            isDisabled: songs.length === 0
          }
        ]}
      />

      <VirtualizedList
        data={songs}
        fixedItemHeight={60}
        scrollTopOffset={scrollTopOffset}
        components={{
          Header: () => (
            <div className="netease-playlist-img-and-info-container text-font-color-black dark:text-font-color-white mb-8 flex flex-row items-center justify-start">
              <Img
                src={playlist.coverImgUrl || DefaultPlaylistCover}
                fallbackSrc={DefaultPlaylistCover}
                className="w-52 rounded-xl lg:w-48"
                alt="Netease Playlist Cover"
                loading="eager"
              />
              <div className="playlist-info-container ml-8 min-w-0 flex-1 pr-8">
                <div className="font-semibold tracking-wider uppercase opacity-50">
                  {t('common.playlist_one')}
                </div>
                <div className="playlist-name text-font-color-highlight dark:text-dark-font-color-highlight mb-2 w-full overflow-hidden text-5xl text-ellipsis whitespace-nowrap">
                  {playlist.name}
                </div>
                <div className="playlist-nickname w-full overflow-hidden text-base text-ellipsis whitespace-nowrap">
                  {playlist.nickname}
                </div>
                <div className="playlist-no-of-songs w-full overflow-hidden text-base text-ellipsis whitespace-nowrap">
                  {t('common.songWithCount', { count: songs.length })}
                </div>
                {songs.length > 0 && (
                  <div className="playlist-total-duration">{playlistDuration}</div>
                )}
                {playlist.description && (
                  <p
                    className="mt-2 line-clamp-2 w-full text-sm opacity-60"
                    title={playlist.description}
                  >
                    {playlist.description}
                  </p>
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
