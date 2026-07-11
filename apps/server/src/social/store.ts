import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../config.js';
import { logger } from '../logging.js';
import { DEFAULT_PREFS, type BoardEntry, type BoardId, type FavoriteOpening, type SocialPrefs } from './validation.js';
import { freshGraph, type FriendGraph } from './friends.js';

/**
 * JSON-file store for the social layer: leaderboard entries, share prefs, the
 * cosmetic profile extras, and the friends/challenges graph. Kept in its own
 * file (social.json) next to the accounts db — same single-process
 * atomic-write pattern as accounts/store.ts, without touching that store's
 * schema.
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
  graph: FriendGraph; // friends + requests + challenges
}

const emptyDb = (): DbShape => ({ users: {}, graph: freshGraph() });

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
  private db: DbShape = emptyDb();
  /** Bumped on every mutation — read paths use it to cache derived views. */
  private mutations = 0;
  /** Latest not-yet-written snapshot; superseded in place by newer ones. */
  private pending: string | null = null;
  /** The active drain loop (also what flush() awaits). */
  private writer: Promise<void> = Promise.resolve();
  private writing = false;

  constructor() {
    // Startup-only sync read: no request path exists yet.
    try {
      if (fs.existsSync(DB_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as Partial<DbShape>;
        // Overlay onto fresh defaults so files that predate a section (e.g.
        // `graph`) load cleanly — and never alias the shared EMPTY object.
        this.db = { users: parsed.users ?? {}, graph: { ...freshGraph(), ...(parsed.graph ?? {}) } };
      }
    } catch (e) {
      logger.error({ err: e }, '[social] failed to load db, starting fresh');
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
    // answered from memory, so correctness never depends on the disk copy.
    // Writes COALESCE: `pending` always holds only the newest snapshot, so a
    // mutation burst keeps at most one snapshot string waiting behind the
    // in-flight write instead of queueing one write per mutation.
    this.pending = JSON.stringify(this.db);
    if (!this.writing) this.writer = this.drain();
  }

  private async drain(): Promise<void> {
    this.writing = true;
    try {
      while (this.pending !== null) {
        const snapshot = this.pending;
        this.pending = null;
        try {
          await writeSnapshot(snapshot);
        } catch (e) {
          logger.error({ err: e }, '[social] failed to persist db');
        }
      }
    } finally {
      this.writing = false;
    }
  }

  /** Resolves once every queued write has hit disk (shutdown/tests). */
  flush(): Promise<void> {
    return this.writer;
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

  // --- friends / challenges graph -------------------------------------------

  /**
   * The live friends/challenges graph. READ-ONLY by convention: mutate only
   * through {@link updateGraph} so every change is persisted and versioned.
   */
  graph(): FriendGraph {
    return this.db.graph;
  }

  /** Apply a mutation to the graph and persist it. */
  updateGraph(fn: (g: FriendGraph) => void): void {
    fn(this.db.graph);
    this.persist();
  }

  /**
   * Right-to-erasure: drop the user's social record (prefs, board entries,
   * favorite openings). Graph removal is the caller's job via updateGraph +
   * friends.purgeUser — kept separate so this store stays schema-agnostic
   * about the graph's internals.
   */
  deleteUser(userId: string): void {
    if (!(userId in this.db.users)) return;
    delete this.db.users[userId];
    this.persist();
  }
}

export const socialStore = new SocialStore();
