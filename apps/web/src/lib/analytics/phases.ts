/**
 * Game-phase division and critical moments for the analysis report.
 *
 * Phase boundaries follow the spirit of lila's chess Divider, simplified:
 * the middlegame starts once the game leaves book AND the armies have
 * unwound (few majors/minors left OR both back ranks emptied out); the
 * endgame starts once most of the material has come off. Everything is a
 * PURE function over {@link MoveRow}s — board queries are plain string maths
 * on the rows' FENs, aggregation delegates to accuracy.ts.
 */
import { acpl, gameAccuracy } from './accuracy';
import type {
  CriticalMoment,
  CriticalMomentKind,
  MoveDetail,
  MoveRow,
  PhaseName,
  PhaseStats,
  Side,
  SideAccuracy,
} from './types';

export interface PhaseBoundaries {
  /** Last ply of the opening (0 = game starts in middlegame). */
  openingEndPly: number;
  /** First ply of the endgame (Infinity = never reached). */
  endgameStartPly: number;
}

const povWin = (whiteWin: number, side: Side) => (side === 'white' ? whiteWin : 100 - whiteWin);

/** "N." for a White move, "N…" for a Black move (move-list numbering). */
const moveLabel = (ply: number) => `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '…'}`;

/** Count of knights, bishops, rooks and queens — both colours — in a FEN. */
function majorsAndMinors(fen: string): number {
  const board = fen.split(' ')[0] ?? '';
  let count = 0;
  for (const ch of board) if ('nbrqNBRQ'.includes(ch)) count++;
  return count;
}

/** Both players have unwound their back rank: < 4 non-king pieces each. */
function backRanksSparse(fen: string): boolean {
  const ranks = (fen.split(' ')[0] ?? '').split('/');
  const rank8 = ranks[0] ?? '';
  const rank1 = ranks[ranks.length - 1] ?? '';
  let white = 0;
  for (const ch of rank1) if (ch >= 'A' && ch <= 'Z' && ch !== 'K') white++;
  let black = 0;
  for (const ch of rank8) if (ch >= 'a' && ch <= 'z' && ch !== 'k') black++;
  return white < 4 && black < 4;
}

/**
 * Lichess-divider-style phase boundaries, computed from the rows' FENs:
 *  • the middlegame starts at the FIRST ply whose fenAfter has ≤ 10 majors
 *    and minors (N/B/R/Q, both colours) OR both back ranks sparse; book moves
 *    always count as opening even past that structural boundary
 *    (openingEndPly = max(boundary − 1, leftTheoryAtPly));
 *  • the endgame starts at the FIRST ply whose fenAfter has ≤ 6 majors and
 *    minors, clamped so endgameStartPly ≥ openingEndPly + 1.
 */
export function detectPhases(rows: MoveRow[], leftTheoryAtPly: number): PhaseBoundaries {
  let middlegamePly = Infinity;
  let endgamePly = Infinity;
  for (const row of rows) {
    const pieces = majorsAndMinors(row.fenAfter);
    if (middlegamePly === Infinity && (pieces <= 10 || backRanksSparse(row.fenAfter))) {
      middlegamePly = row.ply;
    }
    if (pieces <= 6) {
      endgamePly = row.ply; // ≤ 6 implies ≤ 10, so middlegamePly is already set
      break;
    }
  }
  const lastPly = rows.length > 0 ? rows[rows.length - 1]!.ply : 0;
  const openingEndPly = Math.max(
    middlegamePly === Infinity ? lastPly : middlegamePly - 1,
    Math.max(0, leftTheoryAtPly),
  );
  const endgameStartPly = endgamePly === Infinity ? Infinity : Math.max(endgamePly, openingEndPly + 1);
  return { openingEndPly, endgameStartPly };
}

/** Which phase a mainline ply belongs to under the given boundaries. */
export function phaseOfPly(b: PhaseBoundaries, ply: number): PhaseName {
  if (ply <= b.openingEndPly) return 'opening';
  if (ply >= b.endgameStartPly) return 'endgame';
  return 'middlegame';
}

/**
 * Per-phase, per-side accuracy and ACPL (accuracy.gameAccuracy / accuracy.acpl
 * restricted to the phase's rows). Always returns the three phases in order;
 * an empty phase has moves 0, accuracy 100, acpl 0 and endPly < startPly.
 */
export function phaseBreakdown(rows: MoveRow[], b: PhaseBoundaries): PhaseStats[] {
  const order: PhaseName[] = ['opening', 'middlegame', 'endgame'];
  let nextStart = rows.length > 0 ? rows[0]!.ply : 1;
  return order.map((phase) => {
    const own = rows.filter((r) => phaseOfPly(b, r.ply) === phase);
    const startPly = own.length > 0 ? own[0]!.ply : nextStart;
    const endPly = own.length > 0 ? own[own.length - 1]!.ply : startPly - 1;
    nextStart = endPly + 1;
    const sideStats = (side: Side): SideAccuracy => ({
      accuracy: gameAccuracy(own, side),
      acpl: acpl(own, side),
      moves: own.filter((r) => r.side === side).length,
    });
    return { phase, startPly, endPly, white: sideStats('white'), black: sideStats('black') };
  });
}

/** Glyphs conventionally appended to a SAN in prose; the rest stay UI-only. */
const ANNOTATION_GLYPHS: ReadonlySet<string> = new Set(['!!', '!', '?!', '?', '??']);

function momentKind(m: MoveDetail): CriticalMomentKind {
  // Seam: consolidate with checkmateWinner() from lib/coach.ts once fix/coach-trainers lands.
  if (m.isMate) return 'mate';
  if (m.classification === 'miss') return 'missed-win';
  if (m.classification === 'brilliant') return 'brilliant';
  if (povWin(m.winBefore, m.side) <= 45 && povWin(m.winAfter, m.side) >= 55) return 'turnaround';
  return 'blunder';
}

function describeMoment(m: MoveDetail, kind: CriticalMomentKind): string {
  const glyph = ANNOTATION_GLYPHS.has(m.glyph) ? m.glyph : '';
  const move = `${moveLabel(m.ply)} ${m.san}${glyph}`;
  const mover = m.side === 'white' ? 'White' : 'Black';
  const opponent = m.side === 'white' ? 'Black' : 'White';
  switch (kind) {
    case 'mate':
      return `${move} — ${mover} delivers checkmate.`;
    case 'missed-win':
      return `${move} lets a winning position slip away.`;
    case 'brilliant':
      return `${move} — a brilliant sacrifice by ${mover}.`;
    case 'turnaround':
      return `${move} turns the game around in ${mover}'s favour.`;
    case 'blunder': {
      // Eval noise can put a mover-POV gain here without meeting the
      // turnaround bounds; keep the description pointing the right way.
      if (povWin(m.winAfter, m.side) >= povWin(m.winBefore, m.side)) {
        return `${move} swings the game ${mover}'s way.`;
      }
      if (povWin(m.winBefore, m.side) >= 70) return `${move} throws away a winning position.`;
      return `${move} hands ${opponent} the advantage.`;
    }
  }
}

/**
 * Top critical moments, most impactful (largest White-POV win% swing) first,
 * at most `limit` (default 6). Candidates are the ≥ 18-point swings plus every
 * blunder/miss/brilliant and the delivered mate. The mate is pinned last as
 * the finale (and never deduped away); among the rest, of any two moments on
 * adjacent plies only the larger swing survives.
 */
export function findCriticalMoments(moves: MoveDetail[], limit = 6): CriticalMoment[] {
  const candidates = moves.filter(
    (m) =>
      Math.abs(m.winAfter - m.winBefore) >= 18 ||
      m.classification === 'blunder' ||
      m.classification === 'miss' ||
      m.classification === 'brilliant' ||
      m.isMate,
  );

  const built: CriticalMoment[] = candidates.map((m) => {
    const kind = momentKind(m);
    return {
      ply: m.ply,
      san: m.san,
      side: m.side,
      kind,
      winSwing: Math.abs(m.winAfter - m.winBefore),
      description: describeMoment(m, kind),
    };
  });

  const mates = built.filter((c) => c.kind === 'mate');
  const others = built
    .filter((c) => c.kind !== 'mate')
    .sort((a, b) => b.winSwing - a.winSwing || a.ply - b.ply);

  const kept: CriticalMoment[] = [];
  for (const c of others) {
    if (kept.some((k) => Math.abs(k.ply - c.ply) <= 1)) continue;
    kept.push(c);
  }

  const finale = mates.slice(0, limit);
  return [...kept.slice(0, Math.max(0, limit - finale.length)), ...finale];
}
