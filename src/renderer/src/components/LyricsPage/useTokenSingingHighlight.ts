import { useEffect, useMemo, useRef, useState } from 'react';

import {
  getSpacedLyricLineTextWithWordSpans,
  getTokenSingingWindows,
  type TokenSingingSpan
} from '../../other/lyricsAnalysisUtils';

type UseTokenSingingHighlightOptions = {
  /** The analysis for THIS line, or undefined while the line is not analysed yet. */
  analysis?: LyricsAnalysisLine;
  /** The line's YRC word payloads; undefined for plain string lines (no timing data). */
  words?: SyncedLyricsLineWord[];
  /** Only track while the line is being sung — mirrors useSyncedLineHighlight's gating. */
  isActiveLine?: boolean;
};

/**
 * The per-character singing highlight for analysed lines. The plain synced view gets word-level
 * highlighting for free — each YRC word renders as its own EnhancedSyncedLyricWord span that
 * listens to `player/positionChange` — but the token view replaces those words with token spans,
 * which carry no timing. This hook re-attaches the timing: it intersects the line's YRC word
 * windows (hydrated into char spans sharing the token coordinate system — see
 * getSpacedLyricLineTextWithWordSpans) with the token spans and reports, per currently-sounding
 * token, which of its characters are being sung.
 *
 * The returned Map is identity-stable across position ticks: `undefined` while nothing sounds,
 * and the same Map object while the same tokens sound (their windows are fixed per word), so the
 * React bailout on identical state keeps non-boundary ticks from re-rendering the line.
 */
const useTokenSingingHighlight = ({
  analysis,
  words,
  isActiveLine = true
}: UseTokenSingingHighlightOptions) => {
  const [singingWindows, setSingingWindows] = useState<Map<string, TokenSingingSpan> | undefined>(
    undefined
  );
  const singingWindowsRef = useRef<Map<string, TokenSingingSpan> | undefined>(undefined);

  const singingSpans = useMemo(
    () => (words ? getSpacedLyricLineTextWithWordSpans(words).wordSpans : undefined),
    [words]
  );

  useEffect(() => {
    if (!analysis || !singingSpans || singingSpans.length === 0 || !isActiveLine) {
      singingWindowsRef.current = undefined;
      setSingingWindows(undefined);
      return undefined;
    }

    const update = (event: Event) => {
      if (!('detail' in event) || Number.isNaN(event.detail)) return;

      const next = getTokenSingingWindows(event.detail as number, analysis.tokens, singingSpans);
      // Identity stability: replace the state only when the sounding set (or its windows) actually
      // changed, so the 100ms position ticks between word boundaries bail out.
      const previous = singingWindowsRef.current;
      if (isSameSingingState(previous, next)) return;
      singingWindowsRef.current = next;
      setSingingWindows(next);
    };

    document.addEventListener('player/positionChange', update);
    return () => document.removeEventListener('player/positionChange', update);
  }, [analysis, singingSpans, isActiveLine]);

  return singingWindows;
};

const isSameSingingState = (
  previous: Map<string, TokenSingingSpan> | undefined,
  next: Map<string, TokenSingingSpan> | undefined
) => {
  if (previous === next) return true;
  if (!previous || !next || previous.size !== next.size) return false;
  for (const [tokenId, lit] of next) {
    const previousLit = previous.get(tokenId);
    if (
      !previousLit ||
      previousLit.sungStart !== lit.sungStart ||
      previousLit.sungEnd !== lit.sungEnd
    )
      return false;
  }
  return true;
};

export default useTokenSingingHighlight;
