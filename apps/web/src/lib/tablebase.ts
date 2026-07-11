import type { TablebaseCategory, TablebaseResult } from '@chesser/shared';
import i18n from '../i18n';

const cache = new Map<string, TablebaseResult>();

/** Query the server's tablebase proxy. Returns `available:false` on any failure. */
export async function fetchTablebase(fen: string): Promise<TablebaseResult> {
  const hit = cache.get(fen);
  if (hit) return hit;
  try {
    const res = await fetch(`/api/tablebase?fen=${encodeURIComponent(fen)}`);
    const data = (await res.json()) as TablebaseResult;
    // Only cache successful probes — a transient failure must not pin this
    // position to "offline" for the rest of the session (drills revisit the
    // same FENs on every restart/review).
    if (data.available) cache.set(fen, data);
    return data;
  } catch {
    return { available: false, reason: 'fetch-failed' };
  }
}

// Labels/feedback resolve through the `quality` namespace at call time; the
// call sites re-run them per render/move, so a language switch shows up on
// the next update.
export function categoryLabel(cat: TablebaseCategory | undefined, dtm: number | null | undefined): string {
  const t = i18n.getFixedT(null, 'quality');
  // dtm is a distance in plies (half-moves); "mate in N" is counted in moves.
  const mateIn = (d: number) => Math.ceil(Math.abs(d) / 2);
  switch (cat) {
    case 'win':
      return dtm ? t('tablebase.winMate', { n: mateIn(dtm) }) : t('tablebase.win');
    case 'loss':
      return dtm ? t('tablebase.lossMate', { n: mateIn(dtm) }) : t('tablebase.loss');
    case 'draw':
      return t('tablebase.draw');
    case 'cursed-win':
      return t('tablebase.cursedWin');
    case 'blessed-loss':
      return t('tablebase.blessedLoss');
    default:
      return t('tablebase.unknown');
  }
}

const WIN_CATS: TablebaseCategory[] = ['win', 'cursed-win'];
// When the goal is only a draw, winning moves obviously keep it too — without
// 'win' here a defender who punishes a blunder would be told the draw is gone.
const DRAW_CATS: TablebaseCategory[] = ['win', 'draw', 'cursed-win', 'blessed-loss'];

/** Rate a played move against the pre-move tablebase data (mover POV). */
export function judgeMove(
  before: TablebaseResult,
  uci: string,
  goal: 'win' | 'draw',
): { kind: 'ok' | 'good' | 'bad'; text: string } | null {
  if (!before.available || !before.moves || before.moves.length === 0) return null;
  const t = i18n.getFixedT(null, 'quality');
  const best = before.moves[0]!;
  const played = before.moves.find((m) => m.uci === uci);
  if (!played) return null;

  if (goal === 'win') {
    if (!WIN_CATS.includes(played.category)) return { kind: 'bad', text: t('tablebase.feedback.throwsWin') };
    // DTZ lets us rank speed (online proxy); local Syzygy gives category only.
    if (best.dtz == null || played.dtz == null) return { kind: 'good', text: t('tablebase.feedback.winning') };
    if (Math.abs(played.dtz) <= Math.abs(best.dtz)) return { kind: 'good', text: t('tablebase.feedback.optimal') };
    return { kind: 'ok', text: t('tablebase.feedback.slowWin') };
  }
  // draw
  if (!DRAW_CATS.includes(played.category)) return { kind: 'bad', text: t('tablebase.feedback.losesDraw') };
  return { kind: 'good', text: t('tablebase.feedback.holdsDraw') };
}
