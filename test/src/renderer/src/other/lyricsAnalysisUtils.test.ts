import { describe, expect, test } from 'vitest';

import {
  getTokenColor,
  getTokenColorPalette
} from '../../../../../src/renderer/src/other/lyricsAnalysisUtils';

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

describe('getTokenColorPalette', () => {
  test('derives colours from the song palette and lifts every swatch to readable lightness', () => {
    const colors = getTokenColorPalette(palette());

    // The hue-0.1 swatches collapse into one lifted entry; the hue-0.6 LightMuted stays distinct.
    expect(colors).toEqual(['36 90% 74%', '216 30% 75%']);
    expect(colors.map(parse).every((c) => c.l >= 0.7)).toBe(true);
  });

  test('keeps distinct hues distinguishable', () => {
    const colors = getTokenColorPalette(palette());

    expect(new Set(colors).size).toBe(colors.length);
    expect(colors.length).toBeGreaterThan(1);
  });

  test('spreads hues around the wheel when the palette collapses into one colour', () => {
    // Monochrome covers (and the all-blue default palette) leave hue as the only differentiator.
    const mono: NodeVibrantPalette = {
      LightVibrant: swatch([0, 0, 0.74]),
      Vibrant: swatch([0, 0, 0.5]),
      LightMuted: swatch([0, 0, 0.75]),
      Muted: swatch([0, 0, 0.486]),
      DarkVibrant: swatch([0, 0, 0.26]),
      DarkMuted: swatch([0, 0, 0.267])
    };

    const colors = getTokenColorPalette(mono);

    expect(colors.length).toBe(6);
    // Every neighbouring pair must be far apart on the wheel — that is the whole point.
    for (let i = 1; i < colors.length; i += 1) {
      expect(hueDistance(colors[i - 1], colors[i])).toBeGreaterThan(0.1);
    }
    // The palette's own lightness/chroma survive the spread.
    const parsed = colors.map(parse);
    expect(new Set(parsed.map((c) => c.l)).size).toBe(1);
    expect(parsed[0].l).toBeGreaterThanOrEqual(0.7);
    expect(parsed[0].s).toBeGreaterThanOrEqual(0.55);
  });

  test('spreads hues for the all-blue default palette used when a song has no palette', () => {
    const colors = getTokenColorPalette(undefined);

    expect(colors.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < colors.length; i += 1) {
      expect(hueDistance(colors[i - 1], colors[i])).toBeGreaterThan(0.1);
    }
  });

  test('falls back to the default song palette when the cover has no palette', () => {
    expect(getTokenColorPalette(undefined)).toEqual(getTokenColorPalette({}));
  });
});

describe('getTokenColor', () => {
  const colors = ['a', 'b', 'c'];

  test('consecutive token ordinals land on consecutive colours', () => {
    expect(getTokenColor(0, colors)).toBe('a');
    expect(getTokenColor(1, colors)).toBe('b');
    expect(getTokenColor(2, colors)).toBe('c');
    expect(getTokenColor(3, colors)).toBe('a');
  });

  test('returns undefined for an empty palette instead of crashing', () => {
    expect(getTokenColor(0, [])).toBeUndefined();
  });
});
