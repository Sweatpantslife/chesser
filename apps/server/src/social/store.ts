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

/** Atomic snapshot write (tmp + rename), fully async. */
async function writeSnapshot(json: string): Promise<void> {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  await fs.promises.writeFile(tmp, json);
  await fs.promises.rename(tmp, DB_FILE);
}

class SocialStore {
  private db: DbShape = EMPTY;
  /** Bumped on every mutation — read paths use it to cache derived views. */
  private mutations = 0;
  /** Serializes snapshot writes so they never interleave on the tmp file. */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor() {
    // Startup-only sync read: no request path exists yet.
    try {
      if (fs.existsSync(DB_FILE)) this.db = { ...EMPTY, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
    } catch (e) {
      console.error('[social] failed to load db, starting fresh:', e);
    }
  }

  /** Monotonic mutation counter — a cache-invalidation token for readers. */
  get version(): number {
    return this.mutations;
  }

  private persist(): void {
    this.mutations++;
    // Snapshot NOW (cheap: the db is small), write async off the request
    // path — no sync fs calls while serving requests. Reads are always
    // answered from memory, so correctness never depends on the disk copy;
    // the queue keeps the atomic tmp+rename writes ordered, and a later
    // snapshot simply supersedes an earlier one.
    const snapshot = JSON.stringify(this.db);
    this.writeQueue = this.writeQueue
      .then(() => writeSnapshot(snapshot))
      .catch((e) => console.error('[social] failed to persist db:', e));
  }

  /** Resolves once every queued write has hit disk (shutdown/tests). */
  flush(): Promise<void> {
    return this.writeQueue;
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
