export type HslValues = [number, number, number];

type HslRange = { min?: number; max?: number };

/**
 * Clamps the lightness of a Vibrant HSL triplet into `range`, raising dark colours so they stay
 * readable on the dark player background. Shared with the dynamic theme so token colours are
 * derived exactly like the rest of the themed UI.
 */
export const manageBrightness = (values: HslValues, range?: HslRange): HslValues => {
  const max = range?.max || 1;
  const min = range?.min || 0.9;

  const [h, s, l] = values;

  const updatedL = l >= min ? (l <= max ? l : max) : min;
  return [h, s, updatedL];
};

/** Clamps the saturation of a Vibrant HSL triplet into `range`. */
export const manageSaturation = (values: HslValues, range?: HslRange): HslValues => {
  const max = range?.max || 1;
  const min = range?.min || 0.9;

  const [h, s, l] = values;

  const updatedS = s >= min ? (s <= max ? s : max) : min;
  return [h, updatedS, l];
};

/** Formats Vibrant's 0..1 HSL triplet as the space-separated channels used by the CSS theme. */
export const formatHsl = (values: HslValues) => {
  const [h, s, l] = values;

  return `${h * 360} ${s * 100}% ${l * 100}%`;
};

/**
 * Derives the six themed HSL colours (as `formatHsl` strings) from the three palette swatches the
 * theme reads. Shared by the dynamic-theme hook and the dynamic-theme settings preview; callers
 * keep their own guards (swatch-presence checks / `[0, 0, 0]` fallbacks) and pass in non-optional
 * swatches, so only this computation is common.
 */
export const deriveThemeColors = (palette: {
  LightVibrant: NodeVibrantPaletteSwatch;
  Vibrant: NodeVibrantPaletteSwatch;
  DarkVibrant: NodeVibrantPaletteSwatch;
}) => {
  const { LightVibrant, Vibrant, DarkVibrant } = palette;

  const highLightVibrant = formatHsl(manageBrightness(LightVibrant.hsl));
  const mediumLightVibrant = formatHsl(manageBrightness(LightVibrant.hsl, { min: 0.75 }));
  const darkLightVibrant = formatHsl(
    manageSaturation(
      manageBrightness(LightVibrant.hsl, {
        max: 0.2,
        min: 0.2
      }),
      { max: 0.05, min: 0.05 }
    )
  );
  const highVibrant = formatHsl(manageBrightness(Vibrant.hsl, { min: 0.7 }));

  const lightVibrant = formatHsl(LightVibrant.hsl);
  const darkVibrant = formatHsl(DarkVibrant.hsl);

  return {
    highLightVibrant,
    mediumLightVibrant,
    darkLightVibrant,
    highVibrant,
    lightVibrant,
    darkVibrant
  };
};
