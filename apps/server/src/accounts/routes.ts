import type { FastifyInstance, FastifyRequest } from 'fastify';
import { store, type GameEntry } from './store.js';
import { hashPassword, newToken, newUserId, validateCredentials, verifyPassword } from './auth.js';
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

export function registerAccountRoutes(app: FastifyInstance): void {
  app.post('/api/auth/register', async (req, reply) => {
    const { username, password } = (req.body ?? {}) as Creds;
    const err = validateCredentials(username, password);
    if (err) return reply.code(400).send({ error: err });
    if (store.getUser(username as string)) return reply.code(409).send({ error: 'That username is taken.' });
    const { salt, hash } = hashPassword(password as string);
    const id = newUserId();
    store.createUser({ id, username: username as string, salt, hash, createdAt: Date.now() });
    const token = newToken();
    store.createSession(token, id);
    return { token, username };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const { username, password } = (req.body ?? {}) as Creds;
    if (typeof username !== 'string' || typeof password !== 'string') {
      return reply.code(400).send({ error: 'Missing credentials.' });
    }
    const user = store.getUser(username);
    if (!user || !verifyPassword(password, user.salt, user.hash)) {
      return reply.code(401).send({ error: 'Invalid username or password.' });
    }
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
