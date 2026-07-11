/**
 * Plain-language one-line explanations for report moves (SPEC §2d).
 *
 * Template-based and priority-ordered, most specific first: delivered mate →
 * missed mate → allowed mate (incl. a cheap back-rank read) → hung piece →
 * allowed tactic (fork naming) → missed tactic → per-grade fallbacks that
 * mirror the tone of lib/coach.ts. Every concrete claim (piece names, forks,
 * the back rank) is verified on the board with chess.js before it is voiced;
 * whatever the board can't confirm falls back to generic eval-based phrasing.
 *
 * Pure over {@link MoveRow} — see types.ts for the sign conventions.
 *
 * i18n: extraction of these rule-based coaching sentences is DEFERRED to
 * phase 3 ("labels now, sentences later" — see the i18n handoff); the unit
 * tests assert the exact English prose. Move-quality LABELS already resolve
 * via `quality:labels.*` (lib/coach.ts CLASSIFICATION_META).
 */
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import { cpValue } from './accuracy';
import { isEngineBestMove } from './classify';
import type { Classification, EvalPoint, MoveRow, Side } from './types';

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_NAME: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

/** Grades whose rows get the error-flavoured tactic templates. */
const BAD_GRADES: ReadonlySet<Classification> = new Set(['inaccuracy', 'mistake', 'blunder', 'miss']);

const povWin = (whiteWin: number, side: Side) => (side === 'white' ? whiteWin : 100 - whiteWin);
const povCp = (whiteCp: number, side: Side) => (side === 'white' ? whiteCp : -whiteCp);

const pieceName = (type: string | null): string => (type && PIECE_NAME[type]) || 'piece';

/** A coarse, human word for how good a position is, mover POV (mirrors lib/coach.ts). */
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

/** Moves-to-mate when `ev` says the mover mates; null otherwise. */
const mateFor = (ev: EvalPoint | null, side: Side): number | null =>
  ev?.mate !== undefined && (side === 'white' ? ev.mate > 0 : ev.mate < 0) ? Math.abs(ev.mate) : null;

/** Moves-to-mate when `ev` says the mover GETS mated; null otherwise. */
const mateAgainst = (ev: EvalPoint | null, side: Side): number | null =>
  ev?.mate !== undefined && (side === 'white' ? ev.mate < 0 : ev.mate > 0) ? Math.abs(ev.mate) : null;

interface ReplayedMove {
  san: string;
  piece: string;
  captured: string | null;
  from: Square;
  to: Square;
  flags: string;
  check: boolean;
}

/** Replay a UCI move on `board` (mutating it); null when it doesn't apply. */
function applyUci(board: Chess, uci: string): ReplayedMove | null {
  try {
    const mv = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
    if (!mv) return null;
    return { san: mv.san, piece: mv.piece, captured: mv.captured ?? null, from: mv.from, to: mv.to, flags: mv.flags, check: /[+#]$/.test(mv.san) };
  } catch {
    return null;
  }
}

/** The engine's best reply played out on fenAfter, plus the resulting board. */
function replyContext(row: MoveRow): { mv: ReplayedMove; board: Chess } | null {
  if (!row.bestReplyUci) return null;
  let board: Chess;
  try {
    board = new Chess(row.fenAfter);
  } catch {
    return null;
  }
  const mv = applyUci(board, row.bestReplyUci);
  return mv ? { mv, board } : null;
}

/** The played move replayed on fenBefore (capture/castle/piece context). */
function playedContext(row: MoveRow): ReplayedMove | null {
  let board: Chess;
  try {
    board = new Chess(row.fenBefore);
  } catch {
    return null;
  }
  return applyUci(board, row.uci);
}

/** Material the mover is down once the best reply lands (pawns; + = lost). */
function moverLoss(row: MoveRow, afterReply: Chess): number {
  const delta = material(afterReply.fen()) - material(row.fenBefore);
  return row.side === 'white' ? -delta : delta;
}

/**
 * Names of the enemy pieces (minors or better, plus the king) the piece on
 * `from` attacks, biggest first — the attack-count heuristic behind the fork
 * copy. Pure geometry via chess.js `attackers`; defence is not considered,
 * which is fine because callers gate on the engine's eval swing.
 */
function forkTargets(board: Chess, from: Square): string[] {
  const attacker = board.get(from);
  if (!attacker) return [];
  const targets: { type: string; value: number }[] = [];
  for (const rank of board.board()) {
    for (const cell of rank) {
      if (!cell || cell.color === attacker.color) continue;
      const value = cell.type === 'k' ? 100 : (PIECE_VALUE[cell.type] ?? 0);
      if (value < 3) continue;
      if (board.attackers(cell.square, attacker.color).includes(from)) targets.push({ type: cell.type, value });
    }
  }
  targets.sort((a, b) => b.value - a.value);
  return targets.map((t) => pieceName(t.type));
}

function forkPhrase(names: string[]): string {
  const [a = 'piece', b = 'piece'] = names;
  return a === b ? `two ${a}s` : `${a} and ${b}`;
}

interface PvReplay {
  moves: ReplayedMove[];
  /** Board after the first PV move, for fork inspection. */
  afterFirst: Chess | null;
  /** Mover's net material gain in pawns, measured after opponent replies only. */
  moverGain: number;
  /** Highest-value piece the mover captures inside the replayed line. */
  bestCapture: string | null;
  /** A capture or check occurs within the first three plies. */
  hasTactic: boolean;
}

/** Replay the engine PV (SAN) on fenBefore, up to `maxPlies`, tolerantly. */
function replayPv(fenBefore: string, pv: string[], side: Side, maxPlies = 4): PvReplay | null {
  let board: Chess;
  try {
    board = new Chess(fenBefore);
  } catch {
    return null;
  }
  const startMaterial = material(fenBefore);
  const out: PvReplay = { moves: [], afterFirst: null, moverGain: 0, bestCapture: null, hasTactic: false };
  let bestCaptureValue = 0;
  for (let i = 0; i < Math.min(pv.length, maxPlies); i++) {
    const san = pv[i];
    if (!san) break;
    let mv: ReturnType<Chess['move']>;
    try {
      mv = board.move(san);
    } catch {
      break;
    }
    const rp: ReplayedMove = { san: mv.san, piece: mv.piece, captured: mv.captured ?? null, from: mv.from, to: mv.to, flags: mv.flags, check: /[+#]$/.test(mv.san) };
    out.moves.push(rp);
    if (i === 0) out.afterFirst = new Chess(board.fen());
    if (i < 3 && (rp.captured || rp.check)) out.hasTactic = true;
    if (i % 2 === 0 && rp.captured) {
      const v = PIECE_VALUE[rp.captured] ?? 0;
      if (v > bestCaptureValue) {
        bestCaptureValue = v;
        out.bestCapture = rp.captured;
      }
    }
    if (i % 2 === 1) {
      // Only trust a material count once the opponent has answered.
      const delta = material(board.fen()) - startMaterial;
      out.moverGain = side === 'white' ? delta : -delta;
    }
  }
  return out.moves.length > 0 ? out : null;
}

/** A quiet minor-piece move off the back rank early in the game. */
function isDeveloping(row: MoveRow, played: ReplayedMove): boolean {
  if (row.ply > 16 || played.captured || played.check) return false;
  if (played.piece !== 'n' && played.piece !== 'b') return false;
  return played.from.endsWith(row.side === 'white' ? '1' : '8');
}

/**
 * Plain-language explanation for a report row given its final classification.
 * Coach prose passes through when it matches the verdict; otherwise templates
 * apply in priority order (see the module doc), and anything the board can't
 * verify falls back to generic eval-based phrasing. 1–2 sentences, second
 * person, no emoji — same voice as lib/coach.ts.
 */
export function explainMove(row: MoveRow, classification: Classification): string {
  // The coach already wrote prose for this exact verdict — reuse it.
  if (row.coachExplanation && row.coachGrade === classification) return row.coachExplanation;

  if (row.isMate) {
    // row.isMate is data-derived in buildRows (SAN '#' fast path, cross-checked
    // with checkmateWinner from lib/coach).
    return 'Checkmate — the game ends here.';
  }

  const { side } = row;
  const playedIsBest = isEngineBestMove(row);
  const bad = BAD_GRADES.has(classification);
  const drop = Math.max(0, povWin(row.winBefore, side) - povWin(row.winAfter, side));
  const moverCpBefore = povCp(cpValue(row.evalBefore), side);
  const moverCpAfter = povCp(cpValue(row.evalAfter), side);
  // Never claim a better move existed when the played move IS the engine's
  // first choice — the app's own data would contradict the prose (fix A).
  const best = !playedIsBest && row.bestMoveSan && row.bestMoveSan !== row.san ? row.bestMoveSan : null;

  // — Missed mate: the mover had a forced mate and the played move lost it —
  const hadMate = mateFor(row.evalBefore, side);
  if (hadMate !== null && !playedIsBest && mateFor(row.evalAfter, side) === null) {
    return row.bestMoveSan
      ? `You had mate in ${hadMate} starting with ${row.bestMoveSan}.`
      : `You had a forced mate in ${hadMate} here.`;
  }

  const reply = replyContext(row);
  const replySan = row.bestReplySan ?? reply?.mv.san ?? null;

  // — Allowed mate, with a cheap back-rank read on the replied move —
  const allowsMate = mateAgainst(row.evalAfter, side);
  if (bad && allowsMate !== null && mateAgainst(row.evalBefore, side) === null) {
    if (reply && replySan) {
      const homeRank = side === 'white' ? '1' : '8';
      const backRank = reply.mv.check && (reply.mv.piece === 'r' || reply.mv.piece === 'q') && reply.mv.to.endsWith(homeRank);
      if (backRank) return `This exposes your weak back rank — ${replySan} leads to mate in ${allowsMate}.`;
      return `This walks into a forced mate in ${allowsMate}, starting with ${replySan}.`;
    }
    return `This walks into a forced mate in ${allowsMate}.`;
  }

  // — Hung piece: the best reply simply wins the material the move left loose —
  const lostToReply = reply ? moverLoss(row, reply.board) : 0;
  if (bad && reply?.mv.captured && replySan && lostToReply >= 1.5) {
    return `This leaves the ${pieceName(reply.mv.captured)} hanging — ${replySan} just takes it.`;
  }

  // — Allowed tactic: the reply forks, or checks/captures after a big swing —
  if (bad && drop >= 20 && reply && replySan) {
    const forks = forkTargets(reply.board, reply.mv.to);
    if (forks.length >= 2) return `This allows ${replySan}, forking your ${forkPhrase(forks)}.`;
    if (reply.mv.check || reply.mv.captured) {
      return `This allows ${replySan} — your position slips to ${advWord(moverCpAfter)}.`;
    }
  }

  // — Missed tactic: the engine line the mover skipped forks or wins material —
  if (bad && !playedIsBest && row.bestMoveSan && row.pv.length > 0) {
    const line = replayPv(row.fenBefore, row.pv, side);
    if (line) {
      const first = line.moves[0];
      if (first && line.afterFirst) {
        const forks = forkTargets(line.afterFirst, first.to);
        if (forks.length >= 2) return `You missed a fork — ${row.bestMoveSan} attacks the ${forkPhrase(forks)}.`;
      }
      const pvText = row.pv.slice(0, 3).join(' ');
      if (line.moverGain >= 2 && line.bestCapture) {
        return classification === 'miss'
          ? `Missed win — ${row.bestMoveSan} wins the ${pieceName(line.bestCapture)}: ${pvText}.`
          : `You missed ${row.bestMoveSan}, winning the ${pieceName(line.bestCapture)}: ${pvText}.`;
      }
      if (line.hasTactic) {
        return classification === 'miss'
          ? `Missed win — ${row.bestMoveSan} was the move: ${pvText}.`
          : `You missed a stronger idea — ${row.bestMoveSan} was the move: ${pvText}.`;
      }
    }
  }

  // — Per-grade fallbacks: generic, eval-based, mirroring lib/coach.ts's tone —
  const played = playedContext(row);
  switch (classification) {
    case 'book':
      return 'Still in opening theory — a well-established book move.';
    case 'brilliant':
      return `A ${reply?.mv.captured ? pieceName(reply.mv.captured) : 'material'} sacrifice the engine still rates in your favour — a brilliant resource.`;
    case 'great':
      return povWin(row.winBefore, side) < 50
        ? 'Great move — the resource that turns the game back in your favour.'
        : 'Great move — the only move that keeps your advantage together.';
    case 'best': {
      if (played && /[kq]/.test(played.flags)) return 'Best move — tucking your king to safety by castling.';
      if (played?.captured && lostToReply <= -0.5) return `Best move — winning the ${pieceName(played.captured)}.`;
      if (played?.captured && reply?.mv.captured && Math.abs(lostToReply) < 0.5) {
        return `Best move — a fair trade. You're ${advWord(moverCpAfter)}.`;
      }
      if (row.isCheck) return `Best move — a strong check that keeps the initiative. You're ${advWord(moverCpAfter)}.`;
      return `Best move. You're ${advWord(moverCpAfter)}.`;
    }
    case 'good': {
      if (played && isDeveloping(row, played)) return 'A solid developing move.';
      if (povWin(row.winAfter, side) >= 60) {
        return best ? `Keeps your advantage — though ${best} was slightly more precise.` : 'A solid move that keeps your advantage.';
      }
      return best ? `A solid move; the engine slightly preferred ${best}.` : 'A solid, accurate move.';
    }
    case 'inaccuracy':
      // Only claim an "edge" the mover actually had; from a worse position the
      // better move was a defence, not a way to keep an advantage.
      if (povWin(row.winBefore, side) < 50) {
        return best ? `Inaccurate — ${best} was a tougher defence.` : 'Inaccurate — there was a tougher defence.';
      }
      return best ? `Inaccurate — ${best} would have kept more of your edge.` : 'Inaccurate — there was a more precise move.';
    case 'mistake':
      return `A mistake — it lets your position slip to ${advWord(moverCpAfter)}.${best ? ` ${best} was stronger.` : ''}`;
    case 'blunder':
      return `Blunder — it swings the game to ${advWord(moverCpAfter)}.${best ? ` ${best} was needed.` : ''}`;
    case 'miss':
      return `Missed win — you were ${advWord(moverCpBefore)}, but ${best ?? 'the engine line'} was the way to convert.`;
  }
}
