/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { SYNCED_LYRICS_REGEX } from '@common/isLyricsSynced';
import { useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { LyricsAnalysisToken } from '../../../../common/lyricsAnalysis';
import roundTo from '../../../../common/roundTo';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { getSpacedLyricLineText } from '../../other/lyricsAnalysisUtils';
import EnhancedSyncedLyricWord from '../LyricsEditingPage/EnhancedSyncedLyricWord';
import LyricsAnalysisLineContent from './LyricsAnalysisLineContent';
import LyricsProgressBar from './LyricsProgressBar';
import useSyncedLineHighlight from './useSyncedLineHighlight';

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

const getLyricText = (lyrics: string) => {
  const match = SYNCED_LYRICS_REGEX.exec(lyrics);
  SYNCED_LYRICS_REGEX.lastIndex = 0;

  if (match && match.groups && match.groups.lyric) return match.groups.lyric.trim();
  return lyrics;
};

/**
 * Maps an enhanced (YRC) word array to the per-word animated spans, exactly as the three inline
 * copies in LyricLine did (main line, translation, romanization): index keys, `isActive` from the
 * line's in-range state, and a zero delay.
 */
const renderExtendedWords = (words: SyncedLyricsLineWord[], isActive: boolean) =>
  words.map((extendedText, i) => (
    <EnhancedSyncedLyricWord
      key={i}
      isActive={isActive}
      start={extendedText.start}
      end={extendedText.end}
      text={extendedText.text}
      delay={0}
    />
  ));

const LyricLine = (props: LyricProp) => {
  const { updateSongPosition, updateContextMenuData } = useContext(AppUpdateContext);
  const { t } = useTranslation();

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

  const { isInRange, lyricsRef } = useSyncedLineHighlight({ isAutoScrolling, syncedLyrics });

  const lyricString = useMemo(() => {
    if (typeof lyric === 'string') return getLyricText(lyric);
    return renderExtendedWords(lyric, isInRange);
  }, [isInRange, lyric]);

  const translatedLyricString = useMemo(() => {
    if (translatedLyricLines.length === 0) return undefined;

    const translatedLyric = translatedLyricLines[0].text;
    if (typeof translatedLyric === 'string') return getLyricText(translatedLyric);

    return renderExtendedWords(translatedLyric, isInRange);
  }, [isInRange, translatedLyricLines]);

  const convertedLyricString = useMemo(() => {
    if (!convertedLyric || convertedLyric.length === 0) return undefined;
    if (typeof convertedLyric === 'string') return getLyricText(convertedLyric);

    return renderExtendedWords(convertedLyric, isInRange);
  }, [isInRange, convertedLyric]);

  // The original lyric is always the primary (large) line; the translation renders above it in a
  // smaller size, and the romanization renders below it (same styling as the translation) —
  // NetEase songs supply both, so the romanization no longer needs to fall back to the
  // translation's slot. Once the line has been tokenized, the per-token romanizations under each
  // token replace the whole-line romanization, so it is dropped for analysed lines.
  const lyricStringLinePrimary = lyricString;
  const lyricStringLineSecondary = translatedLyricString;
  // Enhanced (YRC) lines carry their text as a word array; the token view needs that text as a
  // plain string to split into token spans. It is the same spaced string the analysis was built
  // from (getSpacedLyricLineText), so token offsets line up exactly — an unspaced join here would
  // shift every span past the first space.
  const isTokenizedLine = Boolean(analysis && onTokenClick && typeof lyric === 'string');
  const tokenizedEnhancedText =
    analysis && onTokenClick && typeof lyric !== 'string'
      ? getSpacedLyricLineText(lyric)
      : undefined;
  const lyricStringLineTertiary = isTokenizedLine || tokenizedEnhancedText !== undefined
    ? undefined
    : convertedLyricString;

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
        {analysis && onTokenClick ? (
          <LyricsAnalysisLineContent
            text={tokenizedEnhancedText ?? getLyricText(lyric as string)}
            analysis={analysis}
            activeTokenId={activeTokenId}
            isActiveLine={isInRange}
            palette={palette}
            onTokenClick={onTokenClick}
          />
        ) : (
          lyricStringLinePrimary
        )}
      </div>
      {lyricStringLineTertiary && (
        <div
          className={`flex flex-row flex-wrap ${playerType !== 'full' ? 'items-center justify-center' : ''} ${syncedLyrics && isInRange ? 'text-font-color-black/50! dark:text-font-color-white/50! text-xl!' : 'text-xl!'}`}
        >
          {lyricStringLineTertiary}
        </div>
      )}
      {syncedLyrics && isInRange && <LyricsProgressBar delay={0} syncedLyrics={syncedLyrics} />}
    </div>
  );
};

export default LyricLine;
