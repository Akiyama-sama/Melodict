/**
 * Bounded-concurrency task pool + AIMD (additive increase, multiplicative decrease) window for the
 * lyrics-analysis gateway.
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
 * spending more requests. Already in-flight tasks always run to completion.
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

/**
 * AIMD controller over the in-flight window. Success grows the window by one (additive increase);
 * a rate limit, timeout or network failure halves it (multiplicative decrease), floor 1.
 */
export class ConcurrencyWindow {
  /** Hard ceiling, from the provider profile's `maxConcurrency` (default 4). */
  readonly cap: number;
  private current: number;
  /** Window history for telemetry: every value the window held, in order. */
  private readonly trace: number[] = [];
  /** Count of settle events that shrank the window (429/timeout/network). */
  private shrinkEvents = 0;
  /** Sum of every sampled window value, over trace.length — feeds the mean. */
  private sampleSum = 0;

  constructor(cap: number) {
    const safeCap = Number.isFinite(cap) && cap >= 1 ? Math.floor(cap) : 4;
    this.cap = safeCap;
    this.current = Math.min(4, safeCap);
  }

  get value(): number {
    return this.current;
  }

  /** Highest window the session ever held. */
  get max(): number {
    return Math.max(...this.trace);
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
    return { max: this.max, mean: Math.round(this.mean * 100) / 100, rateLimitedCount: this.shrinkEvents };
  }

  /** The value to sample when a settle at the current window finishes. */
  private sample(): void {
    this.sampleSum += this.current;
    this.trace.push(this.current);
  }

  /** A batch settled clean: grow by one, capped. */
  onSuccess(): void {
    this.sample();
    if (this.current < this.cap) this.current += 1;
  }

  /** A batch hit a rate limit / timeout / network error: halve, floor 1. */
  onFailure(): void {
    this.sample();
    if (this.current > 1) this.current = Math.max(1, Math.floor(this.current / 2));
    this.shrinkEvents += 1;
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
