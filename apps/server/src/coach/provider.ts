/**
 * LLM provider abstraction for the coach explain endpoint.
 *
 * Two thin fetch-based implementations (matching the repo's fetch style —
 * import.ts, tablebase.ts) behind one interface, selected from the
 * environment at startup:
 *
 *   • ANTHROPIC_API_KEY  → Anthropic Messages API
 *       model: COACH_LLM_MODEL, default claude-haiku-4-5-20251001
 *   • OPENAI_API_KEY     → any OpenAI-compatible /chat/completions endpoint
 *       base:  COACH_LLM_BASE_URL, default https://api.openai.com/v1
 *       model: COACH_LLM_MODEL, default gpt-4o-mini
 *
 * ANTHROPIC_API_KEY wins when both are set. Keys never leave this module —
 * the client only ever sees `{ configured: false }` or generated prose.
 * Errors throw; the route maps them to a 502 the client treats as "fall back
 * to the rule-based text".
 */

import { isIP } from 'node:net';
import dns from 'node:dns/promises';

export interface CoachCompletionInput {
  system: string;
  user: string;
  maxTokens: number;
}

export interface CoachProvider {
  readonly id: 'anthropic' | 'openai';
  /** Model identifier — part of the cache key. */
  readonly model: string;
  /** One short completion. Throws on HTTP/parse failure or empty output. */
  complete(input: CoachCompletionInput): Promise<string>;
}

export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export function anthropicProvider(apiKey: string, model: string): CoachProvider {
  return {
    id: 'anthropic',
    model,
    async complete({ system, user, maxTokens }) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic: HTTP ${res.status}`);
      const data = (await res.json()) as {
        content?: { type: string; text?: string }[];
        stop_reason?: string;
      };
      const text = (data.content ?? [])
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('')
        .trim();
      if (!text) throw new Error(`anthropic: empty response (stop_reason=${data.stop_reason ?? '?'})`);
      return text;
    },
  };
}

export function openAiProvider(apiKey: string, model: string, baseUrl: string): CoachProvider {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    id: 'openai',
    model,
    async complete({ system, user, maxTokens }) {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!res.ok) throw new Error(`openai-compatible: HTTP ${res.status}`);
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error('openai-compatible: empty response');
      return text;
    },
  };
}

// ---------------------------------------------------------------------------
// BYOK (bring-your-own-key) — per-request ephemeral providers
// ---------------------------------------------------------------------------

/**
 * Hosts an OpenAI-compatible BYOK base URL must never point at. The server
 * makes ONE outbound call to this URL with the user's key, so a hostile
 * client could otherwise aim it at loopback/link-local/private services
 * (SSRF). This covers literal addresses and well-known names; a public name
 * that DNS-resolves to a private address is caught by the async
 * `byokBaseUrlDnsError` check the route runs before fetching.
 */
function isForbiddenByokHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (isIP(h)) return isForbiddenIpAddress(h);
  return false;
}

/** True for a v4 dotted-quad in a non-public range (or not a dotted-quad at all). */
function isForbiddenIpv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return true;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || // "this network" / unspecified
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64.0.0/10
    (a === 169 && b === 254) || // link-local (cloud metadata lives here)
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 0) || // IETF special-purpose 192.0.0.0/24 + TEST-NET-1
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking 198.18.0.0/15
    a >= 224 // multicast, reserved, broadcast
  );
}

/**
 * True when `address` is NOT a public unicast IP — loopback, private,
 * link-local, CGNAT, multicast/reserved (v4), or anything outside global
 * unicast 2000::/3 (v6, which excludes ::1, fe80::/10, fc00::/7, ::, …).
 * IPv4-mapped IPv6 (::ffff:a.b.c.d) is unwrapped and checked as IPv4.
 * Non-IP input is forbidden by definition (fail closed).
 */
export function isForbiddenIpAddress(address: string): boolean {
  const ip = address.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const family = isIP(ip);
  if (family === 4) return isForbiddenIpv4(ip);
  if (family === 6) {
    const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(ip);
    if (mapped) return isForbiddenIpv4(mapped[1]!);
    const firstGroup = Number.parseInt(ip.split(':', 1)[0] || '0', 16);
    return !(firstGroup >= 0x2000 && firstGroup <= 0x3fff);
  }
  return true;
}

/** Injectable DNS resolver (tests stub this; production uses dns.lookup). */
export type DnsLookupFn = (hostname: string, opts: { all: true }) => Promise<{ address: string; family: number }[]>;

const defaultLookup: DnsLookupFn = (hostname, opts) => dns.lookup(hostname, opts);

/**
 * The DNS half of the BYOK SSRF guard: resolve the base URL's hostname and
 * refuse it when ANY resolved address is non-public — a public DNS name
 * pointing at 127.0.0.1 / 10.x / 169.254.x must not reach fetch(). Re-runs
 * the syntax checks first so callers can use it as the single gate. Returns
 * an error string for the client, or null when the URL is safe to fetch.
 *
 * Residual risk, accepted: the actual fetch() does its own lookup, so a DNS
 * server flipping records between this check and the fetch (rebinding) could
 * still slip through that one request. Closing that needs a pinned-address
 * dispatcher; for a single JSON POST with the user's own key the
 * resolve-then-check gate is the proportionate defense.
 */
export async function byokBaseUrlDnsError(raw: string, lookup: DnsLookupFn = defaultLookup): Promise<string | null> {
  const syntaxErr = validateByokBaseUrl(raw);
  if (syntaxErr) return syntaxErr;
  const hostname = new URL(raw).hostname.replace(/^\[|\]$/g, '');
  // A literal address was already fully vetted by the syntax checks above.
  if (isIP(hostname)) return null;
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return 'Base URL host could not be resolved.';
  }
  if (addresses.length === 0) return 'Base URL host could not be resolved.';
  for (const a of addresses) {
    if (isForbiddenIpAddress(a.address)) return 'Base URL host is not allowed.';
  }
  return null;
}

/** Error string when a user-supplied OpenAI-compatible base URL is unusable, else null. */
export function validateByokBaseUrl(raw: string): string | null {
  if (raw.length > 200) return 'Base URL too long.';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Base URL is not a valid URL.';
  }
  if (url.protocol !== 'https:') return 'Base URL must use https.';
  if (url.username || url.password) return 'Base URL must not embed credentials.';
  if (isForbiddenByokHost(url.hostname)) return 'Base URL host is not allowed.';
  return null;
}

export interface ByokConfig {
  provider: 'anthropic' | 'openai';
  apiKey: string;
  /** Empty → the provider's default model. */
  model: string;
  /** OpenAI-compatible only; empty → the public OpenAI endpoint. */
  baseUrl: string;
}

/**
 * A single-request provider around a user-supplied key. The key lives only in
 * this closure for the duration of one upstream call — never cached, never
 * stored, never logged (see scrubSecret in routes.ts for the error path).
 */
export function byokProvider(cfg: ByokConfig): CoachProvider {
  if (cfg.provider === 'anthropic') {
    return anthropicProvider(cfg.apiKey, cfg.model || DEFAULT_ANTHROPIC_MODEL);
  }
  return openAiProvider(cfg.apiKey, cfg.model || DEFAULT_OPENAI_MODEL, cfg.baseUrl || DEFAULT_OPENAI_BASE_URL);
}

/** Provider from the environment, or null when no key is configured. */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): CoachProvider | null {
  const model = env.COACH_LLM_MODEL?.trim();
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) return anthropicProvider(anthropicKey, model || DEFAULT_ANTHROPIC_MODEL);
  const openAiKey = env.OPENAI_API_KEY?.trim();
  if (openAiKey) {
    return openAiProvider(openAiKey, model || DEFAULT_OPENAI_MODEL, env.COACH_LLM_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL);
  }
  return null;
}
