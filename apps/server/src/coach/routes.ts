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
 *
 * BYOK pass-through: when the request carries the user's own provider key in
 * the x-coach-key header (plus x-coach-provider / x-coach-model /
 * x-coach-base-url), the route makes ONE upstream call with that key and
 * returns the prose. The pass-through is strictly STATELESS:
 *   • the key headers are removed from the request object before anything
 *     else runs, so no logger / serializer can ever see them;
 *   • the response is never written to the shared cache (and never read from
 *     it) — nothing derived from the user's key persists server-side;
 *   • provider errors are scrubbed of the key before logging.
 * It exists only as a fallback for OpenAI-compatible endpoints whose CORS
 * policy blocks the browser's direct call — the client always tries the
 * provider directly first.
 */
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CoachExplainFacts, CoachSkillLevel } from '@chesser/shared';
import { buildSystemPrompt, buildUserPrompt, COACH_MAX_OUTPUT_TOKENS } from '@chesser/shared';
import { byokProvider, providerFromEnv, validateByokBaseUrl, type ByokConfig, type CoachProvider } from './provider.js';

// Re-exported so callers/tests keep one import site for the coach pieces.
export { buildSystemPrompt, buildUserPrompt };

/** Hard cap on generated tokens — keeps answers short and bills bounded. */
const MAX_OUTPUT_TOKENS = COACH_MAX_OUTPUT_TOKENS;
/** Serialized facts larger than this are rejected (prompt cost bound). */
const MAX_FACTS_BYTES = 6_000;

// ---------------------------------------------------------------------------
// Validation — manual field checks, same style as accounts/routes.ts.
// Every field of each kind is checked (types, lengths, ranges) and unknown
// keys are rejected, so nothing beyond the documented facts shape can be
// smuggled into the LLM prompt.
// ---------------------------------------------------------------------------

const KINDS = new Set(['move', 'game_summary', 'weakness', 'weekly_report']);
const LEVELS = new Set<string>(['beginner', 'intermediate', 'advanced']);
const PHASES = new Set(['opening', 'middlegame', 'endgame']);
const SIDES = new Set(['white', 'black']);
const RESULTS = new Set(['win', 'loss', 'draw', 'unknown']);
const TRENDS = new Set(['improving', 'steady', 'worsening']);

const isStr = (v: unknown, max: number, min = 0): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;
/** null OR a string within `max`. */
const isNullableStr = (v: unknown, max: number): boolean => v === null || isStr(v, max);
const isNum = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isStrArray = (v: unknown, maxItems: number, maxLen = 300): v is string[] =>
  Array.isArray(v) && v.length <= maxItems && v.every((s) => typeof s === 'string' && s.length <= maxLen);
const isIn = (v: unknown, set: Set<string>): boolean => typeof v === 'string' && set.has(v);

const ALLOWED_KEYS: Record<string, ReadonlySet<string>> = {
  move: new Set([
    'kind', 'fen', 'side', 'moveLabel', 'san', 'classification', 'evalBefore', 'evalAfter',
    'winBefore', 'winAfter', 'bestMoveSan', 'pv', 'bestReplySan', 'phase', 'isCheck', 'isMate',
    'ruleBasedText', 'weaknessThemes',
  ]),
  game_summary: new Set([
    'kind', 'playerColor', 'result', 'accuracy', 'acpl', 'moves', 'counts', 'opening', 'phases',
    'keyMoments', 'estimatedRating',
  ]),
  weakness: new Set([
    'kind', 'label', 'summary', 'advice', 'count', 'games', 'totalGames', 'trend', 'examples',
    'accuracy', 'worstPhase',
  ]),
  weekly_report: new Set([
    'kind', 'weekLabel', 'activeDays', 'xpEarned', 'streak', 'gamesPlayed', 'wins', 'losses',
    'draws', 'bestAccuracy', 'lessonsCompleted', 'lessonStars', 'puzzleRatingDelta',
    'newRushBest', 'newStormBest', 'trainingAttempts', 'trainingSolved', 'topWeakness',
    'topWeaknessCount', 'ruleBasedText',
  ]),
};

function validateMoveFacts(f: Record<string, unknown>): string | null {
  if (!isStr(f.fen, 100, 1)) return 'move facts need a FEN.';
  if (!isIn(f.side, SIDES)) return 'move facts need a side.';
  if (!isStr(f.moveLabel, 12, 1)) return 'move facts need a moveLabel.';
  if (!isStr(f.san, 12, 1)) return 'move facts need a SAN move.';
  if (!isStr(f.classification, 20, 1)) return 'move facts need a classification.';
  if (!isNullableStr(f.evalBefore, 12) || !isNullableStr(f.evalAfter, 12)) return 'move evals must be short strings or null.';
  if (!isNum(f.winBefore, 0, 100) || !isNum(f.winAfter, 0, 100)) return 'move win percentages must be 0-100.';
  if (!isNullableStr(f.bestMoveSan, 12) || !isNullableStr(f.bestReplySan, 12)) return 'move best/reply SAN must be short strings or null.';
  if (!isStrArray(f.pv, 12, 12)) return 'move facts pv must be a short SAN list.';
  if (!isIn(f.phase, PHASES)) return 'move facts need a phase.';
  if (!isBool(f.isCheck) || !isBool(f.isMate)) return 'move isCheck/isMate must be booleans.';
  if (!isNullableStr(f.ruleBasedText, 400)) return 'move ruleBasedText must be a short string or null.';
  if (!isStrArray(f.weaknessThemes, 5, 60)) return 'move weaknessThemes must be a short list.';
  return null;
}

function validateGameSummaryFacts(f: Record<string, unknown>): string | null {
  if (f.playerColor !== null && !isIn(f.playerColor, SIDES)) return 'game_summary playerColor must be a side or null.';
  if (!isIn(f.result, RESULTS)) return 'game_summary facts need a result.';
  if (!isNum(f.accuracy, 0, 100) || !isNum(f.acpl, 0, 10_000) || !isNum(f.moves, 0, 1_000)) {
    return 'game_summary facts need accuracy/acpl/moves in range.';
  }
  const counts = f.counts;
  if (
    typeof counts !== 'object' || counts === null || Array.isArray(counts) ||
    Object.entries(counts).length > 12 ||
    !Object.entries(counts).every(([k, n]) => k.length <= 20 && isNum(n, 0, 1_000))
  ) {
    return 'game_summary counts must map classifications to small numbers.';
  }
  const opening = f.opening as Record<string, unknown> | null;
  if (opening !== null) {
    if (typeof opening !== 'object' || Array.isArray(opening)) return 'game_summary opening must be an object or null.';
    const keys = Object.keys(opening);
    if (keys.length > 2 || keys.some((k) => k !== 'eco' && k !== 'name')) return 'game_summary opening has unexpected fields.';
    if (!isNullableStr(opening.eco ?? null, 8) || !isNullableStr(opening.name ?? null, 120)) return 'game_summary opening eco/name too long.';
  }
  const phases = f.phases;
  if (
    !Array.isArray(phases) || phases.length > 3 ||
    !phases.every(
      (p: unknown) =>
        typeof p === 'object' && p !== null &&
        Object.keys(p).every((k) => k === 'phase' || k === 'accuracy') &&
        isIn((p as Record<string, unknown>).phase, PHASES) &&
        isNum((p as Record<string, unknown>).accuracy, 0, 100),
    )
  ) {
    return 'game_summary phases must be phase/accuracy pairs.';
  }
  if (!isStrArray(f.keyMoments, 8, 300)) return 'game_summary keyMoments must be a short list.';
  if (f.estimatedRating !== null && !isNum(f.estimatedRating, 0, 4_000)) return 'game_summary estimatedRating must be a rating or null.';
  return null;
}

function validateWeaknessFacts(f: Record<string, unknown>): string | null {
  if (!isStr(f.label, 60, 1)) return 'weakness facts need a label.';
  if (!isStr(f.summary, 400, 1) || !isStr(f.advice, 400, 1)) return 'weakness facts need summary and advice.';
  if (!isNum(f.count, 0, 10_000) || !isNum(f.games, 0, 10_000) || !isNum(f.totalGames, 0, 10_000)) {
    return 'weakness facts need counts in range.';
  }
  if (f.trend !== null && !isIn(f.trend, TRENDS)) return 'weakness trend must be a known trend or null.';
  if (!isStrArray(f.examples, 5, 300)) return 'weakness examples must be a short list.';
  if (!isNum(f.accuracy, 0, 100)) return 'weakness accuracy must be 0-100.';
  if (f.worstPhase !== null && !isIn(f.worstPhase, PHASES)) return 'weakness worstPhase must be a phase or null.';
  return null;
}

function validateWeeklyReportFacts(f: Record<string, unknown>): string | null {
  if (!isStr(f.weekLabel, 40, 1)) return 'weekly_report facts need a weekLabel.';
  if (!isNum(f.activeDays, 0, 7)) return 'weekly_report activeDays must be 0-7.';
  if (!isNum(f.xpEarned, 0, 1_000_000) || !isNum(f.streak, 0, 100_000)) return 'weekly_report xp/streak out of range.';
  if (
    !isNum(f.gamesPlayed, 0, 10_000) || !isNum(f.wins, 0, 10_000) ||
    !isNum(f.losses, 0, 10_000) || !isNum(f.draws, 0, 10_000)
  ) {
    return 'weekly_report game counts out of range.';
  }
  if (f.bestAccuracy !== null && !isNum(f.bestAccuracy, 0, 100)) return 'weekly_report bestAccuracy must be 0-100 or null.';
  if (!isNum(f.lessonsCompleted, 0, 10_000) || !isNum(f.lessonStars, 0, 30_000)) return 'weekly_report lesson counts out of range.';
  if (f.puzzleRatingDelta !== null && !isNum(f.puzzleRatingDelta, -4_000, 4_000)) return 'weekly_report puzzleRatingDelta out of range.';
  if (f.newRushBest !== null && !isNum(f.newRushBest, 0, 10_000)) return 'weekly_report newRushBest out of range.';
  if (f.newStormBest !== null && !isNum(f.newStormBest, 0, 1_000_000)) return 'weekly_report newStormBest out of range.';
  if (!isNum(f.trainingAttempts, 0, 100_000) || !isNum(f.trainingSolved, 0, 100_000)) return 'weekly_report training counts out of range.';
  if (!isNullableStr(f.topWeakness, 60)) return 'weekly_report topWeakness must be a short string or null.';
  if (!isNum(f.topWeaknessCount, 0, 10_000)) return 'weekly_report topWeaknessCount out of range.';
  if (!isNullableStr(f.ruleBasedText, 600)) return 'weekly_report ruleBasedText must be a short string or null.';
  return null;
}

/** Error string, or null when the body is a valid explain request. */
export function validateExplainBody(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return 'Body must be a JSON object.';
  const { facts, level } = body as { facts?: unknown; level?: unknown };
  if (level !== undefined && !isIn(level, LEVELS)) return 'Invalid level.';
  if (typeof facts !== 'object' || facts === null || Array.isArray(facts)) return 'Missing facts.';
  const f = facts as Record<string, unknown>;
  if (typeof f.kind !== 'string' || !KINDS.has(f.kind)) return 'Invalid facts.kind.';

  const allowed = ALLOWED_KEYS[f.kind]!;
  for (const key of Object.keys(f)) {
    if (!allowed.has(key)) return `Unexpected facts field "${key}".`;
  }

  try {
    if (JSON.stringify(facts).length > MAX_FACTS_BYTES) return 'Facts payload too large.';
  } catch {
    return 'Facts payload is not serializable.';
  }

  switch (f.kind) {
    case 'move':
      return validateMoveFacts(f);
    case 'game_summary':
      return validateGameSummaryFacts(f);
    case 'weakness':
      return validateWeaknessFacts(f);
    case 'weekly_report':
      return validateWeeklyReportFacts(f);
    default:
      return 'Invalid facts.kind.';
  }
}

// ---------------------------------------------------------------------------
// (Prompting lives in @chesser/shared coachPrompts.ts — shared with the
// browser's BYOK direct-call path so both produce identical prompts.)

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
}

// ---------------------------------------------------------------------------
// BYOK pass-through helpers
// ---------------------------------------------------------------------------

/** Request headers carrying the user's own key + provider choice. */
export const BYOK_KEY_HEADER = 'x-coach-key';
export const BYOK_PROVIDER_HEADER = 'x-coach-provider';
export const BYOK_MODEL_HEADER = 'x-coach-model';
export const BYOK_BASE_URL_HEADER = 'x-coach-base-url';

/**
 * Read a header once and DELETE it from the request object, so nothing later
 * in the request lifecycle (error serializers, hooks, loggers) can see it.
 */
function takeHeader(req: FastifyRequest, name: string): string | null {
  const raw = req.headers[name];
  delete req.headers[name];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return raw;
}

/** Replace every occurrence of `secret` in a message — logging defense in depth. */
export function scrubSecret(message: string, secret: string): string {
  if (!secret) return message;
  return message.split(secret).join('[redacted]');
}

/** Parsed BYOK headers: a rejection, or a config (null = no key sent). */
function byokConfigFromHeaders(req: FastifyRequest): { ok: false; error: string } | { ok: true; config: ByokConfig | null } {
  const apiKey = takeHeader(req, BYOK_KEY_HEADER);
  const provider = takeHeader(req, BYOK_PROVIDER_HEADER);
  const model = takeHeader(req, BYOK_MODEL_HEADER);
  const baseUrl = takeHeader(req, BYOK_BASE_URL_HEADER);
  if (apiKey === null) return { ok: true, config: null };
  if (apiKey.length < 8 || apiKey.length > 512 || !/^[\x21-\x7e]+$/.test(apiKey)) {
    return { ok: false, error: 'Invalid user API key format.' };
  }
  const prov = provider ?? 'anthropic';
  if (prov !== 'anthropic' && prov !== 'openai') return { ok: false, error: 'Unknown BYOK provider.' };
  if (model !== null && model.length > 120) return { ok: false, error: 'Model name too long.' };
  if (baseUrl !== null) {
    if (prov !== 'openai') return { ok: false, error: 'Base URL is only supported for OpenAI-compatible providers.' };
    const urlErr = validateByokBaseUrl(baseUrl);
    if (urlErr) return { ok: false, error: urlErr };
  }
  return { ok: true, config: { provider: prov, apiKey, model: model ?? '', baseUrl: baseUrl ?? '' } };
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

  // Cheap probe for the client's "do AI features light up?" logic: true when
  // the OPERATOR configured an env key (self-hosters). BYOK availability is
  // purely client-side knowledge and never reaches this endpoint.
  app.get('/api/coach/status', async () => ({ configured: provider !== null }));

  app.post('/api/coach/explain', async (req: FastifyRequest, reply) => {
    // Strip the user-key headers off the request FIRST — before rate-limit
    // rejections, validation errors or anything else that might serialize the
    // request — so the key cannot leak into logs on any path.
    const byok = byokConfigFromHeaders(req);

    if (!limiter.take(req.ip || 'unknown')) {
      return reply.code(429).send({ error: 'Too many coach requests — try again in a minute.' });
    }

    const err = validateExplainBody(req.body);
    if (err) return reply.code(400).send({ error: err });
    if (!byok.ok) return reply.code(400).send({ error: byok.error });

    const { facts, level = 'intermediate' } = req.body as {
      facts: CoachExplainFacts;
      level?: CoachSkillLevel;
    };

    // ---- BYOK pass-through: one upstream call, no cache, key never stored.
    if (byok.config) {
      const userProvider = byokProvider(byok.config);
      try {
        const explanation = await userProvider.complete({
          system: buildSystemPrompt(level),
          user: buildUserPrompt(facts),
          maxTokens: MAX_OUTPUT_TOKENS,
        });
        return { configured: true, explanation, model: userProvider.model, cached: false };
      } catch (e) {
        // Log a scrubbed plain message only — never the error object, whose
        // properties could carry request internals alongside the message.
        const message = scrubSecret(e instanceof Error ? e.message : String(e), byok.config.apiKey);
        req.log?.warn?.({ provider: byok.config.provider, message }, 'coach byok pass-through failed');
        return reply.code(502).send({ error: 'provider-failed' });
      }
    }

    // ---- Operator env-key path (self-hosters), unchanged behavior.
    if (!provider) return { configured: false, reason: 'no-key' };

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
