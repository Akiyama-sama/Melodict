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
    hex: '#31674e',
    hsl: [0.423, 0.355, 0.298],
    population: 0
  },
  DarkVibrant: {
    hex: '#295b43',
    hsl: [0.42, 0.379, 0.259],
    population: 0
  },
  LightMuted: {
    hex: '#c4c3bc',
    hsl: [0.146, 0.063, 0.753],
    population: 0
  },
  LightVibrant: {
    hex: '#d9ece3',
    hsl: [0.421, 0.333, 0.888],
    population: 8
  },
  Muted: {
    hex: '#b7b1aa',
    hsl: [0.09, 0.083, 0.692],
    population: 0
  },
  Vibrant: {
    hex: '#52ad81',
    hsl: [0.419, 0.357, 0.5],
    population: 2
  }
};
