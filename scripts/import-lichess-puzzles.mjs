// Reproducible import pipeline for the bundled tactics puzzle dataset.
//
// Source: the Lichess open puzzle database (CC0 / public domain):
//   https://database.lichess.org/lichess_db_puzzle.csv.zst   (~300 MB, ~6M rows)
//
// Usage:
//   node scripts/import-lichess-puzzles.mjs path/to/lichess_db_puzzle.csv.zst
//   node scripts/import-lichess-puzzles.mjs path/to/lichess_db_puzzle.csv
//   zstdcat lichess_db_puzzle.csv.zst | node scripts/import-lichess-puzzles.mjs -
//
// (.zst input is streamed through the `zstd` CLI — `apt-get install zstd` /
// `brew install zstd` — because the file is a multi-frame archive that
// node:zlib's zstd decompressor rejects.)
//
// What it does (all constants below — the sampling spec IS this file):
//   1. FILTER    quality gate: RatingDeviation <= 100, Popularity >= 70,
//                NbPlays >= 200, rating within 600–2600.
//   2. SAMPLE    10 rating bands of 200 Elo; per band keep the deterministic
//                top candidates ordered by (Popularity desc, NbPlays desc,
//                PuzzleId asc), guarantee minimum coverage for each major
//                theme, and cap every primary theme so none dominates.
//   3. CONVERT   Lichess convention -> app convention: the CSV FEN is the
//                position BEFORE the opponent's setup move (Moves[0]); we
//                apply Moves[0], store the resulting FEN, and keep
//                solution = Moves.slice(1) (solution[0] = the player's key
//                move). id = 'lc_' + PuzzleId. GameUrl/OpeningTags dropped.
//   4. VALIDATE  every emitted puzzle is replayed with chess.js: FEN parses,
//                every move (setup + full solution) is legal, the solution
//                has odd length (ends on the player's move), and mateIn1/2/3
//                themed lines actually end in checkmate. Failures are dropped
//                and counted.
//   5. EMIT      - apps/web/public/puzzles/band-XXXX.json  (one per band,
//                  lazily fetchable; compact rows, see ROW FORMAT)
//                - apps/web/public/puzzles/index.json      (band manifest)
//                - apps/web/src/trainers/tacticsCore.json  (embedded core
//                  subset, bundled so the trainer works offline)
//
// ROW FORMAT (band files and tacticsCore.json):
//   [id, fen, moves, rating, themes]
//   id      'lc_' + Lichess PuzzleId
//   fen     position AFTER the setup move — the player is to move
//   moves   solution in UCI, space-joined; moves[0] is the player's key move,
//           the line alternates player/opponent and ends on a player move
//   rating  Lichess puzzle rating (number)
//   themes  Lichess theme tags, space-joined
// Decoding lives in apps/web/src/trainers/tactics.ts (decodePuzzleRow).
//
// The output is fully deterministic for a given input file: no RNG, stable
// sort keys, fixed tie-breaks. Re-running on the same CSV reproduces the
// exact same JSON bytes.
//
// This script never touches apps/web/src/trainers/tactics.ts — that file
// hand-maintains the legacy puzzles and imports tacticsCore.json.
import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// chess.js lives in the workspace packages, not next to this script.
const require = createRequire(path.join(ROOT, 'apps/server/package.json'));
const { Chess } = require('chess.js');

// ---------------------------------------------------------------------------
// SAMPLING SPEC (change these constants to change the dataset, then re-run)
// ---------------------------------------------------------------------------

/** Rating bands: [min, max) — 10 bands, 600–2600. */
export const BANDS = Array.from({ length: 10 }, (_, i) => [600 + i * 200, 800 + i * 200]);

/** Quality filters applied to every candidate row. */
export const MIN_RATING_DEVIATION = 100; // RatingDeviation <= 100
export const MIN_POPULARITY = 70; //        Popularity >= 70
export const MIN_NB_PLAYS = 200; //         NbPlays >= 200

/** Puzzles selected per band (full set) and per band in the embedded core. */
export const BAND_TARGET = 5000;
export const CORE_BAND_TARGET = 150;

/** No primary theme may take more than this fraction of a band. */
export const PRIMARY_THEME_CAP_FRAC = 0.15;

/** Guaranteed minimum coverage per band: up to this many puzzles carrying
 *  each MAJOR_THEMES tag are reserved before the popularity-greedy fill. */
export const MAJOR_THEME_QUOTA = 25;
export const CORE_MAJOR_THEME_QUOTA = 3;

/** Themes we guarantee coverage of inside every band (when candidates exist). */
export const MAJOR_THEMES = [
  'mateIn1',
  'mateIn2',
  'mateIn3',
  'fork',
  'pin',
  'skewer',
  'discoveredAttack',
  'backRankMate',
  'hangingPiece',
  'deflection',
  'attraction',
  'sacrifice',
  'doubleCheck',
  'promotion',
  'endgame',
  'zugzwang',
  'smotheredMate',
  'trappedPiece',
  'intermezzo',
  'exposedKing',
  'quietMove',
  'advancedPawn',
];

/** Primary-theme priority, most specific first. A puzzle's primary theme is
 *  the FIRST entry of this list present in its Themes column ('tactic' if
 *  none). Used for the per-band anti-domination cap.
 *  KEEP IN SYNC with THEME_PRIORITY in apps/web/src/trainers/tactics.ts. */
export const THEME_PRIORITY = [
  'smotheredMate',
  'backRankMate',
  'arabianMate',
  'anastasiaMate',
  'bodenMate',
  'doubleBishopMate',
  'hookMate',
  'dovetailMate',
  'killBoxMate',
  'vukovicMate',
  'mateIn1',
  'mateIn2',
  'mateIn3',
  'mateIn4',
  'mateIn5',
  'mate',
  'doubleCheck',
  'discoveredAttack',
  'fork',
  'pin',
  'skewer',
  'deflection',
  'attraction',
  'sacrifice',
  'interference',
  'intermezzo',
  'clearance',
  'xRayAttack',
  'capturingDefender',
  'hangingPiece',
  'trappedPiece',
  'underPromotion',
  'promotion',
  'enPassant',
  'zugzwang',
  'quietMove',
  'defensiveMove',
  'exposedKing',
  'kingsideAttack',
  'queensideAttack',
  'attackingF2F7',
  'advancedPawn',
  'endgame',
];

/** Per-band candidate pool size kept in memory (>> BAND_TARGET so theme caps
 *  never starve the fill; bounded so a 6M-row scan stays in RAM). */
const POOL_LIMIT = 30000;

// Output locations.
const PUBLIC_DIR = path.join(ROOT, 'apps/web/public/puzzles');
const CORE_OUT = path.join(ROOT, 'apps/web/src/trainers/tacticsCore.json');

// ---------------------------------------------------------------------------

function primaryTheme(themes) {
  for (const t of THEME_PRIORITY) if (themes.includes(t)) return t;
  return 'tactic';
}

const bandOf = (rating) => {
  if (!Number.isFinite(rating) || rating < 600 || rating >= 2600) return -1;
  return Math.floor((rating - 600) / 200);
};

/** Deterministic candidate ordering: Popularity desc, NbPlays desc, id asc. */
function cmp(a, b) {
  if (a.pop !== b.pop) return b.pop - a.pop;
  if (a.plays !== b.plays) return b.plays - a.plays;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Convert + validate one candidate. Returns the emit-ready row
 * [id, fen, moves, rating, themes] or null (invalid → dropped).
 */
function convertAndValidate(c) {
  const uci = c.moves.split(' ');
  if (uci.length < 2 || uci.length % 2 !== 0) return null; // setup + odd-length solution
  let game;
  try {
    game = new Chess(c.fen);
  } catch {
    return null;
  }
  // Apply every move (setup + solution); any illegal move drops the puzzle.
  let postSetupFen = '';
  for (let i = 0; i < uci.length; i++) {
    const m = uci[i];
    try {
      if (!game.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] })) return null;
    } catch {
      return null;
    }
    if (i === 0) postSetupFen = game.fen();
  }
  // Mate-themed lines must actually deliver mate.
  const themes = c.themes.split(' ').filter(Boolean);
  const mateN = themes.includes('mateIn1') ? 1 : themes.includes('mateIn2') ? 2 : themes.includes('mateIn3') ? 3 : 0;
  if (mateN) {
    if (!game.isCheckmate()) return null;
    if (uci.length - 1 !== mateN * 2 - 1) return null; // solution plies for mate in N
  }
  return [`lc_${c.id}`, postSetupFen, uci.slice(1).join(' '), c.rating, themes.join(' ')];
}

/**
 * Deterministically select `target` rows from an ordered candidate list.
 * Stage A reserves up to `quota` puzzles per major theme; stage B fills the
 * rest greedily in candidate order. A per-primary-theme cap applies
 * throughout. `rowOf(c)` maps a candidate to its emit row (null = dropped).
 * Returns rows in pick order.
 */
function selectWithQuotas(candidates, target, quota, rowOf) {
  const cap = Math.ceil(target * PRIMARY_THEME_CAP_FRAC);
  const picked = new Map(); // id -> row
  const primaryCount = new Map();

  const tryTake = (c) => {
    if (picked.has(c.id)) return false;
    const prim = primaryTheme(c.themeList);
    if ((primaryCount.get(prim) ?? 0) >= cap) return false;
    const row = rowOf(c);
    if (row === null) return false;
    picked.set(c.id, row);
    primaryCount.set(prim, (primaryCount.get(prim) ?? 0) + 1);
    return true;
  };

  // Stage A: guaranteed coverage of every major theme.
  for (const theme of MAJOR_THEMES) {
    let taken = 0;
    for (const c of candidates) {
      if (taken >= quota || picked.size >= target) break;
      if (!c.themeList.includes(theme)) continue;
      if (tryTake(c)) taken++;
    }
  }
  // Stage B: greedy fill in candidate order under the primary-theme cap.
  for (const c of candidates) {
    if (picked.size >= target) break;
    tryTake(c);
  }
  return [...picked.values()];
}

/**
 * Band selection: candidates that fail chess.js conversion/validation are
 * dropped (counted in stats) and skipped; results are re-sorted for emission.
 */
function selectFromPool(sorted, target, quota, stats) {
  const rowCache = new Map(); // id -> row | null (validation memo)
  const validated = (c) => {
    if (!rowCache.has(c.id)) {
      const row = convertAndValidate(c);
      if (row === null) stats.dropped++;
      rowCache.set(c.id, row);
    }
    return rowCache.get(c.id);
  };
  // Emission order: rating asc, id asc (stable, human-scannable).
  return selectWithQuotas(sorted, target, quota, validated).sort(
    (a, b) => a[3] - b[3] || (a[0] < b[0] ? -1 : 1),
  );
}

async function readCandidates(input) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const pools = BANDS.map(() => []);
  let rows = 0;
  let first = true;
  for await (const line of rl) {
    if (first) {
      first = false;
      if (line.startsWith('PuzzleId')) continue;
    }
    if (!line) continue;
    rows++;
    if (rows % 1000000 === 0) process.stderr.write(`  scanned ${rows / 1e6}M rows...\n`);
    // CSV: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
    // (no quoted fields in this dataset — plain split is safe)
    const [id, fen, moves, ratingS, rdS, popS, playsS, themes = ''] = line.split(',');
    const rating = Number(ratingS);
    const band = bandOf(rating);
    if (band < 0) continue;
    if (!(Number(rdS) <= MIN_RATING_DEVIATION)) continue;
    const pop = Number(popS);
    if (!(pop >= MIN_POPULARITY)) continue;
    const plays = Number(playsS);
    if (!(plays >= MIN_NB_PLAYS)) continue;
    if (!id || !fen || !moves) continue;
    const pool = pools[band];
    pool.push({ id, fen, moves, rating, pop, plays, themes });
    if (pool.length > POOL_LIMIT * 2) {
      pool.sort(cmp);
      pool.length = POOL_LIMIT;
    }
  }
  for (const pool of pools) {
    pool.sort(cmp);
    if (pool.length > POOL_LIMIT) pool.length = POOL_LIMIT;
  }
  return { pools, rows };
}

function openInput(arg) {
  if (!arg) {
    console.error('Usage: node scripts/import-lichess-puzzles.mjs <lichess_db_puzzle.csv[.zst] | ->');
    process.exit(1);
  }
  if (arg === '-') return process.stdin;
  if (!fs.existsSync(arg)) {
    console.error(`Input not found: ${arg}`);
    process.exit(1);
  }
  if (arg.endsWith('.zst')) {
    const child = spawn('zstdcat', [arg], { stdio: ['ignore', 'pipe', 'inherit'] });
    child.on('error', () => {
      console.error('Failed to spawn `zstdcat` — install zstd (apt-get install zstd) or decompress first.');
      process.exit(1);
    });
    return child.stdout;
  }
  return fs.createReadStream(arg);
}

async function main() {
  const input = openInput(process.argv[2]);
  console.log('Scanning Lichess puzzle CSV (streaming)...');
  const { pools, rows } = await readCandidates(input);
  console.log(`Scanned ${rows} rows.`);

  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  const stats = { dropped: 0 };
  const manifest = [];
  const coreRows = [];
  const themeTotals = new Map();

  for (let b = 0; b < BANDS.length; b++) {
    const [min, max] = BANDS[b];
    // themeList is materialized per band (kept out of the scan pools for RAM).
    const pool = pools[b].map((c) => ({ ...c, themeList: c.themes.split(' ').filter(Boolean) }));
    const rowsOut = selectFromPool(pool, BAND_TARGET, MAJOR_THEME_QUOTA, stats);
    if (rowsOut.length < BAND_TARGET) {
      console.warn(`  ! band ${min}-${max}: only ${rowsOut.length}/${BAND_TARGET} after filters/caps`);
    }
    const file = `band-${String(min).padStart(4, '0')}.json`;
    fs.writeFileSync(
      path.join(PUBLIC_DIR, file),
      JSON.stringify({ v: 1, min, max, count: rowsOut.length, rows: rowsOut }),
    );
    manifest.push({ file, min, max, count: rowsOut.length });

    // Embedded core: re-select a small subset from this band's emitted rows
    // (same deterministic algorithm, smaller target/quota).
    const selectedAsCandidates = rowsOut.map((r) => {
      const themes = r[4];
      return {
        id: r[0].slice(3),
        fen: '',
        moves: '',
        rating: r[3],
        pop: 0,
        plays: 0,
        themes,
        themeList: themes.split(' '),
        row: r,
      };
    });
    // Preserve the band-pool popularity order for the core pick.
    const orderIndex = new Map(rowsOut.map((r) => [r[0], 0]));
    let i = 0;
    for (const c of pool) if (orderIndex.has(`lc_${c.id}`)) orderIndex.set(`lc_${c.id}`, i++);
    selectedAsCandidates.sort((a, b) => orderIndex.get(`lc_${a.id}`) - orderIndex.get(`lc_${b.id}`));
    const core = selectCore(selectedAsCandidates, CORE_BAND_TARGET, CORE_MAJOR_THEME_QUOTA);
    coreRows.push(...core);

    for (const r of rowsOut) {
      const prim = primaryTheme(r[4].split(' '));
      themeTotals.set(prim, (themeTotals.get(prim) ?? 0) + 1);
    }
    console.log(`  band ${min}-${max}: pool ${pool.length} -> ${rowsOut.length} puzzles (core ${core.length})`);
  }

  coreRows.sort((a, b) => a[3] - b[3] || (a[0] < b[0] ? -1 : 1));
  fs.writeFileSync(CORE_OUT, JSON.stringify(coreRows));

  const total = manifest.reduce((n, m) => n + m.count, 0);
  fs.writeFileSync(
    path.join(PUBLIC_DIR, 'index.json'),
    JSON.stringify(
      {
        v: 1,
        source: 'Lichess puzzle database (CC0) — https://database.lichess.org/#puzzles',
        format: 'rows: [id, fen, moves, rating, themes] — see scripts/import-lichess-puzzles.mjs',
        total,
        bands: manifest,
      },
      null,
      2,
    ),
  );

  console.log(`\nEmitted ${total} puzzles across ${manifest.length} band files -> ${path.relative(ROOT, PUBLIC_DIR)}/`);
  console.log(`Embedded core set: ${coreRows.length} puzzles -> ${path.relative(ROOT, CORE_OUT)}`);
  console.log(`Dropped by chess.js validation during selection: ${stats.dropped}`);
  console.log('\nPrimary-theme distribution (full set):');
  for (const [t, n] of [...themeTotals.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${t}: ${n}`);
}

/** Core selection over already-validated rows (no re-validation needed). */
function selectCore(candidates, target, quota) {
  return selectWithQuotas(candidates, target, quota, (c) => c.row);
}

main();
