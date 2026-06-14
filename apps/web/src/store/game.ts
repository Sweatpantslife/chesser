import { Chess } from 'chess.js';
import { create } from 'zustand';
import type { AnalysisLine, BotConfig, BotStyle, EngineAvailability, Score } from '@chesser/shared';
import { STARTING_FEN } from '@chesser/shared';
import { engine } from '../lib/engine';
import { whiteWinPercent } from '../lib/format';
import { playMoveSound } from '../lib/sound';

export type Color = 'white' | 'black';
export type Mode = 'play' | 'analysis';
export type Annotation = 'inaccuracy' | 'mistake' | 'blunder';

export interface SideReview {
  accuracy: number; // 0–100
  acpl: number; // average centipawn loss
  moves: number;
}
export interface ReviewStats {
  white: SideReview;
  black: SideReview;
}

export interface HistoryMove {
  san: string;
  uci: string;
  fen: string; // position AFTER the move
}

interface PendingPromotion {
  from: string;
  to: string;
}

const opposite = (c: Color): Color => (c === 'white' ? 'black' : 'white');
const colorOfFen = (fen: string): Color => (fen.split(' ')[1] === 'b' ? 'black' : 'white');

export interface TimeControl {
  initialMs: number;
  incrementMs: number;
  label: string;
}
export interface ClockState {
  whiteMs: number;
  blackMs: number;
}

/** Who you're playing in a vs-bot game (carries avatar data for the UI). */
export interface Opponent {
  /** Roster id, when the opponent is a ladder bot (drives ladder progress). */
  id?: string;
  name: string;
  rating?: number;
  accent?: string;
  motif?: string;
}

/** A non-board game ending: resignation, agreed draw, or a claimed draw. */
export interface ManualResult {
  winner: Color | 'draw';
  reason: string;
}

export type DrawOffer = 'idle' | 'pending' | 'declined' | 'accepted';

/** Everything needed to re-create the current vs-bot game (rematch / switch). */
interface PlaySetup {
  bot: BotConfig;
  playerColor: Color;
  startFen?: string;
  setupSan?: string[];
  opponent: Opponent | null;
}

const ANALYSIS_DEPTH_CAP = 30;

// The single source of truth for the live game. Navigation only changes the
// *view*; this instance always holds the actual played-out position.
let game = new Chess();
let gameId = 0;

export interface GameStore {
  // engine connection
  connected: boolean;
  availability: EngineAvailability | null;
  styles: BotStyle[];

  // mode / board
  mode: Mode;
  orientation: Color;

  // displayed (viewed) position
  fen: string;
  lastMove: [string, string] | undefined;
  turnColor: Color;
  liveTurn: Color; // side to move in the actual game (for clocks)
  inCheck: boolean;

  // move list / navigation
  history: HistoryMove[];
  viewPly: number;
  startFen: string;

  // interaction
  movableColor: Color | 'both' | undefined;
  dests: Map<string, string[]>;
  pendingPromotion: PendingPromotion | null;

  // game outcome
  status: string;
  isGameOver: boolean;
  /** Winner of a finished game, or 'draw'; null while it's still going. */
  winner: Color | 'draw' | null;
  /** Short reason for the result (e.g. "checkmate", "You resigned"). */
  endReason: string;
  /** A claimable draw (threefold / fifty-move) is available at the live position. */
  drawClaimable: boolean;

  // play-vs-bot
  playerColor: Color | null;
  botColor: Color | null;
  botConfig: BotConfig;
  thinking: boolean;
  /** The current opponent (vs-bot games), with avatar metadata for the UI. */
  opponent: Opponent | null;
  /** Increments on every new game — a stable token for per-game effects. */
  gameNo: number;
  /** Set when a game ends by resignation / agreed draw / claimed draw. */
  manualResult: ManualResult | null;
  /** Transient state of a pending draw offer to the bot. */
  drawOffer: DrawOffer;
  /** Captured setup of the live vs-bot game, for rematch / switch colours. */
  playSetup: PlaySetup | null;

  // clocks
  timeControl: TimeControl | null;
  clock: ClockState | null;
  flagged: Color | null;

  // analysis
  analysisOn: boolean;
  multipv: number;
  analysisLines: AnalysisLine[];
  analysisDepth: number;
  evalScore: Score | null;

  // game review (annotations keyed by ply, 1-based)
  annotations: Record<number, Annotation>;
  reviewing: boolean;
  reviewProgress: number; // 0–100
  evalGraph: number[]; // White win% per position (start + after each ply)
  reviewStats: ReviewStats | null;

  // actions
  init(): void;
  newGame(cfg: {
    mode: Mode;
    playerColor?: Color;
    bot?: BotConfig;
    /** Start from this position instead of the initial one. */
    startFen?: string;
    /** Pre-play these SAN moves (e.g. an opening) before handing over. */
    setupSan?: string[];
    /** Opponent metadata for vs-bot games. */
    opponent?: Opponent | null;
  }): void;
  userMove(from: string, to: string): void;
  finalizePromotion(piece: 'q' | 'r' | 'b' | 'n'): void;
  cancelPromotion(): void;
  goToPly(ply: number): void;
  stepView(delta: number): void;
  takeback(): void;
  flip(): void;
  setAnalysisOn(on: boolean): void;
  setMultipv(n: number): void;
  setBotConfig(bot: Partial<BotConfig>): void;
  setTimeControl(tc: TimeControl | null): void;
  resign(): void;
  offerDraw(): Promise<void>;
  claimDraw(): void;
  rematch(): void;
  switchColors(): void;
  exploreMove(uci: string): void;
  loadPgn(pgn: string): boolean;
  loadFen(fen: string): boolean;
  reviewGame(): Promise<void>;

  // internals
  _sync(): void;
  _refreshAnalysis(): void;
  _maybeTriggerBot(): void;
  _applyMove(move: { from: string; to: string; promotion?: string }): void;
  _tick(dtMs: number): void;
}

const DEFAULT_BOT: BotConfig = { style: 'human', maiaRating: 1500, elo: 1500, moveTimeMs: 700 };

export const useGame = create<GameStore>((set, get) => ({
  connected: false,
  availability: null,
  styles: [],

  mode: 'analysis',
  orientation: 'white',

  fen: game.fen(),
  lastMove: undefined,
  turnColor: 'white',
  liveTurn: 'white',
  inCheck: false,

  history: [],
  viewPly: 0,
  startFen: game.fen(),

  movableColor: 'both',
  dests: new Map(),
  pendingPromotion: null,

  status: 'White to move',
  isGameOver: false,
  winner: null,
  endReason: '',
  drawClaimable: false,

  playerColor: null,
  botColor: null,
  botConfig: DEFAULT_BOT,
  thinking: false,
  opponent: null,
  gameNo: 0,
  manualResult: null,
  drawOffer: 'idle',
  playSetup: null,

  timeControl: null,
  clock: null,
  flagged: null,

  analysisOn: true,
  multipv: 3,
  analysisLines: [],
  analysisDepth: 0,
  evalScore: null,

  annotations: {},
  reviewing: false,
  reviewProgress: 0,
  evalGraph: [],
  reviewStats: null,

  init() {
    engine.onStatus.add((connected) => set({ connected }));
    engine.onWelcome.add(({ engines, styles }) => set({ availability: engines, styles }));
    engine.connect();
    get()._sync();
    get()._refreshAnalysis();
  },

  newGame(cfg) {
    const base = cfg.startFen ?? STARTING_FEN;
    let g: Chess;
    try {
      g = new Chess(base);
    } catch {
      g = new Chess();
    }
    // Pre-play any setup moves (e.g. an opening) into the visible history.
    const history: HistoryMove[] = [];
    if (cfg.setupSan) {
      for (const san of cfg.setupSan) {
        try {
          const mv = g.move(san);
          history.push({ san: mv.san, uci: mv.from + mv.to + (mv.promotion ?? ''), fen: g.fen() });
        } catch {
          break; // stop at the first move that doesn't apply
        }
      }
    }
    const startFen = base; // the root the visible line branches from
    game = g;
    gameId++;

    const playerColor = cfg.mode === 'play' ? (cfg.playerColor ?? 'white') : null;
    const opponent = cfg.mode === 'play' ? (cfg.opponent ?? null) : null;
    const botConfig = cfg.bot ?? get().botConfig;
    const tc = get().timeControl;
    const clock = cfg.mode === 'play' && tc ? { whiteMs: tc.initialMs, blackMs: tc.initialMs } : null;
    const playSetup: PlaySetup | null =
      cfg.mode === 'play'
        ? { bot: botConfig, playerColor: playerColor ?? 'white', startFen: cfg.startFen, setupSan: cfg.setupSan, opponent }
        : null;

    set({
      mode: cfg.mode,
      orientation: playerColor ?? get().orientation,
      playerColor,
      botColor: playerColor ? opposite(playerColor) : null,
      botConfig,
      opponent,
      gameNo: get().gameNo + 1,
      playSetup,
      manualResult: null,
      drawOffer: 'idle',
      winner: null,
      endReason: '',
      drawClaimable: false,
      history,
      viewPly: history.length,
      startFen,
      thinking: false,
      pendingPromotion: null,
      analysisLines: [],
      analysisDepth: 0,
      evalScore: null,
      clock,
      flagged: null,
      annotations: {},
      evalGraph: [],
      reviewStats: null,
    });
    get()._sync();
    get()._refreshAnalysis();
    get()._maybeTriggerBot();
  },

  userMove(from, to) {
    const s = get();
    if (s.viewPly !== s.history.length) return; // only move at the live position
    if (s.isGameOver) return;
    const legal = game.moves({ verbose: true, square: from as any }).filter((m) => m.to === to);
    if (legal.length === 0) return;
    if (legal.some((m) => m.promotion)) {
      set({ pendingPromotion: { from, to } });
      return;
    }
    get()._applyMove({ from, to });
  },

  finalizePromotion(piece) {
    const p = get().pendingPromotion;
    if (!p) return;
    set({ pendingPromotion: null });
    get()._applyMove({ from: p.from, to: p.to, promotion: piece });
  },

  cancelPromotion() {
    set({ pendingPromotion: null });
    get()._sync(); // snap the board back
  },

  _applyMove(move) {
    try {
      const moverColor = colorOfFen(game.fen()); // side about to move
      const mv = game.move({ from: move.from, to: move.to, promotion: move.promotion });
      playMoveSound(mv.san);
      const history = [...get().history, { san: mv.san, uci: mv.from + mv.to + (mv.promotion ?? ''), fen: game.fen() }];
      // add the increment to the player who just moved
      const tc = get().timeControl;
      const clock = get().clock;
      const nextClock =
        clock && tc && !get().flagged
          ? moverColor === 'white'
            ? { ...clock, whiteMs: clock.whiteMs + tc.incrementMs }
            : { ...clock, blackMs: clock.blackMs + tc.incrementMs }
          : clock;
      set({ history, viewPly: history.length, clock: nextClock, annotations: {}, evalGraph: [], reviewStats: null });
      get()._sync();
      get()._refreshAnalysis();
      get()._maybeTriggerBot();
    } catch {
      get()._sync();
    }
  },

  _maybeTriggerBot() {
    const s = get();
    if (s.mode !== 'play' || s.isGameOver || s.thinking) return;
    if (colorOfFen(game.fen()) !== s.botColor) return;
    const myGame = gameId;
    set({ thinking: true });
    const bot = s.botConfig;
    const fen = game.fen();
    window.setTimeout(async () => {
      try {
        const res = await engine.botMove(fen, bot);
        if (gameId !== myGame) return; // a new game started meanwhile
        const from = res.uci.slice(0, 2);
        const to = res.uci.slice(2, 4);
        const promotion = res.uci.length > 4 ? res.uci[4] : undefined;
        set({ thinking: false });
        get()._applyMove({ from, to, promotion });
      } catch (e) {
        if (gameId === myGame) set({ thinking: false });
        console.error('[bot]', e);
      }
    }, 300);
  },

  goToPly(ply) {
    const s = get();
    const clamped = Math.max(0, Math.min(ply, s.history.length));
    set({ viewPly: clamped });
    get()._sync();
    get()._refreshAnalysis();
  },

  stepView(delta) {
    get().goToPly(get().viewPly + delta);
  },

  takeback() {
    const s = get();
    if (s.history.length === 0) return;
    // In play, undo back to the human's turn (drop the bot's reply too).
    let undo = 1;
    if (s.mode === 'play' && s.botColor) {
      const lastFen = s.history[s.history.length - 1]!.fen;
      if (colorOfFen(lastFen) === s.playerColor && s.history.length >= 2) undo = 2;
    }
    for (let i = 0; i < undo; i++) game.undo();
    const history = s.history.slice(0, s.history.length - undo);
    set({
      history,
      viewPly: history.length,
      thinking: false,
      pendingPromotion: null,
      annotations: {},
      evalGraph: [],
      reviewStats: null,
      manualResult: null, // taking back un-ends a resigned / drawn game
      drawOffer: 'idle',
    });
    gameId++; // invalidate any in-flight bot move
    get()._sync();
    get()._refreshAnalysis();
  },

  flip() {
    set({ orientation: opposite(get().orientation) });
  },

  setAnalysisOn(on) {
    set({ analysisOn: on });
    if (!on) {
      engine.stopAnalysis();
      set({ analysisLines: [], evalScore: null, analysisDepth: 0 });
    } else {
      get()._refreshAnalysis();
    }
  },

  setMultipv(n) {
    set({ multipv: Math.max(1, Math.min(5, n)) });
    get()._refreshAnalysis();
  },

  setBotConfig(bot) {
    set({ botConfig: { ...get().botConfig, ...bot } });
  },

  setTimeControl(tc) {
    set({ timeControl: tc });
  },

  // --- vs-bot game actions --------------------------------------------------

  resign() {
    const s = get();
    if (s.mode !== 'play' || s.isGameOver || !s.playerColor) return;
    set({ manualResult: { winner: opposite(s.playerColor), reason: 'You resigned' }, thinking: false, drawOffer: 'idle' });
    gameId++; // drop any in-flight bot reply
    get()._sync();
    get()._refreshAnalysis();
  },

  async offerDraw() {
    const s = get();
    if (s.mode !== 'play' || s.isGameOver || s.thinking || s.drawOffer === 'pending') return;
    if (s.viewPly !== s.history.length || s.history.length < 2 || !s.botColor) return;
    const myGame = gameId;
    set({ drawOffer: 'pending' });
    const fen = game.fen();
    const botColor = s.botColor;
    try {
      const score = await engine.evalOnce(fen, { movetimeMs: 600 });
      if (gameId !== myGame) return; // game changed under us
      // Bot accepts only if it isn't better than ~+0.6 pawns from its own POV.
      const whiteCp = !score ? 0 : score.kind === 'mate' ? (score.value > 0 ? 10_000 : score.value < 0 ? -10_000 : 0) : score.value;
      const botCp = botColor === 'white' ? whiteCp : -whiteCp;
      if (botCp <= 60) {
        set({ drawOffer: 'accepted', manualResult: { winner: 'draw', reason: 'Draw agreed' }, thinking: false });
        gameId++;
        get()._sync();
      } else {
        set({ drawOffer: 'declined' });
        window.setTimeout(() => {
          if (get().drawOffer === 'declined') set({ drawOffer: 'idle' });
        }, 2600);
      }
      get()._refreshAnalysis(); // evalOnce hijacked the analysis stream; resume it
    } catch {
      set({ drawOffer: 'idle' });
      get()._refreshAnalysis();
    }
  },

  claimDraw() {
    const s = get();
    if (s.mode !== 'play' || s.isGameOver || !s.drawClaimable) return;
    const reason = game.isThreefoldRepetition() ? 'Threefold repetition' : 'Fifty-move rule';
    set({ manualResult: { winner: 'draw', reason }, thinking: false, drawOffer: 'idle' });
    gameId++;
    get()._sync();
    get()._refreshAnalysis();
  },

  rematch() {
    const ps = get().playSetup;
    if (!ps) return;
    get().newGame({
      mode: 'play',
      playerColor: ps.playerColor,
      bot: ps.bot,
      startFen: ps.startFen,
      setupSan: ps.setupSan,
      opponent: ps.opponent,
    });
  },

  switchColors() {
    const ps = get().playSetup;
    if (!ps) return;
    get().newGame({
      mode: 'play',
      playerColor: opposite(ps.playerColor),
      bot: ps.bot,
      startFen: ps.startFen,
      setupSan: ps.setupSan,
      opponent: ps.opponent,
    });
  },

  // Play a move from the currently-viewed position (branches the line).
  exploreMove(uci) {
    const s = get();
    if (s.mode !== 'analysis') return;
    if (s.viewPly < s.history.length) {
      const baseFen = s.viewPly === 0 ? s.startFen : s.history[s.viewPly - 1]!.fen;
      game = new Chess(baseFen);
      set({ history: s.history.slice(0, s.viewPly) });
    }
    get()._applyMove({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
  },

  loadPgn(pgn) {
    const probe = new Chess();
    try {
      probe.loadPgn(pgn);
    } catch {
      return false;
    }
    const verbose = probe.history({ verbose: true });
    if (verbose.length === 0) return false;
    game = new Chess(probe.fen());
    gameId++;
    set({
      mode: 'analysis',
      playerColor: null,
      botColor: null,
      opponent: null,
      playSetup: null,
      manualResult: null,
      drawOffer: 'idle',
      gameNo: get().gameNo + 1,
      history: verbose.map((m) => ({ san: m.san, uci: m.from + m.to + (m.promotion ?? ''), fen: m.after })),
      viewPly: 0,
      startFen: verbose[0]!.before,
      thinking: false,
      pendingPromotion: null,
      flagged: null,
      clock: null,
      analysisLines: [],
      analysisDepth: 0,
      evalScore: null,
      annotations: {},
      evalGraph: [],
      reviewStats: null,
    });
    get()._sync();
    get()._refreshAnalysis();
    return true;
  },

  loadFen(fen) {
    let c: Chess;
    try {
      c = new Chess(fen);
    } catch {
      return false;
    }
    game = c;
    gameId++;
    set({
      mode: 'analysis',
      playerColor: null,
      botColor: null,
      opponent: null,
      playSetup: null,
      manualResult: null,
      drawOffer: 'idle',
      gameNo: get().gameNo + 1,
      orientation: c.turn() === 'b' ? 'black' : 'white',
      history: [],
      viewPly: 0,
      startFen: c.fen(),
      thinking: false,
      pendingPromotion: null,
      flagged: null,
      clock: null,
      analysisLines: [],
      analysisDepth: 0,
      evalScore: null,
      annotations: {},
      evalGraph: [],
      reviewStats: null,
    });
    get()._sync();
    get()._refreshAnalysis();
    return true;
  },

  async reviewGame() {
    const s0 = get();
    if (s0.reviewing || s0.history.length === 0) return;
    const myGame = gameId;
    engine.stopAnalysis();
    set({ reviewing: true, reviewProgress: 0, annotations: {}, evalGraph: [], reviewStats: null });

    const cap = (cp: number) => Math.max(-1500, Math.min(1500, cp));
    const cpOf = (sc: Score | null): number =>
      !sc ? 0 : sc.kind === 'mate' ? (sc.value > 0 ? 1500 : sc.value < 0 ? -1500 : 0) : cap(sc.value);

    const fens = [s0.startFen, ...s0.history.map((h) => h.fen)];
    const winWhite: number[] = [];
    const cpWhite: number[] = [];
    for (let i = 0; i < fens.length; i++) {
      const score = await engine.evalOnce(fens[i]!, { movetimeMs: 300 });
      if (gameId !== myGame) {
        set({ reviewing: false });
        return; // game changed under us
      }
      winWhite.push(whiteWinPercent(score));
      cpWhite.push(cpOf(score));
      set({ reviewProgress: Math.round(((i + 1) / fens.length) * 100) });
    }

    // Per-move accuracy (Lichess curve) + centipawn loss, classified by win% swing.
    const ann: Record<number, Annotation> = {};
    const agg = {
      white: { accSum: 0, cpl: 0, moves: 0 },
      black: { accSum: 0, cpl: 0, moves: 0 },
    };
    for (let i = 0; i < s0.history.length; i++) {
      const wb = winWhite[i]!;
      const wa = winWhite[i + 1]!;
      const cb = cpWhite[i]!;
      const ca = cpWhite[i + 1]!;
      const whiteMoved = i % 2 === 0;
      const winDrop = whiteMoved ? wb - wa : wa - wb; // mover's win% lost (>=0 = worse)
      const cpLoss = Math.max(0, whiteMoved ? cb - ca : ca - cb);
      const acc = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, winDrop)) - 3.1669));
      const side = whiteMoved ? agg.white : agg.black;
      side.accSum += acc;
      side.cpl += cpLoss;
      side.moves += 1;

      const ply = i + 1;
      if (winDrop >= 30) ann[ply] = 'blunder';
      else if (winDrop >= 18) ann[ply] = 'mistake';
      else if (winDrop >= 9) ann[ply] = 'inaccuracy';
    }

    const side = (a: { accSum: number; cpl: number; moves: number }): SideReview => ({
      accuracy: a.moves ? Math.round(a.accSum / a.moves) : 100,
      acpl: a.moves ? Math.round(a.cpl / a.moves) : 0,
      moves: a.moves,
    });

    set({
      annotations: ann,
      evalGraph: winWhite,
      reviewStats: { white: side(agg.white), black: side(agg.black) },
      reviewing: false,
      reviewProgress: 100,
    });
    get()._refreshAnalysis();
  },

  _tick(dtMs) {
    const s = get();
    if (s.mode !== 'play' || !s.clock || s.isGameOver || s.flagged) return;
    if (s.viewPly !== s.history.length) return; // not at the live position
    if (s.history.length === 0 && s.thinking) {
      // allow the very first bot move (bot is White) to start the clock
    }
    const turn = colorOfFen(game.fen());
    const ms = turn === 'white' ? s.clock.whiteMs : s.clock.blackMs;
    const left = Math.max(0, ms - dtMs);
    const clock = turn === 'white' ? { ...s.clock, whiteMs: left } : { ...s.clock, blackMs: left };
    if (left <= 0) {
      set({ clock, flagged: turn });
      get()._sync();
    } else {
      set({ clock });
    }
  },

  _sync() {
    const s = get();
    const atLive = s.viewPly === s.history.length;
    const viewedFen = s.viewPly === 0 ? s.startFen : s.history[s.viewPly - 1]!.fen;
    const viewedLast =
      s.viewPly === 0
        ? undefined
        : ((): [string, string] => {
            const u = s.history[s.viewPly - 1]!.uci;
            return [u.slice(0, 2), u.slice(2, 4)];
          })();

    const turnColor = colorOfFen(viewedFen);
    const checkProbe = new Chess(viewedFen);
    const inCheck = checkProbe.inCheck();

    // outcome (live position)
    const liveColor = colorOfFen(game.fen()); // side to move in the actual game
    const cap = (c: Color) => (c === 'white' ? 'White' : 'Black');
    let status: string;
    let isGameOver = false;
    let winner: Color | 'draw' | null = null;
    let endReason = '';
    let drawClaimable = false;
    const manual = s.manualResult;
    const flagged = s.flagged;

    if (manual) {
      // Resignation / agreed draw / claimed draw — ends regardless of the board.
      isGameOver = true;
      winner = manual.winner;
      endReason = manual.reason;
      status =
        manual.winner === 'draw'
          ? `Draw — ${manual.reason.toLowerCase()}`
          : `${cap(manual.winner)} wins — ${manual.reason.toLowerCase()}`;
    } else if (flagged) {
      isGameOver = true;
      winner = opposite(flagged);
      endReason = 'on time';
      status = `${cap(flagged)} flagged — ${cap(opposite(flagged))} wins on time`;
    } else if (game.isCheckmate()) {
      isGameOver = true;
      winner = opposite(liveColor);
      endReason = 'checkmate';
      status = `Checkmate — ${cap(winner)} wins`;
    } else if (game.isStalemate()) {
      isGameOver = true;
      winner = 'draw';
      endReason = 'stalemate';
      status = 'Draw — stalemate';
    } else if (game.isInsufficientMaterial()) {
      isGameOver = true;
      winner = 'draw';
      endReason = 'insufficient material';
      status = 'Draw — insufficient material';
    } else {
      // Threefold repetition and the 50-move rule are *claimable*, not automatic.
      const threefold = game.isThreefoldRepetition();
      const fiftyMove = Number(game.fen().split(' ')[4] ?? '0') >= 100;
      if ((threefold || fiftyMove) && s.mode === 'play') {
        drawClaimable = true;
        status = threefold ? 'Threefold repetition — you can claim a draw' : 'Fifty-move rule — you can claim a draw';
      } else if (threefold || fiftyMove) {
        isGameOver = true;
        winner = 'draw';
        endReason = threefold ? 'threefold repetition' : 'fifty-move rule';
        status = `Draw — ${endReason}`;
      } else {
        status = `${cap(liveColor)} to move${game.inCheck() ? ' — check' : ''}`;
      }
    }

    // interaction (only at the live position)
    const canMove = atLive && !isGameOver;
    let movableColor: Color | 'both' | undefined;
    const dests = new Map<string, string[]>();
    if (canMove) {
      const liveTurn = colorOfFen(game.fen());
      const allowed = s.mode === 'analysis' || (liveTurn === s.playerColor && !s.thinking);
      if (allowed) {
        movableColor = s.mode === 'analysis' ? 'both' : (s.playerColor ?? undefined);
        for (const m of game.moves({ verbose: true })) {
          const arr = dests.get(m.from) ?? [];
          arr.push(m.to);
          dests.set(m.from, arr);
        }
      }
    }

    set({
      fen: viewedFen,
      lastMove: viewedLast,
      turnColor,
      liveTurn: colorOfFen(game.fen()),
      inCheck,
      status,
      isGameOver,
      winner,
      endReason,
      drawClaimable,
      movableColor,
      dests,
    });
  },

  _refreshAnalysis() {
    const s = get();
    if (!s.analysisOn) return;
    const fen = s.fen;
    engine.analyze(fen, { multipv: s.multipv, depth: ANALYSIS_DEPTH_CAP }, (msg) => {
      if (get().fen !== msg.fen) return; // viewed position moved on
      set({
        analysisLines: msg.lines,
        analysisDepth: msg.depth,
        evalScore: msg.lines[0]?.score ?? null,
      });
    });
  },
}));
