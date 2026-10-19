/**
 * The default palette the dynamic theme falls back to when a song has no artwork palette.
 * Lives in `common` so both the main process (palette generation) and the renderer (token
 * colours) can use the same values.
 */
export const DEFAULT_SONG_PALETTE: PaletteData = {
  paletteId: 'DEFAULT_PALETTE',
  DarkMuted: {
    hex: '#104888',
    hsl: [0.589, 0.789, 0.3],
    population: 0
  },
  DarkVibrant: {
    hex: '#0d3e76',
    hsl: [0.589, 0.789, 0.26],
    population: 0
  },
  LightMuted: {
    hex: '#154383',
    hsl: [0.597, 0.716, 0.3],
    population: 0
  },
  LightVibrant: {
    hex: '#8cb4ec',
    hsl: [0.597, 0.716, 0.737],
    population: 8
  },
  Muted: {
    hex: '#104888',
    hsl: [0.589, 0.789, 0.3],
    population: 0
  },
  Vibrant: {
    hex: '#3c8ce8',
    hsl: [0.589, 0.789, 0.576],
    population: 2
  }
};
