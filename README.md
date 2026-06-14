# ♟ Chesser

A complete chess game and trainer powered by **Stockfish** and **Lc0 / Maia**.

Play against bots across a wide range of strengths and playing **styles**, get
live engine analysis, and (coming next) train your openings, middlegame and
endgames.

> **Status:** Playable. Engine backend (Stockfish analysis + Stockfish/Maia
> bots), the play-vs-bot client, and all three trainers — openings, middlegame
> tactics, and endgames — are in. See the [roadmap](#roadmap).

---

## What's inside

| | |
|---|---|
| **Engines** | Stockfish 17 (analysis + leveled/styled bots) and Lc0 running Maia human-like networks |
| **Levels** | Stockfish bots from ~1320 to 3190 Elo; Maia bots at 1100 / 1500 / 1900 |
| **Styles** | Human-like (Maia), Balanced, Aggressive, Defensive, Positional |
| **Analysis** | Live multi-PV evaluation, eval bar, principal variations in SAN |
| **Trainers** | Opening repertoire drills · engine-verified tactics puzzles · theoretical endgames played out vs Stockfish |
| **Spaced repetition** | Openings and tactics are SM-2 scheduled — “due” counts, streaks, review sessions |
| **Custom repertoires** | Build your own opening libraries — save any line from the board, then drill them |
| **Puzzle rush** | Solve against a 5-minute clock; 3 strikes and you’re out, with a synced high score |
| **Accounts & sync** | Optional username/password accounts sync progress *and repertoires* across devices |
| **Opening explorer** | Master / Lichess game stats for the current position; **＋** saves a move's line straight into a repertoire |
| **Game review** | Auto-annotate every move (blunder / mistake / inaccuracy), with per-side **accuracy %**, ACPL, and a clickable win-probability graph |
| **Learn from mistakes** | Save review-flagged blunders into a drill deck and find the better move (engine-validated); synced across devices |
| **Game library & import** | Save analyzed games to your account; import your real games by Lichess / Chess.com username |
| **Analyze anything** | Paste a FEN or PGN to study any position or game |
| **Quality-of-life** | Move sounds, board themes, premoves, keyboard nav (← → Home End, `f`); Syzygy badge when local tablebases are installed |
| **Tablebase** | Syzygy endgame tablebases — loaded into Stockfish (`SyzygyPath`) for perfect ≤7-man play, and queried via a configurable proxy for move feedback (online or local files) |
| **Clocks** | Real chess clocks with time-control presets (1+0 … 10+5) and increments |
| **Stack** | pnpm monorepo · Node + Fastify + `ws` backend · React + Vite + TypeScript frontend · `chess.js` for rules |

## Trainers

- **Openings** — drill a curated repertoire for White and Black (Italian, Ruy
  Lopez, Najdorf, King's Indian, …) *or build your own*: play a line out on the
  board and **★ Save line** into a personal repertoire, then drill it with the
  same spaced-repetition scheduling. Custom repertoires sync with your account.
- **Middlegame** — practice mode (engine-verified puzzles with SRS) plus a
  **Puzzle Rush**: a 5-minute, 3-strike sprint with ramping difficulty and a
  saved best score.
- **Middlegame (tactics)** — find the one winning move. Puzzles are
  *generated and verified by Stockfish* (`scripts/gen-tactics.mjs` plays
  imperfect engine games, then keeps only positions with a single decisive
  move), so every solution is sound.
- **Endgames** — play out essential theoretical positions (Q/R vs K, two
  bishops, bishop+knight, K+P, connected passers, Lucena, Q vs R, plus drawn
  studies) against a tablebase-perfect or full-strength Stockfish defender, with
  a live eval bar and per-move feedback tracking your technique.

Progress in the openings and tactics trainers is scheduled with a lightweight
SM-2 spaced-repetition system and persisted in the browser, so “Review due”
brings back exactly what you’re about to forget. Create an account (username +
password, hashed with scrypt) to sync that progress across devices — the client
pulls + merges on sign-in and pushes on every change. Accounts live in a JSON
store at `CHESSER_DATA_DIR` (default `data/`).

### Bigger puzzle sets

The shipped tactics are Stockfish-generated, but you can import the full
[Lichess puzzle database](https://database.lichess.org/) (CC0):

```bash
# download + decompress, then:
COUNT=500 MIN_RATING=1000 MAX_RATING=2200 \
  node scripts/import-lichess-puzzles.mjs lichess_db_puzzle.csv
```

### External data (explorer & tablebase)

Both the opening explorer and the tablebase proxy fetch from configurable
upstreams (default: Lichess). Their hosts must be reachable from the server —
allowlist them in sandboxed networks, or they degrade gracefully:

| Feature | Default host | Env override |
|---|---|---|
| Tablebase | `tablebase.lichess.ovh` | `CHESSER_TABLEBASE_URL` |
| Explorer | `explorer.lichess.ovh` | `CHESSER_EXPLORER_MASTERS_URL` / `CHESSER_EXPLORER_LICHESS_URL` |

### Syzygy tablebase

Chesser uses Syzygy endgame tablebases two complementary ways:

1. **In the engine.** If local tablebase files are present, the server points
   Stockfish at them (`SyzygyPath`), so analysis and *every* Stockfish opponent
   — including the endgame trainer’s defender — play and evaluate ≤ N-piece
   endings perfectly, entirely offline.
2. **For move feedback.** The endgame trainer queries `/api/tablebase` for the
   position category and best move. It prefers the online proxy (default: the
   public Lichess tablebase API) because that carries distance-to-zeroing; when
   the upstream is unreachable it falls back to the local files, and otherwise
   to Stockfish.

Local tablebases are auto-detected from `engines/syzygy/`, or from
`CHESSER_SYZYGY_PATH` (one or more directories, joined the way Stockfish’s
`SyzygyPath` expects). Fetch the 3-4-5 set (~1 GB) with:

```bash
pnpm setup:syzygy            # download into engines/syzygy
WITH_SYZYGY=1 pnpm setup:engines   # or fold it into a full engine setup
```

The download is best-effort and resumable; you can also drop `*.rtbw` / `*.rtbz`
files into `engines/syzygy/` by hand. Without any tablebases the app behaves as
before: the online proxy plus full-strength Stockfish. Set
`CHESSER_TABLEBASE_URL` to use a self-hosted proxy, and `SYZYGY_BASE_URL` /
`SYZYGY_SET` to change the download mirror or piece set.

## Architecture

```
chesser/
├── packages/shared/     # TypeScript types + the WebSocket protocol contract
├── apps/server/         # Fastify HTTP + WebSocket; manages UCI engine processes
│   └── src/engine/      #   uci wrapper · manager · analysis · bot · style scoring
├── apps/web/            # React/Vite client (board, analysis, play-vs-bot)
├── engines/             # downloaded/built binaries + Maia nets (git-ignored)
└── scripts/setup-engines.sh
```

The browser never talks to an engine directly. The **server** owns native UCI
engine processes and speaks a small JSON protocol over WebSocket:

- `analyze` → streaming `analysis` updates (multi-PV, scores normalised to
  White's POV, PVs converted to SAN server-side)
- `botMove` → a single `botMove` reply (Stockfish at a target Elo + style, or
  Maia at a target rating)

**Styles** work by running Stockfish with several candidate moves (MultiPV) and,
among the moves it rates near-best, picking the one that best fits the chosen
style (captures/checks/king attacks for aggressive; castling/safe squares for
defensive; central development for positional). It shapes *flavour* without ever
playing an unsound move. **Human-like** play uses Maia directly — a neural net
trained on millions of real human games that, at one node, reproduces how a
player of a given rating actually moves.

## Getting started

Prerequisites: **Node ≥ 20** and **pnpm**. Building Lc0 also needs a C++
toolchain, `ninja`, and (the script handles these) `meson` + Eigen headers.

```bash
pnpm install          # install JS dependencies
pnpm setup:engines    # download Stockfish + Maia nets, build Lc0  (a few minutes)
pnpm dev              # start the engine server and the web client
```

Then open the web app (Vite prints the URL, typically http://localhost:5173).

Engine setup is incremental and resumable. For a quick start without the Lc0
build (Stockfish-only):

```bash
SKIP_LC0=1 pnpm setup:engines
```

### Useful scripts

| Command | Description |
|---|---|
| `pnpm dev` | Run server + web together (with shared types in watch mode) |
| `pnpm dev:server` | Engine server only (default port `8787`) |
| `pnpm dev:web` | Web client only |
| `pnpm build` | Type-check and build all packages |
| `pnpm typecheck` | Type-check everything |
| `pnpm setup:engines` | Install/refresh engines (see `engines/README.md`) |

## Roadmap

- [x] **Phase 0** — Monorepo, engine setup scripts, UCI backend architecture
- [x] **Phase 1a** — Engine server: Stockfish analysis, leveled + styled bots, Maia
- [x] **Phase 1b** — Web client: board, play-vs-bot, live analysis + eval bar, PGN
- [x] **Phase 2** — Opening trainer (repertoire drills, reveal, accuracy)
- [x] **Phase 3** — Middlegame trainer (engine-verified tactics puzzles)
- [x] **Phase 4** — Endgame trainer (theoretical positions vs Stockfish)

- [x] **Phase 5** — Spaced-repetition progress, larger datasets, Syzygy
  tablebase, and chess clocks
- [x] **Phase 6** — Accounts + cross-device sync, opening explorer, PGN import &
  review, and a Lichess puzzle-DB importer
- [x] **Phase 7** — Personal opening repertoires (save lines from the board),
  Puzzle Rush mode, and repertoire sync

- [x] **Phase 8** — One-click explorer→repertoire saving and game-review
  annotations with accuracy %, ACPL, and an eval graph
- [x] **Phase 9** — Learn-from-mistakes drills, game library + Lichess/Chess.com
  import, FEN/PGN analysis, and a UX pack (sounds, themes, premoves, settings)

### Next up

- Opening-name lookup; a stats dashboard (accuracy & puzzles over time)
- Coordinate/board-vision trainer; alternate piece sets

## Credits

- [Stockfish](https://stockfishchess.org/) — GPLv3
- [Leela Chess Zero (Lc0)](https://lczero.org/)
- [Maia Chess](https://maiachess.com/) by the CSSLab — human-like networks
- [chess.js](https://github.com/jhlywa/chess.js) — move generation & validation
