import fs from 'fs/promises';
import path from 'path';

/**
 * Shared JSON-file plumbing for the lyricsAnalysis repositories: tolerant reads and tmp+rename
 * atomic writes. The error-reporting and cleanup policies stay at the call sites — each
 * repository has its own (swallow+cleanup vs. propagate, log context, file mode).
 */

/** The `.tmp` sibling written first and renamed over the target; exposed for failure cleanup. */
export const getJsonTmpPath = (filePath: string) => `${filePath}.tmp`;

/**
 * Reads a JSON file; a missing file (the normal first-run case) reads as `undefined` without
 * noise. Any other failure — including a JSON parse error — goes to `onUnexpectedError` and also
 * reads as `undefined`.
 */
export const readJsonFileOrNull = async <T>(
  filePath: string,
  onUnexpectedError?: (error: unknown) => void
): Promise<T | undefined> => {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') onUnexpectedError?.(error);
    return undefined;
  }
};

/**
 * Atomically writes `data` as JSON: creates the target's directory, writes a sibling `.tmp` file,
 * then renames it over `filePath`. Writes with the default utf-8 encoding; `spacing` and `mode`
 * are forwarded to `JSON.stringify` / `writeFile` for callers that need them.
 */
export const writeJsonFileAtomic = async (
  filePath: string,
  data: unknown,
  options: { spacing?: number; mode?: number } = {}
): Promise<void> => {
  const tempPath = getJsonTmpPath(filePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    tempPath,
    JSON.stringify(data, null, options.spacing),
    options.mode === undefined ? undefined : { mode: options.mode }
  );
  await fs.rename(tempPath, filePath);
};
