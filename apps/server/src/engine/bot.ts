import type { BotMoveMessage, BotMoveRequest, Score } from '@chesser/shared';
import { STOCKFISH_ELO_MAX, STOCKFISH_ELO_MIN } from '@chesser/shared';
import type { EngineManager } from './manager.js';
import type { UciEngine, UciInfo } from './uci.js';
import { styleScore } from './style-score.js';
import { uciToSan } from '../util/san.js';
import { withLock } from '../util/lock.js';

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

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
    if (req.bot.style === 'human') return this.maiaMove(req);
    return this.stockfishMove(req);
  }

  // --- Maia (human-like) ----------------------------------------------------

  private async maiaMove(req: BotMoveRequest): Promise<BotMoveMessage> {
    const netId = this.manager.maiaNetworkId(req.bot.maiaRating);
    if (!netId) throw new Error('No Maia network is installed');
    const eng = await this.manager.getMaia(netId);
    // Maia is shared across sessions, so serialise access to it.
    const best = await withLock(eng, () => eng.search({ fen: req.fen, go: 'go nodes 1' }));
    const uci = best.bestmove;
    if (!uci || uci === '(none)') throw new Error('Maia returned no move');
    return {
      t: 'botMove',
      reqId: req.reqId,
      fen: req.fen,
      uci,
      san: uciToSan(req.fen, uci) ?? uci,
      meta: { engine: 'lc0', style: 'human' },
    };
  }

  // --- Stockfish (levels + styles) -----------------------------------------

  private async stockfishMove(req: BotMoveRequest): Promise<BotMoveMessage> {
    const eng = await this.getStockfish();
    // The session's bot engine handles one search at a time.
    return withLock(eng, () => this.runStockfish(eng, req));
  }

  private async runStockfish(eng: UciEngine, req: BotMoveRequest): Promise<BotMoveMessage> {
    const elo = clamp(Math.round(req.bot.elo ?? 1500), STOCKFISH_ELO_MIN, STOCKFISH_ELO_MAX);
    const moveTime = clamp(req.bot.moveTimeMs ?? 600, 50, 5000);
    const white = whiteToMove(req.fen);
    const styled = req.bot.style !== 'balanced';

    if (elo >= STOCKFISH_ELO_MAX) {
      eng.setOption('UCI_LimitStrength', false);
    } else {
      eng.setOption('UCI_LimitStrength', true);
      eng.setOption('UCI_Elo', elo);
    }
    eng.setOption('MultiPV', styled ? 4 : 1);
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
        // candidate is meaningfully more in-style. Keeps quiet positions sane.
        const evalPenalty = ((c.cp - bestCp) / 100) * 0.4; // <= 0, in pawns
        const v = styleScore(req.bot.style, req.fen, c.uci) + evalPenalty + Math.random() * 0.1;
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
