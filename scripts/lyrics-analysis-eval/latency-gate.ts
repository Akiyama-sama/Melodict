/**
 * First-line latency gate: runs the production pipeline on a fixed 4-line probe (cached model
 * config) and reports the first-line latency from a fresh (non-cached) run. Used per iteration to
 * verify a prompt change does not slow down time-to-first-line materially.
 *
 * Usage: pnpm tsx scripts/lyrics-analysis-eval/latency-gate.ts [--base-url ... --model ... --api-key ...]
 */
import fs from 'node:fs';
import process from 'node:process';

import { analyzeLyrics } from '../../src/main/lyricsAnalysis/providerGateway';

const readCreds = () => {
  const get = (key: string) => {
    const env = fs.readFileSync('/tmp/eval-creds.env', 'utf-8');
    return new RegExp(`^(?:export\\s+)?${key}=(.*)$`, 'm').exec(env)?.[1]?.trim() ?? '';
  };
  return {
    baseURL: get('LYRICS_ANALYSIS_BASE_URL') || 'http://127.0.0.1:3425/v1',
    apiKey: get('LYRICS_ANALYSIS_API_KEY') || 'local'
  };
};

const PROBE_LINES = [
  'しっかりした花弁の空気',
  "Please don't say \"You are lazy\"",
  '白鳥たちはそう',
  '見えないとこでバタ足するんです'
].map((text, index) => ({ lineId: `line-${index}`, text }));

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const main = async () => {
  const creds = readCreds();
  const baseURL = getArg('--base-url') ?? creds.baseURL;
  const apiKey = getArg('--api-key') ?? creds.apiKey;
  const modelId = getArg('--model') ?? 'workbuddy/glm-5.3-flash';

  const startedAt = Date.now();
  let firstLineAt: number | undefined;

  const outcome = await analyzeLyrics({
    config: { baseURL, modelId, apiKey },
    uiLanguage: 'zh-CN',
    songTitle: 'latency-probe',
    songArtists: [],
    lines: PROBE_LINES,
    onLine: () => {
      firstLineAt ??= Date.now();
    }
  });

  const firstLineLatency = firstLineAt ? firstLineAt - startedAt : -1;
  const totalMs = Date.now() - startedAt;
  const okLines = outcome.lines.length;

  console.log(
    JSON.stringify({
      firstLineLatencyMs: firstLineLatency,
      totalMs,
      okLines,
      targetLines: PROBE_LINES.length
    })
  );
};

void main().catch((error) => {
  console.error(String(error).slice(0, 300));
  process.exit(1);
});
