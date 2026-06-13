import { Chess } from 'chess.js';
import type { BotStyleId } from '@chesser/shared';

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function fileOf(sq: string): number {
  return sq.charCodeAt(0) - 97; // 'a' -> 0
}
function rankOf(sq: string): number {
  return Number(sq[1]) - 1; // '1' -> 0
}
function chebyshev(a: string, b: string): number {
  return Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));
}
/** 0 at the four central squares, growing toward the rim. */
function centerDistance(sq: string): number {
  return Math.abs(fileOf(sq) - 3.5) + Math.abs(rankOf(sq) - 3.5);
}

function enemyKingSquare(game: Chess, enemy: 'w' | 'b'): string | null {
  for (const row of game.board()) {
    for (const cell of row) {
      if (cell && cell.type === 'k' && cell.color === enemy) return cell.square;
    }
  }
  return null;
}

/** Is `square` attacked by an enemy pawn in the given position? (sac proxy) */
function attackedByEnemyPawn(game: Chess, square: string, mover: 'w' | 'b'): boolean {
  const f = fileOf(square);
  const r = rankOf(square);
  // enemy pawns sit one rank "ahead" of the square from the mover's view
  const dir = mover === 'w' ? 1 : -1;
  const pr = r + dir;
  if (pr < 0 || pr > 7) return false;
  const enemy = mover === 'w' ? 'b' : 'w';
  for (const df of [-1, 1]) {
    const pf = f + df;
    if (pf < 0 || pf > 7) continue;
    const sq = String.fromCharCode(97 + pf) + (pr + 1);
    const piece = game.get(sq as any);
    if (piece && piece.type === 'p' && piece.color === enemy) return true;
  }
  return false;
}

export interface MoveFeatures {
  capturedValue: number;
  givesCheck: boolean;
  isPromotion: boolean;
  isCastle: boolean;
  piece: string;
  kingProximity: number; // 0..7, higher = closer to enemy king
  centralization: number; // higher = more central destination
  developsMinor: boolean;
  earlyQueenMove: boolean;
  pawnAdvance: boolean;
  landsEnPrise: boolean; // destination attacked by an enemy pawn
  fullmove: number;
}

export function extractFeatures(fen: string, uci: string): MoveFeatures | null {
  const game = new Chess(fen);
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : undefined;
  let mv;
  try {
    mv = game.move({ from, to, promotion });
  } catch {
    return null;
  }
  if (!mv) return null;

  const mover = mv.color; // 'w' | 'b'
  const enemy = mover === 'w' ? 'b' : 'w';
  const kingSq = enemyKingSquare(game, enemy);
  const fullmove = Number(fen.split(' ')[5] ?? '1');

  const fromRank = rankOf(from);
  const backRank = mover === 'w' ? 0 : 7;

  // Only a real piece (not a pawn or the king) landing genuinely near the enemy
  // king counts as "attacking" — otherwise rim-pawn pushes read as aggressive.
  const dist = kingSq ? chebyshev(to, kingSq) : 9;
  const attacks = mv.piece !== 'p' && mv.piece !== 'k' && dist <= 3;

  return {
    capturedValue: mv.captured ? (PIECE_VALUE[mv.captured] ?? 0) : 0,
    givesCheck: game.inCheck(), // after the move it's the enemy to move
    isPromotion: !!mv.promotion,
    isCastle: mv.flags.includes('k') || mv.flags.includes('q'),
    piece: mv.piece,
    kingProximity: attacks ? 4 - dist : 0,
    centralization: 7 - centerDistance(to),
    developsMinor: (mv.piece === 'n' || mv.piece === 'b') && fromRank === backRank,
    earlyQueenMove: mv.piece === 'q' && fullmove <= 10,
    pawnAdvance: mv.piece === 'p',
    landsEnPrise: attackedByEnemyPawn(game, to, mover),
    fullmove,
  };
}

/**
 * Score how well a (sound) candidate move fits a playing style.
 * Only used to break ties among moves the engine already rates near-equal,
 * so it shapes *flavour*, never blunders.
 */
export function styleScore(style: BotStyleId, fen: string, uci: string): number {
  const f = extractFeatures(fen, uci);
  if (!f) return 0;

  switch (style) {
    case 'aggressive':
      return (
        f.capturedValue * 1.0 +
        (f.givesCheck ? 2.5 : 0) +
        (f.isPromotion ? 3 : 0) +
        f.kingProximity * 0.5 +
        (f.landsEnPrise ? 1.5 : 0) // willing to sac
      );
    case 'defensive':
      return (
        (f.isCastle ? 4 : 0) +
        (f.landsEnPrise ? -3 : 1.0) + // avoid loose pieces, like safe squares
        (f.givesCheck ? -0.5 : 0) +
        (f.earlyQueenMove ? -1.5 : 0) +
        (f.capturedValue > 0 ? 0.3 : 0.8) // mildly prefer quiet consolidation
      );
    case 'positional':
      return (
        f.centralization * 0.6 +
        (f.developsMinor ? 2.5 : 0) +
        (f.isCastle ? 2.5 : 0) +
        (f.earlyQueenMove ? -2 : 0) +
        (f.pawnAdvance && f.centralization > 4 ? 1 : 0) +
        (f.landsEnPrise ? -2 : 0)
      );
    case 'balanced':
    case 'human':
    default:
      return 0;
  }
}
