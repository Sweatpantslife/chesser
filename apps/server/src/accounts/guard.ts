import { TokenBucketLimiter } from '../rate-limit.js';

/**
 * Brute-force protection for the auth endpoints, two layers deep:
 *
 *  1. Per-IP token buckets on login and register — a backstop against
 *     credential stuffing and mass account creation from one address. The
 *     defaults are deliberately generous because a misconfigured deployment
 *     (reverse proxy without TRUST_PROXY) collapses every client onto the
 *     proxy's IP; the per-account lockout below is the primary defense.
 *
 *  2. Per-account lockout with exponential backoff — after `lockThreshold`
 *     consecutive failures the account locks for `lockBaseMs`, doubling on
 *     each subsequent lockout up to `lockMaxMs`. State is keyed on the
 *     SUBMITTED username (normalized), whether or not such a user exists, so
 *     the lockout itself cannot be used to probe which usernames are real.
 *
 * In-memory and single-process by design, like the JSON-file store. The clock
 * is injectable and `reset()` clears all state, so tests control time fully.
 */

export interface AuthGuardOptions {
  /** Login attempts: bucket capacity (burst) per IP. */
  loginIpCapacity?: number;
  /** Login attempts: bucket refill per minute per IP. */
  loginIpRefillPerMinute?: number;
  /** Registrations: bucket capacity (burst) per IP. */
  registerIpCapacity?: number;
  /** Registrations: bucket refill per minute per IP. */
  registerIpRefillPerMinute?: number;
  /** Consecutive failures on one account before it locks. */
  lockThreshold?: number;
  /** First lockout duration; doubles per subsequent lockout. */
  lockBaseMs?: number;
  /** Lockout duration ceiling. */
  lockMaxMs?: number;
  /** Failure streaks (and lockout history) are forgotten after this idle time. */
  failWindowMs?: number;
  now?: () => number;
}

interface AccountState {
  /** Consecutive failures since the last success/lockout. */
  failures: number;
  /** How many lockouts this streak has already triggered (drives the backoff). */
  lockCount: number;
  lockedUntil: number;
  lastAttempt: number;
}

/** Entry count above which the guard starts sweeping stale account state. */
const SWEEP_THRESHOLD = 10_000;
/** Minimum gap between sweeps. */
const SWEEP_INTERVAL_MS = 60_000;

export class AuthGuard {
  private readonly loginIp: TokenBucketLimiter;
  private readonly registerIp: TokenBucketLimiter;
  private accounts = new Map<string, AccountState>();
  private lastSweep = 0;

  private readonly lockThreshold: number;
  private readonly lockBaseMs: number;
  private readonly lockMaxMs: number;
  private readonly failWindowMs: number;
  private readonly now: () => number;

  constructor(opts: AuthGuardOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.loginIp = new TokenBucketLimiter(opts.loginIpCapacity ?? 20, opts.loginIpRefillPerMinute ?? 20, this.now);
    this.registerIp = new TokenBucketLimiter(
      opts.registerIpCapacity ?? 10,
      opts.registerIpRefillPerMinute ?? 5,
      this.now,
    );
    this.lockThreshold = opts.lockThreshold ?? 5;
    this.lockBaseMs = opts.lockBaseMs ?? 30_000;
    this.lockMaxMs = opts.lockMaxMs ?? 60 * 60_000;
    this.failWindowMs = opts.failWindowMs ?? 15 * 60_000;
  }

  /** Normalize the submitted username into a bounded state key. */
  private key(username: string): string {
    return username.toLowerCase().slice(0, 64);
  }

  /** Take one login-attempt token for `ip`; false = rate limited. */
  allowLoginAttempt(ip: string): boolean {
    return this.loginIp.take(ip || 'unknown');
  }

  /** Take one registration token for `ip`; false = rate limited. */
  allowRegister(ip: string): boolean {
    return this.registerIp.take(ip || 'unknown');
  }

  /** Milliseconds until `username` may attempt a login again (0 = not locked). */
  lockedForMs(username: string): number {
    const s = this.accounts.get(this.key(username));
    if (!s) return 0;
    return Math.max(0, s.lockedUntil - this.now());
  }

  /** Record a failed login for the submitted username (existing or not). */
  recordFailure(username: string): void {
    const t = this.now();
    const k = this.key(username);
    let s = this.accounts.get(k);
    // A long-idle streak is stale — start over rather than compounding it.
    if (!s || (t - s.lastAttempt > this.failWindowMs && s.lockedUntil <= t)) {
      s = { failures: 0, lockCount: 0, lockedUntil: 0, lastAttempt: t };
    }
    s.failures += 1;
    s.lastAttempt = t;
    if (s.failures >= this.lockThreshold) {
      const backoff = Math.min(this.lockMaxMs, this.lockBaseMs * 2 ** s.lockCount);
      s.lockedUntil = t + backoff;
      s.lockCount += 1;
      s.failures = 0;
    }
    this.accounts.set(k, s);
    this.sweep(t, k);
  }

  /** Clear failure/lockout state after a successful login. */
  recordSuccess(username: string): void {
    this.accounts.delete(this.key(username));
  }

  /** Drop state that carries no information anymore (throttled O(N) scan). */
  private sweep(t: number, keep: string): void {
    if (this.accounts.size <= SWEEP_THRESHOLD || t - this.lastSweep < SWEEP_INTERVAL_MS) return;
    this.lastSweep = t;
    for (const [k, s] of this.accounts) {
      if (k === keep) continue;
      if (s.lockedUntil <= t && t - s.lastAttempt > this.failWindowMs) this.accounts.delete(k);
    }
  }

  /** Tracked account-state count (tests / observability). */
  get size(): number {
    return this.accounts.size;
  }

  /** Test hook: forget all IP buckets and account state. */
  reset(): void {
    this.accounts.clear();
    this.loginIp.clear();
    this.registerIp.clear();
  }
}
