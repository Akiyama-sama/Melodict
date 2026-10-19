import { beforeEach, describe, expect, test, vi } from 'vitest';

const memfs: Record<string, string> = {};

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/fake-userdata') } }));
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(async (p: string) => {
      if (!(p in memfs)) {
        const err = new Error('no entry') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return memfs[p];
    }),
    writeFile: vi.fn(async (p: string, data: string) => {
      memfs[p] = data;
    }),
    rename: vi.fn(async (from: string, to: string) => {
      memfs[to] = memfs[from];
      delete memfs[from];
    }),
    mkdir: vi.fn(async () => undefined),
    rm: vi.fn(async (p: string) => {
      delete memfs[p];
    })
  }
}));
vi.mock('../../../../src/main/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));
const generatePaletteMock = vi.fn();
vi.mock('../../../../src/main/other/generatePalette', () => ({
  default: (...args: unknown[]) => generatePaletteMock(...args)
}));

import {
  getNeteaseSongPalette,
  readNeteasePaletteCache,
  writeNeteasePaletteCache
} from '../../../../src/main/netease/paletteCache';

const entryPath = (neteaseId: number) => `/tmp/fake-userdata/netease-palette-cache/${neteaseId}.json`;

const aPalette = (): PaletteData => ({
  paletteId: 'p1',
  Vibrant: { hex: '#123456', hsl: [0.5, 0.5, 0.5], population: 1 }
});

beforeEach(() => {
  for (const key of Object.keys(memfs)) delete memfs[key];
  generatePaletteMock.mockReset();
});

describe('netease palette cache', () => {
  test('round-trips a palette through write/read', async () => {
    await writeNeteasePaletteCache(42, aPalette());
    expect(await readNeteasePaletteCache(42)).toMatchObject({ paletteId: 'p1' });
  });

  test('returns undefined for a missing entry', async () => {
    expect(await readNeteasePaletteCache(7)).toBeUndefined();
  });

  test('getNeteaseSongPalette generates, caches and reuses', async () => {
    generatePaletteMock.mockResolvedValue(aPalette());

    const first = await getNeteaseSongPalette(9, 'https://cdn.example/cover.jpg');
    expect(first).toMatchObject({ paletteId: 'p1' });
    expect(generatePaletteMock).toHaveBeenCalledWith('https://cdn.example/cover.jpg');

    // Second call is served from disk without regenerating.
    generatePaletteMock.mockClear();
    const second = await getNeteaseSongPalette(9, 'https://cdn.example/cover.jpg');
    expect(second).toMatchObject({ paletteId: 'p1' });
    expect(generatePaletteMock).not.toHaveBeenCalled();
  });

  test('getNeteaseSongPalette returns undefined without a cover', async () => {
    expect(await getNeteaseSongPalette(1, undefined)).toBeUndefined();
    expect(generatePaletteMock).not.toHaveBeenCalled();
  });

  test('generation failures degrade to undefined instead of throwing', async () => {
    generatePaletteMock.mockRejectedValue(new Error('network down'));
    expect(await getNeteaseSongPalette(3, 'https://cdn.example/cover.jpg')).toBeUndefined();
  });
});
