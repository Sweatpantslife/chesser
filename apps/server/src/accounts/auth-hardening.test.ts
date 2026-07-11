import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The account store persists to CHESSER_DATA_DIR at module load, so seed a
// throwaway db.json (including a LEGACY session without expiresAt) BEFORE
// importing the routes (which import the store).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chesser-auth-hardening-'));
process.env.CHESSER_DATA_DIR = dataDir;

const LEGACY_TOKEN = 'a'.repeat(64);
// A password longer than the new 512-byte cap. Such accounts could exist:
// the old validator enforced only a 6-char minimum (no upper bound) under a
// 1 MiB body limit. Login must still accept it — there is no password reset.
const LEGACY_LONG_PASSWORD = 'correct-horse-battery-staple-'.repeat(30); // ~870 bytes
fs.writeFileSync(
  path.join(dataDir, 'db.json'),
  JSON.stringify({
    users: {
      'legacy-user': {
        id: 'legacyid',
        username: 'legacy-user',
        // scryptSync('hunter22', 'legacysalt', 64) — a pre-async-migration hash.
        salt: 'legacysalt',
        hash: (await import('node:crypto')).default.scryptSync('hunter22', 'legacysalt', 64).toString('hex'),
        createdAt: 1_700_000_000_000,
      },
      'legacy-longpass': {
        id: 'legacylongid',
        username: 'legacy-longpass',
        salt: 'legacysalt2',
        hash: (await import('node:crypto')).default
          .scryptSync(LEGACY_LONG_PASSWORD, 'legacysalt2', 64)
          .toString('hex'),
        createdAt: 1_700_000_000_000,
      },
    },
    // Legacy session: no expiresAt field — must be backfilled on load.
    sessions: { [LEGACY_TOKEN]: { userId: 'legacyid', createdAt: 1_700_000_000_000 } },
    progress: {},
    games: {},
  }),
);

const { registerAccountRoutes } = await import('./routes.js');
const { store } = await import('./store.js');
const { MAX_PASSWORD_BYTES } = await import('./auth.js');
const Fastify = (await import('fastify')).default;

// Fake clock, shared by the store and the auth guard.
const t0 = Date.now();
let clock = t0;
const now = () => clock;
store._setClock(now);

const DAY = 24 * 60 * 60_000;

const app = Fastify();
registerAccountRoutes(app, {
  guard: {
    loginIpCapacity: 8,
    loginIpRefillPerMinute: 8,
    registerIpCapacity: 100,
    registerIpRefillPerMinute: 100,
    lockThreshold: 3,
    lockBaseMs: 30_000,
    lockMaxMs: 10 * 60_000,
    now,
  },
});
await app.ready();

after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

let nextIp = 1;
/** A fresh source IP, so per-account tests aren't tangled up in the IP bucket. */
function freshIp(): string {
  return `10.0.${Math.floor(nextIp / 250)}.${(nextIp++ % 250) + 1}`;
}

function login(username: string, password: string, ip = freshIp()) {
  return app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: ip, payload: { username, password } });
}

function registerUser(username: string, password = 'hunter22-pass', ip = freshIp()) {
  return app.inject({ method: 'POST', url: '/api/auth/register', remoteAddress: ip, payload: { username, password } });
}

function me(token: string) {
  return app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });
}

describe('per-IP login rate limit', () => {
  it('returns 429 once the bucket for one IP is drained; other IPs are unaffected', async () => {
    const ip = freshIp();
    // Drain the bucket (capacity 8) with a DIFFERENT username per attempt, so
    // the per-account lockout (tested separately below) stays out of the way.
    for (let i = 0; i < 8; i++) {
      const res = await login(`rl-user-${i}`, 'wrong-password-xx', ip);
      assert.equal(res.statusCode, 401);
    }
    const limited = await login('rl-user-fresh', 'wrong-password-xx', ip);
    assert.equal(limited.statusCode, 429);
    assert.ok(limited.headers['retry-after']);
    // A different IP still gets through to the (401) credential check.
    const other = await login('rl-user-other', 'wrong-password-xx', freshIp());
    assert.equal(other.statusCode, 401);
  });
});

describe('per-account lockout with exponential backoff', () => {
  it('locks after repeated failures, even with the right password, and recovers after the backoff', async () => {
    assert.equal((await registerUser('lock-user', 'correct-horse-9')).statusCode, 200);
    // 3 failures (lockThreshold) from DIFFERENT IPs → account locks anyway.
    for (let i = 0; i < 3; i++) {
      assert.equal((await login('lock-user', 'wrong-password-xx')).statusCode, 401);
    }
    const locked = await login('lock-user', 'correct-horse-9');
    assert.equal(locked.statusCode, 429);
    assert.ok(Number(locked.headers['retry-after']) <= 30);

    // Backoff elapses → correct password works again and clears the state.
    clock += 31_000;
    const ok = await login('lock-user', 'correct-horse-9');
    assert.equal(ok.statusCode, 200, ok.body);
  });

  it('doubles the lockout on the next streak (exponential backoff)', async () => {
    assert.equal((await registerUser('lock2-user', 'correct-horse-9')).statusCode, 200);
    for (let i = 0; i < 3; i++) await login('lock2-user', 'nope-nope-nope');
    // First lockout: 30s.
    clock += 31_000;
    // Second streak of failures (state remembered — lockCount is now 1).
    for (let i = 0; i < 3; i++) await login('lock2-user', 'nope-nope-nope');
    // 31s later a 30s lock would have expired — a 60s lock has not.
    clock += 31_000;
    const still = await login('lock2-user', 'correct-horse-9');
    assert.equal(still.statusCode, 429);
    clock += 30_000;
    const ok = await login('lock2-user', 'correct-horse-9');
    assert.equal(ok.statusCode, 200, ok.body);
  });

  it('behaves identically for usernames that do not exist (no enumeration via lockout)', async () => {
    for (let i = 0; i < 3; i++) {
      assert.equal((await login('no-such-user-xyz', 'wrong-password-xx')).statusCode, 401);
    }
    assert.equal((await login('no-such-user-xyz', 'wrong-password-xx')).statusCode, 429);
  });
});

describe('session lifecycle', () => {
  it('backfills a legacy token (no expiresAt) on load so it keeps working', async () => {
    const res = await me(LEGACY_TOKEN);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal((res.json() as { username: string }).username, 'legacy-user');
  });

  it('rejects a token after its TTL, and prunes it from the store', async () => {
    const reg = await registerUser('ttl-user');
    assert.equal(reg.statusCode, 200);
    const token = (reg.json() as { token: string }).token;
    assert.equal((await me(token)).statusCode, 200);

    clock += 31 * DAY; // default TTL is 30 days
    assert.equal((await me(token)).statusCode, 401);
    // Lazy prune removed it server-side, not just hid it.
    assert.equal(store.sessionUserId(token), undefined);
  });

  it('slides expiry on use: a token used regularly outlives the fixed TTL', async () => {
    const reg = await registerUser('sliding-user');
    assert.equal(reg.statusCode, 200);
    const token = (reg.json() as { token: string }).token;

    // Touch the token every 20 days for 100 days — always inside the sliding window.
    for (let i = 0; i < 5; i++) {
      clock += 20 * DAY;
      assert.equal((await me(token)).statusCode, 200, `still valid at +${(i + 1) * 20}d`);
    }
    // Then go idle past the TTL — now it dies.
    clock += 31 * DAY;
    assert.equal((await me(token)).statusCode, 401);
  });

  it('logout revokes the session server-side', async () => {
    const reg = await registerUser('logout-user');
    const token = (reg.json() as { token: string }).token;
    assert.equal((await me(token)).statusCode, 200);
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: `Bearer ${token}` } });
    assert.equal(out.statusCode, 200);
    assert.equal((await me(token)).statusCode, 401);
  });

  it('pruneExpiredSessions drops only dead sessions', async () => {
    const reg = await registerUser('prune-user');
    const token = (reg.json() as { token: string }).token;
    store.createSession('doomed-token', 'someuser');
    clock += 31 * DAY;
    store.createSession('fresh-token', 'someuser'); // also sweeps on create
    assert.equal(store.sessionUserId('doomed-token'), undefined);
    assert.equal(store.sessionUserId('fresh-token'), 'someuser');
    assert.equal(store.sessionUserId(token), undefined); // expired with the rest
  });
});

describe('input validation', () => {
  it('rejects an oversized password on register with 400, before hashing', async () => {
    const res = await registerUser('big-pass-user', 'x'.repeat(MAX_PASSWORD_BYTES + 1));
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { error: string }).error, /too long/i);
  });

  it('lets a legacy account whose password exceeds the new cap log in (no login-time length reject)', async () => {
    // The 512-byte cap is registration-only; login must not lock out a pre-cap
    // account holding a longer password (there is no reset). A WRONG long
    // password still fails the uniform 401 via the normal verify path.
    assert.ok(LEGACY_LONG_PASSWORD.length > MAX_PASSWORD_BYTES, 'fixture password is over the cap');
    const ok = await login('legacy-longpass', LEGACY_LONG_PASSWORD);
    assert.equal(ok.statusCode, 200, ok.body);
    const wrong = await login('legacy-longpass', `${LEGACY_LONG_PASSWORD}x`);
    assert.equal(wrong.statusCode, 401);
    assert.match((wrong.json() as { error: string }).error, /invalid username or password/i);
  });

  it('rejects a multi-KiB auth body outright (413)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: freshIp(),
      payload: { username: 'whoever', password: 'ok', junk: 'z'.repeat(8192) },
    });
    assert.equal(res.statusCode, 413);
  });

  it('enforces the 8-char minimum for NEW passwords only', async () => {
    const res = await registerUser('short-pass', 'seven77');
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { error: string }).error, /at least 8/i);
    // legacy-user's stored password predates the raise; login still works.
    const legacy = await login('legacy-user', 'hunter22');
    assert.equal(legacy.statusCode, 200, legacy.body);
  });

  it('rejects malformed credential types with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: freshIp(),
      payload: { username: ['a'], password: { x: 1 } },
    });
    assert.equal(res.statusCode, 400);
  });
});

describe('per-IP register rate limit', () => {
  it('throttles mass registration from one IP', async () => {
    const app2 = Fastify();
    registerAccountRoutes(app2, { guard: { registerIpCapacity: 3, registerIpRefillPerMinute: 3, now } });
    await app2.ready();
    try {
      const ip = freshIp();
      for (let i = 0; i < 3; i++) {
        const res = await app2.inject({
          method: 'POST',
          url: '/api/auth/register',
          remoteAddress: ip,
          payload: { username: `mass-reg-${i}`, password: 'hunter22-pass' },
        });
        assert.equal(res.statusCode, 200, res.body);
      }
      const limited = await app2.inject({
        method: 'POST',
        url: '/api/auth/register',
        remoteAddress: ip,
        payload: { username: 'mass-reg-3', password: 'hunter22-pass' },
      });
      assert.equal(limited.statusCode, 429);
    } finally {
      await app2.close();
    }
  });
});
