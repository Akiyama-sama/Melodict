import crypto from 'crypto';
import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import {
  LYRICS_ANALYSIS_PROMPT_VERSION,
  LYRICS_ANALYSIS_SCHEMA_VERSION,
  type LyricsAnalysisInputLine,
  type LyricsAnalysisLine
} from '../../common/lyricsAnalysis';
import logger from '../logger';

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

export const readLyricsAnalysisCache = async (
  fingerprint: string
): Promise<LyricsAnalysisCacheArtifact | undefined> => {
  try {
    const raw = await fs.readFile(getArtifactPath(fingerprint), 'utf-8');
    const artifact = JSON.parse(raw) as LyricsAnalysisCacheArtifact;

    if (
      artifact?.fingerprint !== fingerprint ||
      !Array.isArray(artifact.lines) ||
      artifact.lines.length === 0
    )
      return undefined;

    return artifact;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      logger.warn('Failed to read the lyrics analysis cache entry.', { error, fingerprint });
    return undefined;
  }
};

export const writeLyricsAnalysisCache = async (
  artifact: LyricsAnalysisCacheArtifact
): Promise<void> => {
  const artifactPath = getArtifactPath(artifact.fingerprint);
  const tempPath = `${artifactPath}.tmp`;

  try {
    await fs.mkdir(getLyricsAnalysisCacheDir(), { recursive: true });
    await fs.writeFile(tempPath, JSON.stringify(artifact), 'utf-8');
    await fs.rename(tempPath, artifactPath);
  } catch (error) {
    logger.warn('Failed to write the lyrics analysis cache entry.', { error });
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
};
