// Validate the curated trainer datasets (mate patterns, anti-blunder positions
// and calculation puzzles) with chess.js: every FEN must be legal, every mating
// line must actually mate, every blunder refutation must be a forced mate, and
// every calculation line must be legal. Run with the workspace's tsx:
//
//   pnpm validate:trainers
//
// This keeps the hand-authored chess data honest.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// chess.js lives in the workspace packages, not next to this script (same trick
// the gen-* scripts use).
const require = createRequire(path.join(ROOT, 'apps/server/package.json'));
const { Chess } = require('chess.js');

import { MATE_DRILLS } from '../apps/web/src/trainers/mates.ts';
import { BLUNDER_POSITIONS } from '../apps/web/src/trainers/blunders.ts';
import { CALC_PUZZLES } from '../apps/web/src/trainers/calc.ts';

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

if (failures) {
  console.error(`\n✗ ${failures} problem(s) found.\n`);
  process.exit(1);
} else {
  console.log(`\n✓ All trainer datasets valid.\n`);
}
