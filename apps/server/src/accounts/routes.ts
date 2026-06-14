import type { FastifyInstance, FastifyRequest } from 'fastify';
import { store } from './store.js';
import { hashPassword, newToken, newUserId, validateCredentials, verifyPassword } from './auth.js';

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
    store.setProgress(uid, data ?? null);
    return { ok: true, updatedAt: Date.now() };
  });
}
