/**
 * Annotated-PGN export for the game report. Pure function over an
 * {@link AnalysisReport}: reuses lib/pgn.ts's header layout (plus [ECO] /
 * [Opening] when the report knows the opening, and [SetUp]/[FEN] for games
 * from a custom start position — without those the movetext cannot parse),
 * then emits Lichess-style movetext: `<san> <NAG> { [%eval <e>] <comment> }`.
 *
 *  • NAGs from the final classification: brilliant $3, great $1,
 *    inaccuracy $6, mistake $2, blunder $4, miss $2; best/good/book none.
 *  • [%eval] is the White-POV eval AFTER the move, in pawns with two decimals
 *    ("0.35", "-1.20") or "#N"/"#-N" for mate (Lichess [%eval] syntax).
 *  • Notable moves (the NAG'd ones) also get "<Label>. <bestMoveSan> was
 *    best." using CLASSIFICATION_META labels from lib/coach.ts.
 *
 * Output round-trips through chess.js `loadPgn` (verified in the tests).
 */
import { STARTING_FEN } from '@chesser/shared';
import { CLASSIFICATION_META } from '../coach';
import type { PgnMeta } from '../pgn';
import type { AnalysisReport, Classification, MoveDetail } from './types';

/** Standard NAG per classification; quiet grades carry no annotation. */
const CLASSIFICATION_NAG: Partial<Record<Classification, string>> = {
  brilliant: '$3',
  great: '$1',
  inaccuracy: '$6',
  mistake: '$2',
  blunder: '$4',
  miss: '$2',
};

/** Escape a PGN tag value (quotes and backslashes break the tag pair). */
const tagValue = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Comment text must not close the brace pair early. */
const commentText = (v: string) => v.replace(/[{}]/g, '');

/** Lichess [%eval] tag for the position after the move, or null if unknown. */
function evalTag(m: MoveDetail): string | null {
  const ev = m.evalAfter;
  if (!ev) return null;
  if (ev.mate !== undefined) {
    // Mate 0 = the mate is already on the board — nothing left to evaluate.
    if (ev.mate === 0) return null;
    return `[%eval #${ev.mate}]`;
  }
  return `[%eval ${((ev.cp ?? 0) / 100).toFixed(2)}]`;
}

/** NAG + classification comment for one move (both null on quiet grades). */
function annotation(m: MoveDetail): { nag: string | null; note: string | null } {
  let cls = m.classification;
  // A delivered mate can never carry a bad grade in the export, whatever an
  // upstream row said — the mating move ended the game in the mover's favour.
  // Seam: consolidate with checkmateWinner() from lib/coach.ts once fix/coach-trainers lands.
  if ((m.isMate || m.san.endsWith('#')) && cls !== 'brilliant' && cls !== 'great') cls = 'best';
  const nag = CLASSIFICATION_NAG[cls] ?? null;
  if (!nag) return { nag: null, note: null };
  const label = CLASSIFICATION_META[cls].label;
  const best = m.bestMoveSan && m.bestMoveSan !== m.san ? ` ${m.bestMoveSan} was best.` : '';
  return { nag, note: `${label}.${best}` };
}

/** Build the annotated PGN for a finished report. Ends with meta.result. */
export function annotatedPgn(report: AnalysisReport, meta: PgnMeta): string {
  const date = meta.date ?? new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  const headers = [
    `[Event "Chesser game"]`,
    `[Site "Chesser"]`,
    `[Date "${date}"]`,
    `[White "${tagValue(meta.white)}"]`,
    `[Black "${tagValue(meta.black)}"]`,
    `[Result "${meta.result}"]`,
  ];
  if (report.opening.eco) headers.push(`[ECO "${tagValue(report.opening.eco)}"]`);
  if (report.opening.name) headers.push(`[Opening "${tagValue(report.opening.name)}"]`);
  if (report.meta.startFen !== STARTING_FEN) {
    headers.push(`[SetUp "1"]`, `[FEN "${tagValue(report.meta.startFen)}"]`);
  }

  const tokens: string[] = [];
  // Move numbers come from the mover's side and the start FEN's fullmove
  // counter, not ply parity — a black-to-move custom position ("Practice this
  // position" games) must open "N... <san>" with the FEN's own numbering.
  const fullmoveField = Number.parseInt(report.meta.startFen.split(' ')[5] ?? '1', 10);
  let moveNo = Number.isFinite(fullmoveField) && fullmoveField >= 1 ? fullmoveField : 1;
  // PGN convention: a black move restates its number ("3...") at the start of
  // the movetext and after a comment.
  let numberBlack = true;
  for (const m of report.moves) {
    if (m.side === 'white') tokens.push(`${moveNo}.`);
    else if (numberBlack) tokens.push(`${moveNo}...`);
    tokens.push(m.san);

    const { nag, note } = annotation(m);
    if (nag) tokens.push(nag);
    const parts: string[] = [];
    const ev = evalTag(m);
    if (ev) parts.push(ev);
    if (note) parts.push(commentText(note));
    if (parts.length > 0) {
      tokens.push(`{ ${parts.join(' ')} }`);
      numberBlack = true;
    } else {
      numberBlack = false;
    }
    if (m.side === 'black') moveNo += 1;
  }
  tokens.push(meta.result);

  return `${headers.join('\n')}\n\n${tokens.join(' ')}\n`;
}
