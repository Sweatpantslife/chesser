/**
 * Per-IP rate limits for the unauthenticated upstream-proxy endpoints.
 *
 * /api/explorer, /api/tablebase and /api/import forward to Lichess /
 * chess.com on the operator's dime (and, for the explorer, with the
 * operator's CHESSER_LICHESS_TOKEN) — so they get stricter, per-endpoint
 * budgets than the rest of the API. Implemented as one onRequest hook so
 * index.ts only gains a single registration line; the endpoints themselves
 * are matched by exact pathname.
 *
 * Budgets are token buckets (burst capacity + sustained refill):
 *   • explorer/tablebase: one request per move browsed, both caches hit hard
 *     upstream only on misses — 60 burst / 30 per minute sustained absorbs
 *     fast click-through without letting one IP crawl the tree endlessly.
 *   • import: each request can fan out to 30 upstream game fetches — 5 burst
 *     / 2 per minute is plenty for a human re-importing an archive.
 *
 * Like the auth guard, budgets are per req.ip: behind a reverse proxy set
 * TRUST_PROXY so this keys on real client addresses, not the proxy's.
 */
import type { FastifyInstance } from 'fastify';
import { TokenBucketLimiter } from './rate-limit.js';

export interface ProxyGuardOptions {
  explorerCapacity?: number;
  explorerRefillPerMinute?: number;
  tablebaseCapacity?: number;
  tablebaseRefillPerMinute?: number;
  importCapacity?: number;
  importRefillPerMinute?: number;
  now?: () => number;
}

export function registerProxyGuards(app: FastifyInstance, opts: ProxyGuardOptions = {}): void {
  const now = opts.now ?? Date.now;
  const limiters = new Map<string, TokenBucketLimiter>([
    ['/api/explorer', new TokenBucketLimiter(opts.explorerCapacity ?? 60, opts.explorerRefillPerMinute ?? 30, now)],
    ['/api/tablebase', new TokenBucketLimiter(opts.tablebaseCapacity ?? 60, opts.tablebaseRefillPerMinute ?? 30, now)],
    ['/api/import', new TokenBucketLimiter(opts.importCapacity ?? 5, opts.importRefillPerMinute ?? 2, now)],
  ]);

  app.addHook('onRequest', async (req, reply) => {
    // Match the ROUTED path, not the raw URL. Fastify percent-decodes the path
    // when it routes, so `/api/%69mport` reaches the /api/import handler — but
    // req.url would still read `/api/%69mport` and miss the limiter Map,
    // bypassing the guard entirely. routeOptions.url is the matched route
    // pattern ('/api/import'), identical for the plain and the encoded form,
    // and undefined for unrouted requests (which consume no budget). Mirrors
    // metrics.ts, which already keys on req.routeOptions.url.
    const pathname = req.routeOptions?.url;
    const limiter = pathname ? limiters.get(pathname) : undefined;
    if (!limiter) return;
    if (!limiter.take(req.ip || 'unknown')) {
      return reply
        .code(429)
        .header('retry-after', '60')
        .send({ error: 'Too many requests — try again shortly.' });
    }
  });
}
