/**
 * Security headers for every response — API JSON and the served SPA alike.
 *
 * Hand-rolled (like rate-limit.ts) rather than @fastify/helmet because two
 * pieces are dynamic per deployment and per request:
 *
 *   • CSP script-src carries sha256 hashes of the inline <script> blocks in
 *     the BUILT index.html (the theme-before-first-paint snippet), computed
 *     from the file actually being served — so a rebuilt SPA can change its
 *     inline script without anyone remembering to update a hardcoded hash.
 *   • CSP connect-src needs the WebSocket origin (ws://host or wss://host).
 *     CSP3 says 'self' covers same-origin wss:, but older Safari releases
 *     don't implement that, and plain-http deployments (ws://) are never
 *     covered by 'self' — so the request's own Host is allowed explicitly.
 *
 * CSP decisions (see apps/web for the evidence):
 *   • No 'wasm-unsafe-eval', no blob: workers: engines run SERVER-side
 *     (Stockfish child processes behind /ws) — the web client has no WASM and
 *     no Worker() calls. The only worker is the PWA service worker, same-origin.
 *   • No COEP, and therefore no crossOriginIsolated: nothing in the client
 *     uses SharedArrayBuffer (grep: zero hits), and COEP would put every
 *     future cross-origin fetch behind CORP hurdles for no benefit.
 *   • connect-src allows api.anthropic.com + api.openai.com for the BYOK
 *     coach's direct-from-browser path (lib/byokCoach.ts). A CUSTOM OpenAI-
 *     compatible base URL is intentionally NOT allowed here: the direct call
 *     fails closed as a network error and byokCoach.ts falls back to the
 *     stateless /api/coach/explain pass-through, which still works.
 *   • style-src keeps 'unsafe-inline': the piece-set CSS and chessground rely
 *     on inline style attributes; hashes are impractical for attributes.
 *   • img-src data: — the bundled piece sets are data:-URI SVGs in CSS.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';

/** sha256 CSP source tokens for every inline <script> in an HTML document. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  // Inline scripts only: a <script ... src=...> tag never has a hashable body.
  const re = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const body = m[1] ?? '';
    if (!body.trim()) continue;
    hashes.push(`'sha256-${crypto.createHash('sha256').update(body).digest('base64')}'`);
  }
  return hashes;
}

/** Host header values safe to interpolate into a CSP source expression. */
const SAFE_HOST = /^[a-z0-9.\-]+(:\d{1,5})?$|^\[[0-9a-f:.]+\](:\d{1,5})?$/i;

export interface SecurityHeadersOptions {
  /** Directory of the built SPA (index.html is scanned for inline scripts). */
  webDir?: string | null;
  /** Extra origins for connect-src (the BYOK direct-call providers). */
  connectOrigins?: string[];
}

export const DEFAULT_CONNECT_ORIGINS = ['https://api.anthropic.com', 'https://api.openai.com'];

/** Build the CSP for one request; `host` is the (validated) Host header. */
export function buildCsp(scriptHashes: string[], connectOrigins: string[], host: string | null): string {
  const script = ["'self'", ...scriptHashes].join(' ');
  const ws = host ? ` ws://${host} wss://${host}` : '';
  const connect = ["'self'", ...connectOrigins].join(' ') + ws;
  return [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function registerSecurityHeaders(app: FastifyInstance, opts: SecurityHeadersOptions = {}): void {
  const connectOrigins = opts.connectOrigins ?? DEFAULT_CONNECT_ORIGINS;

  let scriptHashes: string[] = [];
  if (opts.webDir) {
    try {
      scriptHashes = inlineScriptHashes(fs.readFileSync(path.join(opts.webDir, 'index.html'), 'utf8'));
    } catch {
      // No index.html (API-only deployment) — CSP still applies to JSON.
    }
  }

  app.addHook('onSend', async (req, reply) => {
    const rawHost = req.host;
    const host = typeof rawHost === 'string' && SAFE_HOST.test(rawHost) ? rawHost.toLowerCase() : null;
    reply.header('content-security-policy', buildCsp(scriptHashes, connectOrigins, host));
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('cross-origin-resource-policy', 'same-origin');
    // HSTS only when this request actually arrived over TLS — req.protocol is
    // 'https' either on a direct TLS socket or via X-Forwarded-Proto from a
    // trusted proxy (TRUST_PROXY). Sending it on plain http would be a lie the
    // browser ignores, and could lock a LAN-http deployment out of itself.
    if (req.protocol === 'https') {
      reply.header('strict-transport-security', 'max-age=31536000');
    }
  });
}

/**
 * CORS allowlist from CHESSER_ALLOWED_ORIGINS (comma-separated origins).
 * Empty/unset → `false`: no CORS headers at all, which is correct for the
 * single-origin deployment (the SPA and API share an origin; same-origin
 * requests never need Access-Control-Allow-Origin). Cross-origin browser
 * clients then fail closed unless their origin is listed explicitly.
 */
export function parseAllowedOrigins(raw: string | undefined): false | string[] {
  if (!raw) return false;
  const origins: string[] = [];
  for (const part of raw.split(',')) {
    const s = part.trim();
    if (!s) continue;
    try {
      const u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      origins.push(u.origin);
    } catch {
      console.warn(`[config] CHESSER_ALLOWED_ORIGINS entry is not a valid origin, ignored: "${s}"`);
    }
  }
  return origins.length > 0 ? origins : false;
}
