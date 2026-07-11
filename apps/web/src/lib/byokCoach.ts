/**
 * BYOK call paths — talking to the user's own LLM provider with THEIR key.
 *
 * Preferred path: call the provider DIRECTLY from the browser, so the key
 * never touches our server at all.
 *   • Anthropic explicitly supports browser calls via the
 *     `anthropic-dangerous-direct-browser-access: true` header (safe here
 *     because the key is the user's own, entered by them, stored locally).
 *   • OpenAI-compatible endpoints vary: some allow CORS, many don't. We
 *     attempt the direct call and, on a network/CORS failure, fall back to
 *     the STATELESS pass-through on /api/coach/explain — the key rides one
 *     request in the x-coach-key header, is used for one upstream call, and
 *     is never stored or logged (see apps/server/src/coach/routes.ts).
 *
 * Prompts come from @chesser/shared coachPrompts so the direct path and both
 * server paths produce byte-identical prompts (and identical grounding rules).
 *
 * NEVER include cfg.apiKey in an Error message, console output or analytics.
 */
import {
  buildSystemPrompt,
  buildUserPrompt,
  COACH_MAX_OUTPUT_TOKENS,
  type CoachExplainFacts,
  type CoachExplainResponse,
  type CoachSkillLevel,
  type CoachWeeklyReportFacts,
} from '@chesser/shared';
import { DEFAULT_BYOK_MODEL, type ByokConfig } from '../store/byok';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

/** A failed BYOK call. `network` = fetch itself failed (offline or CORS). */
export class ByokCallError extends Error {
  constructor(
    message: string,
    readonly network: boolean,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'ByokCallError';
  }
}

export function byokModelOf(cfg: ByokConfig): string {
  return cfg.model || DEFAULT_BYOK_MODEL[cfg.provider];
}

async function fetchOrNetworkError(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    // fetch rejects (TypeError) on DNS/offline failures AND on CORS blocks —
    // indistinguishable from JS by design. Deliberately not the caught error's
    // message: it must never echo request details.
    throw new ByokCallError('network-or-cors', true);
  }
}

/** One direct-from-browser completion with the user's key. Throws ByokCallError. */
export async function completeDirect(cfg: ByokConfig, system: string, user: string, maxTokens: number): Promise<string> {
  const model = byokModelOf(cfg);
  if (cfg.provider === 'anthropic') {
    const res = await fetchOrNetworkError(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        // Anthropic's explicit opt-in for browser-originated calls. "Dangerous"
        // refers to shipping an app-owned key to browsers — here the key is the
        // user's own, so the risk the header warns about does not apply.
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!res.ok) throw new ByokCallError(`anthropic: HTTP ${res.status}`, false, res.status);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) throw new ByokCallError('anthropic: empty response', false, res.status);
    return text;
  }

  const base = (cfg.baseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
  const res = await fetchOrNetworkError(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new ByokCallError(`openai-compatible: HTTP ${res.status}`, false, res.status);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new ByokCallError('openai-compatible: empty response', false, res.status);
  return text;
}

/**
 * One explain call through the server's stateless pass-through: the key is
 * forwarded per-request in a header, used for a single upstream call, never
 * stored or cached. Throws ByokCallError.
 */
export async function explainViaPassThrough(
  cfg: ByokConfig,
  facts: CoachExplainFacts,
  level?: CoachSkillLevel,
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-coach-key': cfg.apiKey,
    'x-coach-provider': cfg.provider,
  };
  if (cfg.model) headers['x-coach-model'] = cfg.model;
  if (cfg.provider === 'openai' && cfg.baseUrl) headers['x-coach-base-url'] = cfg.baseUrl;

  const res = await fetchOrNetworkError('/api/coach/explain', {
    method: 'POST',
    headers,
    body: JSON.stringify({ facts, level }),
  });
  if (!res.ok) throw new ByokCallError(`pass-through: HTTP ${res.status}`, false, res.status);
  const data = (await res.json()) as CoachExplainResponse;
  if (!data.configured) throw new ByokCallError('pass-through: not configured', false, res.status);
  return data.explanation;
}

/**
 * Word the given facts with the user's own key. Direct call first; stateless
 * server pass-through only when the direct call failed at the network/CORS
 * layer. Resolves null on any failure — callers keep their rule-based text.
 */
export async function explainWithUserKey(
  cfg: ByokConfig,
  facts: CoachExplainFacts,
  level?: CoachSkillLevel,
): Promise<string | null> {
  const effectiveLevel = level ?? 'intermediate';
  try {
    return await completeDirect(cfg, buildSystemPrompt(effectiveLevel), buildUserPrompt(facts), COACH_MAX_OUTPUT_TOKENS);
  } catch (e) {
    // An HTTP error from the provider (bad key, unknown model, rate limit)
    // would fail identically through the pass-through — don't double-bill the
    // attempt. Only a network/CORS failure warrants the server fallback.
    if (!(e instanceof ByokCallError) || !e.network) return null;
  }
  try {
    return await explainViaPassThrough(cfg, facts, level);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// "Test key" — a tiny end-to-end call over the exact production path
// ---------------------------------------------------------------------------

/** Minimal valid weekly_report facts — the cheapest well-formed payload. */
function keyTestFacts(): CoachWeeklyReportFacts {
  return {
    kind: 'weekly_report',
    weekLabel: 'connectivity test',
    activeDays: 1,
    xpEarned: 10,
    streak: 1,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    bestAccuracy: null,
    lessonsCompleted: 0,
    lessonStars: 0,
    puzzleRatingDelta: null,
    newRushBest: null,
    newStormBest: null,
    trainingAttempts: 0,
    trainingSolved: 0,
    topWeakness: null,
    topWeaknessCount: 0,
    ruleBasedText: 'Reply with one short sentence confirming the coach is reachable.',
  };
}

export type KeyTestResult =
  | { ok: true; via: 'direct' | 'server'; model: string }
  | { ok: false; error: string };

/** Human wording for a provider HTTP failure. NEVER includes the key. */
function describeStatus(status: number | null): string {
  if (status === 401 || status === 403) return 'The provider rejected the key. Check that it was pasted completely.';
  if (status === 404) return 'The provider could not find that model (or base URL). Check the model name.';
  if (status === 429) return 'The provider rate-limited the request. The key works — try again in a minute.';
  if (status !== null && status >= 500) return 'The provider had a server error. Try again shortly.';
  return 'The provider call failed.';
}

/**
 * Validate the key by making one real (tiny) coach call: direct first, then
 * the stateless pass-through when the direct call is blocked by CORS/network.
 */
export async function testUserKey(cfg: ByokConfig): Promise<KeyTestResult> {
  const facts = keyTestFacts();
  let directError: ByokCallError | null = null;
  try {
    await completeDirect(cfg, buildSystemPrompt('intermediate'), buildUserPrompt(facts), 64);
    return { ok: true, via: 'direct', model: byokModelOf(cfg) };
  } catch (e) {
    directError = e instanceof ByokCallError ? e : new ByokCallError('direct call failed', false);
  }
  if (!directError.network) return { ok: false, error: describeStatus(directError.status) };
  try {
    await explainViaPassThrough(cfg, facts, 'intermediate');
    return { ok: true, via: 'server', model: byokModelOf(cfg) };
  } catch (e) {
    const status = e instanceof ByokCallError ? e.status : null;
    if (e instanceof ByokCallError && e.network) {
      return { ok: false, error: 'Could not reach the provider or the app server. Check your connection.' };
    }
    if (status === 502) return { ok: false, error: describeStatus(null) + ' (relayed via the app server — check key and model).' };
    return { ok: false, error: describeStatus(status) };
  }
}
