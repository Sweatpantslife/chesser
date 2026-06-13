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
| **Stack** | pnpm monorepo · Node + Fastify + `ws` backend · React + Vite + TypeScript frontend · `chess.js` for rules |

## Trainers

- **Openings** — drill a curated repertoire for White and Black (Italian, Ruy
  Lopez, Najdorf, King's Indian, …). The app plays the book replies; you recall
  your moves, with reveal and accuracy tracking.
- **Middlegame (tactics)** — find the one winning move. Puzzles are
  *generated and verified by Stockfish* (`scripts/gen-tactics.mjs` plays
  imperfect engine games, then keeps only positions with a single decisive
  move), so every solution is sound.
- **Endgames** — play out essential theoretical wins (Q vs K, R vs K, the
  lawnmower, K+P, connected passers, Q vs R) against a full-strength Stockfish
  defender, with a live eval bar tracking your technique.

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

### Next up

- Persist progress (spaced repetition for openings, puzzle history) in storage
- Expand datasets (more repertoire lines, larger puzzle sets, more endgames)
- Syzygy tablebase for perfect endgame feedback; clocks & time controls

## Credits

- [Stockfish](https://stockfishchess.org/) — GPLv3
- [Leela Chess Zero (Lc0)](https://lczero.org/)
- [Maia Chess](https://maiachess.com/) by the CSSLab — human-like networks
- [chess.js](https://github.com/jhlywa/chess.js) — move generation & validation
