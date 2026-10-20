import { DEFAULT_SONG_PALETTE } from '../../../common/defaultSongPalette';
import { formatHsl } from './themePalette';

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

/** Tokens must stay readable on the near-black player background. */
const MIN_LIGHTNESS = 0.7;
const MAX_LIGHTNESS = 0.85;
/** Monochrome covers leave hue as the only differentiator; saturation makes it visible. */
const MIN_SATURATION = 0.55;

/**
 * The two-colour token palette.
 *
 * Colour A is the song title's own colour: the fullscreen player always renders dark, where
 * `text-font-color-highlight` resolves to `--dark-text-color-highlight` — which the dynamic theme
 * sets to `LightVibrant` verbatim (deriveThemeColors). Reusing that exact swatch makes the tokens
 * belong to the same colour world as the title instead of introducing yet another accent.
 *
 * Colour B is A's complement (hue + 180°) at the same, clamped saturation/lightness — the largest
 * perceptual gap the wheel offers, still derived from the song's own palette rather than a fixed
 * colour. Tokens simply alternate A, B, A, B … so neighbouring words always differ.
 */
export const getTokenColorPalette = (palette?: NodeVibrantPalette): string[] => {
  // Every palette swatch is optional; LightVibrant always exists on the default palette.
  const swatch = palette?.LightVibrant ?? DEFAULT_SONG_PALETTE.LightVibrant;
  const [h, rawS, rawL] = swatch.hsl;
  const s = Math.max(Math.min(rawS, 1), MIN_SATURATION);
  const l = Math.min(Math.max(rawL, MIN_LIGHTNESS), MAX_LIGHTNESS);

  return [
    formatHsl([h, s, l]),
    formatHsl([(h + 0.5) % 1, s, l])
  ];
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
