import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  ABSOLUTE_WINDOW_CEILING,
  ConcurrencyWindow,
  isThrottlingError,
  parseRetryAfterMs,
  runWithConcurrency
} from '@main/lyricsAnalysis/concurrencyPool';

/**
 * Unit tests for the bounded-concurrency pool and the AIMD window that drives it:
 * submission-order aggregation, error isolation (one rejection never kills siblings),
 * the dynamic limit (re-read per launch), fail-fast via `shouldStop`, and the window's
 * AIMD behavior (streaked increase, 0.75 decrease, cascade dampening, learned ceiling,
 * Retry-After cooldown).
 */

afterEach(() => {
  vi.useRealTimers();
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
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
  test('starts at the seeded value (default 4), clamped to the absolute ceiling', () => {
    expect(new ConcurrencyWindow().value).toBe(4);
    expect(new ConcurrencyWindow(8).value).toBe(8);
    expect(new ConcurrencyWindow(ABSOLUTE_WINDOW_CEILING + 10).value).toBe(ABSOLUTE_WINDOW_CEILING);
  });

  test('invalid seeds fall back to 4', () => {
    expect(new ConcurrencyWindow(Number.NaN).value).toBe(4);
    expect(new ConcurrencyWindow(0).value).toBe(4);
    expect(new ConcurrencyWindow(-3).value).toBe(4);
    expect(new ConcurrencyWindow(4.9).value).toBe(4);
  });

  test('grows +1 only after 3 consecutive successes', () => {
    const window = new ConcurrencyWindow(4);
    window.onSuccess();
    window.onSuccess();
    expect(window.value).toBe(4); // streak 2 — not yet
    window.onSuccess();
    expect(window.value).toBe(5); // streak 3 → +1, streak resets
    window.onSuccess();
    window.onSuccess();
    expect(window.value).toBe(5); // streak 2 again
    window.onSuccess();
    expect(window.value).toBe(6);
  });

  test('a failure resets the growth streak', () => {
    const window = new ConcurrencyWindow(4);
    window.onSuccess();
    window.onSuccess();
    window.onThrottled();
    expect(window.value).toBe(3); // first throttle of the cascade shrinks
    window.onSuccess();
    window.onSuccess();
    expect(window.value).toBe(3); // streak 2, below the 3 needed
    window.onSuccess();
    expect(window.value).toBe(4);
  });

  test('decreases by ×0.75 with a floor of 1', () => {
    const window = new ConcurrencyWindow(16);
    expect(window.value).toBe(16);
    window.onThrottled();
    expect(window.value).toBe(12); // floor(16 × 0.75)
    window.onSuccess(); // closes the cascade so the next throttle shrinks again
    window.onThrottled();
    expect(window.value).toBe(9); // floor(12 × 0.75)
    window.onSuccess();
    window.onThrottled();
    expect(window.value).toBe(6); // floor(9 × 0.75)
    window.onSuccess();
    window.onThrottled();
    expect(window.value).toBe(4); // floor(6 × 0.75)
    window.onSuccess();
    window.onThrottled();
    expect(window.value).toBe(3);
    window.onSuccess();
    window.onThrottled();
    expect(window.value).toBe(2);
    window.onSuccess();
    window.onThrottled();
    expect(window.value).toBe(1);
    // The floor: never 0.
    window.onThrottled();
    expect(window.value).toBe(1);
  });

  test('a 429 burst shrinks the window once (cascade dampening)', () => {
    const window = new ConcurrencyWindow(8);
    window.onThrottled();
    expect(window.value).toBe(6);
    // Four sibling batches hit the same burst of 429s: telemetry counts them, the window does
    // not compound-cut.
    window.onThrottled();
    window.onThrottled();
    window.onThrottled();
    window.onThrottled();
    expect(window.value).toBe(6);
    expect(window.rateLimitedCount).toBe(1);
    // The next success closes the cascade, so a LATER throttle shrinks again.
    window.onSuccess();
    window.onThrottled();
    expect(window.value).toBe(4);
    expect(window.rateLimitedCount).toBe(2);
  });

  test('sustained success climbs to the absolute ceiling', () => {
    const window = new ConcurrencyWindow(4);
    for (let i = 0; i < 40; i += 1) window.onSuccess();
    expect(window.value).toBe(ABSOLUTE_WINDOW_CEILING);
    expect(window.ceiling).toBe(ABSOLUTE_WINDOW_CEILING);
  });

  test('a success at the ceiling raises it; a throttle never does', () => {
    const window = new ConcurrencyWindow(8);
    window.onSuccess(); // proves 8 (streak 1)
    expect(window.ceiling).toBe(8);
    window.onSuccess(); // streak 2
    window.onSuccess(); // streak 3 → window 9, one past the proven value
    expect(window.value).toBe(9);
    expect(window.ceiling).toBe(8); // 9 is unproven overshoot so far
    window.onSuccess(); // a batch settled at 9 → proves it
    expect(window.ceiling).toBe(9);
    window.onThrottled();
    expect(window.ceiling).toBe(9); // throttles never raise the ceiling
    expect(window.value).toBe(6);
  });

  test('throttles never lower the ceiling either (transient failures are not proof)', () => {
    const window = new ConcurrencyWindow(8);
    window.onSuccess(); // proves 8
    window.onThrottled(); // transient dip to 6
    window.onSuccess();
    window.onSuccess();
    window.onSuccess();
    expect(window.value).toBe(7);
    expect(window.ceiling).toBe(8); // still the proven value
  });

  test('stats report max, mean and rate-limited count', () => {
    const window = new ConcurrencyWindow(8);
    window.onSuccess(); // window 8 → streak, samples 8
    window.onThrottled(); // window 8 → 6, samples 8
    const stats = window.stats;
    expect(stats.max).toBe(8);
    expect(stats.mean).toBe(8);
    expect(stats.rateLimitedCount).toBe(1);
  });

  test('cooldown holds launches for the default duration and clears with time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    const window = new ConcurrencyWindow(4);
    expect(window.isCoolingDown()).toBe(false);

    window.onThrottled(); // no Retry-After header → default 2000ms
    expect(window.isCoolingDown()).toBe(true);
    vi.setSystemTime(1_000_000 + 1999);
    expect(window.isCoolingDown()).toBe(true);
    vi.setSystemTime(1_000_000 + 2000);
    expect(window.isCoolingDown()).toBe(false);
  });

  test('a server Retry-After extends the cooldown, capped at 60s', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);

    const window = new ConcurrencyWindow(4);
    window.onThrottled(10_000);
    vi.setSystemTime(2_000_000 + 9_000);
    expect(window.isCoolingDown()).toBe(true);
    vi.setSystemTime(2_000_000 + 10_000);
    expect(window.isCoolingDown()).toBe(false);

    // Hostile/broken header cannot stall a run for more than a minute (capped from now, which
    // is 2_010_000 after the advance above → expires at 2_070_000; the boundary itself is off).
    window.onThrottled(999_999);
    vi.setSystemTime(2_070_000 - 1);
    expect(window.isCoolingDown()).toBe(true);
    vi.setSystemTime(2_070_000);
    expect(window.isCoolingDown()).toBe(false);

    // Garbage values fall back to the default cooldown.
    window.onThrottled(Number.NaN);
    vi.setSystemTime(2_070_000 + 1999);
    expect(window.isCoolingDown()).toBe(true);
    vi.setSystemTime(2_070_000 + 2000);
    expect(window.isCoolingDown()).toBe(false);
  });

  test('waitThroughCooldown resolves once the window stops cooling', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(3_000_000);

    const window = new ConcurrencyWindow(4);
    window.onThrottled(1000);
    expect(window.isCoolingDown()).toBe(true);

    let waited = false;
    const waitPromise = window.waitThroughCooldown().then(() => {
      waited = true;
    });

    // While still cooling the wait hangs; after time passes it resolves.
    await vi.advanceTimersByTimeAsync(999);
    expect(waited).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waitPromise;
    expect(waited).toBe(true);
  });
});

describe('parseRetryAfterMs', () => {
  test('parses second-valued headers', () => {
    expect(parseRetryAfterMs('30')).toBe(30_000);
    expect(parseRetryAfterMs(' 2 ')).toBe(2_000);
  });

  test('parses HTTP-date headers relative to now', () => {
    const now = 1_700_000_000_000;
    expect(parseRetryAfterMs(new Date(now + 5000).toUTCString(), now)).toBe(5000);
    // A date in the past clamps to 0 (already expired).
    expect(parseRetryAfterMs(new Date(now - 5000).toUTCString(), now)).toBe(0);
  });

  test('returns undefined for missing or unparseable headers', () => {
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
    expect(parseRetryAfterMs('')).toBeUndefined();
    expect(parseRetryAfterMs('soon')).toBeUndefined();
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
