import { deriveThemeColors } from '../../../other/themePalette';

type Props = { palette: PaletteData };

const DynamicThemeSettings = (props: Props) => {
  const { palette } = props;

  const fallbackSwatch: NodeVibrantPaletteSwatch = { hsl: [0, 0, 0], hex: '', population: 0 };

  const {
    highLightVibrant,
    mediumLightVibrant,
    darkLightVibrant,
    highVibrant,
    lightVibrant,
    darkVibrant
  } = deriveThemeColors({
    ...palette,
    LightVibrant: { ...fallbackSwatch, ...palette.LightVibrant, hsl: palette.LightVibrant?.hsl || [0, 0, 0] },
    Vibrant: { ...fallbackSwatch, ...palette.Vibrant, hsl: palette.Vibrant?.hsl || [0, 0, 0] },
    DarkVibrant: { ...fallbackSwatch, ...palette.DarkVibrant, hsl: palette.DarkVibrant?.hsl || [0, 0, 0] }
  });

  return (
    <div className="mt-8 flex flex-col gap-6">
      <div className="flex gap-6">
        <span className="flex w-24 flex-col items-center text-center text-xs">
          <span
            className="h-12 w-full rounded-md"
            style={{ backgroundColor: palette?.DarkVibrant?.hex }}
          />
          <span className="mt-2">Dark Vibrant</span>
        </span>
        <span className="flex w-24 flex-col items-center text-center text-xs">
          <span
            className="h-12 w-full rounded-md"
            style={{ backgroundColor: palette?.LightVibrant?.hex }}
          />
          <span className="mt-2">Light Vibrant</span>
        </span>
        <span className="flex w-24 flex-col items-center text-center text-xs">
          <span
            className="h-12 w-full rounded-md"
            style={{ backgroundColor: palette?.DarkMuted?.hex }}
          />
          <span className="mt-2">Dark Muted</span>
        </span>
        <span className="flex w-24 flex-col items-center text-center text-xs">
          <span
            className="h-12 w-full rounded-md"
            style={{ backgroundColor: palette?.LightMuted?.hex }}
          />
          <span className="mt-2">Light Muted</span>
        </span>
        <span className="flex w-24 flex-col items-center text-center text-xs">
          <span
            className="h-12 w-full rounded-md"
            style={{ backgroundColor: palette?.Vibrant?.hex }}
          />
          <span className="mt-2">Vibrant</span>
        </span>
        <span className="flex w-24 flex-col items-center text-center text-xs">
          <span
            className="h-12 w-full rounded-md"
            style={{ backgroundColor: palette?.Muted?.hex }}
          />
          <span className="mt-2">Muted</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-6">
        <span className="flex w-24 flex-col items-center text-center text-xs">
          <span
            className="h-12 w-full rounded-md"
            style={{ backgroundColor: `hsl(${highLightVibrant})` }}
          />
          <span className="mt-2">High Light Vibrant</span>
        </span>
        <span className="flex w-24 flex-col items-center text-center text-xs">
          <span
            className="h-12 w-full rounded-md"
            style={{ backgroundColor: `hsl(${mediumLightVibrant})` }}
          />
          <span className="mt-2">Medium Light Vibrant</span>
        </span>
        <span className="flex w-24 flex-col items-center text-center text-xs">
          <span
            className="h-12 w-full rounded-md"
            style={{ backgroundColor: `hsl(${highVibrant})` }}
          />
          <span className="mt-2">High Vibrant</span>
        </span>
        <span className="flex w-24 flex-col items-center text-center text-xs">
          <span
            className="h-12 w-full rounded-md"
            style={{ backgroundColor: `hsl(${lightVibrant})` }}
          />
          <span className="mt-2">Light Vibrant</span>
        </span>
        <span className="flex w-24 flex-col items-center text-center text-xs">
          <span
            className="h-12 w-full rounded-md"
            style={{ backgroundColor: `hsl(${darkVibrant})` }}
          />
          <span className="mt-2">Dark Vibrant</span>
        </span>
        <span className="flex w-24 flex-col items-center text-center text-xs">
          <span
            className="h-12 w-full rounded-md"
            style={{ backgroundColor: `hsl(${darkLightVibrant})` }}
          />
          <span className="mt-2">Dark Light Vibrant</span>
        </span>
      </div>
    </div>
  );
};

export default DynamicThemeSettings;
