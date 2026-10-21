import type { LyricsAnalysisToken } from '../../../common/lyricsAnalysis';

import { DEFAULT_SONG_PALETTE } from '../../../common/defaultSongPalette';
import { formatHsl } from './themePalette';

export const getLineIdForIndex = (index: number) => `line-${index}`;

/**
 * A maximal run of characters inside the spaced line text that is sung within one audio window.
 * Word-aligned (one YRC word usually yields one run; interior whitespace splits it), so the token
 * view can intersect these runs with token spans to restore the per-word singing highlight the
 * plain synced view has.
 */
export interface SingingSpan {
  /** Char span inside the spaced line text (UTF-16 code units). */
  start: number;
  end: number;
  /** Audio window (seconds) the run is sung in, verbatim from the YRC payload. */
  timeStart: number;
  timeEnd: number;
}

/**
 * Builds the spaced line text AND each word's char span inside it in one pass. The spaced text is
 * byte-identical to the classic `join(' ') + collapse + trim` join — the single source both the
 * analysis input (`useLyricsAnalysis`) and the token view's display text (`LyricLine`) already
 * rely on — so the singing-highlight coordinates are guaranteed to share the exact coordinate
 * system the token spans are validated against.
 *
 * The builder replays that join's whitespace collapse character by character while attributing
 * every surviving character to the word it came from (separator spaces belong to no word), so
 * stray padding inside word payloads cannot shift spans and `text.slice(span.start, span.end)`
 * reconstructs each word's visible text exactly.
 */
export const getSpacedLyricLineTextWithWordSpans = (
  originalText: string | SyncedLyricsLineWord[]
): { text: string; wordSpans: SingingSpan[] } => {
  if (typeof originalText === 'string') return { text: originalText, wordSpans: [] };

  // Flat char list: every word's characters plus one separator space between words. Iterating by
  // index (not for…of) keeps surrogate pairs as two units, matching String.slice coordinates.
  const WHITESPACE = /\s/;
  const chars: Array<{ ch: string; owner: number }> = [];
  originalText.forEach((word, wordIndex) => {
    for (let index = 0; index < word.text.length; index += 1)
      chars.push({ ch: word.text[index] ?? '', owner: wordIndex });
    if (wordIndex < originalText.length - 1) chars.push({ ch: ' ', owner: -1 });
  });

  let text = '';
  // Word index per output char; -1 for collapsed separators.
  const owners: number[] = [];
  for (let index = 0; index < chars.length; index += 1) {
    const entry = chars[index]!;
    if (WHITESPACE.test(entry.ch)) {
      // Collapse the whole run into one separator — `replace(/\s+/g, ' ')` — and never emit a
      // leading one (`trim`).
      if (text.length > 0) {
        text += ' ';
        owners.push(-1);
      }
      while (index + 1 < chars.length && WHITESPACE.test(chars[index + 1]!.ch)) index += 1;
      continue;
    }
    text += entry.ch;
    owners.push(entry.owner);
  }
  while (text.endsWith(' ')) {
    text = text.slice(0, -1);
    owners.pop();
  }

  // Group consecutive output chars by owner into runs; same-window neighbours merge because they
  // highlight identically anyway.
  const wordSpans: SingingSpan[] = [];
  for (let position = 0; position < owners.length; position += 1) {
    const owner = owners[position]!;
    if (owner < 0) continue;
    const word = originalText[owner]!;
    const last = wordSpans[wordSpans.length - 1];
    if (last && last.end === position && last.timeStart === word.start && last.timeEnd === word.end)
      last.end = position + 1;
    else
      wordSpans.push({ start: position, end: position + 1, timeStart: word.start, timeEnd: word.end });
  }

  return { text, wordSpans };
};

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
export const getSpacedLyricLineText = (originalText: string | SyncedLyricsLineWord[]) =>
  getSpacedLyricLineTextWithWordSpans(originalText).text;

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

/**
 * The portion of a token's text that is being sung right now, in the token's OWN character
 * coordinates: `sungStart`/`sungEnd` are offsets into the token's text delimiting the lit
 * characters. A token only appears here while one of its spans is sounding — the map IS the
 * highlight set; tokens absent from it render in their resting palette colour.
 */
export interface TokenSingingSpan {
  sungStart: number;
  sungEnd: number;
}

/**
 * Intersects the currently-sounding singing spans with the token spans at a playback position.
 * Pure function over shared coordinates — the token spans are already validated against the
 * spaced text (validateAndNormalizeLineAnalysis) and the singing spans are produced by the same
 * builder that produced the display text, so an intersection always means the same characters.
 *
 * Only spans whose audio window contains the position contribute (the plain synced view lights
 * just the word being sung — past words revert — and the token view honours that); within a
 * sounding span the highlight sweeps linearly through its characters, which is the per-character
 * granularity the YRC payload carries. A multi-word token lights only the characters of the word
 * being sung, so its earlier characters never flash back on when the next word starts.
 */
export const getTokenSingingWindows = (
  songPosition: number,
  tokens: Pick<LyricsAnalysisToken, 'tokenId' | 'startChar' | 'endChar'>[],
  singingSpans: SingingSpan[]
): Map<string, TokenSingingSpan> | undefined => {
  const windows = new Map<string, TokenSingingSpan>();

  for (const span of singingSpans) {
    if (songPosition < span.timeStart || songPosition >= span.timeEnd) continue;
    const spanDuration = span.timeEnd - span.timeStart;
    const progress = spanDuration > 0 ? (songPosition - span.timeStart) / spanDuration : 1;
    // Quantized to whole characters: the first char lights the moment its word starts (the char
    // being sung counts as lit — "唱到哪儿就上标识"), and the map then holds its value between
    // character boundaries, so consumers can bail out on identity across position ticks.
    const sungEnd =
      span.start + Math.min(span.end - span.start, Math.floor((span.end - span.start) * progress) + 1);

    for (const token of tokens) {
      const start = Math.max(token.startChar, span.start);
      const end = Math.min(token.endChar, sungEnd);
      if (end <= start) continue;

      const existing = windows.get(token.tokenId);
      if (existing) {
        // Overlapping word windows (rare but present in some YRC payloads) union their lit
        // ranges instead of letting the last write truncate the earlier one.
        existing.sungStart = Math.min(existing.sungStart, start - token.startChar);
        existing.sungEnd = Math.max(existing.sungEnd, end - token.startChar);
      } else {
        windows.set(token.tokenId, {
          sungStart: start - token.startChar,
          sungEnd: end - token.startChar
        });
      }
    }
  }

  return windows.size > 0 ? windows : undefined;
};
