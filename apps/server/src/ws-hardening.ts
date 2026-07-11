/**
 * WebSocket hardening shared by index.ts and the tests.
 *
 *   • WS_MAX_PAYLOAD_BYTES caps a single WS message (ws's default is 100 MiB
 *     — a memory-DoS invitation). 1 MiB matches the HTTP bodyLimit; real
 *     protocol messages (analyze requests, friend moves) are well under 4 KB.
 *   • WsSessionGuard bounds concurrent /ws CONNECTIONS per client IP and
 *     globally. Each connection may lazily spawn up to TWO Stockfish child
 *     processes (analysis + bot), so without a ceiling one client opening
 *     sockets in a loop exhausts CPU and RAM. Note this caps connections, not
 *     engine spawns: the web client opens one /ws per tab on mount and holds it
 *     for the tab's lifetime, so idle tabs count toward the cap too (documented
 *     in DEPLOYMENT.md). Rejected sockets get close code 1013 ("try again
 *     later"); the web client's auto-reconnect uses capped exponential backoff
 *     with jitter (lib/engine.ts) so a refused socket does not hot-loop.
 *
 * Defaults are deliberately generous (see accounts/guard.ts for the same
 * reasoning): behind a proxy without TRUST_PROXY every client shares the
 * proxy's IP, and the per-IP cap must not strangle a legitimate deployment.
 * Tune with CHESSER_WS_MAX_SESSIONS / CHESSER_WS_MAX_SESSIONS_PER_IP.
 */
import type { IncomingMessage } from 'node:http';
import { TRUST_PROXY } from './config.js';

export const WS_MAX_PAYLOAD_BYTES = 1_048_576; // 1 MiB, matches HTTP bodyLimit

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export interface WsSessionGuardOptions {
  /** Global ceiling on concurrent engine-capable sessions (≤ 2 Stockfish each). */
  maxSessions?: number;
  /** Per-client-IP ceiling (multiple tabs are legitimate; hundreds are not). */
  maxSessionsPerIp?: number;
}

export class WsSessionGuard {
  private readonly maxSessions: number;
  private readonly maxSessionsPerIp: number;
  private total = 0;
  private readonly perIp = new Map<string, number>();

  constructor(opts: WsSessionGuardOptions = {}) {
    this.maxSessions = opts.maxSessions ?? envInt('CHESSER_WS_MAX_SESSIONS', 32);
    this.maxSessionsPerIp = opts.maxSessionsPerIp ?? envInt('CHESSER_WS_MAX_SESSIONS_PER_IP', 8);
  }

  /** Claim a session slot for `ip`. Returns a release fn, or null when full. */
  acquire(ip: string): (() => void) | null {
    if (this.total >= this.maxSessions) return null;
    const count = this.perIp.get(ip) ?? 0;
    if (count >= this.maxSessionsPerIp) return null;
    this.total += 1;
    this.perIp.set(ip, count + 1);
    let released = false;
    return () => {
      if (released) return; // idempotent — 'close' and error paths may both call
      released = true;
      this.total -= 1;
      const left = (this.perIp.get(ip) ?? 1) - 1;
      if (left <= 0) this.perIp.delete(ip);
      else this.perIp.set(ip, left);
    };
  }

  /** Live session count (tests / observability). */
  get size(): number {
    return this.total;
  }
}

/**
 * Client IP of a raw upgrade request. WS upgrades bypass Fastify's routing,
 * so its trustProxy handling never runs — this applies the same policy to
 * X-Forwarded-For by hand. Numeric trust (the documented TRUST_PROXY=1 setup)
 * counts hops from the RIGHT, exactly like config.ts explains: only entries
 * appended by our own proxies are believed. A string address-spec (IP/CIDR
 * list) is conservatively treated as "use the socket address" — the per-IP
 * cap then keys on the proxy, and the global cap still protects the host.
 */
export function clientIpFromUpgrade(
  req: IncomingMessage,
  trustProxy: false | number | string = TRUST_PROXY,
): string {
  const direct = req.socket.remoteAddress ?? 'unknown';
  if (typeof trustProxy !== 'number' || trustProxy <= 0) return direct;
  const raw = req.headers['x-forwarded-for'];
  const header = Array.isArray(raw) ? raw.join(',') : raw;
  if (!header) return direct;
  const parts = header
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return direct;
  // With N trusted proxies, the Nth entry from the right is the real client;
  // a shorter list means the client connected through fewer hops than
  // expected — take the leftmost rather than reading past the array.
  return parts[Math.max(0, parts.length - trustProxy)] ?? direct;
}
