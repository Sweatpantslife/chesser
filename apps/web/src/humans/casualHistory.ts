/**
 * Casual (human-vs-human) game results. These are intentionally kept out of
 * the rating system — pass-and-play and friend games are unrated — but we
 * still record them locally so players can see their recent casual games.
 */

export interface CasualGameRecord {
  at: number; // epoch ms
  mode: 'local' | 'online';
  winner: 'white' | 'black' | 'draw';
  reason: string;
  moves: number; // full moves
  white: string;
  black: string;
  /** Dedupe key (e.g. the online room code) so refreshes don't double-log. */
  key?: string;
}

const KEY = 'chesser.casualGames.v1';
const MAX = 30;

export function listCasualGames(): CasualGameRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as CasualGameRecord[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function recordCasualGame(rec: CasualGameRecord): void {
  try {
    const existing = listCasualGames();
    if (rec.key && existing.some((g) => g.key === rec.key)) return; // already logged
    const arr = [rec, ...existing].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(arr));
  } catch {
    /* storage full / private mode — losing the casual log is fine */
  }
}
