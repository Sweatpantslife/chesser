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
| **Accounts & sync** | Optional username/password accounts sync your progress across devices |
| **Opening explorer** | Master / Lichess game stats for the current position (via a configurable proxy) |
| **PGN review** | Import any PGN and step through it on the analysis board with the engine |
| **Tablebase** | Optional Syzygy lookups (via a configurable proxy) for perfect endgame defence and move feedback |
| **Clocks** | Real chess clocks with time-control presets (1+0 … 10+5) and increments |
| **Stack** | pnpm monorepo · Node + Fastify + `ws` backend · React + Vite + TypeScript frontend · `chess.js` for rules |

## Trainers

- **Openings** — drill a curated repertoire for White and Black (Italian, Ruy
  Lopez, Najdorf, King's Indian, …). The app plays the book replies; you recall
  your moves, with reveal and accuracy tracking.
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

The endgame trainer queries the server’s `/api/tablebase` endpoint, which
proxies a configurable upstream (default: the public Lichess tablebase API) for
positions with ≤ 7 pieces. When a result is available it drives perfect defence
and grades your moves by distance-to-zeroing; otherwise it falls back to
Stockfish automatically. Set `CHESSER_TABLEBASE_URL` to use a self-hosted
instance. (The upstream host must be reachable from the server — some sandboxed
networks block it, in which case the trainer transparently uses Stockfish.)

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

### Next up

- Opening explorer → save lines straight into your repertoire deck
- Tournament/puzzle-rush modes; richer game-review annotations

## Credits

- [Stockfish](https://stockfishchess.org/) — GPLv3
- [Leela Chess Zero (Lc0)](https://lczero.org/)
- [Maia Chess](https://maiachess.com/) by the CSSLab — human-like networks
- [chess.js](https://github.com/jhlywa/chess.js) — move generation & validation
