/**
 * The default palette the dynamic theme falls back to when a song has no artwork palette.
 * Lives in `common` so both the main process (palette generation) and the renderer (token
 * colours) can use the same values.
 */
/** `NodeVibrantPalette`'s swatches are all optional; this constant really has every one. */
export type CompleteSongPalette = PaletteData & Required<NodeVibrantPalette>;

export const DEFAULT_SONG_PALETTE: CompleteSongPalette = {
  paletteId: 'DEFAULT_PALETTE',
  DarkMuted: {
    hex: '#525a3f',
    hsl: [0.214, 0.18, 0.3],
    population: 0
  },
  DarkVibrant: {
    hex: '#4c5a2b',
    hsl: [0.217, 0.35, 0.26],
    population: 0
  },
  LightMuted: {
    hex: '#a2ab87',
    hsl: [0.208, 0.18, 0.6],
    population: 0
  },
  LightVibrant: {
    hex: '#cad6a4',
    hsl: [0.206, 0.38, 0.74],
    population: 8
  },
  Muted: {
    hex: '#727a5c',
    hsl: [0.214, 0.14, 0.42],
    population: 0
  },
  Vibrant: {
    hex: '#95a960',
    hsl: [0.214, 0.3, 0.52],
    population: 2
  }
};
