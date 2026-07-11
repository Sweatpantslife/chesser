import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../config.js';
import { logger } from '../logging.js';

/**
 * A tiny dependency-free JSON-file store for accounts and synced progress.
 * Single-process, atomic writes (temp + rename). Point CHESSER_DATA_DIR at a
 * persistent volume in production.
 */
export const DATA_DIR = process.env.CHESSER_DATA_DIR ?? path.join(REPO_ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

export interface DbUser {
  id: string;
  username: string;
  salt: string;
  hash: string;
  createdAt: number;
}
export interface DbSession {
  userId: string;
  createdAt: number;
  /**
   * Epoch ms after which the token is dead. Sessions written before this
   * field existed are backfilled to load-time + TTL, so tokens already in
   * users' localStorage keep working (and finally age out).
   */
  expiresAt: number;
}
interface DbProgress {
  data: unknown;
  updatedAt: number;
}
export interface GameEntry {
  id: string;
  pgn: string;
  white: string;
  black: string;
  result: string;
  savedAt: number;
  source?: string;
}
interface DbShape {
  users: Record<string, DbUser>; // keyed by lowercased username
  sessions: Record<string, DbSession>; // keyed by token
  progress: Record<string, DbProgress>; // keyed by userId
  games: Record<string, GameEntry[]>; // keyed by userId
}

const EMPTY: DbShape = { users: {}, sessions: {}, progress: {}, games: {} };
const MAX_GAMES = 300;

/**
 * Session lifetime. Sliding: each authenticated use pushes expiry back out to
 * now + TTL (persisted at most once per RENEW_MIN_INTERVAL_MS per token, so
 * routine requests don't rewrite db.json). CHESSER_SESSION_TTL_DAYS overrides.
 */
const SESSION_TTL_MS = Math.max(1, Number(process.env.CHESSER_SESSION_TTL_DAYS) || 30) * 24 * 60 * 60_000;
const RENEW_MIN_INTERVAL_MS = 24 * 60 * 60_000;

class Store {
  private db: DbShape = EMPTY;
  private now: () => number = Date.now;

  constructor() {
    try {
      if (fs.existsSync(DB_FILE)) this.db = { ...EMPTY, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
    } catch (e) {
      logger.error({ err: e }, '[accounts] failed to load db, starting fresh');
    }
    // Backfill legacy sessions (pre-expiry) so existing logins survive the
    // upgrade, and drop anything already expired. Persist only on change.
    const t = this.now();
    let changed = false;
    for (const [token, s] of Object.entries(this.db.sessions)) {
      if (typeof s.expiresAt !== 'number' || !Number.isFinite(s.expiresAt)) {
        s.expiresAt = t + SESSION_TTL_MS;
        changed = true;
      } else if (s.expiresAt <= t) {
        delete this.db.sessions[token];
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  /** Test hook: inject a fake clock (expiry/renewal logic only). */
  _setClock(now: () => number): void {
    this.now = now;
  }

  private persist(): void {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.db));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {
      logger.error({ err: e }, '[accounts] failed to persist db');
    }
  }

  getUser(username: string): DbUser | undefined {
    return this.db.users[username.toLowerCase()];
  }

  usernameById(id: string): string | undefined {
    for (const u of Object.values(this.db.users)) if (u.id === id) return u.username;
    return undefined;
  }

  createUser(user: DbUser): void {
    this.db.users[user.username.toLowerCase()] = user;
    this.persist();
  }

  createSession(token: string, userId: string): void {
    const t = this.now();
    // Every login is a natural moment to shed dead sessions — keeps db.json
    // bounded without a timer (expired tokens are also dropped lazily on use).
    this.pruneExpiredSessions(t);
    this.db.sessions[token] = { userId, createdAt: t, expiresAt: t + SESSION_TTL_MS };
    this.persist();
  }

  sessionUserId(token: string): string | undefined {
    const s = this.db.sessions[token];
    if (!s) return undefined;
    const t = this.now();
    if (s.expiresAt <= t) {
      delete this.db.sessions[token];
      this.persist();
      return undefined;
    }
    // Sliding renewal: push expiry back out to now + TTL, but persist at most
    // once per RENEW_MIN_INTERVAL_MS per token so reads stay write-free.
    if (s.expiresAt < t + SESSION_TTL_MS - RENEW_MIN_INTERVAL_MS) {
      s.expiresAt = t + SESSION_TTL_MS;
      this.persist();
    }
    return s.userId;
  }

  /** Drop expired sessions; returns how many were removed. Persists via the caller's flow. */
  pruneExpiredSessions(t: number = this.now()): number {
    let removed = 0;
    for (const [token, s] of Object.entries(this.db.sessions)) {
      if (s.expiresAt <= t) {
        delete this.db.sessions[token];
        removed += 1;
      }
    }
    return removed;
  }

  deleteSession(token: string): void {
    if (this.db.sessions[token]) {
      delete this.db.sessions[token];
      this.persist();
    }
  }

  getProgress(userId: string): DbProgress | undefined {
    return this.db.progress[userId];
  }

  setProgress(userId: string, data: unknown): void {
    this.db.progress[userId] = { data, updatedAt: Date.now() };
    this.persist();
  }

  getGames(userId: string): GameEntry[] {
    return this.db.games[userId] ?? [];
  }

  addGame(userId: string, game: GameEntry): void {
    const list = this.db.games[userId] ?? [];
    list.unshift(game);
    this.db.games[userId] = list.slice(0, MAX_GAMES);
    this.persist();
  }

  deleteGame(userId: string, id: string): void {
    const list = this.db.games[userId];
    if (!list) return;
    this.db.games[userId] = list.filter((g) => g.id !== id);
    this.persist();
  }
}

export const store = new Store();
