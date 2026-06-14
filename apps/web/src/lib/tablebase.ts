import type { TablebaseCategory, TablebaseResult } from '@chesser/shared';

const cache = new Map<string, TablebaseResult>();

/** Query the server's tablebase proxy. Returns `available:false` on any failure. */
export async function fetchTablebase(fen: string): Promise<TablebaseResult> {
  const hit = cache.get(fen);
  if (hit) return hit;
  try {
    const res = await fetch(`/api/tablebase?fen=${encodeURIComponent(fen)}`);
    const data = (await res.json()) as TablebaseResult;
    cache.set(fen, data);
    return data;
  } catch {
    return { available: false, reason: 'fetch-failed' };
  }
}

export function categoryLabel(cat: TablebaseCategory | undefined, dtm: number | null | undefined): string {
  switch (cat) {
    case 'win':
      return dtm ? `Tablebase: win, mate in ${Math.abs(dtm)}` : 'Tablebase: winning';
    case 'loss':
      return dtm ? `Tablebase: loss, mated in ${Math.abs(dtm)}` : 'Tablebase: losing';
    case 'draw':
      return 'Tablebase: drawn';
    case 'cursed-win':
      return 'Tablebase: win (50-move rule looms)';
    case 'blessed-loss':
      return 'Tablebase: loss (saved by 50-move rule)';
    default:
      return 'Tablebase: unknown';
  }
}

const WIN_CATS: TablebaseCategory[] = ['win', 'cursed-win'];
const DRAW_CATS: TablebaseCategory[] = ['draw', 'cursed-win', 'blessed-loss'];

/** Rate a played move against the pre-move tablebase data (mover POV). */
export function judgeMove(
  before: TablebaseResult,
  uci: string,
  goal: 'win' | 'draw',
): { kind: 'ok' | 'good' | 'bad'; text: string } | null {
  if (!before.available || !before.moves || before.moves.length === 0) return null;
  const best = before.moves[0]!;
  const played = before.moves.find((m) => m.uci === uci);
  if (!played) return null;

  if (goal === 'win') {
    if (!WIN_CATS.includes(played.category)) return { kind: 'bad', text: 'That throws away the win!' };
    // DTZ lets us rank speed (online proxy); local Syzygy gives category only.
    if (best.dtz == null || played.dtz == null) return { kind: 'good', text: 'Winning move.' };
    if (Math.abs(played.dtz) <= Math.abs(best.dtz)) return { kind: 'good', text: 'Optimal — fastest win.' };
    return { kind: 'ok', text: 'Still winning, but not the quickest.' };
  }
  // draw
  if (!DRAW_CATS.includes(played.category)) return { kind: 'bad', text: 'That loses — the draw is gone.' };
  return { kind: 'good', text: 'Holds the draw.' };
}
