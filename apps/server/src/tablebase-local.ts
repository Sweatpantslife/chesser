import { Chess } from 'chess.js';
import type { TablebaseCategory, TablebaseMove, TablebaseResult } from '@chesser/shared';
import { engines } from './engine/manager.js';
import type { UciEngine, UciInfo } from './engine/uci.js';
import { uciToSan } from './util/san.js';
import { withLock } from './util/lock.js';
import { syzygyInfo } from './config.js';

/**
 * Local Syzygy probing, backed by a dedicated Stockfish process with the
 * tablebases loaded. It is the offline fallback for `/api/tablebase` when the
 * online proxy is unreachable.
 *
 * Stockfish's root probing ranks every legal move DTZ-optimally when the
 * tablebases cover the position, so a single MultiPV search yields each move's
 * win/draw/loss (side-to-move POV) and the best move to play. Syzygy carries no
 * distance-to-mate and we don't surface DTZ here, so `dtz`/`dtm` stay null —
 * the trainer grades on category alone, which is exactly what we can prove.
 */

const MAX_MULTIPV = 256;

let enginePromise: Promise<UciEngine> | null = null;

async function getEngine(): Promise<UciEngine> {
  return (enginePromise ??= (async () => {
    // createStockfish already points the process at SyzygyPath.
    const eng = await engines.createStockfish('sf-tb');
    eng.setOption('UCI_LimitStrength', false);
    eng.setOption('UCI_ShowWDL', true);
    await eng.ready();
    return eng;
  })());
}

/** Map one MultiPV `info` line (side-to-move POV) to a tablebase category. */
function classify(info: UciInfo): TablebaseCategory {
  if (info.scoreMate !== undefined) {
    if (info.scoreMate > 0) return 'win';
    if (info.scoreMate < 0) return 'loss';
    return 'unknown';
  }
  if (info.wdl) {
    const [w, d, l] = info.wdl;
    if (w >= d && w >= l) return 'win';
    if (l >= d && l >= w) return 'loss';
    return 'draw';
  }
  // With the tablebases loaded, decisive positions get large scores and draws
  // collapse to ~0, so a small dead-band on the (TB-backed) cp score is safe.
  const cp = info.scoreCp ?? 0;
  if (cp > 20) return 'win';
  if (cp < -20) return 'loss';
  return 'draw';
}

export async function probeLocalSyzygy(fen: string): Promise<TablebaseResult | null> {
  const sz = syzygyInfo();
  if (!sz) return null;

  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }

  const legal = chess.moves({ verbose: true });
  if (legal.length === 0) {
    // Terminal position — no engine probe needed.
    const checkmate = chess.isCheckmate();
    return {
      available: true,
      source: 'syzygy',
      category: checkmate ? 'loss' : 'draw',
      dtz: null,
      dtm: null,
      checkmate,
      stalemate: !checkmate,
      moves: [],
    };
  }

  let eng: UciEngine;
  try {
    eng = await getEngine();
  } catch {
    return null; // Stockfish unavailable — let the caller report unavailable.
  }

  // Latest (deepest) line seen for each MultiPV slot.
  const slots = new Map<number, { uci: string; category: TablebaseCategory }>();
  try {
    await withLock(eng, async () => {
      eng.setOption('MultiPV', Math.min(legal.length, MAX_MULTIPV));
      await eng.ready();
      await eng.search({
        fen,
        // A couple of plies is plenty once the position is a tablebase hit, and
        // it ensures every MultiPV slot gets reported at least once.
        go: 'go depth 4',
        onInfo: (info) => {
          const uci = info.pv[0];
          if (uci) slots.set(info.multipv, { uci, category: classify(info) });
        },
      });
    });
  } catch {
    return null;
  }

  if (slots.size === 0) return null;

  // MultiPV slot 1 is the best move, so the slots are already best-first.
  const ordered = [...slots.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  const moves: TablebaseMove[] = ordered.map((m) => ({
    uci: m.uci,
    san: uciToSan(fen, m.uci) ?? undefined,
    category: m.category,
    dtz: null,
    dtm: null,
  }));

  return {
    available: true,
    source: 'syzygy',
    category: moves[0]!.category,
    dtz: null,
    dtm: null,
    checkmate: false,
    stalemate: false,
    moves,
  };
}

/** Stop the prober's Stockfish process (called on server shutdown). */
export async function shutdownLocalTablebase(): Promise<void> {
  const p = enginePromise;
  enginePromise = null;
  if (!p) return;
  try {
    await (await p).quit();
  } catch {
    /* ignore */
  }
}
