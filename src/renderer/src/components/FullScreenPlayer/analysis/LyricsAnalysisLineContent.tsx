import { useMemo } from 'react';

import type { LyricsAnalysisToken } from '../../../../../common/lyricsAnalysis';
import { splitLineIntoTokens } from '../../../../../common/lyricsAnalysis';
import { getTokenColorClass } from '../../../other/lyricsAnalysisUtils';

type Props = {
  text: string;
  analysis?: LyricsAnalysisLine;
  activeTokenId?: string;
  onTokenClick: (token: LyricsAnalysisToken, line: LyricsAnalysisLine) => void;
};

/**
 * Renders one lyric line. Lines with analysis get per-token underlines + click targets; lines that
 * have not been analysed yet fall back to plain text with no interactive affordances.
 */
const LyricsAnalysisLineContent = (props: Props) => {
  const { text, analysis, activeTokenId, onTokenClick } = props;

  const segments = useMemo(
    () => (analysis ? splitLineIntoTokens(text, analysis.tokens) : [{ text }]),
    [analysis, text]
  );

  // The lyric line is inside a flex container, which drops whitespace-only text nodes. Wrapping
  // the segments in a single inline span keeps the original word spacing between tokens.
  return (
    <span>
      {segments.map((segment, index) => {
        const { token } = segment;

        if (!token) return <span key={`text-${index}`}>{segment.text}</span>;

        const isActive = token.tokenId === activeTokenId;

        return (
          <button
            key={token.tokenId}
            type="button"
            className={`mx-0.5 inline cursor-pointer rounded-sm p-0! text-inherit underline decoration-2 underline-offset-4 transition-[background,text-decoration-color] duration-150 ${getTokenColorClass(
              token.startChar
            )} ${
              isActive
                ? 'bg-white/25! decoration-white'
                : 'bg-transparent! hover:bg-white/15!'
            }`}
            onClick={(event) => {
              // Clicking a token must not seek the line, which is the default line behaviour.
              event.stopPropagation();
              onTokenClick(token, analysis as LyricsAnalysisLine);
            }}
            title={token.card.meaning}
          >
            {segment.text}
          </button>
        );
      })}
    </span>
  );
};

export default LyricsAnalysisLineContent;
