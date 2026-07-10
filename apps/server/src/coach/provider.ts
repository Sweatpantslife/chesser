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

const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

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
