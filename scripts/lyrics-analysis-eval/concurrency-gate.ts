#!/usr/bin/env tsx
/**
 * concurrency-gate.ts — real-gateway wall-time measurement for the AIMD concurrency work.
 *
 * Runs the production pipeline on a song's LRC and reports m (deduped lines sent), the AIMD
 * window's max/mean (from onConcurrencyStats), T_med (median per-batch duration from pass
 * events), whole-song wall clock, and whether the run meets
 *   wall <= ceil(m / n) * T_med * 1.5
 * using n = concurrencyWindowMax as the effective window.
 */

import fs from 'node:fs/promises';
import process from 'node:process';

import { analyzeLyrics } from '../../src/main/lyricsAnalysis/providerGateway';

import { readCredsFromEnvFile } from './lib/creds';
import { parseLrcFile } from './lib/lrc';

const getArg = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const lyricsPath = getArg('--lyrics');
if (!lyricsPath) {
  console.error('Usage: tsx scripts/lyrics-analysis-eval/concurrency-gate.ts --lyrics <file.lrc> [--title …]');
  process.exit(1);
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const main = async () => {
  const creds = readCredsFromEnvFile();
  const baseURL = getArg('--base-url') ?? creds.baseURL ?? 'http://127.0.0.1:3425/v1';
  const apiKey = getArg('--api-key') ?? creds.apiKey ?? 'local';
  const modelId = getArg('--model') ?? 'workbuddy/glm-5.3-flash';
  const maxConcurrency = getArg('--max-concurrency');
  const title = getArg('--title') ?? 'gate';

  const entries = await parseLrcFile(lyricsPath);
  const lines = entries.map((entry, index) => ({ lineId: `line-${index}`, text: entry.text }));
  // m = deduped line count (the same dedupe the session manager applies before the LLM).
  const seen = new Set<string>();
  const dedupedLines = lines.filter((line) => {
    if (seen.has(line.text)) return false;
    seen.add(line.text);
    return true;
  });

  const batchDurations: number[] = [];
  const startedAt = Date.now();
  let windowStats = { max: 0, mean: 0, rateLimitedCount: 0 };

  const outcome = await analyzeLyrics({
    config: {
      baseURL,
      modelId,
      apiKey,
      ...(maxConcurrency ? { maxConcurrency: Number(maxConcurrency) } : {})
    },
    uiLanguage: 'zh-CN',
    songTitle: title,
    songArtists: [],
    lines: dedupedLines,
    onLine: () => undefined,
    onPassCompleted: (pass) => {
      batchDurations.push(pass.durationMs);
    },
    onConcurrencyStats: (stats) => {
      windowStats = stats;
    }
  });

  const wallMs = Date.now() - startedAt;
  const tMed = median(batchDurations);
  const n = Math.max(1, windowStats.max);
  const budget = Math.ceil(dedupedLines.length / n) * tMed * 1.5;

  const result = {
    title,
    linesTotal: lines.length,
    m: dedupedLines.length,
    n,
    windowMean: windowStats.mean,
    rateLimitedCount: windowStats.rateLimitedCount,
    batches: batchDurations.length,
    tMedMs: Math.round(tMed),
    wallMs,
    budgetMs: Math.round(budget),
    pass: wallMs <= budget,
    okLines: outcome.lines.length,
    failedLineIds: outcome.failedLineIds.length
  };

  console.log(JSON.stringify(result));
  process.exitCode = result.pass ? 0 : 1;
};

void main().catch((error) => {
  console.error(String(error).slice(0, 400));
  process.exit(1);
});
