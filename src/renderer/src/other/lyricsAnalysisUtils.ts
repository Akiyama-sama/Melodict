/** Mirrors `getRawLyricLineText` in the main process: enhanced lines are joined back into text. */
export const getRawLyricLineText = (line: LyricLine) => {
  if (typeof line.originalText === 'string') return line.originalText;

  return line.originalText.map((word) => word.text).join('');
};

export const getLineIdForIndex = (index: number) => `line-${index}`;

/**
 * Stable visual bucket for a token, derived from its span rather than an array index so that
 * re-renders during streaming never reshuffle the colours.
 */
export const getTokenColorClass = (startChar: number) => {
  const palette = [
    'decoration-sky-400/70',
    'decoration-emerald-400/70',
    'decoration-amber-400/70',
    'decoration-fuchsia-400/70',
    'decoration-rose-400/70',
    'decoration-violet-400/70'
  ] as const;

  return palette[startChar % palette.length];
};
