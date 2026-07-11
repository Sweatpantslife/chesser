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
 * (SSRF). Literal-address and well-known-name checks only — a public name
 * that DNS-resolves to a private address is out of scope for this app.
 */
function isForbiddenByokHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  // IPv6 loopback / link-local / unique-local.
  if (h === '::1' || h === '::' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  // IPv4 literals in private / loopback / link-local / unspecified ranges.
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return true;
    }
  }
  return false;
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
