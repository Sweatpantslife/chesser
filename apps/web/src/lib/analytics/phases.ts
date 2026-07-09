/**
 * Game-phase division and critical moments for the analysis report.
 *
 * Phase boundaries port scalachess's Divider (core/src/main/scala/Divider.scala):
 * the middlegame starts at the first position with ≤ 10 majors/minors, OR a
 * sparse back rank on EITHER side (< 4 pieces, king included), OR a mixedness
 * score > 150 (piece entanglement over 2×2 windows); the endgame starts at
 * ≤ 6 majors/minors. One product addition on top of the Divider rules: book
 * moves always count as opening. Everything is a PURE function over
 * {@link MoveRow}s — board queries are plain string maths on the rows' FENs,
 * aggregation delegates to accuracy.ts.
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

/**
 * EITHER player's back rank has thinned to < 4 pieces, KING INCLUDED —
 * scalachess Divider.backrankSparse ("sparse back-rank indicates that pieces
 * have been developed").
 */
function backrankSparse(fen: string): boolean {
  const ranks = (fen.split(' ')[0] ?? '').split('/');
  const rank8 = ranks[0] ?? '';
  const rank1 = ranks[ranks.length - 1] ?? '';
  let white = 0;
  for (const ch of rank1) if (ch >= 'A' && ch <= 'Z') white++;
  let black = 0;
  for (const ch of rank8) if (ch >= 'a' && ch <= 'z') black++;
  return white < 4 || black < 4;
}

/** FEN board → per-square occupancy, index = rank·8 + file (a1 = 0): 0 empty, 1 white, 2 black. */
function boardSquares(fen: string): Int8Array {
  const out = new Int8Array(64);
  const board = fen.split(' ')[0] ?? '';
  let rank = 7;
  let file = 0;
  for (const ch of board) {
    if (ch === '/') {
      rank -= 1;
      file = 0;
    } else if (ch >= '1' && ch <= '8') {
      file += Number(ch);
    } else {
      if (rank >= 0 && rank <= 7 && file <= 7) out[rank * 8 + file] = ch === ch.toUpperCase() ? 1 : 2;
      file += 1;
    }
  }
  return out;
}

/** scalachess Divider.score(y)(white, black) for one 2×2 window, y = 1..7 (bottom row of the window). */
function regionScore(white: number, black: number, y: number): number {
  if (black === 0) {
    if (white === 1) return 1 + (8 - y);
    if (white === 2) return y > 2 ? 2 + (y - 2) : 0;
    if (white === 3 || white === 4) return y > 1 ? 3 + (y - 1) : 0; // group of 4 on the homerow = 0
    return 0;
  }
  if (black === 1) {
    if (white === 0) return 1 + y;
    if (white === 1) return 5 + Math.abs(4 - y);
    if (white === 2) return 4 + (y - 1);
    if (white === 3) return 5 + (y - 1);
    return 0;
  }
  if (black === 2) {
    if (white === 0) return y < 6 ? 2 + (6 - y) : 0;
    if (white === 1) return 4 + (7 - y);
    if (white === 2) return 7;
    return 0;
  }
  if (black === 3) {
    if (white === 0) return y < 7 ? 3 + (7 - y) : 0;
    if (white === 1) return 5 + (7 - y);
    return 0;
  }
  if (black === 4) return white === 0 && y < 7 ? 3 + (7 - y) : 0;
  return 0;
}

/**
 * scalachess Divider.mixedness: how entangled the two armies are, summed over
 * every 2×2 window of the board (windows anchored on files a–g, ranks 1–7).
 * Locked/closed positions score high; > 150 starts the middlegame.
 */
export function mixedness(fen: string): number {
  const sq = boardSquares(fen);
  let total = 0;
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      let white = 0;
      let black = 0;
      for (const dy of [0, 1]) {
        for (const dx of [0, 1]) {
          const v = sq[(y + dy) * 8 + (x + dx)];
          if (v === 1) white += 1;
          else if (v === 2) black += 1;
        }
      }
      total += regionScore(white, black, y + 1);
    }
  }
  return total;
}

/**
 * Phase boundaries, porting scalachess Divider exactly, computed from the
 * rows' FENs:
 *  • the middlegame starts at the FIRST ply whose fenAfter has ≤ 10 majors
 *    and minors (N/B/R/Q, both colours) OR a sparse back rank on either side
 *    (< 4 pieces incl. king) OR mixedness > 150; book moves always count as
 *    opening even past that structural boundary
 *    (openingEndPly = max(boundary − 1, leftTheoryAtPly) — product addition);
 *  • the endgame starts at the FIRST ply whose fenAfter has ≤ 6 majors and
 *    minors, clamped so endgameStartPly ≥ openingEndPly + 1.
 */
export function detectPhases(rows: MoveRow[], leftTheoryAtPly: number): PhaseBoundaries {
  let middlegamePly = Infinity;
  let endgamePly = Infinity;
  for (const row of rows) {
    const pieces = majorsAndMinors(row.fenAfter);
    if (
      middlegamePly === Infinity &&
      (pieces <= 10 || backrankSparse(row.fenAfter) || mixedness(row.fenAfter) > 150)
    ) {
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
    // A delivered mate ends at the mover's edge whatever the terminal eval
    // ({mate: 0} → 50%) says — mirrors EvalGraphPro's pinning so the exposed
    // winSwing points the right way.
    // Seam: consolidate with checkmateWinner() from lib/coach.ts once fix/coach-trainers lands.
    const winAfter = m.isMate ? (m.side === 'white' ? 100 : 0) : m.winAfter;
    return {
      ply: m.ply,
      san: m.san,
      side: m.side,
      kind,
      winSwing: Math.abs(winAfter - m.winBefore),
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
