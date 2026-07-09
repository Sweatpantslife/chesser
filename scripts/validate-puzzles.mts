// Validate every bundled tactics puzzle — the embedded set exported from
// apps/web/src/trainers/tactics.ts AND the full lazily-fetchable dataset in
// apps/web/public/puzzles/band-*.json — by replaying it with chess.js.
//
//   pnpm validate:puzzles
//
// Checks per puzzle: FEN parses, stated turn matches the FEN side-to-move,
// the solution is non-empty and every move is legal in sequence (player and
// opponent replies), imported (lc_*) solutions have odd length (the line ends
// on the player's move), mateIn1/2/3-themed lines end in checkmate at the
// right ply, and ratings sit inside their band file's range. Ids must be
// globally unique. Exits non-zero on any failure.
//
// Self-contained on purpose: scripts/validate-trainers.mts owns the other
// trainer decks (mates/blunders/calc) — this file only owns tactics puzzles.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// chess.js lives in the workspace packages, not next to this script (same
// trick validate-trainers.mts uses).
const require = createRequire(path.join(ROOT, 'apps/server/package.json'));
const { Chess } = require('chess.js');

import { PUZZLES, CORE_PUZZLES, PUZZLE_BANDS, type PuzzleRow } from '../apps/web/src/trainers/tactics.ts';

let failures = 0;
const fail = (id: string, msg: string) => {
  failures++;
  if (failures <= 50) console.error(`  ✗ ${id}: ${msg}`);
};

interface Checkable {
  id: string;
  fen: string;
  solution: string[];
  turn?: 'white' | 'black';
  rating?: number;
  themes?: string[];
}

function checkPuzzle(p: Checkable): void {
  if (!p.id) return fail('(missing id)', 'empty id');
  let game: any;
  try {
    game = new Chess(p.fen);
  } catch (e) {
    return fail(p.id, `illegal FEN: ${(e as Error).message}`);
  }
  const sideToMove = game.turn() === 'w' ? 'white' : 'black';
  if (p.turn && p.turn !== sideToMove) fail(p.id, `turn mismatch: FEN says ${sideToMove}, puzzle says ${p.turn}`);
  if (!p.solution.length) return fail(p.id, 'empty solution');
  for (const mv of p.solution) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(mv)) return fail(p.id, `malformed UCI move "${mv}"`);
    try {
      if (!game.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] })) {
        return fail(p.id, `illegal solution move ${mv}`);
      }
    } catch {
      return fail(p.id, `illegal solution move ${mv} (after ${game.history().join(' ') || 'start'})`);
    }
  }
  if (p.id.startsWith('lc_')) {
    if (p.solution.length % 2 !== 1) fail(p.id, `imported solution must end on the player's move (got ${p.solution.length} plies)`);
    if (typeof p.rating !== 'number' || !Number.isFinite(p.rating)) fail(p.id, 'imported puzzle is missing its rating');
    const themes = p.themes ?? [];
    if (!themes.length) fail(p.id, 'imported puzzle is missing its themes');
    const mateN = themes.includes('mateIn1') ? 1 : themes.includes('mateIn2') ? 2 : themes.includes('mateIn3') ? 3 : 0;
    if (mateN) {
      if (!game.isCheckmate()) fail(p.id, `mateIn${mateN} line does not end in checkmate`);
      else if (p.solution.length !== mateN * 2 - 1) fail(p.id, `mateIn${mateN} line has ${p.solution.length} plies, expected ${mateN * 2 - 1}`);
    }
  }
}

// --- 1. Embedded set (what the app bundles: legacy + core) -----------------
console.log(`\nEmbedded puzzles (${PUZZLES.length} = ${PUZZLES.length - CORE_PUZZLES.length} legacy + ${CORE_PUZZLES.length} core)`);
const embeddedIds = new Set<string>();
for (const p of PUZZLES) {
  if (embeddedIds.has(p.id)) fail(p.id, 'duplicate id in PUZZLES');
  embeddedIds.add(p.id);
  checkPuzzle(p);
}

// --- 2. Full dataset (public/puzzles/band-*.json) ---------------------------
const PUB = path.join(ROOT, 'apps/web/public/puzzles');
const indexPath = path.join(PUB, 'index.json');
if (!fs.existsSync(indexPath)) {
  fail('index.json', `missing ${path.relative(ROOT, indexPath)} — run scripts/import-lichess-puzzles.mjs`);
} else {
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  // The web client fetches exactly the layout in PUZZLE_BANDS (used by
  // apps/web/src/lib/puzzleService.ts) — if a re-import changes the emitted
  // layout, the client would silently 404 on every band fetch, so fail loudly.
  const expectedBands = PUZZLE_BANDS;
  const indexBands: { file: string; min: number; max: number; count: number }[] = index.bands ?? [];
  if (indexBands.length !== expectedBands.length) {
    fail('index.json', `expected ${expectedBands.length} bands (client layout), found ${indexBands.length}`);
  }
  expectedBands.forEach((e, i) => {
    const b = indexBands[i];
    if (b && (b.file !== e.file || b.min !== e.min || b.max !== e.max)) {
      fail(b.file, `band layout mismatch with client: expected ${e.file} [${e.min},${e.max}), got ${b.file} [${b.min},${b.max})`);
    }
  });
  const bandIds = new Set<string>();
  let total = 0;
  for (const band of indexBands) {
    const file = path.join(PUB, band.file);
    if (!fs.existsSync(file)) {
      fail(band.file, 'band file listed in index.json is missing');
      continue;
    }
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rows: PuzzleRow[] = data.rows ?? [];
    if (data.count !== rows.length) fail(band.file, `count ${data.count} != rows.length ${rows.length}`);
    if (band.count !== rows.length) fail(band.file, `index.json count ${band.count} != rows.length ${rows.length}`);
    for (const row of rows) {
      const [id, fen, moves, rating, themes] = row;
      if (bandIds.has(id)) fail(id, 'duplicate id across band files');
      bandIds.add(id);
      if (rating < data.min || rating >= data.max) fail(id, `rating ${rating} outside band ${data.min}-${data.max}`);
      checkPuzzle({ id, fen, solution: moves.split(' '), rating, themes: themes ? themes.split(' ') : [] });
    }
    total += rows.length;
    console.log(`  · ${band.file}: ${rows.length} puzzles ok so far`);
  }
  if (index.total !== total) fail('index.json', `total ${index.total} != summed band counts ${total}`);
  // The embedded core must be a subset of the published band files.
  for (const p of CORE_PUZZLES) if (!bandIds.has(p.id)) fail(p.id, 'core puzzle missing from band files');
  console.log(`Band files: ${total} puzzles`);
}

if (failures) {
  console.error(`\n✗ ${failures} puzzle problem(s) found.\n`);
  process.exit(1);
} else {
  console.log(`\n✓ All bundled tactics puzzles valid.\n`);
}
