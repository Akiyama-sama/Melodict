/**
 * Bounded-concurrency task pool + AIMD window for the lyrics-analysis gateway.
 *
 * Serial batch execution left whole-song wall time at sum(batch) even when the endpoint had
 * headroom; this pool instead keeps `window` batches in flight at once. Results are aggregated in
 * submission order regardless of completion order, a single task rejection never kills sibling
 * tasks, and every settle (success or failure) reports through the AIMD controller so the next
 * wave sizes itself from what the endpoint just tolerated.
 *
 * This module is imported by the gateway, which runs inside the lyrics-analysis utility process
 * where Electron modules crash — keep it dependency-free (no logger, no `ai`).
 */

/** Outcome of a pooled run: results indexed by submission order, rejections keyed the same way. */
export interface PoolOutcome<T> {
  /** Slot `i` holds task `i`'s value, or `undefined` when that task rejected. */
  results: Array<T | undefined>;
  /** Rejections keyed by submission index; a slot never appears in both maps. */
  errors: Map<number, unknown>;
}

/**
 * Runs async task thunks with a dynamic in-flight limit, keeping results indexed by submission
 * order. `getLimit` is re-read every time a slot frees up, so an AIMD window can grow or shrink
 * the pool mid-run: successes widen it, throttles narrow it, all without touching in-flight
 * tasks. A rejection never kills siblings — it only occupies its own slot in `errors`.
 *
 * `shouldStop` is polled before every launch: once it returns true, unstarted tasks are skipped
 * (their slots stay empty), so a fatal sibling failure (auth error, abort) stops the run from
 * spending more requests. Already in-flight tasks always run to completion. A throttle cooldown
 * is NOT a pool concern: tasks that must not hit the wire yet simply await
 * `ConcurrencyWindow.waitThroughCooldown()` inside their thunk, which keeps them counted as
 * in-flight (no idle deadlock) while sending nothing.
 */
export const runWithConcurrency = async <T>(
  tasks: Array<() => Promise<T>>,
  getLimit: () => number,
  shouldStop: () => boolean = () => false
): Promise<PoolOutcome<T>> => {
  const results = new Array<T | undefined>(tasks.length).fill(undefined);
  const errors = new Map<number, unknown>();

  if (tasks.length === 0) return { results, errors };

  let nextIndex = 0;
  let activeCount = 0;
  let stopped = false;

  let releaseDone: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    releaseDone = resolve;
  });

  // The pool is finished when nothing is in flight AND no further task can start: either every
  // task was launched or `shouldStop` told it to abandon the rest. (Counting "pending" tasks
  // instead would hang here — skipped tasks never settle.)
  const maybeDone = () => {
    if (activeCount === 0 && (stopped || nextIndex >= tasks.length)) releaseDone();
  };

  const launchEligible = () => {
    if (shouldStop()) {
      stopped = true;
      maybeDone();
      return;
    }
    // A limit below 1 (or a transient NaN from a caller computing a mean) would stall the pool.
    const limit = Math.max(1, Math.floor(getLimit() || 1));
    while (activeCount < limit && nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      activeCount += 1;

      void Promise.resolve()
        .then(() => tasks[index]())
        .then(
          (value) => {
            results[index] = value;
          },
          (error) => {
            errors.set(index, error);
          }
        )
        .finally(() => {
          activeCount -= 1;
          maybeDone();
          launchEligible();
        });
    }
  };

  launchEligible();
  await done;

  return { results, errors };
};

/** AIMD tuning for the lyrics-analysis workload, not the NeMo batch-pipeline defaults: a song
 * sends ~10–18 batches in total, so a 25-success window would mean the run ends before the
 * window ever grows. Three consecutive successes per +1 keeps growth reachable within one song
 * while still demanding sustained headroom. */
const SUCCESS_STREAK_FOR_INCREASE = 3;
/** A throttle cuts the window to 3/4 (NeMo-style; gentler than the old halving, because with
 * cascade dampening the cut only fires once per burst anyway). */
const DECREASE_FACTOR = 0.75;
/** Absolute window ceiling. Replaces the per-provider `maxConcurrency` config: 16 is far beyond
 * what one song can occupy anyway (~15 batches) and only exists to bound a runaway window. */
export const ABSOLUTE_WINDOW_CEILING = 16;
/** When no `Retry-After` header accompanies a 429, hold new launches for this long (NeMo's
 * default cooldown). */
const DEFAULT_RETRY_AFTER_MS = 2000;
/** Cap on a provider-supplied Retry-After so a hostile/broken header cannot stall a whole run. */
const MAX_RETRY_AFTER_MS = 60_000;
/** After a throttle, the window is allowed to climb to at most `learnedCeiling + 1`: probing one
 * value past the observed limit re-checks the endpoint occasionally without re-entering the
 * sawtooth of climbing all the way back into the burst that tripped the limit. */
const CEILING_OVERSHOOT = 1;

/**
 * AIMD window over the in-flight batch count, hardened the way production controllers
 * (Netflix/concurrency-limits, NVIDIA NeMo Data Designer's ThrottleManager) harden theirs:
 *
 * - **Cascade dampening** — when a burst of in-flight batches all hit 429s at once, only the
 *   FIRST throttle shrinks the window; the rest of the burst counts for telemetry only. Without
 *   this, five simultaneous 429s would compound-cut the window (0.75^5 ≈ 0.24×) far below what
 *   the endpoint actually objected to. The cascade resets on the next success.
 * - **Ceiling stabilization** — `learnedCeiling` records the largest window value a batch
 *   actually SUCCEEDED at (seeded from the cross-session memory). Growth tops out at ceiling +
 *   CEILING_OVERSHOOT: one value past the proven limit gets re-checked occasionally, and a
 *   success there raises the ceiling — but a throttle never inflates it with a value the
 *   endpoint just objected to, so the persisted ceiling is always endpoint-proven.
 * - **Retry-After cooldown** — a throttle holds new launches for the server-advised duration
 *   (capped), or a short default, so the next wave does not launch straight into the same wall.
 *   `waitThroughCooldown()` is awaited inside each batch thunk, keeping those batches counted as
 *   in-flight (no idle deadlock) while sending nothing.
 * - **Streaked additive increase** — the window grows by 1 only after
 *   SUCCESS_STREAK_FOR_INCREASE consecutive successful settles, and never past the learned
 *   ceiling (plus overshoot).
 *
 * The learned ceiling survives runs via the caller (see concurrencyMemory.ts): `learnedCeiling`
 * seeds the next session, so repeated runs converge monotonically instead of re-probing from 4.
 */
export class ConcurrencyWindow {
  private current: number;
  private learnedCeiling: number;
  /** While set (epoch ms), the window is cooling down and new launches hold back. */
  private coolUntil = 0;
  /** Successes since the last throttle; drives the streaked additive increase. */
  private successStreak = 0;
  /** True while a 429 cascade is in progress (resets on the next success). */
  private cascadeOpen = false;
  /** Window history for telemetry: every value the window held at a settle, in order. */
  private readonly trace: number[] = [];
  /** Count of settle events that shrank the window (429/timeout/network). */
  private shrinkEvents = 0;
  /** Sum of every sampled window value, over trace.length — feeds the mean. */
  private sampleSum = 0;

  constructor(initial?: number) {
    const start = Number.isFinite(initial) && (initial as number) >= 1 ? Math.floor(initial as number) : 4;
    this.current = Math.min(ABSOLUTE_WINDOW_CEILING, start);
    this.learnedCeiling = this.current;
  }

  get value(): number {
    return this.current;
  }

  /** Highest window the session ever held. */
  get max(): number {
    return this.trace.length > 0 ? Math.max(...this.trace) : this.current;
  }

  /** Arithmetic mean of the window over time (trace-sampled; 0 when no settles ran). */
  get mean(): number {
    return this.trace.length > 0 ? this.sampleSum / this.trace.length : 0;
  }

  get rateLimitedCount(): number {
    return this.shrinkEvents;
  }

  /** Window snapshot for telemetry: {max, mean, rateLimitedCount}. */
  get stats(): { max: number; mean: number; rateLimitedCount: number } {
    return {
      max: this.max,
      mean: Math.round(this.mean * 100) / 100,
      rateLimitedCount: this.shrinkEvents
    };
  }

  /** The ceiling this window converged on — the caller persists it for the next session. */
  get ceiling(): number {
    return this.learnedCeiling;
  }

  /** True while a throttle's cooldown is in effect. */
  isCoolingDown(now: number = Date.now()): boolean {
    return now < this.coolUntil;
  }

  /**
   * Resolves once the throttle cooldown has elapsed. Batch thunks await this before touching the
   * wire: the tasks stay counted as in-flight (the pool keeps its slots busy instead of
   * deadlocking on an external gate), they just send nothing until the cooldown passes.
   */
  async waitThroughCooldown(): Promise<void> {
    while (this.isCoolingDown()) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, this.coolUntil - Date.now())));
    }
  }

  /** The value to sample when a settle at the current window finishes. */
  private sample(): void {
    this.sampleSum += this.current;
    this.trace.push(this.current);
  }

  /** A batch settled clean: grows the window after a streak of successes, capped by the learned
   * ceiling (+ overshoot). Closes any open throttle cascade. A success at or above the learned
   * ceiling is endpoint proof — it raises the ceiling, which is how cross-session convergence
   * climbs (see concurrencyMemory.ts). */
  onSuccess(): void {
    this.sample();
    this.cascadeOpen = false;
    this.successStreak += 1;

    if (this.current >= this.learnedCeiling) this.learnedCeiling = this.current;

    const growthCap = Math.min(ABSOLUTE_WINDOW_CEILING, this.learnedCeiling + CEILING_OVERSHOOT);
    if (this.successStreak >= SUCCESS_STREAK_FOR_INCREASE && this.current < growthCap) {
      this.current += 1;
      this.successStreak = 0;
    }
  }

  /**
   * A batch hit a rate limit / timeout / network error. Only the first throttle of a cascade
   * shrinks the window. The learned ceiling is intentionally NOT updated here: a throttle above
   * it is a failed overshoot probe (the ceiling already marks the proven limit), and a throttle
   * below it is transient (timeout/network) — neither is proof about the endpoint's capacity.
   * `retryAfterMs` (from the 429's Retry-After header, when the transport surfaces it) holds new
   * launches for the server-advised interval.
   */
  onThrottled(retryAfterMs?: number): void {
    this.sample();

    if (!this.cascadeOpen) {
      this.cascadeOpen = true;
      this.successStreak = 0;
      this.shrinkEvents += 1;

      this.current = Math.max(1, Math.floor(this.current * DECREASE_FACTOR));
    }

    const advised =
      typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0
        ? Math.min(Math.ceil(retryAfterMs), MAX_RETRY_AFTER_MS)
        : DEFAULT_RETRY_AFTER_MS;
    this.coolUntil = Math.max(this.coolUntil, Date.now() + advised);
  }
}

/**
 * Classifies a gateway failure for AIMD: true for the transient failure families the window
 * should back off from (429 rate limiting, 5xx overload, timeouts, network reachability).
 * Auth/endpoint-config errors are permanent and must NOT shrink the window.
 */
export const isThrottlingError = (error: unknown): boolean => {
  const statusCode =
    error && typeof error === 'object' && 'statusCode' in error
      ? (error as { statusCode?: unknown }).statusCode
      : undefined;
  if (typeof statusCode === 'number' && (statusCode === 429 || statusCode >= 500)) return true;

  const message = error instanceof Error ? error.message : String(error);
  return /rate.?limit|too many requests|timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EPIPE|network|fetch failed|socket hang up|aborted|terminated|503|502|429/i.test(
    message
  );
};

/** Parses a Retry-After header (seconds or HTTP-date) into milliseconds, or undefined. */
export const parseRetryAfterMs = (header: string | undefined, now: number = Date.now()): number | undefined => {
  const trimmed = header?.trim();
  if (!trimmed) return undefined;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(trimmed);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
};
