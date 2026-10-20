import { describe, expect, test } from 'vitest';

import {
  getSpacedLyricLineText,
  getTokenColor,
  getTokenColorPalette
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
  // The token colour contract: exactly two colours — the song title's own colour (LightVibrant,
  // which is what --dark-text-color-highlight uses in the always-dark fullscreen player) and its
  // hue complement — alternating across tokens.
  test('returns exactly two colours, the second being the complement of the first', () => {
    const colors = getTokenColorPalette(palette());

    expect(colors).toHaveLength(2);
    const [a, b] = colors.map(parse);
    // Complement: hue diametrically opposite, same saturation and lightness.
    expect(hueDistance(colors[0], colors[1])).toBeCloseTo(0.5, 5);
    expect(b.s).toBeCloseTo(a.s, 5);
    expect(b.l).toBeCloseTo(a.l, 5);
  });

  test('colour A is the LightVibrant swatch verbatim (the song title colour)', () => {
    const colors = getTokenColorPalette(palette());
    expect(parse(colors[0])).toEqual({ h: 0.1, s: 0.9, l: 0.74 });
  });

  test('clamps lightness into the readable band and saturation up to a visible floor', () => {
    // A dark, desaturated cover would otherwise produce unreadable token colours.
    const colors = getTokenColorPalette(
      palette({ LightVibrant: swatch([0.3, 0.1, 0.3]) })
    );

    for (const color of colors) {
      const { s, l } = parse(color);
      expect(l).toBeGreaterThanOrEqual(0.7);
      expect(l).toBeLessThanOrEqual(0.85);
      expect(s).toBeGreaterThanOrEqual(0.55);
    }
    // The two entries stay distinct even after clamping.
    expect(hueDistance(colors[0], colors[1])).toBeCloseTo(0.5, 5);
  });

  test('falls back to the default song palette when the cover has no palette', () => {
    expect(getTokenColorPalette(undefined)).toEqual(getTokenColorPalette({}));
    // The default palette is blue (~215°); colour B must be its complement (~35°, orange).
    const [a, b] = getTokenColorPalette(undefined).map(parse);
    expect(a.h * 360).toBeCloseTo(214.9, 0);
    expect(b.h * 360).toBeCloseTo(34.9, 0);
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
