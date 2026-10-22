import { app } from 'electron';

import logger from '../logger';
import { readJsonFileOrNull, writeJsonFileAtomic } from './fsJson';

/**
 * Cross-session memory of the AIMD window's learned concurrency ceiling.
 *
 * A single session converges on what the endpoint tolerated (see ConcurrencyWindow), but every
 * new session used to start from scratch and re-pay the climb — and the first 429s it takes to
 * learn the limit again. This tiny store persists the learned ceiling per endpoint+model, so the
 * next session STARTS at what the previous one converged on: repeated runs converge monotonically
 * (throttles revise downward, sustained success probes upward by the window's overshoot rule),
 * which is the durable equivalent of "probe a few times and take the max".
 *
 * Lives in the MAIN process (Electron `app` is unavailable inside the analysis utility process,
 * where the window itself runs) — the session manager seeds each run from it and writes the
 * result back at session end.
 */

const MEMORY_FILE_NAME = 'lyrics-analysis-concurrency.json';
const MEMORY_FORMAT_VERSION = 1;
/** Fallback seed when nothing (or nothing valid) is stored for the endpoint. */
export const DEFAULT_CONCURRENCY_SEED = 4;
/** Absolute bound on what memory may seed, mirroring the window's own hard ceiling. */
const MAX_SEED = 16;

interface StoredMemoryFile {
  version: typeof MEMORY_FORMAT_VERSION;
  /** Key: `${normalized baseURL}|${modelId}` → the last learned window ceiling. */
  ceilings: Record<string, number>;
}

const emptyMemory = (): StoredMemoryFile => ({ version: MEMORY_FORMAT_VERSION, ceilings: {} });

/** The memory key for an endpoint+model. Normalizes the baseURL the same way the gateway's
 * OpenAI client does (trailing slashes, scheme) so aliases of one endpoint share an entry. */
export const concurrencyMemoryKey = (baseURL: string, modelId: string) => {
  const trimmed = baseURL.trim();
  const withScheme = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    const pathname = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${pathname === '/' ? '' : pathname}|${modelId.trim()}`;
  } catch {
    return `${trimmed.replace(/\/+$/, '')}|${modelId.trim()}`;
  }
};

const getMemoryPath = () => app.getPath('userData') + '/' + MEMORY_FILE_NAME;

const readMemory = async (): Promise<StoredMemoryFile> => {
  const stored = await readJsonFileOrNull<Partial<StoredMemoryFile>>(getMemoryPath(), (error) =>
    logger.warn('Failed to read the lyrics analysis concurrency memory.', { error })
  );
  if (!stored || stored.version !== MEMORY_FORMAT_VERSION || typeof stored.ceilings !== 'object' || stored.ceilings === null)
    return emptyMemory();

  const ceilings: Record<string, number> = {};
  for (const [key, value] of Object.entries(stored.ceilings)) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
      ceilings[key] = Math.min(MAX_SEED, Math.floor(value));
    }
  }
  return { version: MEMORY_FORMAT_VERSION, ceilings };
};

/** The seed for one endpoint+model: the last learned ceiling, or the default. */
export const readConcurrencySeed = async (baseURL: string, modelId: string): Promise<number> => {
  try {
    const memory = await readMemory();
    return memory.ceilings[concurrencyMemoryKey(baseURL, modelId)] ?? DEFAULT_CONCURRENCY_SEED;
  } catch (error) {
    logger.warn('Failed to load the concurrency seed; using the default.', { error });
    return DEFAULT_CONCURRENCY_SEED;
  }
};

/** Persists a session's learned ceiling for one endpoint+model. Fire-and-forget friendly: a
 * failed write logs and moves on — the next session simply re-learns. */
export const writeConcurrencyCeiling = async (baseURL: string, modelId: string, ceiling: number): Promise<void> => {
  if (!Number.isFinite(ceiling) || ceiling < 1) return;

  try {
    const memory = await readMemory();
    memory.ceilings[concurrencyMemoryKey(baseURL, modelId)] = Math.min(MAX_SEED, Math.floor(ceiling));
    await writeJsonFileAtomic(getMemoryPath(), memory, { spacing: 2 });
  } catch (error) {
    logger.warn('Failed to persist the learned concurrency ceiling.', { error });
  }
};

/** Drops one endpoint's entry (or every entry when no endpoint is given). Exposed for provider
 * cleanup and tests. */
export const forgetConcurrency = async (baseURL?: string, modelId?: string): Promise<void> => {
  try {
    if (baseURL === undefined || modelId === undefined) {
      await writeJsonFileAtomic(getMemoryPath(), emptyMemory(), { spacing: 2 });
      return;
    }
    const memory = await readMemory();
    delete memory.ceilings[concurrencyMemoryKey(baseURL, modelId)];
    await writeJsonFileAtomic(getMemoryPath(), memory, { spacing: 2 });
  } catch (error) {
    logger.warn('Failed to reset the concurrency memory.', { error });
  }
};
