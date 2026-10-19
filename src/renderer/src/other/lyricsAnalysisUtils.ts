import { DEFAULT_SONG_PALETTE } from '../../../common/defaultSongPalette';
import { formatHsl, manageBrightness } from './themePalette';

/**
 * Joins a lyric line — plain text or an enhanced (YRC) word array — back into the line's spaced
 * text. `LyricLine.tsx` renders YRC words as separate spans with `mr-2` spacing, so a space between
 * words is how the line reads everywhere else; the unspaced `IhavetogosomewhereIsaw` fed to the LLM
 * left it no way to recover word boundaries and collapsed the whole line into one token.
 *
 * This is the single source for BOTH the analysis input (`useLyricsAnalysis`) and the token view's
 * display text (`LyricLine`): token startChar/endChar offsets are validated against the analysis
 * text and then sliced against the display text (splitLineIntoTokens), so the two strings MUST be
 * identical or the spans misalign. Whitespace is collapsed so stray padding inside word payloads
 * (some sources carry spaces in `word.text`) cannot double up. CJK YRC words join with spaces too —
 * harmless for the model, which aligns better with boundaries made explicit.
 */
export const getSpacedLyricLineText = (originalText: string | SyncedLyricsLineWord[]) => {
  if (typeof originalText === 'string') return originalText;

  return originalText
    .map((word) => word.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
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
 * When a palette collapses into one colour, spread hues across this span centred on the palette's
 * own hue (±0.125 of the wheel = ±45°, 18° apart). A tight analogous span keeps the tokens inside
 * the theme's colour family — a blue theme yields blues and teals, never purple or green — while
 * the 18° steps still separate neighbouring tokens clearly.
 */
const SPREAD_HALF_WIDTH = 0.125;
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
