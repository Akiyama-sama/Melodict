import { describe, expect, test, vi } from 'vitest';

import {
  ConcurrencyWindow,
  isThrottlingError,
  runWithConcurrency
} from '@main/lyricsAnalysis/concurrencyPool';

/**
 * Unit tests for the bounded-concurrency pool and the AIMD window that drives it:
 * submission-order aggregation, error isolation (one rejection never kills siblings),
 * the dynamic limit (re-read per launch), fail-fast via `shouldStop`, and the window's
 * grow/halve/floor/clamp/telemetry behavior.
 */

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('runWithConcurrency', () => {
  test('aggregates results in submission order regardless of completion order', async () => {
    // Later tasks settle first: task 2 resolves immediately, task 0 last.
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
    const order: number[] = [];

    const pooled = runWithConcurrency(
      gates.map((gate, index) => async () => {
        order.push(index);
        const value = await gate.promise;
        return `${index}:${value}`;
      }),
      () => 3
    );

    gates[2].resolve('c');
    gates[1].resolve('b');
    gates[0].resolve('a');
    const { results, errors } = await pooled;

    expect([...results]).toEqual(['0:a', '1:b', '2:c']);
    expect(errors.size).toBe(0);
    // All three started (limit 3) even though they settled out of order.
    expect(order.sort()).toEqual([0, 1, 2]);
  });

  test('a rejecting task does not kill its siblings', async () => {
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];

    const pooled = runWithConcurrency(
      gates.map((gate) => async () => gate.promise),
      () => 3
    );

    gates[1].reject(new Error('boom'));
    gates[0].resolve('ok0');
    gates[2].resolve('ok2');
    const { results, errors } = await pooled;

    expect(results[0]).toBe('ok0');
    expect(results[1]).toBeUndefined();
    expect(results[2]).toBe('ok2');
    expect(errors.get(1)).toBeInstanceOf(Error);
    expect((errors.get(1) as Error).message).toBe('boom');
  });

  test('re-reads the limit before every launch (dynamic window)', async () => {
    // Limit starts at 1; after task 0 settles the window grows to 3, so the remaining
    // tasks run concurrently in one wave.
    let limit = 1;
    let inflight = 0;
    let maxInflight = 0;

    const { results } = await runWithConcurrency(
      [0, 1, 2, 3].map(
        (n) => async () => {
          inflight += 1;
          maxInflight = Math.max(maxInflight, inflight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inflight -= 1;
          limit = n === 0 ? 3 : limit;
          return n;
        }
      ),
      () => limit
    );

    expect([...results]).toEqual([0, 1, 2, 3]);
    // Serial first wave (limit 1), then a concurrent wave of the rest.
    expect(maxInflight).toBeGreaterThanOrEqual(2);
  });

  test('shouldStop prevents unstarted tasks from launching', async () => {
    const started: number[] = [];
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];

    let stop = false;
    // Limit 1: strictly serial launches, so task 1 cannot start while task 0 is in flight —
    // exactly the situation where a fatal sibling failure must stop the queue.
    const pooled = runWithConcurrency(
      gates.map((gate, index) => () => {
        started.push(index);
        return gate.promise;
      }),
      () => 1,
      () => stop
    );

    gates[0].reject(new Error('fatal'));
    stop = true;
    const { results, errors } = await pooled;

    // Only task 0 ever started; tasks 1 and 2 were abandoned without their thunks running.
    expect(started).toEqual([0]);
    expect(results).toEqual([undefined, undefined, undefined]);
    expect(errors.size).toBe(1);
    expect((errors.get(0) as Error).message).toBe('fatal');
  });

  test('already in-flight tasks run to completion even after shouldStop flips', async () => {
    const gates = [deferred<string>(), deferred<string>()];
    let stop = false;

    const pooled = runWithConcurrency(
      gates.map((gate) => async () => {
        // Flip stop while task 0 is in flight; task 1 was launched in the same wave.
        stop = true;
        return gate.promise;
      }),
      () => 2,
      () => stop
    );

    gates[0].resolve('a');
    gates[1].resolve('b');
    const { results } = await pooled;
    expect([...results]).toEqual(['a', 'b']);
  });

  test('handles an empty task list', async () => {
    const { results, errors } = await runWithConcurrency([], () => 4);
    expect(results).toEqual([]);
    expect(errors.size).toBe(0);
  });
});

describe('ConcurrencyWindow', () => {
  test('starts at min(4, cap) and grows +1 per success up to the cap', () => {
    const window = new ConcurrencyWindow(8);
    expect(window.value).toBe(4);
    window.onSuccess();
    window.onSuccess();
    window.onSuccess();
    window.onSuccess();
    expect(window.value).toBe(8);
    // Clamped at cap.
    window.onSuccess();
    expect(window.value).toBe(8);
  });

  test('initial window never exceeds a small cap', () => {
    const window = new ConcurrencyWindow(2);
    expect(window.value).toBe(2);
    window.onSuccess();
    expect(window.value).toBe(2);
  });

  test('halves on failure with a floor of 1', () => {
    const window = new ConcurrencyWindow(16);
    expect(window.value).toBe(4);
    window.onFailure();
    expect(window.value).toBe(2);
    window.onFailure();
    expect(window.value).toBe(1);
    window.onFailure();
    expect(window.value).toBe(1);
    expect(window.rateLimitedCount).toBe(3);
  });

  test('stats report max, mean and rate-limited count', () => {
    const window = new ConcurrencyWindow(8);
    window.onSuccess(); // window 4 -> 5, samples 4
    window.onFailure(); // window 5 -> 2, samples 5
    const stats = window.stats;
    expect(stats.max).toBe(5);
    expect(stats.mean).toBe((4 + 5) / 2);
    expect(stats.rateLimitedCount).toBe(1);
  });

  test('default cap is 4 when the profile field is missing or invalid', () => {
    expect(new ConcurrencyWindow(Number.NaN).cap).toBe(4);
    expect(new ConcurrencyWindow(0).cap).toBe(4);
    expect(new ConcurrencyWindow(-3).cap).toBe(4);
    expect(new ConcurrencyWindow(4.9).cap).toBe(4);
  });
});

describe('isThrottlingError', () => {
  test('classifies 429 and 5xx as throttling', () => {
    expect(isThrottlingError({ statusCode: 429 })).toBe(true);
    expect(isThrottlingError({ statusCode: 503 })).toBe(true);
    expect(isThrottlingError({ statusCode: 500 })).toBe(true);
  });

  test('classifies timeouts and network failures as throttling', () => {
    expect(isThrottlingError(new Error('Request timed out'))).toBe(true);
    expect(isThrottlingError(new Error('fetch failed'))).toBe(true);
    expect(isThrottlingError(new Error('socket hang up'))).toBe(true);
    expect(isThrottlingError(new Error('ECONNRESET'))).toBe(true);
  });

  test('does NOT classify auth/endpoint/config errors as throttling', () => {
    expect(isThrottlingError({ statusCode: 401 })).toBe(false);
    expect(isThrottlingError({ statusCode: 403 })).toBe(false);
    expect(isThrottlingError({ statusCode: 404 })).toBe(false);
    expect(isThrottlingError({ statusCode: 400 })).toBe(false);
    expect(isThrottlingError(new Error('Invalid API key'))).toBe(false);
  });
});
