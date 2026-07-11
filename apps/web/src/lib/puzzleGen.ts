// Generate verified tactics from a game's positions, in the browser.
//
// Mirrors scripts/gen-tactics.mjs: for each position, ask the engine for its
// top two lines and keep it only when exactly one move is decisive (the best is
// clearly winning and the second-best is not) — a real "find the only move"
// tactic. Scores from the server are White-POV, so we convert to the mover's
// POV before judging, matching the original generator.
import { Chess } from 'chess.js';
import type { AnalysisLine } from '@chesser/shared';
import { engine } from './engine';
import type { Difficulty } from '../trainers/tactics';
import type { NewGeneratedPuzzle } from '../store/customPuzzles';

interface MoverInfo {
  cp?: number; // mover POV
  mate?: number; // mover POV (positive = mover mates)
  pv: string[];
}

const cpOf = (i: MoverInfo, cap = 100000) => {
  if (i.mate !== undefined) return i.mate > 0 ? cap - i.mate * 100 : -cap - i.mate * 100;
  return i.cp ?? 0;
};
const decisive = (i: MoverInfo, capAbs = 2500) => {
  if (i.mate !== undefined) return i.mate > 0;
  return i.cp !== undefined && i.cp >= 200 && i.cp <= capAbs;
};
const isTactic = (m1?: MoverInfo, m2?: MoverInfo): boolean => {
  if (!m1 || !decisive(m1) || !m1.pv[0]) return false;
  if (!m2) return true;
  const notWinning2 = m2.mate !== undefined ? m2.mate < 0 : (m2.cp ?? 0) <= 80;
  return notWinning2 || cpOf(m1) - cpOf(m2) >= 250;
};

/** Convert a White-POV analysis line to the mover's point of view. */
function toMoverInfo(line: AnalysisLine, moverIsWhite: boolean): MoverInfo {
  const sign = moverIsWhite ? 1 : -1;
  if (line.score.kind === 'mate') return { mate: line.score.value * sign, pv: line.pvUci };
  return { cp: line.score.value * sign, pv: line.pvUci };
}

function classify(i: MoverInfo): string {
  if (i.mate !== undefined && i.mate > 0) return i.mate <= 1 ? 'Mate in 1' : `Mate in ${i.mate}`;
  return 'Winning tactic';
}

function difficultyOf(i: MoverInfo): Difficulty {
  if (i.mate !== undefined && i.mate > 0) return i.mate <= 2 ? 'easy' : i.mate <= 4 ? 'medium' : 'hard';
  const cp = i.cp ?? 0;
  return cp >= 600 ? 'easy' : cp >= 320 ? 'medium' : 'hard';
}

/** A rough rating: small/long wins are harder, big/short wins are easier. */
function ratingOf(i: MoverInfo, solutionLen: number): number {
  let base: number;
  if (i.mate !== undefined && i.mate > 0) base = 1300 + Math.min(i.mate, 6) * 120;
  else base = 1900 - Math.max(0, Math.min(800, ((i.cp ?? 200) - 200) / 3));
  base += (solutionLen - 1) * 30;
  return Math.round(Math.max(800, Math.min(2600, base)));
}

export interface GenOptions {
  /** Positions to test (FENs of the side to move). */
  fens: string[];
  source?: string;
  movetimeMs?: number;
  maxFound?: number;
  onProgress?: (done: number, total: number, found: number) => void;
  shouldStop?: () => boolean;
}

export async function generatePuzzles(opts: GenOptions): Promise<NewGeneratedPuzzle[]> {
  const { fens, source, movetimeMs = 700, maxFound = 12, onProgress, shouldStop } = opts;
  const found: NewGeneratedPuzzle[] = [];
  const seen = new Set<string>();

  for (let idx = 0; idx < fens.length; idx++) {
    if (shouldStop?.()) break;
    const fen = fens[idx]!;
    onProgress?.(idx, fens.length, found.length);

    const board = fen.split(' ')[0]!;
    const pieceCount = board.replace(/[^a-zA-Z]/g, '').length;
    const probe = new Chess(fen);
    if (pieceCount < 6 || probe.isGameOver() || probe.inCheck()) continue;

    const key = fen.split(' ').slice(0, 2).join(' ');
    if (seen.has(key)) continue;

    const lines = await engine.analyzeManyOnce(fen, { multipv: 2, movetimeMs });
    if (!lines.length) continue;
    const moverIsWhite = fen.split(' ')[1] === 'w';
    const m1 = lines[0] ? toMoverInfo(lines[0], moverIsWhite) : undefined;
    const m2 = lines[1] ? toMoverInfo(lines[1], moverIsWhite) : undefined;
    if (!isTactic(m1, m2) || !m1) continue;

    // Truncate the PV to a legal, sensible solution line.
    const replay = new Chess(fen);
    const solution: string[] = [];
    for (const u of m1.pv.slice(0, 8)) {
      try {
        const mv = replay.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] as any });
        if (!mv) break;
      } catch {
        break;
      }
      solution.push(u);
    }
    if (solution.length === 0) continue;

    seen.add(key);
    found.push({
      fen,
      solution,
      theme: classify(m1),
      difficulty: difficultyOf(m1),
      turn: moverIsWhite ? 'white' : 'black',
      rating: ratingOf(m1, solution.length),
      source,
    });
    onProgress?.(idx + 1, fens.length, found.length);
    if (found.length >= maxFound) break;
  }

  return found;
}
