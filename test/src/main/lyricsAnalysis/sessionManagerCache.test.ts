import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type {
  LyricsAnalysisInputLine,
  LyricsAnalysisLine
} from '../../../../src/common/lyricsAnalysis';

/**
 * Integration tests for the caching layers in `prepareLyricsAnalysisSession`:
 *
 * - Song-level artifact (exact line list match) — pre-existing behaviour, kept as a guard rail
 * - Line-level cache (same text anywhere, any song) — the cross-song reuse this work adds
 * - Intra-song dedupe (repeated chorus lines cost one LLM element, fan out to siblings)
 *
 * The worker is mocked at the module boundary so the tests observe exactly which lines were sent to
 * the "LLM" and how results flow back into snapshots and the caches.
 */

const userDataDir = path.join(
  os.tmpdir(),
  `nora-session-cache-${process.pid}-${Math.random().toString(36).slice(2)}`
);

vi.mock('electron', async (importOriginal) => {
  const actual = await importOriginal<typeof import('electron')>();
  return {
    ...actual,
    app: { ...actual.app, getPath: vi.fn(() => userDataDir) },
    BrowserWindow: { getAllWindows: () => [] }
  };
});

const analyzeLyricsInWorker = vi.fn();

vi.mock('../../../../src/main/lyricsAnalysis/analysisWorkerClient', () => ({
  analyzeLyricsInWorker: (...args: unknown[]) => analyzeLyricsInWorker(...args),
  // Supersede fires these against whatever runs the mock's controlled worker holds.
  cancelLyricsAnalysisRequest: () => undefined,
  inFlightAnalysisRequestIds: () => new Set<string>()
}));

vi.mock('../../../../src/main/lyricsAnalysis/providerConfigRepository', () => ({
  getStoredProviderConfig: async () => ({
    baseURL: 'http://127.0.0.1:3425/v1',
    modelId: 'test-model',
    apiKey: 'test-key'
  })
}));

// Telemetry writes are irrelevant here and would touch the same temp dir.
vi.mock('../../../../src/main/lyricsAnalysis/telemetryEmitter', () => ({
  emitSessionStartTelemetry: () => undefined,
  emitFirstLineTelemetry: () => undefined,
  emitLineResultTelemetry: () => undefined,
  emitAnalysisPassTelemetry: () => undefined,
  emitSessionEndTelemetry: () => undefined
}));

const sessionManager = await import('../../../../src/main/lyricsAnalysis/sessionManager');
const lineCache = await import('../../../../src/main/lyricsAnalysis/lineCacheRepository');
const songCache = await import('../../../../src/main/lyricsAnalysis/cacheRepository');

const makeAnalysis = (line: LyricsAnalysisInputLine): LyricsAnalysisLine => ({
  lineId: line.lineId,
  text: line.text,
  translation: `译:${line.text}`,
  status: 'ready',
  tokens: [
    {
      tokenId: `${line.lineId}:0-1`,
      text: line.text.slice(0, 1),
      startChar: 0,
      endChar: 1,
      language: 'ja',
      card: {
        term: line.text.slice(0, 1),
        pronunciation: { kana: 'か', romaji: 'ka' },
        meaning: '意思',
        grammarFunction: '角色'
      }
    }
  ]
});

/** Fake worker: analyses every line it is given and reports which lines it saw. */
const installFakeWorker = () => {
  const sentBatches: LyricsAnalysisInputLine[][] = [];
  analyzeLyricsInWorker.mockImplementation(
    async (input: {
      lines: LyricsAnalysisInputLine[];
      onLine: (line: LyricsAnalysisLine, source: 'first' | 'repair') => void;
    }) => {
      sentBatches.push(input.lines);
      for (const line of input.lines) input.onLine(makeAnalysis(line), 'first');
      return {
        lines: input.lines.map(makeAnalysis),
        failedLineIds: [],
        passStats: { outputTokens: 1, inputTokens: 1 }
      };
    }
  );
  return sentBatches;
};

const request = (overrides: {
  songPath?: string;
  songTitle?: string;
  lines: LyricsAnalysisInputLine[];
  forceRefresh?: boolean;
}) => ({
  songPath: overrides.songPath ?? '/music/a.flac',
  songTitle: overrides.songTitle ?? 'Song A',
  songArtists: ['Artist'],
  uiLanguage: 'zh-CN',
  lines: overrides.lines,
  forceRefresh: overrides.forceRefresh
});

const lines = (...texts: string[]): LyricsAnalysisInputLine[] =>
  texts.map((text, index) => ({ lineId: `line-${index}`, text }));

describe('prepareLyricsAnalysisSession caching', () => {
  beforeEach(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true });
    await fs.mkdir(userDataDir, { recursive: true });
    analyzeLyricsInWorker.mockReset();
  });

  afterEach(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true });
  });

  test('reuses a line analyzed in a different song without calling the LLM for it', async () => {
    const sentBatches = installFakeWorker();

    // Song A: two lines, both analyzed and written to the line cache.
    await sessionManager.prepareLyricsAnalysisSession(
      request({ songPath: '/music/a.flac', lines: lines('夢ならば', 'どれほど') })
    );
    expect(sentBatches.flat().map((line) => line.text)).toEqual(['夢ならば', 'どれほど']);

    sentBatches.length = 0;

    // Song B shares one line with A and adds a new one. Only the new line goes to the LLM.
    const snapshot = await sessionManager.prepareLyricsAnalysisSession(
      request({
        songPath: '/music/b.flac',
        songTitle: 'Song B',
        lines: lines('夢ならば', '新しい歌詞')
      })
    );

    expect(sentBatches.flat().map((line) => line.text)).toEqual(['新しい歌詞']);
    expect(snapshot.status).toBe('ready');
    // The reused line is fully hydrated (tokens present), not a placeholder.
    const reused = snapshot.lines?.find((line) => line.lineId === 'line-0');
    expect(reused?.tokens).toHaveLength(1);
    expect(reused?.translation).toBe('译:夢ならば');
  });

  test('returns a cached snapshot with zero LLM calls when every line hits the line cache', async () => {
    installFakeWorker();
    await sessionManager.prepareLyricsAnalysisSession(
      request({ songPath: '/music/a.flac', lines: lines('夢ならば', 'どれほど') })
    );

    analyzeLyricsInWorker.mockClear();
    const snapshot = await sessionManager.prepareLyricsAnalysisSession(
      request({
        songPath: '/music/b.flac',
        songTitle: 'Song B',
        lines: lines('夢ならば', 'どれほど')
      })
    );

    expect(analyzeLyricsInWorker).not.toHaveBeenCalled();
    expect(snapshot.status).toBe('cached');
    expect(snapshot.lines?.every((line) => line.tokens.length > 0)).toBe(true);
  });

  test('sends a repeated chorus line once and fans the result out to every occurrence', async () => {
    const sentBatches = installFakeWorker();

    const snapshot = await sessionManager.prepareLyricsAnalysisSession(
      request({ lines: lines('夢ならば', 'サビの歌詞', '夢ならば', 'サビの歌詞') })
    );

    // One element per distinct text, not per line.
    expect(sentBatches.flat().map((line) => line.text)).toEqual(['夢ならば', 'サビの歌詞']);
    // All four lines are analyzed in the final snapshot.
    expect(snapshot.lines).toHaveLength(4);
    expect(snapshot.lines?.every((line) => line.tokens.length > 0)).toBe(true);
    // Each occurrence keeps its own lineId and token ids.
    expect(snapshot.lines?.map((line) => line.lineId)).toEqual([
      'line-0',
      'line-1',
      'line-2',
      'line-3'
    ]);
    expect(snapshot.lines?.[2]?.tokens[0]?.tokenId).toBe('line-2:0-1');
  });

  test('does not use any cache when forceRefresh is set', async () => {
    const sentBatches = installFakeWorker();
    await sessionManager.prepareLyricsAnalysisSession(
      request({ songPath: '/music/a.flac', lines: lines('夢ならば', 'どれほど') })
    );

    sentBatches.length = 0;
    await sessionManager.prepareLyricsAnalysisSession(
      request({
        songPath: '/music/a.flac',
        lines: lines('夢ならば', 'どれほど'),
        forceRefresh: true
      })
    );

    // Both lines re-sent despite identical text and song.
    expect(sentBatches.flat().map((line) => line.text)).toEqual(['夢ならば', 'どれほど']);
  });

  test('line-cache hits are merged into the song artifact under the shared fingerprint', async () => {
    installFakeWorker();
    // Song A analyzes three lines; song B shares two of them but adds a third, so the fingerprints
    // differ and song B needs a real run — but its shared lines should come from the line cache.
    await sessionManager.prepareLyricsAnalysisSession(
      request({ songPath: '/music/a.flac', lines: lines('夢ならば', 'どれほど', 'だけ') })
    );

    const fingerprintB = songCache.buildLyricsAnalysisFingerprint({
      lines: lines('夢ならば', 'どれほど', '新しい'),
      uiLanguage: 'zh-CN',
      modelId: 'test-model'
    });
    expect(await songCache.readLyricsAnalysisPartialCache(fingerprintB)).toBeUndefined();

    const sentBatches = installFakeWorker();
    await sessionManager.prepareLyricsAnalysisSession(
      request({
        songPath: '/music/b.flac',
        songTitle: 'Song B',
        lines: lines('夢ならば', 'どれほど', '新しい')
      })
    );

    // Only the genuinely new line reached the LLM.
    expect(sentBatches.flat().map((line) => line.text)).toEqual(['新しい']);

    // The artifact for song B's fingerprint now holds all three lines (two hydrated + one new).
    const artifact = await songCache.readLyricsAnalysisPartialCache(fingerprintB);
    expect(artifact?.lines).toHaveLength(3);
  });

  test('line cache entries survive a changed lineId and keep valid token spans', async () => {
    installFakeWorker();
    await sessionManager.prepareLyricsAnalysisSession(
      request({ lines: lines('夢ならば', 'どれほど') })
    );

    // Same text, different position in the list: the second song's line-0 was song A's line-1.
    const snapshot = await sessionManager.prepareLyricsAnalysisSession(
      request({
        songPath: '/music/c.flac',
        songTitle: 'Song C',
        lines: lines('どれほど', '夢ならば')
      })
    );

    const first = snapshot.lines?.find((line) => line.lineId === 'line-0');
    expect(first?.text).toBe('どれほど');
    expect(first?.tokens[0]?.tokenId).toBe('line-0:0-1');
    expect(first?.tokens[0]?.text).toBe('ど');
  });
});

describe('lineCacheRepository integration with sessionManager', () => {
  beforeEach(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true });
    await fs.mkdir(userDataDir, { recursive: true });
    analyzeLyricsInWorker.mockReset();
  });

  afterEach(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true });
  });

  test('an analyzed line lands in the line cache under its own key', async () => {
    installFakeWorker();
    const inputLines = lines('夢ならば');
    await sessionManager.prepareLyricsAnalysisSession(request({ lines: inputLines }));

    // Give the fire-and-forget cache write a tick to land.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const key = lineCache.buildLineAnalysisCacheKey({
      text: '夢ならば',
      uiLanguage: 'zh-CN',
      modelId: 'test-model',
      language: 'ja'
    });
    const entry = await lineCache.readLineAnalysisCache(key);
    expect(entry?.text).toBe('夢ならば');
    expect(entry?.tokens).toHaveLength(1);
  });
});
