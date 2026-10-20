import { db } from '@main/db/db';
import { createArtworkPalette, getLowResArtworksWithoutPalettes } from '@main/db/queries/palettes';
import generateCoverBuffer from '@main/parseSong/generateCoverBuffer';
import { Vibrant } from 'node-vibrant/node';

import { DEFAULT_SONG_PALETTE } from '../../common/defaultSongPalette';
import roundTo from '../../common/roundTo';
import { PALETTE_SWATCH_TYPES } from '../../common/swatchTypes';
import logger from '../logger';
import { dataUpdateEvent, sendMessageToRenderer } from '../main';
import { timeEnd, timeStart } from '../utils/measureTimeUsage';
import { generateRandomId } from '../utils/randomId';

export { DEFAULT_SONG_PALETTE };

const generatePalette = async (artwork?: Buffer | string): Promise<PaletteData | undefined> => {
  if (artwork) {
    const palette = await Vibrant.from(artwork)
      .getPalette()
      .catch((error) => {
        logger.error(`Failed to parse a song artwork to get a color palette.`, {
          error
        });
      });

    if (palette) {
      const generatePaletteSwatch = <T extends typeof palette.DarkMuted>(
        nodeVibrantSwatch: T
      ): NodeVibrantPaletteSwatch | undefined => {
        if (nodeVibrantSwatch && Array.isArray(nodeVibrantSwatch.hsl)) {
          const [h, s, l] = nodeVibrantSwatch.hsl;

          const data: NodeVibrantPaletteSwatch = {
            population: nodeVibrantSwatch.population,
            hex: nodeVibrantSwatch.hex,
            hsl: [roundTo(h, 3), roundTo(s, 3), roundTo(l, 3)]
          };

          return data;
        }
        return undefined;
      };

      const outputPalette: PaletteData = {
        paletteId: generateRandomId(),
        Vibrant: generatePaletteSwatch(palette.Vibrant),
        LightVibrant: generatePaletteSwatch(palette.LightVibrant),
        DarkVibrant: generatePaletteSwatch(palette.DarkVibrant),
        Muted: generatePaletteSwatch(palette.Muted),
        LightMuted: generatePaletteSwatch(palette.LightMuted),
        DarkMuted: generatePaletteSwatch(palette.DarkMuted)
      };

      return outputPalette;
    }
    logger.warn('Generated artwork palette empty.');
    return undefined;
  }
  logger.warn('Empty input to generate a palette.');
  return DEFAULT_SONG_PALETTE;
};

const generatePalettesForSongs = async () => {
  const artworks = await getLowResArtworksWithoutPalettes();

  if (artworks.length > 0) {
    let x = 0;
    const noOfNoPaletteArtworks = artworks.reduce(
      (acc, artwork) => (!artwork.paletteId ? acc + 1 : acc),
      0
    );

    if (noOfNoPaletteArtworks > 0) {
      const start = timeStart();

      await db.transaction(async (trx) => {
        for (let i = 0; i < artworks.length; i += 1) {
          const artwork = artworks[i];

          if (!artwork.paletteId) {
            const buffer = await generateCoverBuffer(artwork.path, false);
            const palette = await generatePalette(buffer);

            await savePalette(artwork.id, palette, trx);
            x += 1;

            sendMessageToRenderer({
              messageCode: 'SONG_PALETTE_GENERATING_PROCESS_UPDATE',
              data: { total: noOfNoPaletteArtworks, value: x }
            });
          }
        }
      });

      timeEnd(start, 'Time to finish generating palettes');

      dataUpdateEvent('songs/palette');
    } else sendMessageToRenderer({ messageCode: 'NO_MORE_SONG_PALETTES' });
  }
};

const savePalette = async (
  artworkId: number,
  palette: PaletteData | undefined,
  trx: DBTransaction
) => {
  if (palette) {
    const swatches: Parameters<typeof createArtworkPalette>[0]['swatches'] = [];

    PALETTE_SWATCH_TYPES.forEach(({ key, label }) => {
      const swatch = palette[key];

      if (swatch && typeof swatch === 'object') {
        swatches.push({
          hex: swatch.hex,
          hsl: {
            h: swatch.hsl[0],
            s: swatch.hsl[1],
            l: swatch.hsl[2]
          },
          population: swatch.population,
          swatchType: label
        });
      }
    });

    await createArtworkPalette({ artworkId, swatches }, trx);
  }
};

export const generatePalettes = async () => {
  try {
    await generatePalettesForSongs();
  } catch (error) {
    logger.error('Failed to generate palettes for songs.', { error });
  }
};

export default generatePalette;
