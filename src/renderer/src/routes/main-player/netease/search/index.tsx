import Button from '@renderer/components/Button';
import MainContainer from '@renderer/components/MainContainer';
import NeteaseAlbumCard from '@renderer/components/Netease/NeteaseAlbumCard';
import NeteaseArtistCard from '@renderer/components/Netease/NeteaseArtistCard';
import NeteasePlaylistCard from '@renderer/components/Netease/NeteasePlaylistCard';
import NeteaseSearchInput from '@renderer/components/Netease/NeteaseSearchInput';
import NeteaseSongRow from '@renderer/components/Netease/NeteaseSongRow';
import SecondaryContainer from '@renderer/components/SecondaryContainer';
import { neteaseQuery } from '@renderer/queries/netease';
import { useThrottledCallback } from '@tanstack/react-pacer';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type NeteaseSearchFilter = 'songs' | 'albums' | 'artists' | 'playlists';

const NETEASE_SEARCH_FILTERS: {
  value: NeteaseSearchFilter;
  labelKey:
    | 'common.song_other'
    | 'common.album_other'
    | 'common.artist_other'
    | 'common.playlist_other';
  icon: string;
}[] = [
  { value: 'songs', labelKey: 'common.song_other', icon: 'music_note' },
  { value: 'albums', labelKey: 'common.album_other', icon: 'album' },
  { value: 'artists', labelKey: 'common.artist_other', icon: 'people' },
  { value: 'playlists', labelKey: 'common.playlist_other', icon: 'queue_music' }
];

const FILTER_TO_SEARCH_TYPE: Record<NeteaseSearchFilter, NeteaseSearchTypes> = {
  songs: 1,
  albums: 10,
  artists: 100,
  playlists: 1000
};

const neteaseSearchPageSchema = z.object({
  keyword: z.string().optional().default(''),
  filterBy: z.enum(['songs', 'albums', 'artists', 'playlists']).optional()
});

export const Route = createFileRoute('/main-player/netease/search/')({
  validateSearch: neteaseSearchPageSchema,
  component: NeteaseSearchPage
});

function NeteaseSearchPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const { keyword, filterBy = 'songs' } = Route.useSearch();

  const searchContainerRef = useRef(null);
  const [searchText, setSearchText] = useState(keyword);

  // The input echoes instantly through local state; the URL keyword (throttled) is what drives
  // the results query below, so typing and searching run on separate clocks.
  const throttledSetSearch = useThrottledCallback(
    (value) => {
      navigate({ search: (prev) => ({ ...prev, keyword: value }), replace: true });
    },
    { wait: 800 }
  );

  const updateSearchInput = (input: string) => {
    const value = input ?? '';
    setSearchText(value);
    throttledSetSearch(value);
  };

  const trimmedKeyword = (keyword ?? '').trim();

  const { data: searchResults, isFetching } = useQuery({
    ...neteaseQuery.search({
      keywords: trimmedKeyword,
      type: FILTER_TO_SEARCH_TYPE[filterBy]
    }),
    // Anonymous sessions can search; a session (when present) only enriches VIP-accurate data.
    enabled: trimmedKeyword.length > 0,
    staleTime: 60_000
  });

  const hasResults = useMemo(
    () =>
      !!searchResults &&
      (searchResults.songs.length > 0 ||
        searchResults.albums.length > 0 ||
        searchResults.artists.length > 0 ||
        searchResults.playlists.length > 0),
    [searchResults]
  );

  return (
    <MainContainer
      className="netease-search-page h-full! overflow-hidden [scrollbar-gutter:stable] pb-0! pl-8!"
      ref={searchContainerRef}
    >
      <div className="search-controls-container">
        <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-4 flex items-center justify-between pr-4 text-3xl font-medium">
          {t('netease.searchTitle')}
        </div>
        <div className="search-input-container appear-from-bottom mb-4 flex items-center">
          <div className="search-bar-container bg-background-color-2 dark:bg-dark-background-color-2 flex w-1/2 max-w-xl min-w-[25rem] items-center rounded-3xl px-2 py-1">
            <NeteaseSearchInput
              value={searchText}
              onChange={updateSearchInput}
              onSubmit={(keyword) =>
                navigate({ search: (prev) => ({ ...prev, keyword }), replace: true })
              }
              placeholder={t('netease.searchPlaceholder')}
              ariaLabel={t('netease.searchTitle')}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>
        </div>
        {/* SEARCH FILTERS */}
        <div className="search-filters-container mb-6">
          <ul className="flex items-center">
            {NETEASE_SEARCH_FILTERS.map((filter) => (
              <li key={filter.value} className="mr-3">
                <Button
                  className={`appear-from-bottom text-font-color-black mr-0! flex w-fit cursor-pointer list-none items-center !border-0 outline-offset-1 transition-[width,background,color] duration-200 focus-visible:!outline ${
                    filterBy === filter.value
                      ? 'active bg-background-color-3 dark:bg-dark-background-color-3 dark:text-font-color-black!'
                      : 'bg-background-color-2 hover:bg-background-color-3 dark:bg-dark-background-color-2 dark:text-font-color-white dark:hover:bg-dark-background-color-3 dark:hover:text-font-color-black!'
                  }`}
                  clickHandler={() => {
                    navigate({ search: (prev) => ({ ...prev, filterBy: filter.value }) });
                  }}
                  label={t(filter.labelKey)}
                  iconName={filter.icon}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
      {/* The results area owns the scrolling. The app shell around every page is
          `overflow-hidden`, so this page — the only NetEase page rendering a plain flow list —
          lost everything below the fold before it grew its own scroll container (the library
          pages scroll inside react-virtuoso instead and never hit this). `min-h-0` lets the
          flex-1 area shrink to the space left under the fixed controls. */}
      <div className="search-results-container relative h-full! min-h-0 flex-1 overflow-y-auto pr-4">
        {trimmedKeyword.length === 0 && (
          <div className="text-sm opacity-60">{t('netease.searchStartHint')}</div>
        )}

        {trimmedKeyword.length > 0 && filterBy === 'songs' && (searchResults?.songs?.length ?? 0) > 0 && (
          <div className="songs-search-results-container pb-8">
            {searchResults?.songs.map((song, index) => (
              <NeteaseSongRow key={song.songId} index={index} summary={song} />
            ))}
          </div>
        )}

        {trimmedKeyword.length > 0 && filterBy === 'albums' && (searchResults?.albums?.length ?? 0) > 0 && (
          <SecondaryContainer className="flex flex-wrap pb-8 pl-0!">
            {searchResults?.albums.map((album) => (
              <NeteaseAlbumCard key={album.albumId} album={album} />
            ))}
          </SecondaryContainer>
        )}

        {trimmedKeyword.length > 0 && filterBy === 'artists' && (searchResults?.artists?.length ?? 0) > 0 && (
          <SecondaryContainer className="flex flex-wrap pb-8 pl-0!">
            {searchResults?.artists.map((artist) => (
              <NeteaseArtistCard key={artist.artistId} artist={artist} />
            ))}
          </SecondaryContainer>
        )}

        {trimmedKeyword.length > 0 && filterBy === 'playlists' && (searchResults?.playlists?.length ?? 0) > 0 && (
          <SecondaryContainer className="flex flex-wrap pb-8 pl-0!">
            {searchResults?.playlists.map((playlist) => (
              <NeteasePlaylistCard key={playlist.playlistId} playlist={playlist} />
            ))}
          </SecondaryContainer>
        )}

        {trimmedKeyword.length > 0 && !isFetching && !hasResults && (
          <div className="no-netease-search-results-container my-[10%] flex h-full w-full flex-col items-center justify-center text-center text-xl">
            <span className="material-icons-round-outlined text-font-color-highlight dark:text-dark-font-color-highlight mb-4 text-6xl">
              search_off
            </span>{' '}
            <div className="text-font-color-highlight dark:text-dark-font-color-highlight mb-2 text-2xl font-medium">
              {t('netease.noSearchResults')}
            </div>
            <p className="text-sm opacity-70">{t('netease.noSearchResultsHint')}</p>
          </div>
        )}
      </div>
    </MainContainer>
  );
}
