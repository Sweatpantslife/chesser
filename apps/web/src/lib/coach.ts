/**
 * Move-by-move game review: classify each move (chess.com-style grades) and
 * write a plain-English explanation of *why* it earned that grade.
 *
 * Everything here is pure and engine-agnostic. The store feeds in the engine's
 * per-position evaluations (best move + score + 2nd-best score for every ply)
 * and we turn them into {@link MoveReview}s the UI can render and narrate.
 *
 * Grades follow the conventions players know from Lichess / chess.com:
 *  • thresholds for inaccuracy / mistake / blunder are win-percentage swings
 *    (Lichess: 10 / 20 / 30), the same Win% curve already used elsewhere;
 *  • "best" is the engine's top move, "good" a near-best alternative;
 *  • "book" is still-in-theory opening moves;
 *  • "brilliant" is a sound material sacrifice, "great" the only move that
 *    holds or swings the game — both deliberately rare so they feel earned.
 */
import { Chess } from 'chess.js';
import type { Score } from '@chesser/shared';
import { formatScore } from '@chesser/shared';
import i18n from '../i18n';
import { whiteWinPercent } from './format';

export type Classification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'miss';

export type Side = 'white' | 'black';

export interface ClassMeta {
  label: string;
  /** Short suffix shown after a move in the move list ('' = nothing). */
  glyph: string;
  /** Compact icon for the coach badge. */
  icon: string;
  text: string; // tailwind text colour
  bg: string; // tailwind badge background
  ring: string; // tailwind badge ring
  /** Chessground brush for the on-board square highlight. */
  brush: string;
}

/**
 * `label` is a getter resolving through the `quality` namespace at ACCESS
 * time, so every render site that reads `CLASSIFICATION_META[cls].label`
 * shows the active language without changing its code (components re-render
 * on language change via their own useTranslation subscription). The English
 * literal doubles as the defaultValue, keeping English output byte-identical
 * even if i18n resources were somehow unavailable.
 */
const classMeta = (key: Classification, english: string, rest: Omit<ClassMeta, 'label'>): ClassMeta => ({
  get label() {
    return i18n.t(`quality:labels.${key}`, { defaultValue: english });
  },
  ...rest,
});

export const CLASSIFICATION_META: Record<Classification, ClassMeta> = {
  brilliant: classMeta('brilliant', 'Brilliant', { glyph: '!!', icon: '✦', text: 'text-cyan-300', bg: 'bg-cyan-500/15', ring: 'ring-cyan-400/50', brush: 'paleBlue' }),
  great: classMeta('great', 'Great move', { glyph: '!', icon: '★', text: 'text-blue-300', bg: 'bg-blue-500/15', ring: 'ring-blue-400/50', brush: 'blue' }),
  best: classMeta('best', 'Best move', { glyph: '', icon: '✓', text: 'text-emerald-300', bg: 'bg-emerald-500/15', ring: 'ring-emerald-400/50', brush: 'green' }),
  good: classMeta('good', 'Good', { glyph: '', icon: '·', text: 'text-lime-300', bg: 'bg-lime-500/10', ring: 'ring-lime-400/30', brush: 'paleGreen' }),
  book: classMeta('book', 'Book', { glyph: '', icon: '◫', text: 'text-amber-200', bg: 'bg-amber-500/10', ring: 'ring-amber-400/30', brush: 'paleGrey' }),
  inaccuracy: classMeta('inaccuracy', 'Inaccuracy', { glyph: '?!', icon: '?!', text: 'text-amber-300', bg: 'bg-amber-500/15', ring: 'ring-amber-400/50', brush: 'yellow' }),
  mistake: classMeta('mistake', 'Mistake', { glyph: '?', icon: '?', text: 'text-orange-300', bg: 'bg-orange-500/15', ring: 'ring-orange-400/50', brush: 'paleRed' }),
  blunder: classMeta('blunder', 'Blunder', { glyph: '??', icon: '??', text: 'text-rose-300', bg: 'bg-rose-500/15', ring: 'ring-rose-400/50', brush: 'red' }),
  miss: classMeta('miss', 'Missed win', { glyph: '×', icon: '⤬', text: 'text-rose-300', bg: 'bg-rose-500/10', ring: 'ring-rose-400/40', brush: 'red' }),
};
// NOTE: the rule-based explanation sentences below (explain()) are
// deliberately NOT extracted yet — deferred to phase 3 alongside
// lib/analytics/explain.ts ("labels now, sentences later").

/** Grades the auto-play walkthrough stops on so the user can take them in. */
export const IMPORTANT: ReadonlySet<Classification> = new Set<Classification>(['brilliant', 'great', 'mistake', 'blunder', 'miss']);

export interface MoveReview {
  id: string; // node id in the variation tree
  ply: number;
  side: Side;
  san: string;
  uci: string;
  classification: Classification;
  /** White-POV evaluation after the move, pre-formatted (+1.24, #3, …). */
  evalText: string;
  /** White's win chance after the move (0–100), for a small bar. */
  winWhiteAfter: number;
  bestSan: string | null;
  bestUci: string | null;
  explanation: string;
}

/** The engine's read on one position: top move, its score, and the runner-up. */
export interface PositionEval {
  score: Score | null;
  bestUci: string | null;
  bestSan: string | null;
  secondScore: Score | null;
}

export interface ReviewNode {
  id: string;
  san: string;
  uci: string;
  fen: string; // position AFTER this move
  ply: number;
}

export interface BuildInput {
  startFen: string;
  nodes: ReviewNode[];
  /** One per position: evals[0] = startFen, evals[i] = after nodes[i-1]. */
  evals: PositionEval[];
  /** Number of leading plies still in opening theory. */
  bookPly: number;
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_NAME: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

/** White-POV centipawns, mate clamped to ±1500 (matches the review elsewhere). */
export function cpOf(s: Score | null): number {
  if (!s) return 0;
  if (s.kind === 'mate') return s.value > 0 ? 1500 : s.value < 0 ? -1500 : 0;
  return Math.max(-1500, Math.min(1500, s.value));
}

/**
 * The side that delivered checkmate if `fen` is a mated position, else null.
 *
 * Engines return no evaluation for terminal positions (a mated position has no
 * PV), so the review's eval for the position AFTER a mating move is `null` —
 * which reads as 50/50 and used to grade the checkmating move as a "missed
 * win". Detecting mate from the FEN lets the grading path treat it as the
 * decisive result it is.
 */
export function checkmateWinner(fen: string): Side | null {
  try {
    const c = new Chess(fen);
    if (!c.isCheckmate()) return null;
    return c.turn() === 'w' ? 'black' : 'white';
  } catch {
    return null;
  }
}

/** Net material on the board (White − Black), in pawns. */
function material(fen: string): number {
  const board = fen.split(' ')[0] ?? '';
  let v = 0;
  for (const ch of board) {
    const val = PIECE_VALUE[ch.toLowerCase()];
    if (val === undefined) continue;
    v += ch === ch.toUpperCase() ? val : -val;
  }
  return v;
}

interface MoveCtx {
  san: string;
  piece: string;
  captured?: string;
  flags: string;
  check: boolean;
}

function moveCtx(fen: string, uci: string): MoveCtx | null {
  try {
    const c = new Chess(fen);
    const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
    if (!mv) return null;
    return { san: mv.san, piece: mv.piece, captured: mv.captured, flags: mv.flags, check: /[+#]/.test(mv.san) };
  } catch {
    return null;
  }
}

/**
 * Did the mover give up material? Play the move and the opponent's best reply,
 * then compare the mover's material to before. A net loss flags a sacrifice
 * (the `lost` figure also tells the blunder copy what got dropped).
 */
function materialSwing(fenBefore: string, playedUci: string, oppReplyUci: string | null, side: Side): number {
  if (!oppReplyUci) return 0;
  try {
    const c = new Chess(fenBefore);
    c.move({ from: playedUci.slice(0, 2), to: playedUci.slice(2, 4), promotion: playedUci.length > 4 ? playedUci[4] : undefined });
    c.move({ from: oppReplyUci.slice(0, 2), to: oppReplyUci.slice(2, 4), promotion: oppReplyUci.length > 4 ? oppReplyUci[4] : undefined });
    const before = material(fenBefore);
    const after = material(c.fen());
    const moverDelta = side === 'white' ? after - before : before - after;
    return -moverDelta; // positive = material the mover ended up down
  } catch {
    return 0;
  }
}

const povWin = (whiteWin: number, side: Side) => (side === 'white' ? whiteWin : 100 - whiteWin);
const povCp = (whiteCp: number, side: Side) => (side === 'white' ? whiteCp : -whiteCp);

/** A coarse, human word for how good a position is, from the mover's POV. */
function advWord(moverCp: number): string {
  if (moverCp >= 600) return 'completely winning';
  if (moverCp >= 250) return 'winning';
  if (moverCp >= 110) return 'clearly better';
  if (moverCp >= 45) return 'a little better';
  if (moverCp > -45) return 'about equal';
  if (moverCp > -110) return 'slightly worse';
  if (moverCp > -250) return 'worse';
  if (moverCp > -600) return 'losing';
  return 'completely lost';
}

interface Ctx {
  cls: Classification;
  mctx: MoveCtx | null;
  octx: MoveCtx | null; // opponent's best reply
  bestSan: string | null;
  playedIsBest: boolean;
  moverCpBefore: number;
  moverCpAfter: number;
  moverWinBefore: number;
  moverWinAfter: number;
  lost: number; // material the mover is down after the best reply
  /** The played move delivered checkmate. */
  mates: boolean;
}

function explain(c: Ctx): string {
  if (c.mates) return 'Checkmate — the game is over. No move is stronger than that.';
  const cap = c.mctx?.captured ? PIECE_NAME[c.mctx.captured] : null;
  const dropped = c.octx?.captured ? PIECE_NAME[c.octx.captured] : null;
  const hung = !!dropped && c.lost >= 1.5;
  const best = c.bestSan && c.bestSan !== c.mctx?.san ? c.bestSan : null;

  switch (c.cls) {
    case 'book':
      return 'Still in opening theory — a well-established book move.';
    case 'brilliant': {
      const piece = dropped ?? 'material';
      return `Brilliant! A ${piece} sacrifice that the engine still rates in your favour — the kind of move that wins games.`;
    }
    case 'great':
      return c.moverWinBefore < 50
        ? 'Great move — the resource that turns the game back in your favour.'
        : 'Great move — the only move that keeps your advantage together.';
    case 'best': {
      if (c.mctx && /[kq]/.test(c.mctx.flags)) return 'Best move — tucking your king to safety by castling.';
      if (cap) return `Best move — winning the ${cap}.`;
      if (c.mctx?.check) return `Best move — a strong check that keeps the initiative. You're ${advWord(c.moverCpAfter)}.`;
      return `Best move. You're ${advWord(c.moverCpAfter)}.`;
    }
    case 'good':
      return best ? `A solid move; the engine slightly preferred ${best}.` : 'A solid, accurate move.';
    case 'inaccuracy':
      return best ? `Inaccurate — ${best} would have kept more of your edge.` : 'Inaccurate — there was a more precise move.';
    case 'mistake':
      if (hung) return `A mistake — this leaves the ${dropped} hanging.${best ? ` ${best} was safer.` : ''}`;
      return `A mistake — it lets your position slip to ${advWord(c.moverCpAfter)}.${best ? ` ${best} was stronger.` : ''}`;
    case 'blunder':
      if (hung) return `Blunder — this drops the ${dropped}.${best ? ` ${best} held everything together.` : ''}`;
      return `Blunder — it swings the game to ${advWord(c.moverCpAfter)}.${best ? ` ${best} was needed.` : ''}`;
    case 'miss':
      return `Missed win — you were ${advWord(c.moverCpBefore)}, but ${best ?? 'the engine line'} was the way to convert.`;
  }
}

/** Turn engine evals into graded, explained move reviews (one per played move). */
export function buildMoveReviews(input: BuildInput): MoveReview[] {
  const { startFen, nodes, evals, bookPly } = input;
  const out: MoveReview[] = [];

  for (let k = 0; k < nodes.length; k++) {
    const node = nodes[k]!;
    const pre = evals[k];
    const post = evals[k + 1];
    if (!pre || !post) continue;

    const side: Side = node.ply % 2 === 1 ? 'white' : 'black';
    const fenBefore = k === 0 ? startFen : nodes[k - 1]!.fen;

    // Terminal positions get no engine eval (score null → 50/50), so score a
    // delivered checkmate from the FEN: it's a 100% win for the mover.
    const mateWinner = checkmateWinner(node.fen);
    const mates = mateWinner === side;

    const winWhiteBefore = whiteWinPercent(pre.score);
    const winWhiteAfter = mateWinner ? (mateWinner === 'white' ? 100 : 0) : whiteWinPercent(post.score);
    const moverWinBefore = povWin(winWhiteBefore, side);
    const moverWinAfter = povWin(winWhiteAfter, side);
    const drop = Math.max(0, moverWinBefore - moverWinAfter);

    const moverCpBefore = povCp(cpOf(pre.score), side);
    const moverCpAfter = mateWinner ? povCp(mateWinner === 'white' ? 1500 : -1500, side) : povCp(cpOf(post.score), side);

    const playedIsBest = !!pre.bestUci && node.uci === pre.bestUci;
    const secondMoverWin = pre.secondScore ? povWin(whiteWinPercent(pre.secondScore), side) : moverWinBefore;
    const onlyMoveGap = pre.secondScore ? moverWinBefore - secondMoverWin : 0;

    const isBook = k + 1 <= bookPly;
    const lost = materialSwing(fenBefore, node.uci, post.bestUci, side);

    // — Base grade from the win-percentage swing (Lichess thresholds) —
    let cls: Classification;
    if (drop >= 30) cls = 'blunder';
    else if (drop >= 20) cls = 'mistake';
    else if (drop >= 10) cls = 'inaccuracy';
    else cls = playedIsBest || drop < 2 ? 'best' : 'good';

    // A serious error that only squandered a *winning* edge (didn't fall into a
    // losing game) reads better as a "missed win".
    if ((cls === 'mistake' || cls === 'blunder') && moverWinBefore >= 75 && moverWinAfter >= 38 && moverWinAfter <= 65) {
      cls = 'miss';
    }

    // Theory moves that didn't lose anything are just "book" (a mate is never
    // demoted to book — it deserves its grade).
    if (isBook && drop < 10 && !mates) cls = 'book';

    // Upgrades for strong moves: a sound sacrifice is brilliant; the single
    // move that holds or swings the game is great.
    if (cls === 'best' || cls === 'good') {
      const sound = moverWinAfter >= 50;
      if (lost >= 2 && sound && moverWinBefore <= 95 && (playedIsBest || drop < 6)) {
        cls = 'brilliant';
      } else {
        const turnaround = moverWinBefore < 50 && moverWinAfter >= 52;
        const onlyGood = onlyMoveGap >= 18 && moverWinAfter >= 45 && moverWinBefore <= 90;
        if ((playedIsBest || drop < 4) && (turnaround || onlyGood)) cls = 'great';
      }
    }

    const mctx = moveCtx(fenBefore, node.uci);
    const octx = post.bestUci ? moveCtx(node.fen, post.bestUci) : null;

    const explanation = explain({
      cls,
      mctx,
      octx,
      bestSan: pre.bestSan,
      playedIsBest,
      moverCpBefore,
      moverCpAfter,
      moverWinBefore,
      moverWinAfter,
      lost,
      mates,
    });

    out.push({
      id: node.id,
      ply: node.ply,
      side,
      san: node.san,
      uci: node.uci,
      classification: cls,
      evalText: mateWinner ? '#' : formatScore(post.score ?? { kind: 'cp', value: 0 }),
      winWhiteAfter,
      bestSan: pre.bestSan,
      bestUci: pre.bestUci,
      explanation,
    });
  }

  return out;
}
