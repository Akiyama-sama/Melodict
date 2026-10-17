import { isNeteaseSongId } from '@common/netease';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { neteaseQuery } from '../queries/netease';
import type { NeteaseSongSummary } from '@common/netease';

export type QueueRowData =
  | { kind: 'local'; song: SongData }
  | { kind: 'netease'; summary: NeteaseSongSummary };

/**
 * Merges the current queue into renderable rows: local song ids resolve through the regular songs
 * query (whose cache already holds the page data), while NetEase sentinel ids are fetched in one
 * batched query. Rows keep the queue's order so drag-and-drop indexes stay valid.
 *
 * Returns `undefined` while local rows are still loading so the queue page can keep its existing
 * loading behavior.
 */
export function useNeteaseQueueRows(
  currentQueue: number[],
  localSongs: SongData[] | undefined
): QueueRowData[] | undefined {
  const neteaseIds = useMemo(
    () => currentQueue.filter((songId) => isNeteaseSongId(songId)).map((id) => -(id + 1)),
    [currentQueue]
  );

  const { data: summaries = [] } = useQuery({
    ...neteaseQuery.songSummaries(neteaseIds),
    enabled: neteaseIds.length > 0,
    // Sentinel ids only exist online; retrying would hammer the API for removed songs.
    retry: false
  });

  const summariesById = useMemo(() => {
    const map = new Map<number, NeteaseSongSummary>();
    for (const summary of summaries) map.set(summary.neteaseSongId, summary);
    return map;
  }, [summaries]);

  return useMemo(() => {
    if (localSongs === undefined) return undefined;

    const localById = new Map(localSongs.map((song) => [song.songId, song]));

    return currentQueue.map((songId): QueueRowData | null => {
      if (isNeteaseSongId(songId)) {
        const summary = summariesById.get(-(songId + 1));
        return summary ? { kind: 'netease', summary } : null;
      }
      const song = localById.get(songId);
      return song ? { kind: 'local', song } : null;
    }).filter((row): row is QueueRowData => row !== null);
  }, [currentQueue, localSongs, summariesById]);
}
