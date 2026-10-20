import { useMemo } from 'react';

import type { LyricsAnalysisToken } from '../../../../common/lyricsAnalysis';
import { splitLineIntoTokens } from '../../../../common/lyricsAnalysis';
import { getTokenColor, getTokenColorPalette } from '../../other/lyricsAnalysisUtils';

type Props = {
  text: string;
  analysis?: LyricsAnalysisLine;
  activeTokenId?: string;
  /**
   * Whether this line is the one currently being sung. Every analysed line shows token colours, but
   * unsung lines render them at the same 20% dimness as the shared lyric colour so the page keeps
   * its dark, only-the-sung-line-pops hierarchy.
   */
  isActiveLine?: boolean;
  /** The song's dynamic-theme palette; token colours are derived from its swatches. */
  palette?: NodeVibrantPalette;
  onTokenClick: (token: LyricsAnalysisToken, line: LyricsAnalysisLine) => void;
};

/**
 * Picks the romanization to show under a token: wapuro romaji (ja), RR (ko), or pinyin (zh),
 * falling back to kana for Japanese tokens the model gave no romaji for. `value` is skipped on
 * purpose — the normalizer defaults it to the token text itself, so it carries no signal.
 */
const getTokenPronunciation = (token: LyricsAnalysisToken) => {
  const { pronunciation } = token.card;
  return (
    pronunciation.romaji ?? pronunciation.romanized ?? pronunciation.pinyin ?? pronunciation.kana
  );
};

/**
 * Renders one lyric line. Lines with analysis get per-token colours + click targets, and each token
 * shows its romanization directly beneath it; lines that have not been analysed yet fall back to
 * plain text with no interactive affordances.
 *
 * Tokens are spans (not buttons) and are laid out as atomic inline-flex columns — the word on the
 * first row, its romanization on the second — so the pronunciation travels with the word as a unit
 * when the line wraps. This means analysed lines wrap at token boundaries rather than at the same
 * points as plain text; that is unavoidable once per-token annotations sit under the words. Atomic
 * boxes also keep the hover band trivial: the band paints on the inner `.token-main` row, which
 * never fragments across lines (the abs-positioning/pseudo-element pitfall that used to affect
 * fragmented inlines cannot recur).
 */
const LyricsAnalysisLineContent = (props: Props) => {
  const { text, analysis, activeTokenId, isActiveLine = false, palette, onTokenClick } = props;

  const segments = useMemo(
    () => (analysis ? splitLineIntoTokens(text, analysis.tokens) : [{ text }]),
    [analysis, text]
  );

  const tokenColors = useMemo(() => getTokenColorPalette(palette), [palette]);

  let tokenIndex = -1;

  // The lyric line is inside a flex container, which drops whitespace-only text nodes. Wrapping
  // the segments in a single inline span keeps the original word spacing between tokens.
  return (
    <span className="lyrics-analysis-tokens">
      {segments.map((segment, index) => {
        const { token } = segment;

        if (!token) return <span key={`text-${index}`}>{segment.text}</span>;

        tokenIndex += 1;
        const isActive = token.tokenId === activeTokenId;
        const tokenColor = getTokenColor(tokenIndex, tokenColors);
        // Unsung lines keep the 20% dimness the plain lyric colour had; the sung line is full.
        const alpha = isActiveLine ? 1 : 0.2;
        const pronunciation = getTokenPronunciation(token);
        // Tokens with no whitespace between them (common in CJK lines) would have their
        // outward-reaching hover bands overlap, so those sides are flagged for the stylesheet.
        const prevSegment = segments[index - 1];
        const nextSegment = segments[index + 1];
        const adjacentClasses = `${index > 0 && !/\s$/.test(prevSegment.text) ? 'adjacent-left ' : ''}${
          /^\s/.test(nextSegment?.text ?? ' ') ? '' : 'adjacent-right'
        }`;

        return (
          <span
            key={token.tokenId}
            role="button"
            tabIndex={0}
            className={`inline-flex cursor-pointer flex-col items-center transition-[color] duration-150 ${adjacentClasses} ${
              isActive ? 'token-active text-white!' : tokenColor ? '' : 'text-inherit'
            }`}
            style={isActive || !tokenColor ? undefined : { color: `hsl(${tokenColor} / ${alpha})` }}
            onClick={(event) => {
              // Clicking a token must not seek the line, which is the default line behaviour.
              event.stopPropagation();
              onTokenClick(token, analysis as LyricsAnalysisLine);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              onTokenClick(token, analysis as LyricsAnalysisLine);
            }}
            title={token.card.meaning}
          >
            <span className="token-main whitespace-pre">{segment.text}</span>
            {pronunciation && <span className="token-romaji whitespace-pre">{pronunciation}</span>}
          </span>
        );
      })}
    </span>
  );
};

export default LyricsAnalysisLineContent;
