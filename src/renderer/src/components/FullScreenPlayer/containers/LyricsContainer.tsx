import { store } from '@renderer/store/store';
import { useStore } from '@tanstack/react-store';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { LyricsAnalysisToken } from '../../../../../common/lyricsAnalysis';
import useLyricsAnalysis from '../../../hooks/useLyricsAnalysis';
import useSkipLyricsLines from '../../../hooks/useSkipLyricsLines';
import useSongLyrics from '../../../hooks/useSongLyrics';
import { getLineIdForIndex } from '../../../other/lyricsAnalysisUtils';
import LyricLine from '../../LyricsPage/LyricLine';
import LyricsMetadata from '../../LyricsPage/LyricsMetadata';

type Props = {
  setIsLyricsAvailable: (state: boolean) => void;
  selectedToken?: { token: LyricsAnalysisToken; line: LyricsAnalysisLine };
  /** Whether the word panel is open — it, not the selected token, drives the lyrics layout. */
  isPanelOpen?: boolean;
  /** When false, lyric lines render as plain text even where analysis is available. */
  isAnalysisView?: boolean;
  onTokenClick: (token: LyricsAnalysisToken, line: LyricsAnalysisLine) => void;
};

// Memoized: the fullscreen player re-renders on every song-position tick (songPos state), but
// this subtree only depends on its own props, all of which hold stable across those ticks —
// the setters and the click handler are useCallback'd, isPanelOpen/isAnalysisView are booleans,
// and selectedToken only changes identity when the selection actually changes.
const LyricsContainer = memo((props: Props) => {
  const currentSongData = useStore(store, (state) => state.currentSongData);

  const { setIsLyricsAvailable, selectedToken, isPanelOpen = false, isAnalysisView = true, onTokenClick } =
    props;
  const { t } = useTranslation();

  // Reported ahead of the enhancement sequence, exactly where the inline implementation used to
  // call it; the setter is stable, so this callback never re-triggers the loading effect.
  const handleLyricsLoaded = useCallback(
    (res: SongLyrics | undefined) => setIsLyricsAvailable(res?.lyrics?.isSynced ?? false),
    [setIsLyricsAvailable]
  );
  const { lyrics } = useSongLyrics({ onLyricsLoaded: handleLyricsLoaded });
  useSkipLyricsLines(lyrics);

  const { linesById } = useLyricsAnalysis({
    songPath: currentSongData.path,
    songTitle: currentSongData.title,
    songArtists: Array.isArray(currentSongData.artists)
      ? currentSongData.artists.map((artist) => artist.name)
      : [],
    lyrics
  });

  // Only the raw line/token ids of the selection matter to the rendered lines; keying the memo on
  // the primitives (instead of the selectedToken object) keeps unrelated re-renders of the parent
  // from rebuilding the whole line list, while an actual selection change still does.
  const activeTokenLineId = selectedToken?.line.lineId;
  const activeTokenId = selectedToken?.token.tokenId;

  const lyricsComponents = useMemo(() => {
    if (lyrics && lyrics?.lyrics) {
      const { isSynced, parsedLyrics, offset = 0 } = lyrics.lyrics;

      if (isSynced) {
        const syncedLyricsLines = parsedLyrics.map((lyric, index) => {
          const { originalText: text, end = 0, start = 0 } = lyric;
          const lineId = getLineIdForIndex(index);
          const analysis = linesById[lineId];

          return (
            <LyricLine
              playerType="full"
              key={lineId}
              index={index}
              lyric={text}
              syncedLyrics={{ start, end }}
              translatedLyricLines={lyric.translatedTexts}
              convertedLyric={lyric.romanizedText}
              analysis={isAnalysisView ? analysis : undefined}
              activeTokenId={activeTokenLineId === lineId ? activeTokenId : undefined}
              palette={currentSongData.paletteData}
              onTokenClick={onTokenClick}
            />
          );
        });

        const firstLine = (
          <LyricLine
            playerType="full"
            key="..."
            index={0}
            lyric="•••"
            syncedLyrics={{
              start: 0,
              end: (parsedLyrics[0]?.start || 0) + offset
            }}
          />
        );

        if ((parsedLyrics[0]?.start || 0) !== 0) syncedLyricsLines.unshift(firstLine);

        return syncedLyricsLines;
      }
      if (!isSynced) {
        return parsedLyrics.map((line, index) => {
          return (
            <LyricLine
              playerType="full"
              key={index}
              index={index}
              lyric={line.originalText}
              translatedLyricLines={line.translatedTexts}
              convertedLyric={line.romanizedText}
            />
          );
        });
      }
    }
    return [];
  }, [
    isAnalysisView,
    lyrics,
    linesById,
    onTokenClick,
    activeTokenLineId,
    activeTokenId,
    currentSongData.paletteData
  ]);

  const lyricsSource = useMemo(() => {
    if (lyrics && lyrics?.lyrics) {
      const { source, link } = lyrics;

      return (
        <LyricsMetadata
          source={source}
          copyright={lyrics.lyrics.copyright}
          link={link}
          className="items-start! text-left! mt-4!"
        />
      );
    }
    return undefined;
  }, [lyrics]);

  return (
    <div
      className="mini-player-lyrics-container appear-from-bottom min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto py-20 transition-[filter] delay-200 select-none"
      id="miniPlayerLyricsContainer"
    >
      {lyricsComponents.length > 0 && lyrics && lyrics.lyrics.isSynced && (
        <>
          {isPanelOpen ? (
            // With the analysis panel open the lyrics column no longer sits beside the cover, so
            // center the block in the remaining space. The lines themselves stay left-aligned, and
            // the source line lives inside the same wrapper so it aligns with the lyric text.
            <div className="mx-auto w-full max-w-[52rem]">
              {lyricsComponents}
              {lyricsSource}
            </div>
          ) : (
            <>
              {lyricsComponents}
              {lyricsSource}
            </>
          )}
        </>
      )}
      {lyrics && !lyrics.lyrics.isSynced && (
        <div className="text-font-color-highlight flex h-full w-full flex-col justify-center text-2xl opacity-50">
          <span className="material-icons-round-outlined mb-2 text-5xl">brightness_alert</span>
          {t('lyricsPage.noSyncedLyrics')}
          <p className="mt-4 text-base">{t('lyricsPage.noSyncedLyricsDescription')}</p>
        </div>
      )}
      {lyrics === undefined && (
        <div className="text-font-color-highlight flex h-full w-full flex-col justify-center text-2xl opacity-50">
          <span className="material-icons-round-outlined mb-2 text-5xl">brightness_alert</span>
          <p>{t('lyricsPage.noLyrics')}</p>
          <p className="mt-4 text-base">{t('lyricsPage.noLyricsDescription')}</p>
        </div>
      )}
    </div>
  );
});

LyricsContainer.displayName = 'LyricsContainer';
export default LyricsContainer;
