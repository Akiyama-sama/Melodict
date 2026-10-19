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
