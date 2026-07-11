import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../config.js';

/**
 * A tiny dependency-free JSON-file store for accounts and synced progress.
 * Single-process, atomic writes (temp + rename). Point CHESSER_DATA_DIR at a
 * persistent volume in production.
 */
const DATA_DIR = process.env.CHESSER_DATA_DIR ?? path.join(REPO_ROOT, 'data');
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

class Store {
  private db: DbShape = EMPTY;

  constructor() {
    try {
      if (fs.existsSync(DB_FILE)) this.db = { ...EMPTY, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
    } catch (e) {
      console.error('[accounts] failed to load db, starting fresh:', e);
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.db));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {
      console.error('[accounts] failed to persist db:', e);
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
    this.db.sessions[token] = { userId, createdAt: Date.now() };
    this.persist();
  }

  sessionUserId(token: string): string | undefined {
    return this.db.sessions[token]?.userId;
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

  /** Full user lookup by id (export/delete flows). */
  userById(id: string): DbUser | undefined {
    for (const u of Object.values(this.db.users)) if (u.id === id) return u;
    return undefined;
  }

  /**
   * Right-to-erasure: remove the account and everything keyed to it — the
   * user record (credentials), EVERY session token, the synced progress blob
   * and the saved-games library. One persist at the end.
   */
  deleteUser(userId: string): void {
    for (const [key, u] of Object.entries(this.db.users)) {
      if (u.id === userId) delete this.db.users[key];
    }
    for (const [token, s] of Object.entries(this.db.sessions)) {
      if (s.userId === userId) delete this.db.sessions[token];
    }
    delete this.db.progress[userId];
    delete this.db.games[userId];
    this.persist();
  }
}

export const store = new Store();
