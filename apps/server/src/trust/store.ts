import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../config.js';

/**
 * JSON-file store for the trust layer: abuse reports filed against public
 * profiles, kept for later human review. Lives in its own file (trust.json)
 * next to the accounts/social dbs — same single-process async atomic-write
 * pattern as social/store.ts, without touching either store's schema.
 *
 * Data-minimization: a report stores exactly what review needs — who filed it
 * (account id), who it targets (account id + the display name as seen at
 * report time), a category, an optional bounded note, and a timestamp.
 */
const DATA_DIR = process.env.CHESSER_DATA_DIR ?? path.join(REPO_ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'trust.json');

export const REPORT_REASONS = ['inappropriate-name', 'harassment', 'cheating', 'impersonation', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const isReportReason = (v: unknown): v is ReportReason =>
  typeof v === 'string' && (REPORT_REASONS as readonly string[]).includes(v);

export const REPORT_LIMITS = {
  /** Optional free-text note cap. */
  detailsMax: 500,
  /** Min spacing between reports per reporter. */
  intervalMs: 30_000,
  /** One report per reporter+target within this window (repeats are no-ops). */
  dedupeWindowMs: 24 * 60 * 60 * 1000,
  /** Stored reports cap — oldest are dropped first. */
  maxStored: 5_000,
} as const;

export interface ReportRec {
  id: string;
  reporterId: string;
  targetId: string;
  /** Display name at report time (review works even if the name changes). */
  targetUsername: string;
  reason: ReportReason;
  details?: string;
  at: number;
}

interface DbShape {
  reports: ReportRec[];
}

const EMPTY: DbShape = { reports: [] };

/** Atomic snapshot write (tmp + rename), fully async. */
async function writeSnapshot(json: string): Promise<void> {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  await fs.promises.writeFile(tmp, json);
  await fs.promises.rename(tmp, DB_FILE);
}

class TrustStore {
  private db: DbShape = EMPTY;
  /** Latest not-yet-written snapshot; superseded in place by newer ones. */
  private pending: string | null = null;
  /** The active drain loop (also what flush() awaits). */
  private writer: Promise<void> = Promise.resolve();
  private writing = false;

  constructor() {
    // Startup-only sync read: no request path exists yet.
    try {
      if (fs.existsSync(DB_FILE)) this.db = { ...EMPTY, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
    } catch (e) {
      console.error('[trust] failed to load db, starting fresh:', e);
    }
  }

  private persist(): void {
    // Same async coalescing write as social/store.ts: snapshot NOW (cheap:
    // the db is small), write off the request path — no sync fs calls while
    // serving requests. Reads are always answered from memory, and `pending`
    // holds only the newest snapshot, so a mutation burst keeps at most one
    // snapshot waiting behind the in-flight write.
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
          console.error('[trust] failed to persist db:', e);
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

  addReport(rec: ReportRec): void {
    this.db.reports.push(rec);
    if (this.db.reports.length > REPORT_LIMITS.maxStored) {
      this.db.reports = this.db.reports.slice(-REPORT_LIMITS.maxStored);
    }
    this.persist();
  }

  /** Epoch ms of the reporter's most recent report, or 0. */
  lastReportAt(reporterId: string): number {
    let last = 0;
    for (const r of this.db.reports) if (r.reporterId === reporterId && r.at > last) last = r.at;
    return last;
  }

  /** True when reporter already reported target within the dedupe window. */
  hasRecentReport(reporterId: string, targetId: string, nowMs: number): boolean {
    return this.db.reports.some(
      (r) => r.reporterId === reporterId && r.targetId === targetId && nowMs - r.at < REPORT_LIMITS.dedupeWindowMs,
    );
  }

  /** Reports filed BY a user (their own data — included in the export). */
  reportsBy(reporterId: string): ReportRec[] {
    return this.db.reports.filter((r) => r.reporterId === reporterId);
  }

  /** All stored reports (review tooling / tests). */
  allReports(): ReportRec[] {
    return [...this.db.reports];
  }

  /** Right-to-erasure: drop every report the user filed or that targets them. */
  deleteUser(userId: string): void {
    const before = this.db.reports.length;
    this.db.reports = this.db.reports.filter((r) => r.reporterId !== userId && r.targetId !== userId);
    if (this.db.reports.length !== before) this.persist();
  }
}

export const trustStore = new TrustStore();
