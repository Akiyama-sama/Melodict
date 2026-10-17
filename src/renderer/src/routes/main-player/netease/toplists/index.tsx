import MainContainer from '@renderer/components/MainContainer';
import NeteaseSongRow from '@renderer/components/Netease/NeteaseSongRow';
import TitleContainer from '@renderer/components/TitleContainer';
import VirtualizedList from '@renderer/components/VirtualizedList';
import { neteaseQuery } from '@renderer/queries/netease';
import { baseInfoPageSearchParamsSchema } from '@renderer/utils/zod/baseInfoPageSearchParamsSchema';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/main-player/netease/toplists/')({
  validateSearch: baseInfoPageSearchParamsSchema.extend({
    toplistId: z.string().optional()
  }),
  component: NeteaseToplistsPage
});

/** The NetEase toplists ("leaderboard" sidebar entry): grid of lists, one list expanded inline. */
function NeteaseToplistsPage() {
  const { toplistId } = Route.useSearch({ select: (s) => ({ toplistId: s.toplistId }) });
  const navigate = useNavigate({ from: Route.fullPath });

  const { t } = useTranslation();

  const { data: toplists = [] } = useSuspenseQuery(neteaseQuery.toplists);

  const selectedToplist = toplistId ?? toplists[0]?.playlistId;

  const { data: selected, isFetching } = useQuery({
    ...neteaseQuery.playlistDetail(selectedToplist ?? '0'),
    enabled: !!selectedToplist,
    staleTime: 5 * 60_000
  });

  return (
    <MainContainer className="netease-toplists-container appear-from-bottom h-full! pl-8!">
      <TitleContainer title={t('netease.toplists')} className="pr-4" />

      <div className="toplists-container mb-8 flex flex-wrap gap-2 pr-8">
        {toplists.map((toplist) => (
          <button
            type="button"
            key={toplist.playlistId}
            className={`toplist-chip flex cursor-pointer items-center rounded-3xl px-4 py-2 text-sm transition-[background] ${
              toplist.playlistId === selectedToplist
                ? 'bg-background-color-3 text-font-color-black dark:bg-dark-background-color-3 dark:text-font-color-black!'
                : 'bg-background-color-2 text-font-color-black hover:bg-background-color-3 dark:bg-dark-background-color-2 dark:text-font-color-white dark:hover:bg-dark-background-color-3'
            }`}
            onClick={() => {
              navigate({ search: (prev) => ({ ...prev, toplistId: toplist.playlistId }) });
            }}
          >
            {toplist.name}
          </button>
        ))}
      </div>

      {selected && (
        <>
          <div className="toplist-title-container text-font-color-black dark:text-font-color-white mb-4 ml-2 flex items-center gap-4 text-2xl">
            <img
              src={selected.playlist.coverImgUrl}
              alt={selected.playlist.name}
              className="h-16 w-16 rounded-lg object-cover"
              loading="lazy"
            />
            <div className="min-w-0">
              <div className="truncate font-medium">{selected.playlist.name}</div>
              <div className="text-sm opacity-60">
                {t('common.songWithCount', { count: selected.songs.length })}
              </div>
            </div>
          </div>
          <VirtualizedList
            data={selected.songs}
            fixedItemHeight={60}
            itemContent={(index, song) => (
              <NeteaseSongRow key={song.songId} index={index} summary={song} />
            )}
          />
        </>
      )}

      {isFetching && (
        <div className="loading-container flex h-24 items-center justify-center">
          <span className="material-icons-round-outlined animate-spin text-4xl opacity-60">
            progress_activity
          </span>
        </div>
      )}
    </MainContainer>
  );
}
