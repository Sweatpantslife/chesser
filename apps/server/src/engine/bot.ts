import type { BotMoveMessage, BotMoveRequest, Score } from '@chesser/shared';
import { BOT_RATING_MIN, STOCKFISH_ELO_MAX, STOCKFISH_ELO_MIN } from '@chesser/shared';
import type { EngineManager } from './manager.js';
import type { UciEngine, UciInfo } from './uci.js';
import { styleScore } from './style-score.js';
import { annotateRepeats, pickHumanMove, pickMaiaVariety, plyOfFen, searchPlanFor } from './humanize.js';
import { uciToSan } from '../util/san.js';
import { withLock } from '../util/lock.js';

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** A Maia net must sit within this many rating points of the request to be used. */
const MAIA_NET_TOLERANCE = 150;
/** Upper bound for the human-like Stockfish sampler's target rating. */
const HUMANLIKE_RATING_MAX = 2600;

function whiteToMove(fen: string): boolean {
  return fen.split(' ')[1] !== 'b';
}
function toWhiteScore(info: { scoreCp?: number; scoreMate?: number }, white: boolean): Score {
  if (info.scoreMate !== undefined) return { kind: 'mate', value: white ? info.scoreMate : -info.scoreMate };
  const cp = info.scoreCp ?? 0;
  return { kind: 'cp', value: white ? cp : -cp };
}
/** Collapse mate scores into a comparable centipawn-ish number (STM POV). */
function comparableCp(info: UciInfo): number {
  if (info.scoreMate !== undefined) return info.scoreMate > 0 ? 100000 - info.scoreMate * 100 : -100000 - info.scoreMate * 100;
  return info.scoreCp ?? 0;
}
/** How far below the best move a styled bot will reach for flavour (in cp). */
function styleMargin(elo: number): number {
  return clamp((STOCKFISH_ELO_MAX - elo) / 18 + 25, 25, 160);
}

interface Candidate {
  uci: string;
  cp: number; // STM POV, comparable
  score: Score; // White POV, for display
}

export class BotService {
  constructor(
    private readonly manager: EngineManager,
    /** Lazily provides the session's dedicated Stockfish-for-bot process. */
    private readonly getStockfish: () => Promise<UciEngine>,
  ) {}

  async move(req: BotMoveRequest): Promise<BotMoveMessage> {
    if (req.bot.style === 'human') return this.humanMove(req);
    return this.stockfishMove(req);
  }

  // --- Human-like: real Maia when a net matches, sampler otherwise ----------

  private async humanMove(req: BotMoveRequest): Promise<BotMoveMessage> {
    // Real Maia only when a net actually covers the requested band — a 600- or
    // 2200-rated "human" persona must not silently play a 1100/1900 net.
    const target = req.bot.maiaRating;
    const netId = target != null ? this.manager.maiaNetworkNear(target, MAIA_NET_TOLERANCE) : null;
    if (netId) return this.maiaMove(req, netId);
    if (this.manager.hasStockfish) return this.humanlikeStockfishMove(req);
    // Degenerate deploy (lc0-only): the nearest net beats failing outright.
    const fallback = this.manager.maiaNetworkId(target ?? req.bot.elo);
    if (fallback) return this.maiaMove(req, fallback);
    throw new Error('No engine available for human-like play');
  }

  // --- Maia (human-like neural net) -----------------------------------------

  private async maiaMove(req: BotMoveRequest, netId: string): Promise<BotMoveMessage> {
    const eng = await this.manager.getMaia(netId);
    const candidates: Candidate[] = [];
    const white = whiteToMove(req.fen);
    // Maia is shared across sessions, so serialise access to it.
    const best = await withLock(eng, async () => {
      // lc0 reuses its search tree across searches, so without ucinewgame a
      // repeated position accumulates visits and "go nodes 1" stops meaning
      // "play the raw policy move" — the persona would drift stronger over
      // server uptime. Resetting is near-free (the net stays loaded).
      eng.newGame();
      await eng.ready();
      return eng.search({
        fen: req.fen,
        go: 'go nodes 1',
        onInfo: (info) => {
          const first = info.pv[0];
          if (!first) return;
          candidates[info.multipv - 1] = { uci: first, cp: comparableCp(info), score: toWhiteScore(info, white) };
        },
      });
    });
    let uci = best.bestmove;
    if (!uci || uci === '(none)') throw new Error('Maia returned no move');
    // At nodes=1 Maia's raw policy is deterministic (same game every time), so
    // sample among its near-top policy moves for the first few plies. lc0 lists
    // MultiPV lines in policy order at one node; if it reported a single line
    // (or none), this is a no-op and bestmove is played exactly as before.
    const list = candidates.filter(Boolean);
    let score = list[0]?.score;
    if (list.length > 1 && list[0]!.uci === uci) {
      const pick = list[pickMaiaVariety(list, plyOfFen(req.fen))];
      if (pick) {
        uci = pick.uci;
        score = pick.score;
      }
    }
    return {
      t: 'botMove',
      reqId: req.reqId,
      fen: req.fen,
      uci,
      san: uciToSan(req.fen, uci) ?? uci,
      meta: { engine: 'lc0', style: 'human', score },
    };
  }

  // --- Stockfish (levels + styles) -----------------------------------------

  private async stockfishMove(req: BotMoveRequest): Promise<BotMoveMessage> {
    const eng = await this.getStockfish();
    // The session's bot engine handles one search at a time.
    return withLock(eng, () => {
      const elo = req.bot.elo ?? 1500;
      // Below Stockfish's UCI_Elo floor the human-like sampler provides the
      // weakening (it replaced the old uniform-random "beginner" path).
      if (elo < STOCKFISH_ELO_MIN) return this.runHumanlike(eng, req);
      return this.runStockfish(eng, req);
    });
  }

  private async humanlikeStockfishMove(req: BotMoveRequest): Promise<BotMoveMessage> {
    const eng = await this.getStockfish();
    return withLock(eng, () => this.runHumanlike(eng, req));
  }

  // --- Human-like sampling over Stockfish candidates ------------------------
  //
  // A full-strength MultiPV search supplies graded candidate moves; the pure
  // selection model in humanize.ts (rating-calibrated softmax + lapse tier +
  // opening variety + safety rails) picks the one a human of this rating
  // plausibly plays. Covers every rating the ladder needs (600 … 2600) and is
  // the honest fallback for Maia personas when lc0 isn't installed.

  private async runHumanlike(eng: UciEngine, req: BotMoveRequest): Promise<BotMoveMessage> {
    const rating = clamp(Math.round(req.bot.elo ?? req.bot.maiaRating ?? 1500), BOT_RATING_MIN, HUMANLIKE_RATING_MAX);
    const plan = searchPlanFor(rating, req.bot.moveTimeMs);
    const white = whiteToMove(req.fen);

    eng.setOption('UCI_LimitStrength', false);
    eng.setOption('MultiPV', plan.multiPv);
    await eng.ready();

    const candidates = new Map<number, Candidate>();
    let maxDepth = 0;
    await eng.search({
      fen: req.fen,
      go: plan.go,
      onInfo: (info) => {
        const first = info.pv[0];
        if (!first) return;
        if (info.depth > maxDepth) maxDepth = info.depth;
        // A movetime cutoff can leave a fail-high/low bound as the last line;
        // prefer the previous exact score so the sampler grades on real evals.
        if (info.bound && candidates.has(info.multipv)) return;
        candidates.set(info.multipv, { uci: first, cp: comparableCp(info), score: toWhiteScore(info, white) });
      },
    });

    const list = [...candidates.values()];
    if (list.length === 0) throw new Error('Bot found no move');
    // Clients cap what they send at 24; clamp server-side so a hostile client
    // can't make every bot move iterate a multi-megabyte array.
    const annotated = annotateRepeats(req.fen, list, (req.recentFens ?? []).slice(-32));
    const pick = pickHumanMove(annotated, { rating, ply: plyOfFen(req.fen) });
    const chosen = list[pick.index]!;

    return {
      t: 'botMove',
      reqId: req.reqId,
      fen: req.fen,
      uci: chosen.uci,
      san: uciToSan(req.fen, chosen.uci) ?? chosen.uci,
      meta: { engine: 'stockfish', style: req.bot.style, score: chosen.score, depth: maxDepth, candidates: list.length },
    };
  }

  private async runStockfish(eng: UciEngine, req: BotMoveRequest): Promise<BotMoveMessage> {
    const elo = clamp(Math.round(req.bot.elo ?? 1500), STOCKFISH_ELO_MIN, STOCKFISH_ELO_MAX);
    const moveTime = clamp(req.bot.moveTimeMs ?? 600, 50, 5000);
    const white = whiteToMove(req.fen);
    const styled = req.bot.style !== 'balanced';

    if (styled) {
      // Full strength gives reliable candidate evaluations; the Elo-scaled
      // margin + style scoring provide the weakening and the flavour. (Limiting
      // strength here would randomise the evals and make selection meaningless.)
      eng.setOption('UCI_LimitStrength', false);
      eng.setOption('MultiPV', 4);
    } else if (elo >= STOCKFISH_ELO_MAX) {
      eng.setOption('UCI_LimitStrength', false);
      eng.setOption('MultiPV', 1);
    } else {
      eng.setOption('UCI_LimitStrength', true);
      eng.setOption('UCI_Elo', elo);
      eng.setOption('MultiPV', 1);
    }
    await eng.ready();

    const candidates = new Map<number, Candidate>();
    let maxDepth = 0;
    const best = await eng.search({
      fen: req.fen,
      go: `go movetime ${moveTime}`,
      onInfo: (info) => {
        const first = info.pv[0];
        if (!first) return;
        if (info.depth > maxDepth) maxDepth = info.depth;
        candidates.set(info.multipv, { uci: first, cp: comparableCp(info), score: toWhiteScore(info, white) });
      },
    });

    let chosen = best.bestmove;
    let chosenScore = candidates.get(1)?.score;
    let considered = 1;

    if (styled && candidates.size > 0) {
      const list = [...candidates.values()];
      const bestCp = Math.max(...list.map((c) => c.cp));
      const margin = styleMargin(elo);
      const eligible = list.filter((c) => c.cp >= bestCp - margin);
      considered = eligible.length;
      let bestPick = eligible[0]!;
      let bestVal = -Infinity;
      for (const c of eligible) {
        // Penalise giving up eval, so the bot only abandons the top move when a
        // candidate is meaningfully more in-style. Deterministic: in a quiet
        // position where nothing scores on style, the best move wins — an
        // "aggressive" bot only deviates when a real attacking move exists.
        const evalPenalty = ((c.cp - bestCp) / 100) * 0.5; // <= 0, in pawns
        const v = styleScore(req.bot.style, req.fen, c.uci) + evalPenalty;
        if (v > bestVal) {
          bestVal = v;
          bestPick = c;
        }
      }
      chosen = bestPick.uci;
      chosenScore = bestPick.score;
    }

    if (!chosen || chosen === '(none)') throw new Error('Stockfish returned no move');

    return {
      t: 'botMove',
      reqId: req.reqId,
      fen: req.fen,
      uci: chosen,
      san: uciToSan(req.fen, chosen) ?? chosen,
      meta: {
        engine: 'stockfish',
        style: req.bot.style,
        score: chosenScore,
        depth: maxDepth,
        candidates: considered,
      },
    };
  }
}
