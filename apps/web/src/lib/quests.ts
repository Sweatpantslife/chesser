/**
 * Daily quests — pure logic, no stores, no clock. A small catalogue of
 * objectives; every day a deterministic slate of DAILY_QUEST_COUNT quests is
 * drawn from it, seeded ONLY by the `YYYY-MM-DD` day key (from lib/clock's
 * todayStr), so every device — and every test — sees the same slate for the
 * same date.
 *
 * Progress is fed by the activity stream: lib/gamify.ts calls the quest store
 * with one `Activity` per record* event, and each quest measures what that
 * activity contributes. Persistence/sync live in store/quests.ts.
 */
import type { GameOutcome } from '../store/ratings';

/** One gamified thing the player just did (mirrors the record* wrappers). */
export type Activity =
  | { type: 'puzzle'; success: boolean }
  | { type: 'review'; correct: boolean }
  | { type: 'game'; outcome: GameOutcome }
  | { type: 'lesson'; firstTime: boolean }
  | { type: 'rush'; score: number }
  | { type: 'storm'; solved: number; score: number };

/** Rotation buckets — a day's slate never has two quests from one group. */
export type QuestGroup = 'puzzle' | 'game' | 'lesson' | 'review' | 'rush' | 'storm';

export interface QuestDef {
  id: string;
  group: QuestGroup;
  name: string;
  desc: string;
  icon: string;
  target: number;
  /** XP paid on completion (passive — doesn't tick the streak). */
  xp: number;
  /** 'sum' accumulates contributions; 'max' keeps the best single value (e.g. a rush score). */
  mode: 'sum' | 'max';
  /** What `a` contributes toward the target (0 = irrelevant activity). */
  measure(a: Activity): number;
}

export const DAILY_QUEST_COUNT = 3;
/** Bonus XP for finishing every quest on the slate the same day. */
export const ALL_QUESTS_BONUS_XP = 30;

const solved = (a: Activity) => (a.type === 'puzzle' && a.success ? 1 : 0);
const reviewed = (a: Activity) => (a.type === 'review' ? 1 : 0);
const played = (a: Activity) => (a.type === 'game' ? 1 : 0);

export const QUEST_CATALOGUE: QuestDef[] = [
  // — Tactics —
  { id: 'quest-puzzles-3', group: 'puzzle', name: 'Sharp Eyes', desc: 'Solve 3 tactics puzzles.', icon: '🎯', target: 3, xp: 20, mode: 'sum', measure: solved },
  { id: 'quest-puzzles-5', group: 'puzzle', name: 'Puzzle Spree', desc: 'Solve 5 tactics puzzles.', icon: '🧩', target: 5, xp: 30, mode: 'sum', measure: solved },
  // — Play —
  { id: 'quest-game-play', group: 'game', name: 'Face a Bot', desc: 'Play a game against a bot.', icon: '♟️', target: 1, xp: 15, mode: 'sum', measure: played },
  { id: 'quest-game-win', group: 'game', name: 'Claim a Crown', desc: 'Win a game against a bot.', icon: '👑', target: 1, xp: 25, mode: 'sum', measure: (a) => (a.type === 'game' && a.outcome === 'win' ? 1 : 0) },
  { id: 'quest-games-2', group: 'game', name: 'Double Header', desc: 'Play 2 games against the bots.', icon: '🎮', target: 2, xp: 25, mode: 'sum', measure: played },
  // — Learn —
  { id: 'quest-lesson', group: 'lesson', name: 'Daily Lesson', desc: 'Complete a lesson on the Learn tab.', icon: '🎓', target: 1, xp: 20, mode: 'sum', measure: (a) => (a.type === 'lesson' ? 1 : 0) },
  // — Reviews (openings · mates · anti-blunder decks) —
  { id: 'quest-reviews-5', group: 'review', name: 'Memory Lane', desc: 'Do 5 flashcard reviews.', icon: '🧠', target: 5, xp: 15, mode: 'sum', measure: reviewed },
  { id: 'quest-reviews-10', group: 'review', name: 'Deck Dive', desc: 'Do 10 flashcard reviews.', icon: '🃏', target: 10, xp: 25, mode: 'sum', measure: reviewed },
  // — Puzzle rush —
  { id: 'quest-rush-run', group: 'rush', name: 'Beat the Clock', desc: 'Finish a Puzzle Rush round.', icon: '⏱️', target: 1, xp: 15, mode: 'sum', measure: (a) => (a.type === 'rush' ? 1 : 0) },
  { id: 'quest-rush-10', group: 'rush', name: 'Rush to Ten', desc: 'Score 10+ in a single Puzzle Rush round.', icon: '🏃', target: 10, xp: 25, mode: 'max', measure: (a) => (a.type === 'rush' ? a.score : 0) },
  // — Puzzle storm —
  { id: 'quest-storm-run', group: 'storm', name: 'Weather the Storm', desc: 'Finish a Puzzle Storm run.', icon: '🌩️', target: 1, xp: 15, mode: 'sum', measure: (a) => (a.type === 'storm' ? 1 : 0) },
  { id: 'quest-storm-100', group: 'storm', name: 'Thunderstruck', desc: 'Score 100+ points in a single Puzzle Storm run.', icon: '⚡', target: 100, xp: 25, mode: 'max', measure: (a) => (a.type === 'storm' ? a.score : 0) },
];

export const QUESTS_BY_ID: Record<string, QuestDef> = Object.fromEntries(QUEST_CATALOGUE.map((q) => [q.id, q]));

// — Deterministic rotation: fnv1a(day) seeds a tiny PRNG that shuffles the
//   catalogue; the slate is the first DAILY_QUEST_COUNT quests with distinct
//   groups. Same day string → same slate, everywhere. —

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The day's quest slate — pure function of the `YYYY-MM-DD` key. */
export function questsForDay(day: string): QuestDef[] {
  const rand = mulberry32(fnv1a(`quests:${day}`));
  const pool = [...QUEST_CATALOGUE];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const slate: QuestDef[] = [];
  const groups = new Set<QuestGroup>();
  for (const q of pool) {
    if (groups.has(q.group)) continue;
    slate.push(q);
    groups.add(q.group);
    if (slate.length === DAILY_QUEST_COUNT) break;
  }
  return slate;
}

/** Progress value for `q` after `a`, given the previous value. */
export function questValueAfter(q: QuestDef, prev: number, a: Activity): number {
  const m = q.measure(a);
  if (m <= 0) return prev;
  return q.mode === 'sum' ? prev + m : Math.max(prev, m);
}
