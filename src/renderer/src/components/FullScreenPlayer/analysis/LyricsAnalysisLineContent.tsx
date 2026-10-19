import { useMemo } from 'react';

import type { LyricsAnalysisToken } from '../../../../../common/lyricsAnalysis';
import { splitLineIntoTokens } from '../../../../../common/lyricsAnalysis';
import { getTokenColor, getTokenColorPalette } from '../../../other/lyricsAnalysisUtils';

type Props = {
  text: string;
  analysis?: LyricsAnalysisLine;
  activeTokenId?: string;
  /** The song's dynamic-theme palette; token colours are derived from its swatches. */
  palette?: NodeVibrantPalette;
  onTokenClick: (token: LyricsAnalysisToken, line: LyricsAnalysisLine) => void;
};

/**
 * Renders one lyric line. Lines with analysis get per-token colours + click targets; lines that
 * have not been analysed yet fall back to plain text with no interactive affordances.
 *
 * Tokens are spans rather than buttons on purpose: Chromium lays inline `<button>`s out as atomic
 * boxes, which changes where `text-wrap: balance` breaks the line, so the analysed line would wrap
 * at different points than the same line rendered as plain text. Spans lay out identically.
 * The wrapper opts out of the karaoke word margin (`[&>div>span:not(.lyrics-analysis-tokens)]`)
 * so the analysed line keeps the same total width as plain text.
 */
const LyricsAnalysisLineContent = (props: Props) => {
  const { text, analysis, activeTokenId, palette, onTokenClick } = props;

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

        return (
          <span
            key={token.tokenId}
            role="button"
            tabIndex={0}
            className={`inline cursor-pointer rounded-sm transition-[background,color] duration-150 ${
              isActive
                ? 'bg-white/25! text-white!'
                : `bg-transparent! hover:bg-white/15! ${tokenColor ? '' : 'text-inherit'}`
            }`}
            style={isActive || !tokenColor ? undefined : { color: `hsl(${tokenColor})` }}
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
            {segment.text}
          </span>
        );
      })}
    </span>
  );
};

export default LyricsAnalysisLineContent;
