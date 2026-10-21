import { describe, expect, test } from 'vitest';

import {
  getSpacedLyricLineText,
  getSpacedLyricLineTextWithWordSpans,
  getTokenColor,
  getTokenColorPalette,
  getTokenSingingWindows
} from '../../../../../src/renderer/src/other/lyricsAnalysisUtils';

const word = (text: string): SyncedLyricsLineWord => ({
  text,
  start: 0,
  end: 1,
  unparsedText: text
});

const swatch = (hsl: [number, number, number]): NodeVibrantPaletteSwatch => ({
  hsl,
  hex: '#000000',
  population: 1
});

const palette = (overrides: Partial<NodeVibrantPalette> = {}): NodeVibrantPalette => ({
  LightVibrant: swatch([0.1, 0.9, 0.74]),
  Vibrant: swatch([0.1, 0.9, 0.5]),
  LightMuted: swatch([0.6, 0.3, 0.75]),
  Muted: swatch([0.1, 0.9, 0.3]),
  DarkVibrant: swatch([0.1, 0.9, 0.26]),
  DarkMuted: swatch([0.1, 0.9, 0.3]),
  ...overrides
});

const parse = (color: string) => {
  const [h, s, l] = color.split(' ');
  return {
    h: Number(h) / 360,
    s: Number(s.replace('%', '')) / 100,
    l: Number(l.replace('%', '')) / 100
  };
};

const hueDistance = (a: string, b: string) => {
  const d = Math.abs(parse(a).h - parse(b).h);
  return Math.min(d, 1 - d);
};

describe('getSpacedLyricLineText', () => {
  // The real-world failure this guards against: NetEase YRC (ENHANCED_SYNCED) words joined without
  // separators left the model no way to see word boundaries, and every line of Till I Die came
  // back as one whole-line token. This exact line is the song's first line.
  test('joins an English YRC word array with spaces (the analysis input contract)', () => {
    const line: LyricLine = {
      originalText: [
        word('I'),
        word('have'),
        word('to'),
        word('go'),
        word('somewhere'),
        word('I'),
        word('saw')
      ],
      translatedTexts: [],
      isEnhancedSynced: true
    };

    expect(getSpacedLyricLineText(line.originalText)).toBe('I have to go somewhere I saw');
  });

  test('returns string lines untouched', () => {
    expect(getSpacedLyricLineText('I have to go')).toBe('I have to go');
  });

  test('collapses whitespace already present in word payloads instead of doubling it', () => {
    expect(getSpacedLyricLineText([word('I '), word(' have')])).toBe('I have');
  });

  test('keeps CJK YRC words space-joined (boundaries stay explicit for the model)', () => {
    expect(getSpacedLyricLineText([word('夜'), word('に'), word('駆ける')])).toBe(
      '夜 に 駆ける'
    );
  });
});

describe('getTokenColorPalette', () => {
  // The token colour contract: exactly two colours, BOTH verbatim palette swatches — the song
  // title's own colour (LightVibrant, which is what --dark-text-color-highlight uses in the
  // always-dark fullscreen player) plus the other readable swatch whose hue is farthest from it —
  // alternating across tokens. No recomputed hues, no clamping.
  test('returns exactly two colours, both verbatim swatches, B the farthest-hue readable one', () => {
    const colors = getTokenColorPalette(palette());

    expect(colors).toHaveLength(2);
    // Colour A is LightVibrant verbatim.
    expect(parse(colors[0])).toEqual({ h: 0.1, s: 0.9, l: 0.74 });
    // Colour B is LightMuted's swatch, unmodified (h 0.6 is the farthest hue among readable
    // candidates here).
    expect(parse(colors[1])).toEqual({ h: 0.6, s: 0.3, l: 0.75 });
  });

  test('prefers a readable swatch over darker far-hue ones and never brightens a dark pick', () => {
    // A dark, far-hue Vibrant must NOT be brightened into colour B — the palette simply yields
    // the readable LightMuted swatch instead, verbatim.
    const colors = getTokenColorPalette(
      palette({
        Vibrant: swatch([0.9, 0.9, 0.45]),
        LightMuted: swatch([0.6, 0.3, 0.75]),
        Muted: swatch([0.5, 0.3, 0.6])
      })
    );

    expect(colors).toHaveLength(2);
    expect(parse(colors[1])).toEqual({ h: 0.6, s: 0.3, l: 0.75 });
  });

  test('returns a single colour when no other readable swatch exists instead of inventing one', () => {
    const colors = getTokenColorPalette(
      palette({
        Vibrant: swatch([0.2, 0.9, 0.45]),
        LightMuted: swatch([0.1, 0.3, 0.4]),
        Muted: swatch([0.1, 0.9, 0.3]),
        DarkVibrant: swatch([0.1, 0.9, 0.26]),
        DarkMuted: swatch([0.1, 0.9, 0.3])
      })
    );

    // Every remaining swatch is too dark for the near-black player background, so B would not
    // be readable — and a recomputed complement would not be a palette colour.
    expect(colors).toHaveLength(1);
    expect(parse(colors[0])).toEqual({ h: 0.1, s: 0.9, l: 0.74 });
  });

  test('falls back to the default song palette when the cover has no palette', () => {
    expect(getTokenColorPalette(undefined)).toEqual(getTokenColorPalette({}));
    // The default palette is mint green (~152°); the only other swatch above the readability
    // floor with meaningful hue distance is Muted, so B is that swatch verbatim (not a recomputed
    // hue).
    const [a, b] = getTokenColorPalette(undefined).map(parse);
    expect(a.h * 360).toBeCloseTo(151.6, 0);
    expect(b.h * 360).toBeCloseTo(32.4, 0);
    expect(b.l * 100).toBeCloseTo(69.2, 1);
  });
});

describe('getTokenColor', () => {
  const colors = ['a', 'b'];

  test('alternates between the two colours for consecutive tokens', () => {
    expect(getTokenColor(0, colors)).toBe('a');
    expect(getTokenColor(1, colors)).toBe('b');
    expect(getTokenColor(2, colors)).toBe('a');
    expect(getTokenColor(3, colors)).toBe('b');
  });

  test('returns undefined for an empty palette instead of crashing', () => {
    expect(getTokenColor(0, [])).toBeUndefined();
  });
});

describe('getSpacedLyricLineTextWithWordSpans', () => {
  // The singing highlight hydrates YRC word timings into the token view's char coordinates, so
  // the spans MUST slice out each word's visible text from the same string the tokens are
  // validated against.
  test('reconstructs each word from the spaced text by its span', () => {
    const words = [word('I'), word('have'), word('to'), word('go')];
    const { text, wordSpans } = getSpacedLyricLineTextWithWordSpans(words);

    expect(text).toBe('I have to go');
    expect(wordSpans.map((span) => text.slice(span.start, span.end))).toEqual([
      'I',
      'have',
      'to',
      'go'
    ]);
  });

  test('time windows ride through verbatim', () => {
    const { wordSpans } = getSpacedLyricLineTextWithWordSpans([word('夜'), word('に')]);

    expect(wordSpans).toHaveLength(2);
    expect(wordSpans[0]).toMatchObject({ start: 0, end: 1, timeStart: 0, timeEnd: 1 });
    expect(wordSpans[1]).toMatchObject({ start: 2, end: 3, timeStart: 0, timeEnd: 1 });
  });

  test('stray padding inside word payloads cannot shift spans', () => {
    // The spaced text collapses 'I ' + ' have' to 'I have'; the spans must still slice the
    // reconstructed words, not the raw payload boundaries.
    const { text, wordSpans } = getSpacedLyricLineTextWithWordSpans([
      word('I '),
      word(' have')
    ]);

    expect(text).toBe('I have');
    expect(wordSpans.map((span) => text.slice(span.start, span.end))).toEqual(['I', 'have']);
  });

  test('string lines carry no spans (nothing to hydrate)', () => {
    expect(getSpacedLyricLineTextWithWordSpans('plain line')).toEqual({
      text: 'plain line',
      wordSpans: []
    });
  });
});

describe('getTokenSingingWindows', () => {
  const token = (tokenId: string, startChar: number, endChar: number) => ({
    tokenId,
    startChar,
    endChar
  });

  test('lights the whole token the moment its word starts sounding', () => {
    // "I have to go": token "have" spans [2, 6); its word sounds 10s..12s.
    const spans = [{ start: 2, end: 6, timeStart: 10, timeEnd: 12 }];
    // Anywhere inside the window — 0.1s in or 1.9s in — the word is fully lit.
    expect(getTokenSingingWindows(10.1, [token('t1', 2, 6)], spans)?.get('t1')).toEqual({
      sungStart: 0,
      sungEnd: 4
    });
    expect(getTokenSingingWindows(11.9, [token('t1', 2, 6)], spans)?.get('t1')).toEqual({
      sungStart: 0,
      sungEnd: 4
    });
  });

  test('a multi-word token lights only the word being sung', () => {
    // "settled down": one token [0, 12); "settled" 0..10s, "down" 10..14s.
    const spans = [
      { start: 0, end: 7, timeStart: 0, timeEnd: 10 },
      { start: 8, end: 12, timeStart: 10, timeEnd: 14 }
    ];
    const windows = getTokenSingingWindows(
      12,
      [token('t1', 0, 12)],
      spans
    );

    // "down" is sounding: the lit run is its characters only, "settled" stays unlit.
    expect(windows?.get('t1')).toEqual({ sungStart: 8, sungEnd: 12 });
  });

  test('past words revert: the map only holds the currently-sounding span', () => {
    const spans = [
      { start: 0, end: 1, timeStart: 0, timeEnd: 1 },
      { start: 2, end: 6, timeStart: 1, timeEnd: 2 }
    ];
    const tokens = [token('t1', 0, 1), token('t2', 2, 6)];

    expect(getTokenSingingWindows(0.5, tokens, spans)?.has('t2')).toBe(false);
    expect(getTokenSingingWindows(1.5, tokens, spans)?.has('t1')).toBe(false);
    expect(getTokenSingingWindows(1.5, tokens, spans)?.has('t2')).toBe(true);
  });

  test('returns undefined between words and before the line starts', () => {
    const spans = [{ start: 0, end: 1, timeStart: 5, timeEnd: 6 }];

    expect(getTokenSingingWindows(4.9, [token('t1', 0, 1)], spans)).toBeUndefined();
    expect(getTokenSingingWindows(6.1, [token('t1', 0, 1)], spans)).toBeUndefined();
  });

  test('overlapping word windows union their lit ranges', () => {
    const spans = [
      { start: 0, end: 4, timeStart: 0, timeEnd: 2 },
      { start: 2, end: 6, timeStart: 1, timeEnd: 3 }
    ];
    // At 1.5 both spans sound; the union covers [0, ~4) of the token.
    const windows = getTokenSingingWindows(1.5, [token('t1', 0, 6)], spans);

    expect(windows?.get('t1')).toMatchObject({ sungStart: 0 });
    expect(windows?.get('t1')?.sungEnd).toBeGreaterThan(2);
  });
});
