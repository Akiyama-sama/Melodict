import DefaultAlbumCover from '@renderer/assets/images/webp/album_cover_default.webp';
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
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/main-player/netease/albums/$albumId')({
  validateSearch: baseInfoPageSearchParamsSchema,
  component: NeteaseAlbumInfoPage,
  loader: async ({ params }) => {
    await queryClient.ensureQueryData(neteaseQuery.albumDetail(params.albumId));
  }
});

/**
 * Renders a NetEase album: cover + metadata header, play/shuffle/add-to-queue controls and a
 * virtualized song list, mirroring the local album detail page. The header links to the artist.
 */
function NeteaseAlbumInfoPage() {
  const { albumId } = Route.useParams();
  const { scrollTopOffset } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const { createQueue, playSong, updateQueueData, addNewNotifications } =
    useContext(AppUpdateContext);
  const { t } = useTranslation();

  const { data } = useSuspenseQuery(neteaseQuery.albumDetail(albumId));
  const { album, songs } = data;

  const queueSongIds = useMemo(() => songs.map((song) => song.songId), [songs]);

  const albumDuration = useMemo(
    () =>
      calculateTimeFromSeconds(songs.reduce((prev, current) => prev + current.duration, 0))
        .timeString,
    [songs]
  );

  const playAll = useCallback(() => {
    createQueue(queueSongIds, 'album', false, album.albumId, true);
  }, [album.albumId, createQueue, queueSongIds]);

  const shuffleAndPlayAll = useCallback(() => {
    createQueue(queueSongIds, 'album', true, album.albumId, true);
  }, [album.albumId, createQueue, queueSongIds]);

  const addToQueue = useCallback(() => {
    updateQueueData(undefined, [...queueSongIds]);
    addNewNotifications([
      {
        id: `netease-album-${album.albumId}`,
        duration: 5000,
        content: t('notifications.addedToQueue', { count: songs.length })
      }
    ]);
  }, [addNewNotifications, album.albumId, queueSongIds, songs.length, t, updateQueueData]);

  const handleRowPlayClick = useCallback(
    (songId: number) => {
      createQueue(queueSongIds, 'album', false, album.albumId, false);
      playSong(songId, true);
    },
    [album.albumId, createQueue, playSong, queueSongIds]
  );

  return (
    <MainContainer className="netease-album-info-page-container appear-from-bottom h-full! px-8 pr-0! pb-0!">
      <TitleContainer
        title={album.name}
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
            <div className="netease-album-img-and-info-container text-font-color-black dark:text-font-color-white mb-8 flex flex-row items-center justify-start">
              <Img
                src={album.coverImgUrl || DefaultAlbumCover}
                fallbackSrc={DefaultAlbumCover}
                className="w-52 rounded-xl lg:w-48"
                alt="Netease Album Cover"
                loading="eager"
              />
              <div className="album-info-container ml-8 min-w-0 flex-1 pr-8">
                <div className="font-semibold tracking-wider uppercase opacity-50">
                  {t('common.album_one')}
                </div>
                <div className="album-name text-font-color-highlight dark:text-dark-font-color-highlight mb-2 w-full overflow-hidden text-5xl text-ellipsis whitespace-nowrap">
                  {album.name}
                </div>
                <button
                  type="button"
                  className="album-artist w-full cursor-pointer overflow-hidden text-base text-ellipsis whitespace-nowrap hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate({
                      to: '/main-player/netease/artists/$artistId',
                      params: { artistId: String(album.artistId) }
                    });
                  }}
                >
                  {album.artistName || t('common.unknownArtist')}
                </button>
                <div className="album-no-of-songs w-full overflow-hidden text-base text-ellipsis whitespace-nowrap">
                  {t('common.songWithCount', { count: songs.length })}
                </div>
                {songs.length > 0 && <div className="album-total-duration">{albumDuration}</div>}
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
