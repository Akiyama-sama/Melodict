import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Unique temp dir per module instance, mirroring providerConfigRepository.test.ts.
const userDataDir = path.join(
  os.tmpdir(),
  `knote-concurrency-memory-${process.pid}-${Math.random().toString(36).slice(2)}`
);

// `test/setup.ts` already mocks `electron` globally, so override only what this module reads.
vi.mock('electron', async (importOriginal) => {
  const actual = await importOriginal<typeof import('electron')>();
  return {
    ...actual,
    app: { ...actual.app, getPath: vi.fn(() => userDataDir) }
  };
});

const memory = await import('../../../../src/main/lyricsAnalysis/concurrencyMemory');

const memoryFile = () => path.join(userDataDir, 'lyrics-analysis-concurrency.json');

describe('concurrencyMemoryKey', () => {
  test('normalizes trailing slashes and scheme so endpoint aliases share an entry', () => {
    const canonical = memory.concurrencyMemoryKey('https://api.example.com/v1', 'model-a');
    expect(memory.concurrencyMemoryKey('https://api.example.com/v1/', 'model-a')).toBe(canonical);
    expect(memory.concurrencyMemoryKey('api.example.com/v1', 'model-a')).toBe(canonical);
    // Different model → different entry, even on the same endpoint.
    expect(memory.concurrencyMemoryKey('https://api.example.com/v1', 'model-b')).not.toBe(canonical);
  });

  test('falls back to plain trimming when the URL does not parse', () => {
    expect(memory.concurrencyMemoryKey('::bad url::', 'm')).toBe('::bad url::|m');
  });
});

describe('concurrencyMemory', () => {
  beforeEach(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true });
    await fs.mkdir(userDataDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true });
  });

  test('seeds the default when nothing is stored', async () => {
    await expect(memory.readConcurrencySeed('https://api.example.com/v1', 'model-a')).resolves.toBe(
      memory.DEFAULT_CONCURRENCY_SEED
    );
  });

  test('a written ceiling becomes the next seed and is keyed per endpoint+model', async () => {
    await memory.writeConcurrencyCeiling('https://api.example.com/v1', 'model-a', 12);

    await expect(memory.readConcurrencySeed('https://api.example.com/v1', 'model-a')).resolves.toBe(12);
    // Sibling model and sibling endpoint stay untouched.
    await expect(memory.readConcurrencySeed('https://api.example.com/v1', 'model-b')).resolves.toBe(
      memory.DEFAULT_CONCURRENCY_SEED
    );
    await expect(memory.readConcurrencySeed('https://other.example/v1', 'model-a')).resolves.toBe(
      memory.DEFAULT_CONCURRENCY_SEED
    );
  });

  test('re-learning overwrites; values are clamped to 1..16', async () => {
    await memory.writeConcurrencyCeiling('https://api.example.com/v1', 'model-a', 8);
    await memory.writeConcurrencyCeiling('https://api.example.com/v1', 'model-a', 10);
    await expect(memory.readConcurrencySeed('https://api.example.com/v1', 'model-a')).resolves.toBe(10);

    // Out-of-range ceilings clamp on write, mirroring the window's hard ceiling.
    await memory.writeConcurrencyCeiling('https://api.example.com/v1', 'model-a', 999);
    await expect(memory.readConcurrencySeed('https://api.example.com/v1', 'model-a')).resolves.toBe(16);
  });

  test('invalid ceilings are ignored, not stored', async () => {
    await memory.writeConcurrencyCeiling('https://api.example.com/v1', 'model-a', Number.NaN);
    await memory.writeConcurrencyCeiling('https://api.example.com/v1', 'model-a', 0);
    await expect(memory.readConcurrencySeed('https://api.example.com/v1', 'model-a')).resolves.toBe(
      memory.DEFAULT_CONCURRENCY_SEED
    );
  });

  test('forgets one endpoint or everything', async () => {
    await memory.writeConcurrencyCeiling('https://api.example.com/v1', 'model-a', 8);
    await memory.writeConcurrencyCeiling('https://other.example/v1', 'model-b', 6);

    await memory.forgetConcurrency('https://api.example.com/v1', 'model-a');
    await expect(memory.readConcurrencySeed('https://api.example.com/v1', 'model-a')).resolves.toBe(
      memory.DEFAULT_CONCURRENCY_SEED
    );
    await expect(memory.readConcurrencySeed('https://other.example/v1', 'model-b')).resolves.toBe(6);

    await memory.forgetConcurrency();
    await expect(memory.readConcurrencySeed('https://other.example/v1', 'model-b')).resolves.toBe(
      memory.DEFAULT_CONCURRENCY_SEED
    );
  });

  test('tolerates a corrupt or wrong-version memory file', async () => {
    await fs.writeFile(memoryFile(), '{not json');
    await expect(memory.readConcurrencySeed('https://api.example.com/v1', 'model-a')).resolves.toBe(
      memory.DEFAULT_CONCURRENCY_SEED
    );

    await fs.writeFile(memoryFile(), JSON.stringify({ version: 99, ceilings: { x: 8 } }));
    await expect(memory.readConcurrencySeed('https://api.example.com/v1', 'model-a')).resolves.toBe(
      memory.DEFAULT_CONCURRENCY_SEED
    );

    // A write over the corrupt file heals it.
    await memory.writeConcurrencyCeiling('https://api.example.com/v1', 'model-a', 5);
    await expect(memory.readConcurrencySeed('https://api.example.com/v1', 'model-a')).resolves.toBe(5);
  });
});
