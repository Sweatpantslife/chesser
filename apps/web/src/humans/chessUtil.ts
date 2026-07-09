/**
 * Small chess helpers shared by the human-vs-human modes (pass-and-play and
 * friend-link). Everything works off a FEN with chess.js — no store coupling.
 */
import { Chess } from 'chess.js';
import type { Color } from '../store/game';

export const opposite = (c: Color): Color => (c === 'white' ? 'black' : 'white');
export const colorOfFen = (fen: string): Color => (fen.split(' ')[1] === 'b' ? 'black' : 'white');
export const cap = (c: Color) => (c === 'white' ? 'White' : 'Black');

/** Legal-move map for chessground ({from: [to, …]}) at a position. */
export function destsOf(fen: string): Map<string, string[]> {
  const dests = new Map<string, string[]>();
  let probe: Chess;
  try {
    probe = new Chess(fen);
  } catch {
    return dests;
  }
  for (const m of probe.moves({ verbose: true })) {
    const arr = dests.get(m.from) ?? [];
    arr.push(m.to);
    dests.set(m.from, arr);
  }
  return dests;
}

/** Does moving from→to at this position require choosing a promotion piece? */
export function needsPromotion(fen: string, from: string, to: string): boolean {
  try {
    const probe = new Chess(fen);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return probe.moves({ verbose: true, square: from as any }).some((m) => m.to === to && m.promotion);
  } catch {
    return false;
  }
}

/**
 * Can `color` still deliver mate, even with the opponent's help? Following
 * Lichess/FIDE practice for wins on time: a lone king, or king + one minor
 * piece, cannot win — flagging against them is a draw.
 */
export function hasMatingMaterial(fen: string, color: Color): boolean {
  let c: Chess;
  try {
    c = new Chess(fen);
  } catch {
    return true;
  }
  const want = color === 'white' ? 'w' : 'b';
  let minors = 0;
  for (const row of c.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== want || sq.type === 'k') continue;
      if (sq.type === 'p' || sq.type === 'r' || sq.type === 'q') return true;
      minors += 1;
      if (minors >= 2) return true;
    }
  }
  return false;
}

/** Build a PGN for a finished (or ongoing) casual game from its SAN moves. */
export function buildPgn(opts: {
  sans: string[];
  white: string;
  black: string;
  result: Color | 'draw' | null;
  event: string;
}): string {
  const c = new Chess();
  for (const san of opts.sans) {
    try {
      c.move(san);
    } catch {
      break;
    }
  }
  const result = opts.result === 'white' ? '1-0' : opts.result === 'black' ? '0-1' : opts.result === 'draw' ? '1/2-1/2' : '*';
  c.header('Event', opts.event);
  c.header('Site', 'Chesser');
  c.header('Date', new Date().toISOString().slice(0, 10).replaceAll('-', '.'));
  c.header('White', opts.white);
  c.header('Black', opts.black);
  c.header('Result', result);
  const body = c.pgn();
  return body.endsWith(result) ? body : `${body} ${result}`;
}

export interface BoardEnd {
  over: boolean;
  winner: Color | 'draw' | null;
  reason: string;
  /** Threefold / fifty-move draw is claimable at this position (not automatic). */
  claimable: 'threefold repetition' | 'fifty-move rule' | null;
  check: boolean;
}

/** Board-decided game end (or claimable draw) at a position. */
export function boardEnd(fen: string): BoardEnd {
  const c = new Chess(fen);
  const mover = colorOfFen(fen);
  if (c.isCheckmate()) return { over: true, winner: opposite(mover), reason: 'checkmate', claimable: null, check: true };
  if (c.isStalemate()) return { over: true, winner: 'draw', reason: 'stalemate', claimable: null, check: false };
  if (c.isInsufficientMaterial())
    return { over: true, winner: 'draw', reason: 'insufficient material', claimable: null, check: c.inCheck() };
  const fiftyMove = Number(fen.split(' ')[4] ?? '0') >= 100;
  const claimable = c.isThreefoldRepetition() ? ('threefold repetition' as const) : fiftyMove ? ('fifty-move rule' as const) : null;
  return { over: false, winner: null, reason: '', claimable, check: c.inCheck() };
}
