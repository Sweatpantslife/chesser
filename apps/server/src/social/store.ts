import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../config.js';
import { DEFAULT_PREFS, type BoardEntry, type BoardId, type FavoriteOpening, type SocialPrefs } from './validation.js';

/**
 * JSON-file store for the social layer: leaderboard entries, share prefs and
 * the cosmetic profile extras. Kept in its own file (social.json) next to the
 * accounts db — same single-process atomic-write pattern as accounts/store.ts,
 * without touching that store's schema.
 */
const DATA_DIR = process.env.CHESSER_DATA_DIR ?? path.join(REPO_ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'social.json');

export interface UserSocial {
  prefs: SocialPrefs;
  boards: Partial<Record<BoardId, BoardEntry>>;
  favoriteOpenings: FavoriteOpening[];
}

interface DbShape {
  users: Record<string, UserSocial>; // keyed by userId
}

const EMPTY: DbShape = { users: {} };

function freshUser(): UserSocial {
  return { prefs: { ...DEFAULT_PREFS }, boards: {}, favoriteOpenings: [] };
}

class SocialStore {
  private db: DbShape = EMPTY;

  constructor() {
    try {
      if (fs.existsSync(DB_FILE)) this.db = { ...EMPTY, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
    } catch (e) {
      console.error('[social] failed to load db, starting fresh:', e);
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.db));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {
      console.error('[social] failed to persist db:', e);
    }
  }

  /** Read a user's social record (defaults when they've never opted in). */
  get(userId: string): UserSocial {
    const u = this.db.users[userId];
    if (!u) return freshUser();
    // Older records may predate a pref key; overlay onto the defaults.
    return { ...freshUser(), ...u, prefs: { ...DEFAULT_PREFS, ...u.prefs } };
  }

  setPrefs(userId: string, prefs: SocialPrefs): void {
    const u = this.db.users[userId] ?? freshUser();
    this.db.users[userId] = { ...u, prefs };
    this.persist();
  }

  setFavoriteOpenings(userId: string, favoriteOpenings: FavoriteOpening[]): void {
    const u = this.db.users[userId] ?? freshUser();
    this.db.users[userId] = { ...u, favoriteOpenings };
    this.persist();
  }

  setBoardEntry(userId: string, board: BoardId, entry: BoardEntry): void {
    const u = this.db.users[userId] ?? freshUser();
    this.db.users[userId] = { ...u, boards: { ...u.boards, [board]: entry } };
    this.persist();
  }

  /** Every (userId, record) pair — the leaderboard query walks this. */
  all(): [string, UserSocial][] {
    return Object.entries(this.db.users).map(([id, u]) => [id, { ...freshUser(), ...u, prefs: { ...DEFAULT_PREFS, ...u.prefs } }]);
  }
}

export const socialStore = new SocialStore();
