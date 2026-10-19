/** Mirrors `getRawLyricLineText` in the main process: enhanced lines are joined back into text. */
export const getRawLyricLineText = (line: LyricLine) => {
  if (typeof line.originalText === 'string') return line.originalText;

  return line.originalText.map((word) => word.text).join('');
};

export const getLineIdForIndex = (index: number) => `line-${index}`;

/**
 * Stable visual bucket for a token, derived from its span rather than an array index so that
 * re-renders during streaming never reshuffle the colours. Tokens are distinguished by their
 * text colour alone (no underline): the palette keeps every hue readable on the dark player
 * background and against the dimmed inactive-lyric colour.
 */
export const getTokenColorClass = (startChar: number) => {
  const palette = [
    'text-sky-300',
    'text-emerald-300',
    'text-amber-300',
    'text-fuchsia-300',
    'text-rose-300',
    'text-violet-300'
  ] as const;

  return palette[startChar % palette.length];
};
