import type { FastifyInstance, FastifyRequest } from 'fastify';
import { store, type GameEntry } from './store.js';
import {
  fakeVerifyPassword,
  hashPassword,
  newToken,
  newUserId,
  validateCredentials,
  verifyPassword,
} from './auth.js';
import { AuthGuard, type AuthGuardOptions } from './guard.js';
import { validateProgress } from './progress-validator.js';

function bearer(req: FastifyRequest): string | null {
  const h = req.headers['authorization'];
  return typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : null;
}
function authUserId(req: FastifyRequest): string | null {
  const t = bearer(req);
  return t ? (store.sessionUserId(t) ?? null) : null;
}

interface Creds {
  username?: unknown;
  password?: unknown;
}

export interface AccountRouteOptions {
  /** Brute-force guard tuning (tests inject small limits + a fake clock). */
  guard?: AuthGuardOptions;
}

/**
 * Credential bodies are tiny (username ≤ 20 chars, password ≤ 512 bytes), so
 * anything past a few KiB is rejected up front with 413 instead of being
 * parsed under the global 1 MiB limit.
 */
const AUTH_BODY_LIMIT = 4096;

export function registerAccountRoutes(app: FastifyInstance, opts: AccountRouteOptions = {}): void {
  const guard = new AuthGuard(opts.guard);

  app.post('/api/auth/register', { bodyLimit: AUTH_BODY_LIMIT }, async (req, reply) => {
    if (!guard.allowRegister(req.ip)) {
      return reply
        .code(429)
        .header('retry-after', '60')
        .send({ error: 'Too many registrations — try again shortly.' });
    }
    const { username, password } = (req.body ?? {}) as Creds;
    const err = validateCredentials(username, password);
    if (err) return reply.code(400).send({ error: err });
    // Tradeoff, made deliberately: a 409 on a taken username does allow
    // enumeration, but the silent-success alternatives wreck signup UX. The
    // per-IP register bucket above bounds how fast anyone can probe.
    if (store.getUser(username as string)) return reply.code(409).send({ error: 'That username is taken.' });
    const { salt, hash } = await hashPassword(password as string);
    // Re-check after the await: a concurrent register for the same name may
    // have landed while we were hashing.
    if (store.getUser(username as string)) return reply.code(409).send({ error: 'That username is taken.' });
    const id = newUserId();
    store.createUser({ id, username: username as string, salt, hash, createdAt: Date.now() });
    const token = newToken();
    store.createSession(token, id);
    return { token, username };
  });

  app.post('/api/auth/login', { bodyLimit: AUTH_BODY_LIMIT }, async (req, reply) => {
    const { username, password } = (req.body ?? {}) as Creds;
    if (typeof username !== 'string' || typeof password !== 'string' || username.length === 0) {
      return reply.code(400).send({ error: 'Missing credentials.' });
    }
    if (!guard.allowLoginAttempt(req.ip)) {
      return reply
        .code(429)
        .header('retry-after', '60')
        .send({ error: 'Too many login attempts — try again shortly.' });
    }
    // Account lockout is keyed on the SUBMITTED username whether or not it
    // exists, so this branch can't be used to learn which usernames are real.
    const lockedMs = guard.lockedForMs(username);
    if (lockedMs > 0) {
      return reply
        .code(429)
        .header('retry-after', String(Math.ceil(lockedMs / 1000)))
        .send({ error: 'Too many failed attempts — try again later.' });
    }
    // No length pre-check here: the 512-byte cap is a REGISTRATION rule, and
    // accounts predating it (the old validator only enforced a 6-char minimum,
    // under a 1 MiB body limit) may legitimately hold a longer password — a
    // login-time reject would lock them out permanently (no password reset
    // exists). The AUTH_BODY_LIMIT (4 KiB) already bounds the input, and scrypt
    // cost is dominated by its fixed memory-hard core, not the input length, so
    // verifying a few-KiB password is not a CPU-DoS vector.
    const user = store.getUser(username);
    let ok = false;
    if (user) {
      ok = await verifyPassword(password, user.salt, user.hash);
    } else {
      // Burn the same scrypt cost as a real check so response timing doesn't
      // separate "no such user" from "wrong password".
      await fakeVerifyPassword(password);
    }
    if (!user || !ok) {
      guard.recordFailure(username);
      return reply.code(401).send({ error: 'Invalid username or password.' });
    }
    guard.recordSuccess(username);
    const token = newToken();
    store.createSession(token, user.id);
    return { token, username: user.username };
  });

  app.post('/api/auth/logout', async (req) => {
    const t = bearer(req);
    if (t) store.deleteSession(t);
    return { ok: true };
  });

  app.get('/api/me', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    return { username: store.usernameById(uid) };
  });

  app.get('/api/progress', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    const p = store.getProgress(uid);
    return { data: p?.data ?? null, updatedAt: p?.updatedAt ?? 0 };
  });

  app.put('/api/progress', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    const { data } = (req.body ?? {}) as { data?: unknown };
    // Anti-cheat: sanity-check every score-bearing claim against absolute
    // bounds, internal consistency, and plausible deltas vs the stored copy.
    // Impossible claims fail the sync; normalizable ones are clamped and the
    // adjustments reported (see accounts/progress-validator.ts).
    const verdict = validateProgress(data ?? null, store.getProgress(uid)?.data ?? null);
    if (!verdict.ok) return reply.code(400).send({ error: verdict.error });
    store.setProgress(uid, verdict.data);
    return verdict.adjustments.length > 0
      ? { ok: true, updatedAt: Date.now(), adjusted: verdict.adjustments }
      : { ok: true, updatedAt: Date.now() };
  });

  // --- game library -------------------------------------------------------
  app.get('/api/games', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    return { games: store.getGames(uid) };
  });

  app.post('/api/games', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    const b = (req.body ?? {}) as Partial<GameEntry>;
    if (typeof b.pgn !== 'string' || b.pgn.length === 0 || b.pgn.length > 100_000) {
      return reply.code(400).send({ error: 'Invalid PGN.' });
    }
    const game: GameEntry = {
      id: newToken().slice(0, 16),
      pgn: b.pgn,
      white: typeof b.white === 'string' ? b.white.slice(0, 80) : 'White',
      black: typeof b.black === 'string' ? b.black.slice(0, 80) : 'Black',
      result: typeof b.result === 'string' ? b.result.slice(0, 8) : '*',
      savedAt: Date.now(),
      source: typeof b.source === 'string' ? b.source.slice(0, 40) : undefined,
    };
    store.addGame(uid, game);
    return { game };
  });

  app.delete('/api/games/:id', async (req, reply) => {
    const uid = authUserId(req);
    if (!uid) return reply.code(401).send({ error: 'Not authenticated.' });
    store.deleteGame(uid, (req.params as { id: string }).id);
    return { ok: true };
  });
}
