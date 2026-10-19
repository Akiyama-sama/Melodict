/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { SYNCED_LYRICS_REGEX } from '@common/isLyricsSynced';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import roundTo from '../../../../common/roundTo';
import type { LyricsAnalysisToken } from '../../../../common/lyricsAnalysis';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import LyricsAnalysisLineContent from '../FullScreenPlayer/analysis/LyricsAnalysisLineContent';
import EnhancedSyncedLyricWord from '../LyricsEditingPage/EnhancedSyncedLyricWord';
import LyricsProgressBar from './LyricsProgressBar';

interface LyricProp {
  lyric: string | SyncedLyricsLineWord[];
  translatedLyricLines?: TranslatedLyricLine[];
  convertedLyric?: string | SyncedLyricsLineWord[];
  index: number;
  syncedLyrics?: { start: number; end: number };
  isAutoScrolling?: boolean;
  playerType?: PlayerTypes;
  /** LLM analysis for this line, when available. Enables clickable learning tokens. */
  analysis?: LyricsAnalysisLine;
  activeTokenId?: string;
  /** The song's dynamic-theme palette; token colours are derived from its swatches. */
  palette?: NodeVibrantPalette;
  onTokenClick?: (token: LyricsAnalysisToken, line: LyricsAnalysisLine) => void;
}


// const syncedLyricsRegex = /^\[\d+:\d{1,2}\.\d{1,3}]/gm;

const lyricsScrollIntoViewEvent = new CustomEvent('lyrics/scrollIntoView', {
  detail: 'scrollingUsingScrollIntoView'
});

const getLyricText = (lyrics: string) => {
  const match = SYNCED_LYRICS_REGEX.exec(lyrics);
  SYNCED_LYRICS_REGEX.lastIndex = 0;

  if (match && match.groups && match.groups.lyric) return match.groups.lyric.trim();
  return lyrics;
};

const LyricLine = (props: LyricProp) => {
  // const preferences = useStore(store, (state) => state.localStorage.preferences);

  const { updateSongPosition, updateContextMenuData } = useContext(AppUpdateContext);
  const [isInRange, setIsInRange] = useState(false);
  const { t } = useTranslation();

  const lyricsRef = useRef(null as HTMLDivElement | null);
  const isTheCurrnetLineRef = useRef(false);

  const {
    index,
    lyric,
    translatedLyricLines = [],
    convertedLyric,
    syncedLyrics,
    isAutoScrolling = true,
    playerType = 'normal',
    analysis,
    activeTokenId,
    palette,
    onTokenClick
  } = props;

  const handleLyricsActivity = useCallback(
    (e: Event) => {
      if ('detail' in e && !Number.isNaN(e.detail)) {
        const songPosition = e.detail as number;

        if (lyricsRef.current && syncedLyrics) {
          const { start, end } = syncedLyrics;
          if (songPosition > start && songPosition < end) {
            if (!isTheCurrnetLineRef.current) {
              isTheCurrnetLineRef.current = true;
              setIsInRange(true);
              if (isAutoScrolling)
                lyricsRef.current?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'center'
                });

              document.dispatchEvent(lyricsScrollIntoViewEvent);
            }
          } else {
            isTheCurrnetLineRef.current = false;
            setIsInRange(false);
          }
        }
      }
    },
    [isAutoScrolling, syncedLyrics]
  );

  useEffect(() => {
    document.addEventListener('player/positionChange', handleLyricsActivity);

    return () => document.removeEventListener('player/positionChange', handleLyricsActivity);
  }, [handleLyricsActivity]);

  const lyricString = useMemo(() => {
    if (typeof lyric === 'string') return getLyricText(lyric);

    const extendedLyricLines = lyric.map((extendedText, i) => {
      return (
        <EnhancedSyncedLyricWord
          key={i}
          isActive={isInRange}
          start={extendedText.start}
          end={extendedText.end}
          text={extendedText.text}
          delay={0}
        />
      );
    });

    return extendedLyricLines;
  }, [isInRange, lyric]);

  const translatedLyricString = useMemo(() => {
    if (translatedLyricLines.length === 0) return undefined;

    const translatedLyric = translatedLyricLines[0].text;
    if (typeof translatedLyric === 'string') return getLyricText(translatedLyric);

    const extendedLyricLines = translatedLyric.map((extendedText, i) => {
      return (
        <EnhancedSyncedLyricWord
          key={i}
          isActive={isInRange}
          start={extendedText.start}
          end={extendedText.end}
          text={extendedText.text}
          delay={0}
        />
      );
    });

    return extendedLyricLines;
  }, [isInRange, translatedLyricLines]);

  const convertedLyricString = useMemo(() => {
    if (!convertedLyric || convertedLyric.length === 0) return undefined;
    if (typeof convertedLyric === 'string') return getLyricText(convertedLyric);

    const extendedLyricLines = convertedLyric.map((extendedText, i) => {
      return (
        <EnhancedSyncedLyricWord
          key={i}
          isActive={isInRange}
          start={extendedText.start}
          end={extendedText.end}
          text={extendedText.text}
          delay={0}
        />
      );
    });

    return extendedLyricLines;
  }, [isInRange, convertedLyric]);

  // The original lyric is always the primary (large) line; the translation renders above it in a
  // smaller size. When no translation exists, romanization takes the secondary slot instead.
  const lyricStringLinePrimary = lyricString;
  let lyricStringLineSecondary;
  if (translatedLyricString) lyricStringLineSecondary = translatedLyricString;
  else lyricStringLineSecondary = convertedLyricString;

  return (
    <div
      style={{
        animationDelay: `${100 + 20 * (index + 1)}ms`
      }}
      title={
        syncedLyrics
          ? t(`lyricsEditingPage.fromTo`, {
              start: roundTo(syncedLyrics.start, 2),
              end: roundTo(syncedLyrics.end, 2)
            })
          : undefined
      }
      className={`highlight text-font-color-black/20 dark:text-font-color-white/20 z-0 mb-5 flex w-fit flex-col items-center justify-center text-center text-5xl font-medium text-balance transition-[transform,translate,scale,color,filter] duration-250 select-none first:mt-8 last:mb-4 empty:mb-16 ${
        syncedLyrics
          ? `cursor-pointer blur-[1px] ${
              isInRange
                ? 'text-font-color-highlight! dark:text-dark-font-color-highlight! scale-100! font-medium blur-none! [&>div>span:not(.lyrics-analysis-tokens)]:mr-3!'
                : 'scale-75!'
            }`
          : 'text-font-color-black! dark:text-font-color-white! scale-100! text-4xl! font-medium blur-none! [&>div>span:not(.lyrics-analysis-tokens)]:mr-3'
      } ${playerType === 'mini' ? 'text-font-color-white/20! mb-2! text-2xl!' : ''} ${playerType === 'full' ? 'text-font-color-white/20! mb-6! origin-left items-start! justify-start! text-left! text-7xl!' : ''}`}
      ref={lyricsRef}
      onClick={() =>
        syncedLyrics &&
        (typeof lyric === 'string' || translatedLyricString) &&
        updateSongPosition(syncedLyrics.start)
      }
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        updateContextMenuData(
          true,
          [
            {
              label: t('common.copy'),
              class: 'sync',
              iconName: 'content_copy',
              iconClassName: 'material-icons-round-outlined',
              handlerFunction: () =>
                window.navigator.clipboard.writeText(
                  typeof lyric === 'string'
                    ? getLyricText(lyric)
                    : lyric.map((x) => x.text).join(' ')
                )
            }
          ],
          e.pageX,
          e.pageY
        );
      }}
    >
      {lyricStringLineSecondary && (
        <div
          className={`flex flex-row flex-wrap ${playerType !== 'full' ? 'items-center justify-center' : ''} ${syncedLyrics && isInRange ? 'text-font-color-black/50! dark:text-font-color-white/50! text-xl!' : 'text-xl!'}`}
        >
          {lyricStringLineSecondary}
        </div>
      )}
      <div
        className={`whitespace-pre-wrap ${playerType !== 'full' ? 'flex flex-row flex-wrap items-center justify-center' : ''}`}
      >
        {analysis && onTokenClick && typeof lyric === 'string' ? (
          <LyricsAnalysisLineContent
            text={getLyricText(lyric)}
            analysis={analysis}
            activeTokenId={activeTokenId}
            palette={palette}
            onTokenClick={onTokenClick}
          />
        ) : (
          lyricStringLinePrimary
        )}
      </div>
      {syncedLyrics && isInRange && <LyricsProgressBar delay={0} syncedLyrics={syncedLyrics} />}
    </div>
  );
};

export default LyricLine;
