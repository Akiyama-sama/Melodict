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

const lightnessOf = (color: string) => Number(color.split(' ')[2].replace('%', ''));

describe('getTokenColorPalette', () => {
  test('derives colours from the song palette and lifts every swatch to readable lightness', () => {
    const colors = getTokenColorPalette(palette());

    // The three dark swatches all clamp to 70% and dedupe into one entry.
    expect(colors).toEqual(['36 90% 74%', '36 90% 70%', '216 30% 75%']);
    expect(colors.every((color) => lightnessOf(color) >= 70)).toBe(true);
  });

  test('keeps distinct hues distinguishable', () => {
    const colors = getTokenColorPalette(palette());

    expect(new Set(colors).size).toBe(colors.length);
    expect(colors.length).toBeGreaterThan(1);
  });

  test('falls back to the default song palette when the cover has no palette', () => {
    expect(getTokenColorPalette(undefined)).toEqual(getTokenColorPalette({}));
    expect(getTokenColorPalette(undefined).length).toBeGreaterThan(1);
  });
});

describe('getTokenColor', () => {
  const colors = ['a', 'b', 'c'];

  test('buckets by start char so streaming re-renders never reshuffle colours', () => {
    expect(getTokenColor(0, colors)).toBe('a');
    expect(getTokenColor(1, colors)).toBe('b');
    expect(getTokenColor(3, colors)).toBe('a');
  });

  test('returns undefined for an empty palette instead of crashing', () => {
    expect(getTokenColor(0, [])).toBeUndefined();
  });
});
