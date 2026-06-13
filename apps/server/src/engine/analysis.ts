import type { AnalysisLine, AnalysisMessage, AnalyzeRequest, Score } from '@chesser/shared';
import type { UciEngine, UciInfo } from './uci.js';
import { uciLineToSan } from '../util/san.js';

const MAX_MULTIPV = 5;
const EMIT_INTERVAL_MS = 80;

function whiteToMove(fen: string): boolean {
  return fen.split(' ')[1] !== 'b';
}

/** Normalise an engine score (side-to-move POV) to White's POV. */
function toWhiteScore(info: UciInfo, white: boolean): Score {
  if (info.scoreMate !== undefined) {
    return { kind: 'mate', value: white ? info.scoreMate : -info.scoreMate };
  }
  const cp = info.scoreCp ?? 0;
  return { kind: 'cp', value: white ? cp : -cp };
}

/**
 * Drives one Stockfish process as a live analysis engine for a session.
 * A new analyze() cancels any in-flight search first.
 */
export class AnalysisService {
  private current: { reqId: string; done: Promise<void> } | null = null;

  constructor(
    private readonly engine: UciEngine,
    private readonly onMessage: (msg: AnalysisMessage) => void,
  ) {}

  async analyze(req: AnalyzeRequest): Promise<void> {
    await this.cancel();

    const multipv = Math.min(Math.max(req.multipv ?? 1, 1), MAX_MULTIPV);
    this.engine.setOption('MultiPV', multipv);
    await this.engine.ready();

    const white = whiteToMove(req.fen);
    const lines = new Map<number, AnalysisLine>();
    let maxDepth = 0;
    let lastEmit = 0;

    const snapshot = (): AnalysisLine[] => [...lines.values()].sort((a, b) => a.multipv - b.multipv);
    const emit = (final: boolean) => {
      this.onMessage({ t: 'analysis', reqId: req.reqId, fen: req.fen, depth: maxDepth, lines: snapshot(), final });
    };

    const go = req.movetimeMs
      ? `go movetime ${req.movetimeMs}`
      : req.depth
        ? `go depth ${req.depth}`
        : 'go infinite';

    const onInfo = (info: UciInfo) => {
      const pvUci = info.pv.slice(0, 20);
      lines.set(info.multipv, {
        multipv: info.multipv,
        depth: info.depth,
        score: toWhiteScore(info, white),
        pvUci,
        pvSan: uciLineToSan(req.fen, pvUci, 12),
        nodes: info.nodes,
        nps: info.nps,
        timeMs: info.timeMs,
      });
      if (info.depth > maxDepth) maxDepth = info.depth;
      const now = Date.now();
      if (now - lastEmit >= EMIT_INTERVAL_MS) {
        lastEmit = now;
        emit(false);
      }
    };

    const done = this.engine
      .search({ fen: req.fen, go, onInfo })
      .then(() => emit(true))
      .catch(() => {
        /* cancelled or engine died; nothing to emit */
      });

    this.current = { reqId: req.reqId, done };
  }

  /** Stop whatever is running and wait for the engine to settle. */
  async cancel(): Promise<void> {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    this.engine.stop();
    await cur.done;
  }
}
