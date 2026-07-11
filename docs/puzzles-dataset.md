# Tactics puzzle dataset

The bundled tactics puzzles come from the **Lichess open puzzle database**,
plus 15 hand-audited legacy positions.

- Source: <https://database.lichess.org/#puzzles>
  (`lichess_db_puzzle.csv.zst`, ~6M puzzles; columns
  `PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags`)
- License: **CC0 1.0 (public domain)** — no attribution required; we credit
  Lichess here anyway. `GameUrl`/`OpeningTags` are dropped from the bundled
  data to save bytes.
- Import date of the current snapshot: 2026-07-09.

## What ships

| Asset | Contents |
| --- | --- |
| `apps/web/public/puzzles/band-XXXX.json` (10 files, ~6.6 MB total) | Full curated set: 50,000 puzzles, 5,000 per 200-Elo rating band from 600–800 up to 2400–2600. Lazily fetchable; not part of the JS bundle. |
| `apps/web/public/puzzles/index.json` | Band manifest (file, rating range, count). |
| `apps/web/src/trainers/tacticsCore.json` (~200 KB) | Embedded core set: 1,500 puzzles (150 per band), a strict subset of the band files, compiled into the bundle so the trainer (and the daily puzzle) works fully offline. |
| `apps/web/src/trainers/tactics.ts` | Exports `PUZZLES` = 15 legacy puzzles (stable ids `t2…t49`, kept so SRS decks keyed `tactics:<id>` retain history) + the decoded core set. Imported ids are `lc_<LichessPuzzleId>`. |

### Row format

Band files and `tacticsCore.json` store compact rows:

```
[id, fen, moves, rating, themes]
```

- `id` — `'lc_' + PuzzleId`
- `fen` — position **after** Lichess's opponent setup move (`Moves[0]`); the
  solver is to move (the app's convention: `solution[0]` is the player's key
  move)
- `moves` — the solution in UCI, space-joined (`Moves.slice(1)`); alternates
  player/opponent and ends on a player move (odd ply count)
- `rating` — Lichess puzzle rating (number)
- `themes` — Lichess theme tags, space-joined

Decode with `decodePuzzleRow` in `apps/web/src/trainers/tactics.ts`, which also
derives `turn` from the FEN, a display `theme` label, and `difficulty`
(rating < 1300 → easy, < 1800 → medium, else hard).

## Sampling spec

Everything lives as constants in `scripts/import-lichess-puzzles.mjs`:

- **Bands:** 10 × 200 Elo, `[600,800) … [2400,2600)`, 5,000 puzzles each.
- **Quality filters:** `RatingDeviation <= 100`, `Popularity >= 70`,
  `NbPlays >= 200`. (No relaxation was needed — the thinnest band, 2400–2600,
  still had ~78k candidates on the 2026-07 snapshot.)
- **Ordering:** candidates sorted by `Popularity desc, NbPlays desc,
  PuzzleId asc` — fully deterministic, no RNG; re-running the importer on the
  same CSV reproduces byte-identical output (verified).
- **Theme diversity:** per band, up to 25 puzzles are first reserved for each
  major theme (`mateIn1/2/3, fork, pin, skewer, discoveredAttack,
  backRankMate, hangingPiece, deflection, attraction, sacrifice, doubleCheck,
  promotion, endgame, zugzwang, smotheredMate, trappedPiece, intermezzo,
  exposedKing, quietMove, advancedPawn`), then the band is filled greedily by
  popularity with a cap: no *primary* theme may exceed 15% of a band.
- **Core set:** re-runs the same algorithm over each band's selected 5,000
  (target 150/band, quota 3/theme) — so the core is a subset of the band files.
- **Validation (import time):** every selected puzzle is replayed with
  chess.js — FEN parses, setup + every solution move legal, odd solution
  length, `mateIn1/2/3` lines end in checkmate at the right ply. Failures are
  dropped and counted (0 dropped on the 2026-07 snapshot).

## Regenerating

```sh
curl -LO https://database.lichess.org/lichess_db_puzzle.csv.zst
node scripts/import-lichess-puzzles.mjs lichess_db_puzzle.csv.zst   # needs the zstd CLI
# or: zstdcat lichess_db_puzzle.csv.zst | node scripts/import-lichess-puzzles.mjs -
pnpm validate:puzzles
```

The importer rewrites only the JSON assets; `tactics.ts` is hand-maintained.

## Consuming the dataset

- **Client (the required path):** `apps/web/src/lib/puzzleService.ts` owns
  selection. It serves the embedded core synchronously, lazily fetches
  `/puzzles/band-*.json` around the player's rating, and falls back to the
  core when a fetch fails, so the trainer works offline. Key API:
  `getNextPuzzle({ rating, themes?, excludeIds?, difficulty? })`,
  `recordResult(puzzle, solved)` (existing Elo/Glicko-2 'puzzles' rating +
  solved-id persistence), `getDailyPuzzle(dateStr)` (deterministic, from the
  core set), `getLoadedPuzzles()`, `checkKeyMove(fen, expected, from, to)`
  (accepts alternate immediate mates, Lichess convention).
- **Server:** none — puzzles are served entirely client-side (bundled core +
  static band files). Nothing on the server reads the dataset.

## Validation gate

`scripts/validate-puzzles.mts` replays **every** bundled puzzle (embedded
`PUZZLES` + all band files), checks id uniqueness, band rating ranges and the
core-subset invariant, and exits non-zero on any failure. It runs in
`pnpm test` (and CI) alongside `validate:trainers`.
