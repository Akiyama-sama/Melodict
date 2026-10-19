import crypto from 'crypto';
import fs from 'fs/promises';
import { app } from 'electron';
import path from 'path';

import {
  LYRICS_ANALYSIS_PROMPT_VERSION,
  LYRICS_ANALYSIS_SCHEMA_VERSION,
  type LyricsAnalysisInputLine,
  type LyricsAnalysisLine
} from '../../common/lyricsAnalysis';
import logger from '../logger';
import { getJsonTmpPath, readJsonFileOrNull, writeJsonFileAtomic } from './fsJson';

export interface LyricsAnalysisCacheArtifact {
  fingerprint: string;
  schemaVersion: string;
  promptVersion: string;
  modelId: string;
  uiLanguage: string;
  songPath: string;
  songTitle: string;
  lines: LyricsAnalysisLine[];
  generatedAt: number;
}

export const getLyricsAnalysisCacheDir = () =>
  path.join(app.getPath('userData'), 'lyrics-analysis-cache');

export const buildLyricsAnalysisFingerprint = (input: {
  lines: LyricsAnalysisInputLine[];
  uiLanguage: string;
  modelId: string;
}) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        lines: input.lines,
        uiLanguage: input.uiLanguage,
        modelId: input.modelId,
        promptVersion: LYRICS_ANALYSIS_PROMPT_VERSION,
        schemaVersion: LYRICS_ANALYSIS_SCHEMA_VERSION
      })
    )
    .digest('hex');

const getArtifactPath = (fingerprint: string) =>
  path.join(getLyricsAnalysisCacheDir(), `${fingerprint}.json`);

/**
 * Reads the song-level artifact, tolerating an entry with zero lines — a run that crashed before
 * its first incremental flush. Partial artifacts still matter: whatever lines they hold can
 * hydrate the UI instantly and cut the next run's LLM workload.
 */
export const readLyricsAnalysisPartialCache = async (
  fingerprint: string
): Promise<LyricsAnalysisCacheArtifact | undefined> => {
  const artifact = await readJsonFileOrNull<LyricsAnalysisCacheArtifact>(
    getArtifactPath(fingerprint),
    (error) =>
      logger.warn('Failed to read the partial lyrics analysis cache entry.', {
        error,
        fingerprint
      })
  );

  if (artifact?.fingerprint !== fingerprint || !Array.isArray(artifact.lines)) return undefined;

  return artifact;
};

/**
 * Merges `incoming` lines into whatever is already on disk for this fingerprint and writes the
 * union atomically. Line ids already present are overwritten (later, repaired analyses win);
 * ids not present stay. This is what makes mid-run flushes and resume runs accumulate safely.
 */
export const mergeLyricsAnalysisCache = async (artifact: LyricsAnalysisCacheArtifact) => {
  const existing = await readLyricsAnalysisPartialCache(artifact.fingerprint);
  const mergedLines = new Map((existing?.lines ?? []).map((line) => [line.lineId, line]));
  for (const line of artifact.lines) mergedLines.set(line.lineId, line);

  const merged: LyricsAnalysisCacheArtifact = {
    ...artifact,
    lines: [...mergedLines.values()],
    generatedAt: Date.now()
  };

  await writeLyricsAnalysisCache(merged);
  return merged;
};

export const writeLyricsAnalysisCache = async (
  artifact: LyricsAnalysisCacheArtifact
): Promise<void> => {
  const artifactPath = getArtifactPath(artifact.fingerprint);
  const tempPath = getJsonTmpPath(artifactPath);

  try {
    await writeJsonFileAtomic(artifactPath, artifact);
  } catch (error) {
    logger.warn('Failed to write the lyrics analysis cache entry.', { error });
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
};
