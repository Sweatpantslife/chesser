// Validate the bundled trainer datasets (mate patterns, anti-blunder positions,
// calculation puzzles, tactics puzzles, endgame studies and opening lines) with
// chess.js: every FEN must be legal, every mating line must actually mate,
// every blunder refutation must be a forced mate, every solution/opening line
// must be legal move by move. Run with the workspace's tsx:
//
//   pnpm validate:trainers
//
// This keeps the hand-authored and generated chess data honest — a puzzle whose
// solution can't be replayed from its FEN is unsolvable as served (the tactics
// set is also what the blindfold trainer draws its 'easy' puzzles from).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// chess.js lives in the workspace packages, not next to this script (same trick
// the gen-* scripts use).
const require = createRequire(path.join(ROOT, 'apps/server/package.json'));
const { Chess } = require('chess.js');

import { mateInOneUci } from '../apps/web/src/lib/threats.ts';
import { MATE_DRILLS } from '../apps/web/src/trainers/mates.ts';
import { BLUNDER_POSITIONS } from '../apps/web/src/trainers/blunders.ts';
import { CALC_PUZZLES } from '../apps/web/src/trainers/calc.ts';
import { PUZZLES } from '../apps/web/src/trainers/tactics.ts';
import { ENDGAMES } from '../apps/web/src/trainers/endgames.ts';
import { ENDGAME_DRILLS } from '../apps/web/src/trainers/endgameDrills.ts';
import { OPENING_LINES } from '../apps/web/src/trainers/openings.ts';

let failures = 0;
const fail = (id: string, msg: string) => {
  failures++;
  console.error(`  ✗ ${id}: ${msg}`);
};

const uci = (m: string) => ({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] as string | undefined });

function tryMove(game: any, m: string | { from: string; to: string; promotion?: string }): boolean {
  try {
    const res = game.move(m);
    return !!res;
  } catch {
    return false;
  }
}

console.log(`\nMate patterns (${MATE_DRILLS.length} drills)`);
for (const d of MATE_DRILLS) {
  let game: any;
  try {
    game = new Chess(d.fen);
  } catch (e) {
    fail(d.id, `illegal FEN: ${(e as Error).message}`);
    continue;
  }
  const sideToMove = game.turn() === 'w' ? 'white' : 'black';
  if (sideToMove !== d.turn) fail(d.id, `turn mismatch: FEN says ${sideToMove}, drill says ${d.turn}`);
  let ok = true;
  for (const mv of d.solution) {
    if (!tryMove(game, uci(mv))) {
      fail(d.id, `illegal solution move ${mv} (after ${game.history().join(' ') || 'start'})`);
      ok = false;
      break;
    }
  }
  if (ok && !game.isCheckmate()) fail(d.id, `solution does not end in checkmate (final ${game.fen()})`);
  const expectedMateIn = Math.ceil(d.solution.length / 2);
  if (d.mateIn !== expectedMateIn) fail(d.id, `mateIn ${d.mateIn} != computed ${expectedMateIn}`);
}

console.log(`\nAnti-blunder positions (${BLUNDER_POSITIONS.length})`);
for (const b of BLUNDER_POSITIONS) {
  let game: any;
  try {
    game = new Chess(b.fen);
  } catch (e) {
    fail(b.id, `illegal FEN: ${(e as Error).message}`);
    continue;
  }
  const sideToMove = game.turn() === 'w' ? 'white' : 'black';
  if (sideToMove !== b.turn) fail(b.id, `turn mismatch: FEN says ${sideToMove}, says ${b.turn}`);
  // tempting + best[0] must be legal from the starting position.
  if (!tryMove(new Chess(b.fen), uci(b.tempting))) fail(b.id, `tempting move ${b.tempting} is illegal`);
  if (!b.best[0] || !tryMove(new Chess(b.fen), uci(b.best[0]))) fail(b.id, `best move ${b.best[0]} is illegal`);
  if (b.refutation[0] !== b.tempting) fail(b.id, `refutation must start with the tempting move`);
  // The refutation must be a forced mate.
  const rg = new Chess(b.fen);
  let ok = true;
  for (const mv of b.refutation) {
    if (!tryMove(rg, uci(mv))) {
      fail(b.id, `illegal refutation move ${mv}`);
      ok = false;
      break;
    }
  }
  if (ok && !rg.isCheckmate()) fail(b.id, `refutation does not end in checkmate (final ${rg.fen()})`);
  // The trainer busts any move that leaves the opponent a mate-in-one, so the
  // model move must genuinely survive that check (and the tempting one fail it).
  const bg = new Chess(b.fen);
  if (b.best[0] && tryMove(bg, uci(b.best[0]))) {
    const hangs = mateInOneUci(bg.fen());
    if (hangs) fail(b.id, `best move ${b.best[0]} still allows mate-in-one (${hangs})`);
  }
}

console.log(`\nCalculation puzzles (${CALC_PUZZLES.length})`);
for (const c of CALC_PUZZLES) {
  let game: any;
  try {
    game = new Chess(c.fen);
  } catch (e) {
    fail(c.id, `illegal FEN: ${(e as Error).message}`);
    continue;
  }
  let ok = true;
  for (const san of c.line) {
    if (!tryMove(game, san)) {
      fail(c.id, `illegal line move ${san} (after ${game.history().join(' ') || 'start'})`);
      ok = false;
      break;
    }
  }
  if (c.answer < 0 || c.answer >= c.choices.length) fail(c.id, `answer index ${c.answer} out of range`);
  if (ok) {
    const hist = game.history({ verbose: true });
    const last = hist[hist.length - 1];
    // Print enough to eyeball that choices[answer] is correct.
    console.log(
      `  · ${c.id}: last=${last?.san} to=${last?.to} check=${game.isCheck()} mate=${game.isCheckmate()} → answer="${c.choices[c.answer]}"`,
    );
  }
}

console.log(`\nTactics puzzles (${PUZZLES.length}) — also serves the blindfold trainer ('easy' subset)`);
for (const p of PUZZLES) {
  let game: any;
  try {
    game = new Chess(p.fen);
  } catch (e) {
    fail(p.id, `illegal FEN: ${(e as Error).message}`);
    continue;
  }
  const sideToMove = game.turn() === 'w' ? 'white' : 'black';
  if (sideToMove !== p.turn) fail(p.id, `turn mismatch: FEN says ${sideToMove}, puzzle says ${p.turn}`);
  if (!p.solution.length) {
    fail(p.id, 'empty solution');
    continue;
  }
  // The whole solution line must replay legally from the FEN (the key move is
  // what the tactics/rush/blindfold trainers accept; the rest is animated).
  for (const mv of p.solution) {
    if (!tryMove(game, uci(mv))) {
      fail(p.id, `illegal solution move ${mv} (after ${game.history().join(' ') || 'start'})`);
      break;
    }
  }
  // "Mate in 1" puzzles must actually mate with the key move.
  if (p.theme === 'Mate in 1') {
    const g1 = new Chess(p.fen);
    if (!tryMove(g1, uci(p.solution[0]!)) || !g1.isCheckmate()) fail(p.id, `theme "Mate in 1" but the key move does not mate`);
  }
}

console.log(`\nEndgame studies (${ENDGAMES.length})`);
for (const s of ENDGAMES) {
  let game: any;
  try {
    game = new Chess(s.fen);
  } catch (e) {
    fail(s.id, `illegal FEN: ${(e as Error).message}`);
    continue;
  }
  if (game.isGameOver()) fail(s.id, `study starts in a finished position (${s.fen})`);
  const sideToMove = game.turn() === 'w' ? 'white' : 'black';
  if (sideToMove !== s.youPlay) fail(s.id, `it must be your move at the start: FEN says ${sideToMove}, youPlay is ${s.youPlay}`);
  // Curated studies start from a quiet position — never with the trainee in
  // check (the old rook-draw FEN began in check with the checking rook en prise).
  if (game.inCheck()) fail(s.id, `study starts with ${sideToMove} in check (${s.fen})`);
}

// Endgame drills bundle a principal variation ("book line") for offline play,
// so beyond the study checks the whole solution must replay legally with the
// exact canonical SAN the page compares against, and the final position must
// actually deliver the advertised goal.
console.log(`\nEndgame drills (${ENDGAME_DRILLS.length})`);
const drillIds = new Set<string>();
for (const d of ENDGAME_DRILLS) {
  if (drillIds.has(d.id)) fail(d.id, 'duplicate id');
  drillIds.add(d.id);
  if (d.goal !== 'win' && d.goal !== 'draw') fail(d.id, `goal must be 'win' or 'draw', got '${d.goal}'`);
  if (!d.name || !d.technique) fail(d.id, 'missing name/technique');
  if (!d.lesson || d.lesson.length < 20) fail(d.id, 'lesson blurb missing or too short');
  let game: any;
  try {
    game = new Chess(d.fen);
  } catch (e) {
    fail(d.id, `illegal FEN: ${(e as Error).message}`);
    continue;
  }
  if (game.isGameOver()) fail(d.id, `drill starts in a finished position (${d.fen})`);
  const sideToMove = game.turn() === 'w' ? 'white' : 'black';
  if (sideToMove !== d.youPlay) fail(d.id, `it must be your move at the start: FEN says ${sideToMove}, youPlay is ${d.youPlay}`);
  if (game.inCheck()) fail(d.id, `drill starts with ${sideToMove} in check (${d.fen})`);
  if (!d.solution.length) {
    fail(d.id, 'empty solution');
    continue;
  }
  // The bundled line must replay legally AND use canonical SAN — the page
  // matches the player's chess.js SAN against these strings offline.
  let ok = true;
  for (const san of d.solution) {
    let res: any;
    try {
      res = game.move(san);
    } catch {
      res = null;
    }
    if (!res) {
      fail(d.id, `illegal solution move ${san} (after ${game.history().join(' ') || 'start'})`);
      ok = false;
      break;
    }
    if (res.san !== san) {
      fail(d.id, `solution move ${san} is not canonical SAN (chess.js says ${res.san})`);
      ok = false;
      break;
    }
  }
  if (!ok) continue;
  const youChar = d.youPlay === 'white' ? 'w' : 'b';
  const defChar = youChar === 'w' ? 'b' : 'w';
  const endsOnPlayer = d.solution.length % 2 === 1; // solutions start with YOUR move
  const defenderBare =
    game
      .board()
      .flat()
      .filter((p: any) => p && p.color === defChar).length === 1;
  const lastSan = d.solution[d.solution.length - 1]!;
  if (d.goal === 'win') {
    const mated = game.isCheckmate() && game.turn() === defChar;
    const queened = endsOnPlayer && lastSan.includes('=Q');
    const bare = endsOnPlayer && defenderBare;
    if (!mated && !queened && !bare)
      fail(d.id, `win drill solution must end in mate, a promotion, or a bare defending king (final ${game.fen()})`);
  } else {
    if (game.isCheckmate()) fail(d.id, `draw drill solution ends in checkmate (final ${game.fen()})`);
    const bookDraw = game.isStalemate() || game.isInsufficientMaterial() || game.isDraw();
    const survival = endsOnPlayer && d.solution.length >= 7;
    if (!bookDraw && !survival)
      fail(d.id, `draw drill solution must end in a book draw or a ≥7-ply survival line ending on your move (final ${game.fen()})`);
  }
}

console.log(`\nOpening lines (${OPENING_LINES.length})`);
for (const l of OPENING_LINES) {
  const game = new Chess();
  for (const san of l.moves) {
    if (!tryMove(game, san)) {
      fail(l.id, `illegal line move ${san} (after ${game.history().join(' ') || 'start'})`);
      break;
    }
  }
}

if (failures) {
  console.error(`\n✗ ${failures} problem(s) found.\n`);
  process.exit(1);
} else {
  console.log(`\n✓ All trainer datasets valid.\n`);
}
