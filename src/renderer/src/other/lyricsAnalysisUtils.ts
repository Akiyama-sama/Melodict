import { DEFAULT_SONG_PALETTE } from '../../../common/defaultSongPalette';
import { formatHsl, manageBrightness } from './themePalette';

/** Mirrors `getRawLyricLineText` in the main process: enhanced lines are joined back into text. */
export const getRawLyricLineText = (line: LyricLine) => {
  if (typeof line.originalText === 'string') return line.originalText;

  return line.originalText.map((word) => word.text).join('');
};

export const getLineIdForIndex = (index: number) => `line-${index}`;

/**
 * Token colours come from the song's own dynamic-theme palette instead of a fixed rainbow, so the
 * analysed line belongs to the artwork's colour world like the rest of the player UI.
 *
 * The six Vibrant swatches are sorted by hue to keep neighbouring tokens visually distinct, and
 * every one is raised to at least 70% lightness: the player background is nearly black, and
 * Muted/Dark swatches would otherwise be unreadable. Swatches a cover does not provide fall back
 * to the default song palette, which is what the dynamic theme itself uses.
 */
export const getTokenColorPalette = (palette?: NodeVibrantPalette) => {
  const fallback = DEFAULT_SONG_PALETTE;
  const swatches = [
    palette?.LightVibrant ?? fallback.LightVibrant,
    palette?.Vibrant ?? fallback.Vibrant,
    palette?.LightMuted ?? fallback.LightMuted,
    palette?.Muted ?? fallback.Muted,
    palette?.DarkVibrant ?? fallback.DarkVibrant,
    palette?.DarkMuted ?? fallback.DarkMuted
  ];

  const colors = swatches
    .filter((swatch): swatch is NodeVibrantPaletteSwatch => Boolean(swatch?.hsl))
    .map((swatch) => formatHsl(manageBrightness(swatch.hsl, { min: 0.7 })));

  // Deduplicate: covers with a flat colour scheme often produce identical swatches, and two
  // adjacent tokens in the same colour would read as one word.
  return [...new Set(colors)];
};

/**
 * Stable visual bucket for a token, derived from its span rather than an array index so that
 * re-renders during streaming never reshuffle the colours. Tokens are distinguished by their
 * text colour alone (no underline).
 */
export const getTokenColor = (startChar: number, palette: string[]) => {
  if (palette.length === 0) return undefined;

  return palette[startChar % palette.length];
};
