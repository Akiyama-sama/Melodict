#!/usr/bin/env tsx
/**
 * analyze.ts — CLI entry into the production lyrics-analysis pipeline.
 *
 * Runs the exact `providerGateway.analyzeLyrics` the app uses (same prompt, schema, batching,
 * normalization) against a lyrics file, with no Electron involved. Output is the EvalAnalysisResult
 * JSON consumed by the scorer and the HTML reporter.
 *
 * Usage:
 *   tsx scripts/lyrics-analysis-eval/analyze.ts --lyrics <file.lrc> \
 *     [--title "…"] [--artist "…"] [--out <file.json>] \
 *     [--base-url https://… --model <id> --api-key <key>]
 *
 * Credentials resolve in order: --api-key / LYRICS_ANALYSIS_API_KEY env, then the app's stored
 * profile (only its plaintext fallback — safeStorage-encrypted keys cannot be decrypted here).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { analyzeLyrics } from '../../src/main/lyricsAnalysis/providerGateway';

interface CliArgs {
  lyricsPath: string;
  title: string;
  artists: string[];
  out?: string;
  baseURL?: string;
  modelId?: string;
  apiKey?: string;
}

const parseArgs = (argv: string[]): CliArgs => {
  const get = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const lyricsPath = get('--lyrics');
  if (!lyricsPath) {
    console.error('Usage: tsx scripts/lyrics-analysis-eval/analyze.ts --lyrics <file.lrc> [--title …] [--artist …] [--out …] [--base-url … --model … --api-key …]');
    process.exit(1);
  }

  return {
    lyricsPath,
    title: get('--title') ?? path.basename(lyricsPath, path.extname(lyricsPath)),
    artists: (get('--artist') ?? '').split(',').map((a) => a.trim()).filter(Boolean),
    out: get('--out'),
    baseURL: get('--base-url') ?? process.env.LYRICS_ANALYSIS_BASE_URL,
    modelId: get('--model') ?? process.env.LYRICS_ANALYSIS_MODEL,
    apiKey: get('--api-key') ?? process.env.LYRICS_ANALYSIS_API_KEY
  };
};

/** Minimal LRC reader: keeps the line text, drops the timestamp. */
const parseLrcLines = async (filePath: string) => {
  const raw = await fs.readFile(filePath, 'utf-8');
  return raw
    .split('\n')
    .map((line) => line.replace(/^\s*\[(\d+):(\d+)([.:]\d+)?\]\s*/, '').trim())
    .filter((line) => line.length > 0 && !/^\[[a-z]+:/.test(line));
};

const readStoredCredentials = async (): Promise<
  { baseURL: string; modelId: string; apiKey?: string } | undefined
> => {
  // The app's profile file stores safeStorage-encrypted keys, which this process cannot decrypt;
  // only the plaintext fallback is readable here.
  const configPath = path.join(
    process.env.HOME ?? '',
    'Library/Application Support/nora/lyrics-analysis-providers.json'
  );
  try {
    const state = JSON.parse(await fs.readFile(configPath, 'utf-8')) as {
      activeProfileId?: string;
      profiles: Array<{ id: string; baseURL: string; modelId: string; apiKeyPlain?: string }>;
    };
    const active =
      state.profiles.find((p) => p.id === state.activeProfileId) ?? state.profiles[0];
    if (!active) return undefined;
    return {
      baseURL: active.baseURL,
      modelId: active.modelId,
      apiKey: active.apiKeyPlain
    };
  } catch {
    return undefined;
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  const stored = await readStoredCredentials();
  const baseURL = args.baseURL ?? stored?.baseURL;
  const modelId = args.modelId ?? stored?.modelId;
  const apiKey = args.apiKey ?? stored?.apiKey;

  if (!baseURL || !apiKey) {
    console.error(
      'No API credentials. Pass --base-url/--api-key or set LYRICS_ANALYSIS_BASE_URL / LYRICS_ANALYSIS_API_KEY.\n' +
        '(The app stores its key encrypted with safeStorage; pass the key explicitly for CLI runs.)'
    );
    process.exit(1);
  }

  const lines = await parseLrcLines(args.lyricsPath);
  console.error(`[analyze] ${lines.length} lyric lines, model=${modelId}`);

  const passes: NonNullable<import('./types').EvalAnalysisResult['passes']> = [];
  const startedAt = Date.now();

  const outcome = await analyzeLyrics({
    config: { baseURL, modelId: modelId ?? '', apiKey },
    uiLanguage: 'zh-CN',
    songTitle: args.title,
    songArtists: args.artists,
    lines: lines.map((text, index) => ({ lineId: `line-${index}`, text })),
    onLine: (line, source) => {
      console.error(
        `[analyze] ${source} line ${line.lineId}: ${line.tokens.length} tokens (${line.status})`
      );
    },
    onPassCompleted: (pass) => {
      passes.push({
        passKind: pass.passKind,
        targetLines: pass.targetLines,
        okLines: pass.okLines,
        failedLines: pass.failedLines,
        durationMs: pass.durationMs,
        outputTokens: pass.outputTokens
      });
      console.error(
        `[analyze] pass ${pass.passKind}#${pass.batchIndex}: ${pass.okLines}/${pass.targetLines} ok, ${pass.durationMs}ms`
      );
    }
  });

  const result = {
    songTitle: args.title,
    songArtists: args.artists,
    uiLanguage: 'zh-CN',
    modelId: modelId ?? '',
    generatedAt: startedAt,
    lines: outcome.lines,
    passes
  };

  const json = JSON.stringify(result, null, 2);
  if (args.out) {
    await fs.mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
    await fs.writeFile(args.out, json, 'utf-8');
    console.error(`[analyze] wrote ${args.out}`);
  } else {
    console.log(json);
  }

  const failed = outcome.failedLineIds.length;
  console.error(`[analyze] done: ${outcome.lines.length} ok, ${failed} failed`);
  if (failed > 0) process.exitCode = 2;
};

void main();
