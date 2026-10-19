import { DEFAULT_SONG_PALETTE } from '../../../common/defaultSongPalette';
import { formatHsl, manageBrightness } from './themePalette';

/** Mirrors `getRawLyricLineText` in the main process: enhanced lines are joined back into text. */
export const getRawLyricLineText = (line: LyricLine) => {
  if (typeof line.originalText === 'string') return line.originalText;

  return line.originalText.map((word) => word.text).join('');
};

export const getLineIdForIndex = (index: number) => `line-${index}`;

type Hsl = [number, number, number];

/** Distance between two hues on the 0..1 colour wheel. */
const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b);
  return Math.min(d, 1 - d);
};

/** Whether two colours are far enough apart to read as different words at a glance. */
const isVisuallyDistinct = (a: Hsl, b: Hsl) =>
  hueDistance(a[0], b[0]) > 0.1 || Math.abs(a[1] - b[1]) > 0.3 || Math.abs(a[2] - b[2]) > 0.12;

const MIN_DISTINCT_COLORS = 2;
/** Tokens must stay readable on the near-black player background. */
const MIN_LIGHTNESS = 0.7;
const MAX_SPREAD_LIGHTNESS = 0.85;
/** Monochrome covers leave hue as the only differentiator; saturation makes the spread visible. */
const MIN_SPREAD_SATURATION = 0.55;
/**
 * When a palette collapses into one colour, spread six hues across this span centred on the
 * palette's own hue (±0.25 of the wheel = ±90°, 36° apart). Staying analogous keeps the tokens in
 * the theme's colour family instead of an unrelated rainbow, while the 36° steps still separate
 * neighbouring tokens clearly.
 */
const SPREAD_HALF_WIDTH = 0.25;
const SPREAD_COUNT = 6;

/**
 * Token colours come from the song's own dynamic-theme palette instead of a fixed rainbow, so the
 * analysed line belongs to the artwork's colour world like the rest of the player UI.
 *
 * The six Vibrant swatches are lifted to at least 70% lightness (the player background is nearly
 * black, and Muted/Dark swatches would otherwise be unreadable), then near-duplicates are dropped
 * with a perceptual threshold. Covers whose swatches collapse into a single distinguishable
 * colour — monochrome artwork, or the all-blue default palette used when a song has no palette at
 * all (e.g. NetEase streams) — get their hues spread across the analogous range around that hue,
 * keeping the palette's own lightness and chroma: hue is the only axis left that can separate
 * neighbouring tokens, and tokens that look identical would read as one word.
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

  const lifted = swatches
    .filter((swatch): swatch is NodeVibrantPaletteSwatch => Boolean(swatch?.hsl))
    .map((swatch) => manageBrightness(swatch.hsl, { min: MIN_LIGHTNESS }));

  const distinct: Hsl[] = [];
  for (const color of lifted) {
    if (distinct.every((kept) => isVisuallyDistinct(kept, color))) distinct.push(color);
  }

  if (distinct.length >= MIN_DISTINCT_COLORS) return distinct.map(formatHsl);

  const base: Hsl = distinct[0] ?? lifted[0] ?? [0, MIN_SPREAD_SATURATION, MIN_LIGHTNESS];
  const [h, s, l] = base;
  const saturation = Math.max(s, MIN_SPREAD_SATURATION);
  const lightness = Math.min(Math.max(l, MIN_LIGHTNESS), MAX_SPREAD_LIGHTNESS);

  return Array.from({ length: SPREAD_COUNT }, (_, index) =>
    formatHsl([
      // Even steps from h - SPREAD_HALF_WIDTH to h + SPREAD_HALF_WIDTH, wrapping at 1.
      (h + SPREAD_HALF_WIDTH * ((index * 2) / (SPREAD_COUNT - 1) - 1) + 1) % 1,
      saturation,
      lightness
    ])
  );
};

/**
 * Picks the colour for a token from the palette by its ordinal position within the line, so
 * consecutive tokens always land on consecutive (therefore different) palette entries — bucketing
 * by raw `startChar` collided whenever token spans skip characters (0, 3, 6 all mod to the same
 * slot) and rendered neighbouring tokens in the same colour.
 */
export const getTokenColor = (tokenIndex: number, palette: string[]) => {
  if (palette.length === 0) return undefined;

  return palette[tokenIndex % palette.length];
};
