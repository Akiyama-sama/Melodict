import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import logger from '../logger';

/**
 * Shared skeleton for the versioned per-id JSON entry caches under `userData` (NetEase lyrics,
 * NetEase palettes): each entry is a `{ version, neteaseId, fetchedAt, <payload> }` document
 * stored as `<dirName>/<neteaseId>.json`, written through a temp file + rename, and rejected on
 * read when the version or id no longer matches, when the payload fails validation, or when the
 * TTL has elapsed. All failures degrade to `undefined` so callers never wait on or fail because
 * of a cache.
 */
interface JsonEntryCacheOptions {
  /** Directory name under `userData` holding the `<neteaseId>.json` entries. */
  dirName: string;
  /** Schema version stamped into every entry; reads reject mismatches. */
  version: number;
  /** Entry property holding the cached payload (e.g. `lyrics`, `palette`). */
  payloadKey: string;
  /** Extra payload validity check (e.g. `lyrics.lyrics` is non-empty). */
  isValidPayload: (payload: unknown) => boolean;
  /** Human label used in the read/write warning messages (e.g. `NetEase lyrics`). */
  label: string;
  /** Entries older than this are treated as missing. */
  ttlMs: number;
}

interface JsonEntryEnvelope {
  version?: number;
  neteaseId?: number;
  fetchedAt?: number;
}

export const createJsonEntryCache = <T>(options: JsonEntryCacheOptions) => {
  const getCacheDir = () => path.join(app.getPath('userData'), options.dirName);

  const getEntryPath = (neteaseId: number) => path.join(getCacheDir(), `${neteaseId}.json`);

  const read = async (neteaseId: number): Promise<T | undefined> => {
    try {
      const raw = await fs.readFile(getEntryPath(neteaseId), 'utf-8');
      const entry = JSON.parse(raw) as JsonEntryEnvelope & Record<string, unknown>;

      if (
        entry?.version !== options.version ||
        entry.neteaseId !== neteaseId ||
        !options.isValidPayload(entry[options.payloadKey])
      )
        return undefined;

      if (entry.fetchedAt === undefined || Date.now() - entry.fetchedAt > options.ttlMs) return undefined;

      return entry[options.payloadKey] as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        logger.warn(`Failed to read the ${options.label} cache entry.`, { error, neteaseId });
      return undefined;
    }
  };

  const write = async (neteaseId: number, payload: T): Promise<void> => {
    const entryPath = getEntryPath(neteaseId);
    const tempPath = `${entryPath}.tmp`;

    try {
      await fs.mkdir(getCacheDir(), { recursive: true });
      await fs.writeFile(
        tempPath,
        JSON.stringify({
          version: options.version,
          neteaseId,
          fetchedAt: Date.now(),
          [options.payloadKey]: payload
        }),
        'utf-8'
      );
      await fs.rename(tempPath, entryPath);
    } catch (error) {
      logger.warn(`Failed to write the ${options.label} cache entry.`, { error, neteaseId });
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
  };

  return { read, write };
};
