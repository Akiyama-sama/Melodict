import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import {
  LYRICS_ANALYSIS_TELEMETRY_VERSION,
  getTelemetryShardKey,
  lyricsAnalysisTelemetryEventSchema,
  type LyricsAnalysisTelemetryEvent
} from '../../common/lyricsAnalysisTelemetry';
import logger from '../logger';

/**
 * Append-only JSONL persistence for analysis telemetry. One shard file per local day under
 * `userData/lyrics-analysis-telemetry/`, each line a validated event object. Shards older than
 * 90 days are pruned opportunistically so evaluation sets stay bounded.
 */

const TELEMETRY_DIR_NAME = 'lyrics-analysis-telemetry';
const SHARD_RETENTION_DAYS = 90;

export const getLyricsAnalysisTelemetryDir = () =>
  path.join(app.getPath('userData'), TELEMETRY_DIR_NAME);

const getShardPath = (shardKey: string) =>
  path.join(getLyricsAnalysisTelemetryDir(), `${shardKey}.jsonl`);

/** Validates against the zod union; malformed events are logged and dropped, never written. */
export const appendLyricsAnalysisTelemetryEvent = async (
  event: LyricsAnalysisTelemetryEvent
): Promise<void> => {
  const parsed = lyricsAnalysisTelemetryEventSchema.safeParse(event);
  if (!parsed.success) {
    logger.warn('Rejected a malformed lyrics-analysis telemetry event.', {
      error: parsed.error.message,
      kind: (event as { kind?: string })?.kind
    });
    return;
  }

  try {
    await fs.mkdir(getLyricsAnalysisTelemetryDir(), { recursive: true });
    await fs.appendFile(
      getShardPath(getTelemetryShardKey(event.ts)),
      `${JSON.stringify(parsed.data)}\n`,
      'utf-8'
    );
  } catch (error) {
    logger.warn('Failed to append the lyrics-analysis telemetry event.', { error });
  }
};

export const pruneLyricsAnalysisTelemetry = async (now = Date.now()): Promise<number> => {
  const cutoff = now - SHARD_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  try {
    const entries = await fs.readdir(getLyricsAnalysisTelemetryDir());
    let pruned = 0;

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;

      const shardDate = Date.parse(`${entry.replace(/\.jsonl$/, '')}T00:00:00`);
      if (Number.isNaN(shardDate) || shardDate < cutoff) {
        await fs.rm(path.join(getLyricsAnalysisTelemetryDir(), entry), { force: true });
        pruned += 1;
      }
    }

    return pruned;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    logger.warn('Failed to prune old lyrics-analysis telemetry shards.', { error });
    return 0;
  }
};

export const readLyricsAnalysisTelemetryShard = async (
  shardKey: string
): Promise<LyricsAnalysisTelemetryEvent[]> => {
  try {
    const raw = await fs.readFile(getShardPath(shardKey), 'utf-8');
    const events: LyricsAnalysisTelemetryEvent[] = [];

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      try {
        events.push(lyricsAnalysisTelemetryEventSchema.parse(JSON.parse(trimmed)));
      } catch {
        // A torn tail line (crash mid-write) must not invalidate the rest of the shard.
      }
    }

    return events;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    logger.warn('Failed to read a lyrics-analysis telemetry shard.', { error });
    return [];
  }
};

export const listLyricsAnalysisTelemetryShards = async (): Promise<string[]> => {
  try {
    const entries = await fs.readdir(getLyricsAnalysisTelemetryDir());
    return entries
      .filter((entry) => entry.endsWith('.jsonl'))
      .map((entry) => entry.replace(/\.jsonl$/, ''))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    logger.warn('Failed to list lyrics-analysis telemetry shards.', { error });
    return [];
  }
};

export const telemetryVersion = LYRICS_ANALYSIS_TELEMETRY_VERSION;
