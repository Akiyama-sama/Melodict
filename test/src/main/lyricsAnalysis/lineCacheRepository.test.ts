import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { LyricsAnalysisLine } from '../../../../src/common/lyricsAnalysis';

const userDataDir = path.join(
  os.tmpdir(),
  `nora-line-cache-${process.pid}-${Math.random().toString(36).slice(2)}`
);

vi.mock('electron', async (importOriginal) => {
  const actual = await importOriginal<typeof import('electron')>();
  return {
    ...actual,
    app: { ...actual.app, getPath: vi.fn(() => userDataDir) }
  };
});

const repository = await import('../../../../src/main/lyricsAnalysis/lineCacheRepository');

const makeLine = (lineId: string, text: string): LyricsAnalysisLine => ({
  lineId,
  text,
  translation: '译文',
  status: 'ready',
  tokens: [
    {
      tokenId: `${lineId}:0-2`,
      text: text.slice(0, 2),
      startChar: 0,
      endChar: 2,
      language: 'ja',
      card: {
        term: text.slice(0, 2),
        pronunciation: { kana: 'かな', romaji: 'ka na' },
        meaning: '意思',
        grammarFunction: '角色'
      }
    },
    {
      tokenId: `${lineId}:2-4`,
      text: text.slice(2, 4),
      startChar: 2,
      endChar: 4,
      language: 'ja',
      card: {
        term: text.slice(2, 4),
        pronunciation: { kana: 'かな', romaji: 'ka na' },
        meaning: '意思',
        grammarFunction: '角色'
      }
    }
  ]
});

describe('lineCacheRepository', () => {
  beforeEach(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true });
    await fs.mkdir(userDataDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true });
  });

  describe('buildLineAnalysisCacheKey', () => {
    const base = {
      text: '夢ならばどれほどよかったでしょう',
      uiLanguage: 'zh-CN',
      modelId: 'glm-5.3-flash',
      language: 'ja' as const
    };

    test('is stable for the same line regardless of lineId', () => {
      const first = repository.buildLineAnalysisCacheKey(base);
      const second = repository.buildLineAnalysisCacheKey({ ...base });
      expect(first).toBe(second);
    });

    test('changes when the line text changes', () => {
      expect(repository.buildLineAnalysisCacheKey({ ...base, text: '違う歌詞' })).not.toBe(
        repository.buildLineAnalysisCacheKey(base)
      );
    });

    test('changes when the human romanization reference changes', () => {
      const withoutReference = repository.buildLineAnalysisCacheKey(base);
      const withReference = repository.buildLineAnalysisCacheKey({
        ...base,
        romanizedText: 'yume naraba dore hodo yokatta deshou'
      });
      expect(withReference).not.toBe(withoutReference);
    });

    test('changes with output language, model, and resolved line language', () => {
      const reference = repository.buildLineAnalysisCacheKey(base);
      expect(repository.buildLineAnalysisCacheKey({ ...base, uiLanguage: 'en' })).not.toBe(
        reference
      );
      expect(repository.buildLineAnalysisCacheKey({ ...base, modelId: 'other-model' })).not.toBe(
        reference
      );
      // Han-only lines resolve to zh in a Chinese song but ja in a Japanese one — same text,
      // different analysis expectations, so the key must differ.
      expect(repository.buildLineAnalysisCacheKey({ ...base, language: 'zh' })).not.toBe(reference);
    });
  });

  describe('write / read / hydrate', () => {
    test('round-trips an analyzed line', async () => {
      const key = repository.buildLineAnalysisCacheKey({
        text: '夢ならば',
        uiLanguage: 'zh-CN',
        modelId: 'glm',
        language: 'ja'
      });
      await repository.writeLineAnalysisCache({ key, line: makeLine('line-3', '夢ならば') });

      const entry = await repository.readLineAnalysisCache(key);
      expect(entry).toBeDefined();
      expect(entry?.text).toBe('夢ならば');
      expect(entry?.translation).toBe('译文');
      expect(entry?.tokens).toHaveLength(2);
    });

    test('hydrates onto a different lineId with rebuilt token ids', async () => {
      const key = 'k1';
      await repository.writeLineAnalysisCache({ key, line: makeLine('line-3', '夢ならば') });
      const entry = await repository.readLineAnalysisCache(key);
      if (!entry) throw new Error('expected entry');

      const hydrated = repository.hydrateLineAnalysisFromCache({
        entry,
        lineId: 'line-42',
        text: '夢ならば'
      });

      expect(hydrated.lineId).toBe('line-42');
      expect(hydrated.text).toBe('夢ならば');
      expect(hydrated.tokens.map((token) => token.tokenId)).toEqual(['line-42:0-2', 'line-42:2-4']);
    });

    test('returns undefined for a missing key', async () => {
      expect(await repository.readLineAnalysisCache('does-not-exist')).toBeUndefined();
    });

    test('rejects an entry with no tokens', async () => {
      const key = 'empty';
      await fs.mkdir(path.join(userDataDir, 'lyrics-analysis-line-cache'), { recursive: true });
      await fs.writeFile(
        path.join(userDataDir, 'lyrics-analysis-line-cache', `${key}.json`),
        JSON.stringify({ v: 1, text: 'x', tokens: [], status: 'ready', cachedAt: Date.now() })
      );
      expect(await repository.readLineAnalysisCache(key)).toBeUndefined();
    });

    test('rejects an entry written by a different cache format version', async () => {
      const key = 'old';
      await fs.mkdir(path.join(userDataDir, 'lyrics-analysis-line-cache'), { recursive: true });
      await fs.writeFile(
        path.join(userDataDir, 'lyrics-analysis-line-cache', `${key}.json`),
        JSON.stringify({
          v: 0,
          text: 'x',
          tokens: makeLine('line-0', '夢ならば').tokens,
          status: 'ready',
          cachedAt: Date.now()
        })
      );
      expect(await repository.readLineAnalysisCache(key)).toBeUndefined();
    });
  });

  describe('pruneLineAnalysisCache', () => {
    test('removes entries older than the age cutoff', async () => {
      const dir = path.join(userDataDir, 'lyrics-analysis-line-cache');
      await fs.mkdir(dir, { recursive: true });
      const fresh = path.join(dir, 'fresh.json');
      const stale = path.join(dir, 'stale.json');
      await fs.writeFile(fresh, JSON.stringify({ v: 1, text: 'a', tokens: [{}] }));
      await fs.writeFile(stale, JSON.stringify({ v: 1, text: 'b', tokens: [{}] }));

      const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      await fs.utimes(stale, old, old);

      const pruned = await repository.pruneLineAnalysisCache({ maxAgeDays: 60 });
      expect(pruned).toBe(1);
      await expect(fs.access(fresh)).resolves.toBeUndefined();
      await expect(fs.access(stale)).rejects.toThrow();
    });

    test('caps the entry count by dropping the oldest entries', async () => {
      const dir = path.join(userDataDir, 'lyrics-analysis-line-cache');
      await fs.mkdir(dir, { recursive: true });
      for (let index = 0; index < 5; index += 1) {
        const filePath = path.join(dir, `entry-${index}.json`);
        await fs.writeFile(filePath, JSON.stringify({ v: 1, text: `${index}`, tokens: [{}] }));
        const time = new Date(Date.now() - (10 - index) * 1000);
        await fs.utimes(filePath, time, time);
      }

      const pruned = await repository.pruneLineAnalysisCache({ maxAgeDays: 60, maxEntries: 2 });
      expect(pruned).toBe(3);
      const remaining = (await fs.readdir(dir)).sort();
      expect(remaining).toEqual(['entry-3.json', 'entry-4.json']);
    });

    test('returns 0 when the cache directory does not exist', async () => {
      expect(await repository.pruneLineAnalysisCache()).toBe(0);
    });
  });
});
