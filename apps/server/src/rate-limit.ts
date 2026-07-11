/**
 * Per-key token-bucket rate limiter (in-memory, dependency-free).
 *
 * Originally written for /api/coach/explain; now shared with the auth
 * endpoints (accounts/guard.ts). Single-process by design, matching the
 * JSON-file stores. The clock is injectable so tests control time.
 */

interface Bucket {
  tokens: number;
  last: number;
}

/** Entry count above which the limiter starts sweeping idle buckets. */
const SWEEP_THRESHOLD = 10_000;
/** Minimum gap between sweeps — the O(N) scan must not run per-request. */
const SWEEP_INTERVAL_MS = 60_000;

export class TokenBucketLimiter {
  private buckets = new Map<string, Bucket>();
  private lastSweep = 0;
  constructor(
    private readonly capacity: number,
    private readonly refillPerMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Take one token for `key`; false = rate limited. */
  take(key: string): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, last: t };
    b.tokens = Math.min(this.capacity, b.tokens + ((t - b.last) / 60_000) * this.refillPerMinute);
    b.last = t;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    // Opportunistic sweep so idle IPs don't accumulate forever — throttled to
    // once per SWEEP_INTERVAL_MS so the O(N) scan can't run on every request.
    // A bucket whose refill has caught back up to capacity carries no state (a
    // fresh bucket starts full), so dropping it is lossless.
    if (this.buckets.size > SWEEP_THRESHOLD && t - this.lastSweep >= SWEEP_INTERVAL_MS) {
      this.lastSweep = t;
      for (const [k, v] of this.buckets) {
        if (k === key) continue;
        const refilled = v.tokens + ((t - v.last) / 60_000) * this.refillPerMinute;
        if (refilled >= this.capacity - 0.01) this.buckets.delete(k);
      }
    }
    return true;
  }

  /** Tracked bucket count (tests / observability). */
  get size(): number {
    return this.buckets.size;
  }

  /** Forget all buckets (tests / admin reset). */
  clear(): void {
    this.buckets.clear();
  }
}
