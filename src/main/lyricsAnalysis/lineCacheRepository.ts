import crypto from 'crypto';
import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import {
  LYRICS_ANALYSIS_PROMPT_VERSION,
  LYRICS_ANALYSIS_SCHEMA_VERSION,
  buildTokenId,
  type LyricsAnalysisLanguage,
  type LyricsAnalysisLine
} from '../../common/lyricsAnalysis';
import logger from '../logger';

/**
 * Line-level analysis cache.
 *
 * The song-level artifact in cacheRepository only hits when the *entire* line list matches, so a
 * repeated chorus line inside one song, or a line shared between two songs, is re-sent to the LLM
 * every time. This cache keys each analyzed line by everything that actually determines its
 * analysis — the line text, the human romanization reference, the line's resolved language (the
 * language directive is picked per script), the output language, and the model/prompt/schema
 * versions — and deliberately NOT by lineId, which is what makes it reusable across songs.
 *
 * Entries store tokens with the lineId they were produced under; hydration rewrites every tokenId
 * for the line's new id, so a line reused as `line-17` in another song carries valid ids there.
 */

const LINE_CACHE_DIR_NAME = 'lyrics-analysis-line-cache';
const LINE_CACHE_FORMAT_VERSION = 1;
const CACHE_FILE_EXTENSION = '.json';

export interface LineAnalysisCacheEntry {
  v: number;
  text: string;
  translation?: string;
  tokens: LyricsAnalysisLine['tokens'];
  status: LyricsAnalysisLine['status'];
  cachedAt: number;
}

export const getLineAnalysisCacheDir = () =>
  path.join(app.getPath('userData'), LINE_CACHE_DIR_NAME);

const getEntryPath = (key: string) =>
  path.join(getLineAnalysisCacheDir(), `${key}${CACHE_FILE_EXTENSION}`);

/**
 * Stable key for one line's analysis. Everything that changes what the model would produce goes in;
 * the lineId does not, because the same text deserves the same analysis wherever it appears.
 */
export const buildLineAnalysisCacheKey = (input: {
  text: string;
  romanizedText?: string;
  uiLanguage: string;
  modelId: string;
  language: LyricsAnalysisLanguage;
}) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        v: LINE_CACHE_FORMAT_VERSION,
        text: input.text,
        romanizedText: input.romanizedText ?? '',
        uiLanguage: input.uiLanguage,
        modelId: input.modelId,
        language: input.language,
        promptVersion: LYRICS_ANALYSIS_PROMPT_VERSION,
        schemaVersion: LYRICS_ANALYSIS_SCHEMA_VERSION
      })
    )
    .digest('hex');

export const readLineAnalysisCache = async (
  key: string
): Promise<LineAnalysisCacheEntry | undefined> => {
  try {
    const raw = await fs.readFile(getEntryPath(key), 'utf-8');
    const entry = JSON.parse(raw) as LineAnalysisCacheEntry;

    if (
      entry?.v !== LINE_CACHE_FORMAT_VERSION ||
      typeof entry.text !== 'string' ||
      !Array.isArray(entry.tokens) ||
      entry.tokens.length === 0
    )
      return undefined;

    return entry;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      logger.warn('Failed to read the line analysis cache entry.', { error, key });
    return undefined;
  }
};

/** Rewrites an analysis onto a different lineId, rebuilding every token id from its span. */
export const remapLineAnalysisLineId = (input: {
  line: Pick<LyricsAnalysisLine, 'text' | 'translation' | 'tokens' | 'status'>;
  lineId: string;
  text: string;
}): LyricsAnalysisLine => ({
  lineId: input.lineId,
  text: input.text,
  translation: input.line.translation,
  tokens: input.line.tokens.map((token) => ({
    ...token,
    tokenId: buildTokenId(input.lineId, token.startChar, token.endChar)
  })),
  status: input.line.status
});

export const hydrateLineAnalysisFromCache = (input: {
  entry: LineAnalysisCacheEntry;
  lineId: string;
  text: string;
}): LyricsAnalysisLine =>
  remapLineAnalysisLineId({
    line: {
      text: input.entry.text,
      translation: input.entry.translation,
      tokens: input.entry.tokens,
      status: input.entry.status
    },
    lineId: input.lineId,
    text: input.text
  });

export const writeLineAnalysisCache = async (input: {
  key: string;
  line: LyricsAnalysisLine;
}): Promise<void> => {
  const entry: LineAnalysisCacheEntry = {
    v: LINE_CACHE_FORMAT_VERSION,
    text: input.line.text,
    translation: input.line.translation,
    tokens: input.line.tokens,
    status: input.line.status,
    cachedAt: Date.now()
  };

  const entryPath = getEntryPath(input.key);
  const tempPath = `${entryPath}.tmp`;

  try {
    await fs.mkdir(getLineAnalysisCacheDir(), { recursive: true });
    await fs.writeFile(tempPath, JSON.stringify(entry), 'utf-8');
    await fs.rename(tempPath, entryPath);
  } catch (error) {
    logger.warn('Failed to write the line analysis cache entry.', { error });
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
};

/**
 * Bounds the cache: entries older than `maxAgeDays` go first, then the oldest entries beyond
 * `maxEntries`. One entry is a few KB, so the cap keeps the directory in the tens-of-MB range even
 * for very large libraries. Best-effort — failures only cost disk, never correctness.
 */
export const pruneLineAnalysisCache = async (input?: {
  maxAgeDays?: number;
  maxEntries?: number;
}): Promise<number> => {
  const maxAgeDays = input?.maxAgeDays ?? 60;
  const maxEntries = input?.maxEntries ?? 20000;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  try {
    const dir = getLineAnalysisCacheDir();
    const names = (await fs.readdir(dir)).filter((name) => name.endsWith(CACHE_FILE_EXTENSION));
    const survivors: Array<{ filePath: string; mtimeMs: number }> = [];
    let pruned = 0;

    for (const name of names) {
      const filePath = path.join(dir, name);
      try {
        const stat = await fs.stat(filePath);
        if (stat.mtimeMs < cutoff) {
          await fs.rm(filePath, { force: true });
          pruned += 1;
        } else {
          survivors.push({ filePath, mtimeMs: stat.mtimeMs });
        }
      } catch {
        // Raced with another prune or a concurrent write — nothing to do.
      }
    }

    if (survivors.length > maxEntries) {
      survivors.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const entry of survivors.slice(0, survivors.length - maxEntries)) {
        await fs.rm(entry.filePath, { force: true });
        pruned += 1;
      }
    }

    return pruned;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    logger.warn('Failed to prune the line analysis cache.', { error });
    return 0;
  }
};
