/**
 * Single source of truth mapping node-vibrant's `PaletteData` swatch keys to the
 * `swatchTypeEnum` labels persisted in the artwork palettes table. The write side
 * (generatePalette) iterates this map and the read side (parsePaletteFromArtworks) looks keys up
 * in it, so the label set, the PaletteData field names and the swatch payload semantics can
 * never drift apart.
 */
export const PALETTE_SWATCH_TYPES = [
  { key: 'DarkVibrant', label: 'DARK_VIBRANT' },
  { key: 'LightVibrant', label: 'LIGHT_VIBRANT' },
  { key: 'DarkMuted', label: 'DARK_MUTED' },
  { key: 'LightMuted', label: 'LIGHT_MUTED' },
  { key: 'Muted', label: 'MUTED' },
  { key: 'Vibrant', label: 'VIBRANT' }
] as const satisfies readonly {
  key: keyof Omit<PaletteData, 'paletteId'>;
  label: 'VIBRANT' | 'LIGHT_VIBRANT' | 'DARK_VIBRANT' | 'MUTED' | 'LIGHT_MUTED' | 'DARK_MUTED';
}[];
