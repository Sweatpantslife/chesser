/**
 * POST /api/coach/explain — engine-truth + LLM-words.
 *
 * The client sends verified engine facts (a discriminated union: move /
 * game_summary / weakness — see @chesser/shared coach.ts); the server has an
 * LLM verbalize them. The system prompt pins the model to ONLY the provided
 * facts, so it can phrase but never invent chess content.
 *
 * Behavior contract (the web client relies on this):
 *   • no provider key      → 200 { configured: false, reason: 'no-key' }
 *   • invalid body         → 400 { error }
 *   • rate limited         → 429 { error }   (per-IP token bucket, 20/min)
 *   • provider failure     → 502 { error: 'provider-failed' }
 *   • success              → 200 { configured: true, explanation, model, cached }
 *
 * Responses are cached in a small in-memory LRU keyed on a stable hash of
 * (facts + level + provider model), 1h TTL — repeated "explain this" clicks
 * on the same move never re-bill.
 */
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CoachExplainFacts, CoachSkillLevel } from '@chesser/shared';
import { providerFromEnv, type CoachProvider } from './provider.js';

/** Hard cap on generated tokens — keeps answers short and bills bounded. */
const MAX_OUTPUT_TOKENS = 300;
/** Serialized facts larger than this are rejected (prompt cost bound). */
const MAX_FACTS_BYTES = 6_000;

// ---------------------------------------------------------------------------
// Validation — manual field checks, same style as accounts/routes.ts.
// ---------------------------------------------------------------------------

const KINDS = new Set(['move', 'game_summary', 'weakness']);
const LEVELS = new Set<string>(['beginner', 'intermediate', 'advanced']);

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrArray = (v: unknown, max: number): v is string[] =>
  Array.isArray(v) && v.length <= max && v.every((s) => typeof s === 'string' && s.length <= 300);

/** Error string, or null when the body is a valid explain request. */
export function validateExplainBody(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return 'Body must be a JSON object.';
  const { facts, level } = body as { facts?: unknown; level?: unknown };
  if (level !== undefined && !(isStr(level) && LEVELS.has(level))) return 'Invalid level.';
  if (typeof facts !== 'object' || facts === null) return 'Missing facts.';
  const f = facts as Record<string, unknown>;
  if (!isStr(f.kind) || !KINDS.has(f.kind)) return 'Invalid facts.kind.';

  try {
    if (JSON.stringify(facts).length > MAX_FACTS_BYTES) return 'Facts payload too large.';
  } catch {
    return 'Facts payload is not serializable.';
  }

  switch (f.kind) {
    case 'move':
      if (!isStr(f.fen) || f.fen.length > 100) return 'move facts need a FEN.';
      if (f.side !== 'white' && f.side !== 'black') return 'move facts need a side.';
      if (!isStr(f.san) || f.san.length === 0 || f.san.length > 12) return 'move facts need a SAN move.';
      if (!isStr(f.classification) || f.classification.length > 20) return 'move facts need a classification.';
      if (!isStrArray(f.pv ?? [], 12)) return 'move facts pv must be a short SAN list.';
      if (!isNum(f.winBefore) || !isNum(f.winAfter)) return 'move facts need win percentages.';
      return null;
    case 'game_summary':
      if (!isNum(f.accuracy) || !isNum(f.acpl) || !isNum(f.moves)) return 'game_summary facts need accuracy/acpl/moves.';
      if (!isStr(f.result) || f.result.length > 10) return 'game_summary facts need a result.';
      if (!isStrArray(f.keyMoments ?? [], 8)) return 'game_summary keyMoments must be a short list.';
      return null;
    case 'weakness':
      if (!isStr(f.label) || f.label.length === 0 || f.label.length > 60) return 'weakness facts need a label.';
      if (!isStr(f.summary) || !isStr(f.advice)) return 'weakness facts need summary and advice.';
      if (!isNum(f.count) || !isNum(f.games) || !isNum(f.totalGames)) return 'weakness facts need counts.';
      if (!isStrArray(f.examples ?? [], 5)) return 'weakness examples must be a short list.';
      return null;
    default:
      return 'Invalid facts.kind.';
  }
}

// ---------------------------------------------------------------------------
// Prompting
// ---------------------------------------------------------------------------

const LEVEL_VOICE: Record<CoachSkillLevel, string> = {
  beginner:
    'The player is a beginner: avoid jargon, explain any chess term you use in a few plain words, and keep ideas very simple.',
  intermediate:
    'The player is an intermediate club player: common chess terms (fork, pin, back rank, initiative) are fine without explanation.',
  advanced:
    'The player is advanced: be concise and precise; technical language is welcome, skip basics.',
};

export function buildSystemPrompt(level: CoachSkillLevel): string {
  return [
    'You are a friendly, encouraging chess coach inside a chess training app.',
    'You receive verified facts from a chess engine\'s analysis of the player\'s own game as compact JSON.',
    'Ground rules:',
    '- Use ONLY the provided facts. Never invent moves, evaluations, threats, tactics, openings or statistics that are not in the facts.',
    '- If a fact is missing, simply do not mention it. Never guess.',
    '- If a ruleBasedText fact is present, you may rephrase it but must not contradict it.',
    '- Speak directly to the player as "you". Be warm and constructive — name the fix, not just the fault.',
    `- ${LEVEL_VOICE[level]}`,
    '- Answer in 2-4 short sentences of plain prose. No headings, no bullet points, no emoji, no JSON.',
    '- Never mention JSON, payloads, or that you were given data.',
  ].join('\n');
}

const KIND_INSTRUCTION: Record<CoachExplainFacts['kind'], string> = {
  move: 'Explain this reviewed move to the player: what the move did, why it got its classification, and (when the facts include a better move) what the better idea was.',
  game_summary:
    'Give the player a short, encouraging coach\'s summary of this finished game: how they played overall and the one most useful takeaway.',
  weakness:
    'Coach the player about this recurring weakness from their recent games: what keeps happening and one concrete, practical habit to fix it.',
};

export function buildUserPrompt(facts: CoachExplainFacts): string {
  return `${KIND_INSTRUCTION[facts.kind]}\nFacts (verified engine analysis): ${JSON.stringify(facts)}`;
}

// ---------------------------------------------------------------------------
// LRU cache with TTL (hand-rolled; Map preserves insertion order)
// ---------------------------------------------------------------------------

interface CacheEntry {
  value: string;
  expiresAt: number;
}

export class LruCache {
  private map = new Map<string, CacheEntry>();
  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): string | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency: re-insert at the tail.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: string): void {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

/** Deterministic JSON with sorted object keys, so hashes are stable. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function cacheKey(facts: CoachExplainFacts, level: CoachSkillLevel, model: string): string {
  return crypto.createHash('sha256').update(`${facts.kind}\n${level}\n${model}\n${stableStringify(facts)}`).digest('hex');
}

// ---------------------------------------------------------------------------
// Per-IP token bucket (this route only — @fastify/rate-limit is not a dep)
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  last: number;
}

export class TokenBucketLimiter {
  private buckets = new Map<string, Bucket>();
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
    // Opportunistic sweep so idle IPs don't accumulate forever.
    if (this.buckets.size > 10_000) {
      for (const [k, v] of this.buckets) {
        if (v.tokens >= this.capacity - 0.01 && k !== key) this.buckets.delete(k);
      }
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export interface CoachRouteOptions {
  /**
   * Provider override. `undefined` → resolve from process.env at registration;
   * `null` → force the not-configured path (tests).
   */
  provider?: CoachProvider | null;
  cacheMax?: number;
  cacheTtlMs?: number;
  rateCapacity?: number;
  rateRefillPerMinute?: number;
  now?: () => number;
}

export function registerCoachRoutes(app: FastifyInstance, opts: CoachRouteOptions = {}): void {
  const provider = opts.provider === undefined ? providerFromEnv() : opts.provider;
  const now = opts.now ?? Date.now;
  const cache = new LruCache(opts.cacheMax ?? 500, opts.cacheTtlMs ?? 60 * 60 * 1000, now);
  const limiter = new TokenBucketLimiter(opts.rateCapacity ?? 20, opts.rateRefillPerMinute ?? 20, now);

  app.post('/api/coach/explain', async (req: FastifyRequest, reply) => {
    if (!limiter.take(req.ip || 'unknown')) {
      return reply.code(429).send({ error: 'Too many coach requests — try again in a minute.' });
    }

    const err = validateExplainBody(req.body);
    if (err) return reply.code(400).send({ error: err });

    if (!provider) return { configured: false, reason: 'no-key' };

    const { facts, level = 'intermediate' } = req.body as {
      facts: CoachExplainFacts;
      level?: CoachSkillLevel;
    };

    const key = cacheKey(facts, level, provider.model);
    const hit = cache.get(key);
    if (hit !== undefined) {
      return { configured: true, explanation: hit, model: provider.model, cached: true };
    }

    let explanation: string;
    try {
      explanation = await provider.complete({
        system: buildSystemPrompt(level),
        user: buildUserPrompt(facts),
        maxTokens: MAX_OUTPUT_TOKENS,
      });
    } catch (e) {
      req.log?.warn?.({ err: e }, 'coach provider failed');
      return reply.code(502).send({ error: 'provider-failed' });
    }

    cache.set(key, explanation);
    return { configured: true, explanation, model: provider.model, cached: false };
  });
}
