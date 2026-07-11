// Heuristic tactical-motif classifier.
//
// Given a puzzle's starting FEN and its solution line (UCI), derive a set of
// theme tags — mate-in-N, fork, sacrifice, back-rank, promotion, etc. This runs
// entirely in the browser off chess.js + a tiny board/attack model, so both the
// bundled puzzles and ones generated from your own games can be filtered by
// theme without re-running the engine.
import { Chess } from 'chess.js';

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
interface Piece {
  t: PieceType;
  c: 'w' | 'b';
}

const VAL: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const FILES = 'abcdefgh';
const sq = (f: number, r: number) => `${FILES[f]}${r + 1}`;
const onBoard = (f: number, r: number) => f >= 0 && f < 8 && r >= 0 && r < 8;

/** Parse the board part of a FEN into a square → piece map. */
function parseBoard(fen: string): Map<string, Piece> {
  const map = new Map<string, Piece>();
  const rows = fen.split(' ')[0]!.split('/');
  for (let r = 0; r < 8; r++) {
    const row = rows[7 - r]!; // FEN lists rank 8 first
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        f += Number(ch);
      } else {
        const c = ch === ch.toUpperCase() ? 'w' : 'b';
        map.set(sq(f, r), { t: ch.toLowerCase() as PieceType, c });
        f++;
      }
    }
  }
  return map;
}

const DIRS = {
  rook: [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ],
  bishop: [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ],
  knight: [
    [1, 2],
    [2, 1],
    [-1, 2],
    [-2, 1],
    [1, -2],
    [2, -1],
    [-1, -2],
    [-2, -1],
  ],
};

/** Squares attacked by the piece on `from` given the current occupancy. */
function attacksFrom(board: Map<string, Piece>, from: string, piece: Piece): string[] {
  const f = FILES.indexOf(from[0]!);
  const r = Number(from[1]) - 1;
  const out: string[] = [];
  const slide = (dirs: number[][]) => {
    for (const [df, dr] of dirs) {
      let nf = f + df!;
      let nr = r + dr!;
      while (onBoard(nf, nr)) {
        const s = sq(nf, nr);
        out.push(s);
        if (board.has(s)) break; // ray stops at the first piece
        nf += df!;
        nr += dr!;
      }
    }
  };
  switch (piece.t) {
    case 'p': {
      const dr = piece.c === 'w' ? 1 : -1;
      for (const df of [-1, 1]) if (onBoard(f + df, r + dr)) out.push(sq(f + df, r + dr));
      break;
    }
    case 'n':
      for (const [df, dr] of DIRS.knight) if (onBoard(f + df!, r + dr!)) out.push(sq(f + df!, r + dr!));
      break;
    case 'k':
      for (const df of [-1, 0, 1]) for (const dr of [-1, 0, 1]) if ((df || dr) && onBoard(f + df, r + dr)) out.push(sq(f + df, r + dr));
      break;
    case 'b':
      slide(DIRS.bishop);
      break;
    case 'r':
      slide(DIRS.rook);
      break;
    case 'q':
      slide([...DIRS.rook, ...DIRS.bishop]);
      break;
  }
  return out;
}

function material(board: Map<string, Piece>, color: 'w' | 'b'): number {
  let m = 0;
  for (const p of board.values()) if (p.c === color) m += VAL[p.t];
  return m;
}

/** All motif tags a puzzle can carry, in display order. */
export const MOTIF_ORDER = [
  'mateIn1',
  'mateIn2',
  'mateIn3',
  'mate',
  'fork',
  'sacrifice',
  'backRank',
  'promotion',
  'check',
  'endgame',
] as const;

export type Motif = (typeof MOTIF_ORDER)[number];

// i18n: this module must NOT import src/i18n (lib/weakness → here sits in
// store/game's static import graph, whose tests run under plain `node
// --test`). These are the CANONICAL ENGLISH labels; render sites resolve
// display text via t(`motifs:labels.${motif}`) with these as defaultValue.
export const MOTIF_LABELS: Record<Motif, string> = {
  mateIn1: 'Mate in 1',
  mateIn2: 'Mate in 2',
  mateIn3: 'Mate in 3',
  mate: 'Long mate',
  fork: 'Fork',
  sacrifice: 'Sacrifice',
  backRank: 'Back rank',
  promotion: 'Promotion',
  check: 'Check',
  endgame: 'Endgame',
};

/** Classify the motifs present in a puzzle (fen = position before the key move). */
export function classifyMotifs(fen: string, solution: string[], themeHint?: string): Motif[] {
  const tags = new Set<Motif>();
  const mover = fen.split(' ')[1] === 'w' ? 'w' : 'b';
  const opp = mover === 'w' ? 'b' : 'w';

  const startBoard = parseBoard(fen);
  const startBal = material(startBoard, mover) - material(startBoard, opp);
  let minBal = startBal;

  // Endgame: few pieces left.
  if (startBoard.size <= 12) tags.add('endgame');

  // Replay the solution to find mate distance, promotions and material dips.
  const chess = new Chess(fen);
  let mateAtPly = -1;
  let mateMoveTo = '';
  let mateMovePiece: PieceType | null = null;
  for (let i = 0; i < solution.length; i++) {
    const u = solution[i]!;
    let mv;
    try {
      mv = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] as any });
    } catch {
      break;
    }
    if (!mv) break;
    if (mv.promotion && i % 2 === 0) tags.add('promotion');
    const b = parseBoard(chess.fen());
    minBal = Math.min(minBal, material(b, mover) - material(b, opp));
    if (chess.isCheckmate()) {
      mateAtPly = i;
      mateMoveTo = mv.to;
      mateMovePiece = mv.piece as PieceType;
      break;
    }
  }

  // Mate distance — prefer the replayed line, fall back to the engine's hint
  // (built-in long mates ship only the first few plies of the solution).
  let mateInN = mateAtPly >= 0 && mateAtPly % 2 === 0 ? mateAtPly / 2 + 1 : 0;
  if (!mateInN && themeHint) {
    const m = /Mate in (\d+)/i.exec(themeHint);
    if (m) mateInN = Number(m[1]);
  }
  if (mateInN === 1) tags.add('mateIn1');
  else if (mateInN === 2) tags.add('mateIn2');
  else if (mateInN === 3) tags.add('mateIn3');
  else if (mateInN >= 4) tags.add('mate');

  // Sacrifice: the solver was materially down by ~a pawn-plus at some point.
  if (minBal <= startBal - 2) tags.add('sacrifice');

  // Key-move motifs: check + fork from the destination square.
  const after = new Chess(fen);
  try {
    const key = solution[0]!;
    after.move({ from: key.slice(0, 2), to: key.slice(2, 4), promotion: key[4] as any });
    if (after.inCheck()) tags.add('check');
    const board = parseBoard(after.fen());
    const dest = key.slice(2, 4);
    const moved = board.get(dest);
    if (moved) {
      let valuable = 0;
      let hitsKing = false;
      for (const target of attacksFrom(board, dest, moved)) {
        const occ = board.get(target);
        if (!occ || occ.c === moved.c) continue;
        if (occ.t === 'k') hitsKing = true;
        else if (VAL[occ.t] >= 3) valuable++;
      }
      if (valuable >= 2 || (hitsKing && valuable >= 1)) tags.add('fork');
    }
  } catch {
    /* ignore an unplayable key move */
  }

  // Back-rank mate: rook/queen mate on the opponent's first rank.
  if (mateInN && mateAtPly % 2 === 0 && (mateMovePiece === 'r' || mateMovePiece === 'q')) {
    const oppBackRank = mover === 'w' ? '8' : '1';
    if (mateMoveTo[1] === oppBackRank) tags.add('backRank');
  }

  return MOTIF_ORDER.filter((m) => tags.has(m));
}
