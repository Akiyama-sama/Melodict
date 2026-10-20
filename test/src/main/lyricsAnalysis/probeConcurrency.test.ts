import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { LyricsAnalysisProviderConfig } from '@common/lyricsAnalysis';

/**
 * Concurrency-probe unit tests with the network layer mocked at the `ai` module boundary: every
 * `generateText` call either resolves or rejects per a per-level scenario script. Pins the climb
 * semantics — the 1→2→4→8→16 schedule, every request of a level fired before the next level
 * starts, the first failing level ending the climb at prevLevel × 0.75 (floor 1), an all-clean
 * climb reporting the highest level, and 429 vs 5xx being counted separately.
 */

type ProbeCallBehavior = 'ok' | 'rate-limited' | 'server-error';

// The climb schedule the probe walks, pinned here on purpose: it is part of the probe's spec.
const LEVELS = [1, 2, 4, 8, 16];

let levelBehaviors: ProbeCallBehavior[] = [];
let generateTextCalls = 0;

// Calls fire level by level, so a call's index maps to a level by walking the cumulative sizes.
const levelForCall = (callIndex: number): number => {
  let remaining = callIndex;
  for (let level = 0; level < LEVELS.length; level += 1) {
    if (remaining < LEVELS[level]) return level;
    remaining -= LEVELS[level];
  }
  return LEVELS.length - 1;
};

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();

  return {
    ...actual,
    generateText: async () => {
      const callIndex = generateTextCalls;
      generateTextCalls += 1;
      const behavior = levelBehaviors[levelForCall(callIndex)] ?? 'ok';
      if (behavior === 'ok') return { text: 'a' };
      throw new actual.APICallError(
        behavior === 'rate-limited'
          ? {
              message: 'rate limited',
              url: 'http://127.0.0.1:9/v1/chat/completions',
              requestBodyValues: {},
              statusCode: 429,
              isRetryable: false
            }
          : {
              message: 'boom',
              url: 'http://127.0.0.1:9/v1/chat/completions',
              requestBodyValues: {},
              statusCode: 503,
              isRetryable: false
            }
      );
    }
  };
});

const gateway = await import('@main/lyricsAnalysis/providerGateway');

const config: LyricsAnalysisProviderConfig = {
  baseURL: 'http://127.0.0.1:9/v1',
  modelId: 'probe-model',
  apiKey: 'probe-key'
};

beforeEach(() => {
  generateTextCalls = 0;
  levelBehaviors = [];
});

describe('probeProviderConcurrency', () => {
  test('a fully clean climb reports the highest level (16)', async () => {
    levelBehaviors = ['ok', 'ok', 'ok', 'ok', 'ok'];

    const result = await gateway.probeProviderConcurrency(config);

    expect(result.probedMaxConcurrency).toBe(16);
    expect(result.perLevel.map((level) => level.level)).toEqual(LEVELS);
    expect(result.perLevel.every((level) => level.failed === 0 && level.rateLimited === 0)).toBe(true);
    // 1 + 2 + 4 + 8 + 16 tiny requests across the whole climb.
    expect(generateTextCalls).toBe(31);
    // Successful levels report their mean latency.
    expect(result.perLevel.every((level) => typeof level.meanLatencyMs === 'number')).toBe(true);
  });

  test('the first failing level ends the climb at prevLevel × 0.75', async () => {
    // Levels 1, 2, 4 clean; level 8 rate-limited → probed = 4 × 0.75 = 3, level 16 never fires.
    levelBehaviors = ['ok', 'ok', 'ok', 'rate-limited'];

    const result = await gateway.probeProviderConcurrency(config);

    expect(result.probedMaxConcurrency).toBe(3);
    expect(result.perLevel).toHaveLength(4);
    const failing = result.perLevel.find((level) => level.level === 8);
    expect(failing?.ok).toBe(0);
    expect(failing?.rateLimited).toBe(8);
    expect(failing?.failed).toBe(8);
    // 1 + 2 + 4 + 8 requests fired; the climb stopped before level 16.
    expect(generateTextCalls).toBe(15);
  });

  test('a failure at level 2 floors the probe at 1 (never zero)', async () => {
    levelBehaviors = ['ok', 'server-error'];

    const result = await gateway.probeProviderConcurrency(config);

    // prevLevel 1 × 0.75 = 0.75 → floored to 1.
    expect(result.probedMaxConcurrency).toBe(1);
    expect(result.perLevel).toHaveLength(2);
    expect(result.perLevel[1]?.failed).toBe(2);
    expect(generateTextCalls).toBe(3);
  });

  test('a server-error level counts failures, not rate limits', async () => {
    levelBehaviors = ['server-error'];

    const result = await gateway.probeProviderConcurrency(config);

    expect(result.probedMaxConcurrency).toBe(1);
    expect(result.perLevel).toHaveLength(1);
    expect(result.perLevel[0]?.level).toBe(1);
    expect(result.perLevel[0]?.failed).toBe(1);
    expect(result.perLevel[0]?.rateLimited).toBe(0);
    expect(result.perLevel[0]?.meanLatencyMs).toBeUndefined();
  });

  test('a rate-limited level 1 also probes 1', async () => {
    levelBehaviors = ['rate-limited'];

    const result = await gateway.probeProviderConcurrency(config);

    expect(result.probedMaxConcurrency).toBe(1);
    expect(result.perLevel[0]?.rateLimited).toBe(1);
  });

  test('exposes the climb schedule for callers and tests', () => {
    expect(gateway.PROBE_LEVELS).toEqual(LEVELS);
  });
});
