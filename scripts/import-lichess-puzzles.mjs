// Import puzzles from the Lichess puzzle database into trainers/tactics.ts.
//
// The database is a CSV (≈5M rows) published at:
//   https://database.lichess.org/lichess_db_puzzle.csv.zst
//
// Decompress it first (zstd -d lichess_db_puzzle.csv.zst), then:
//   node scripts/import-lichess-puzzles.mjs path/to/lichess_db_puzzle.csv
//
// Options (env vars):
//   COUNT=300          how many puzzles to import (default 200)
//   MIN_RATING=900     inclusive lower bound (default 800)
//   MAX_RATING=2200    inclusive upper bound (default 2200)
//   THEME=fork         only puzzles whose themes include this token
//   OUT=...            output file (default apps/web/src/trainers/tactics.ts)
//
// CSV columns: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
// In Lichess puzzles, FEN is the position before the opponent's setup move; the
// FIRST move in `Moves` is played automatically, then the solver is to move.
import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'apps/server/package.json'));
const { Chess } = require('chess.js');

const INPUT = process.argv[2] ?? process.env.LICHESS_CSV;
const COUNT = Number(process.env.COUNT ?? 200);
const MIN_RATING = Number(process.env.MIN_RATING ?? 800);
const MAX_RATING = Number(process.env.MAX_RATING ?? 2200);
const THEME = process.env.THEME ?? '';
const OUT = process.env.OUT ?? path.join(ROOT, 'apps/web/src/trainers/tactics.ts');

if (!INPUT || !fs.existsSync(INPUT)) {
  console.error('Provide a path to the decompressed Lichess puzzle CSV.');
  console.error('  node scripts/import-lichess-puzzles.mjs lichess_db_puzzle.csv');
  process.exit(1);
}

const THEME_LABELS = {
  mateIn1: 'Mate in 1',
  mateIn2: 'Mate in 2',
  mateIn3: 'Mate in 3',
  mate: 'Checkmate',
  fork: 'Fork',
  pin: 'Pin',
  skewer: 'Skewer',
  discoveredAttack: 'Discovered attack',
  doubleCheck: 'Double check',
  sacrifice: 'Sacrifice',
  deflection: 'Deflection',
  hangingPiece: 'Hanging piece',
  backRankMate: 'Back-rank mate',
  promotion: 'Promotion',
};

function themeLabel(themes) {
  for (const key of Object.keys(THEME_LABELS)) if (themes.includes(key)) return THEME_LABELS[key];
  return 'Tactic';
}
function difficulty(rating) {
  return rating < 1500 ? 'easy' : rating <= 2000 ? 'medium' : 'hard';
}

function writeOut(puzzles) {
  const out =
    `// Imported from the Lichess puzzle database (CC0). Each FEN is the position\n` +
    `// the solver moves in; solution[0] is the key move.\n` +
    `export type Difficulty = 'easy' | 'medium' | 'hard';\n` +
    `export interface Puzzle {\n  id: string;\n  fen: string;\n  solution: string[];\n  theme: string;\n  difficulty: Difficulty;\n  turn: 'white' | 'black';\n}\n\n` +
    `export const PUZZLES: Puzzle[] = ${JSON.stringify(puzzles, null, 2)};\n`;
  fs.writeFileSync(OUT, out);
}

async function main() {
  const rl = readline.createInterface({ input: fs.createReadStream(INPUT), crlfDelay: Infinity });
  const puzzles = [];
  let first = true;
  for await (const line of rl) {
    if (first) {
      first = false;
      if (line.startsWith('PuzzleId')) continue; // header
    }
    const [id, fen, moves, ratingStr, , , , themes = ''] = line.split(',');
    const rating = Number(ratingStr);
    if (!fen || !moves || !Number.isFinite(rating)) continue;
    if (rating < MIN_RATING || rating > MAX_RATING) continue;
    if (THEME && !themes.split(' ').includes(THEME)) continue;

    const uciMoves = moves.split(' ');
    if (uciMoves.length < 2) continue;
    const game = new Chess(fen);
    const setup = uciMoves[0];
    try {
      if (!game.move({ from: setup.slice(0, 2), to: setup.slice(2, 4), promotion: setup[4] })) continue;
    } catch {
      continue;
    }
    puzzles.push({
      id: `lc_${id}`,
      fen: game.fen(),
      solution: uciMoves.slice(1, 13),
      theme: themeLabel(themes),
      difficulty: difficulty(rating),
      turn: game.turn() === 'w' ? 'white' : 'black',
    });
    if (puzzles.length >= COUNT) break;
    if (puzzles.length % 50 === 0) process.stdout.write(`  ${puzzles.length}/${COUNT}\r`);
  }
  rl.close();
  writeOut(puzzles);
  console.log(`\nImported ${puzzles.length} puzzles -> ${path.relative(ROOT, OUT)}`);
}

main();
