import { Chess } from 'chess.js';
import { create } from 'zustand';
import type { AnalysisLine, BotConfig, BotStyle, EngineAvailability, Score } from '@chesser/shared';
import { engine } from '../lib/engine';

export type Color = 'white' | 'black';
export type Mode = 'play' | 'analysis';

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

  // play-vs-bot
  playerColor: Color | null;
  botColor: Color | null;
  botConfig: BotConfig;
  thinking: boolean;

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

  // actions
  init(): void;
  newGame(cfg: { mode: Mode; playerColor?: Color; bot?: BotConfig }): void;
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

  playerColor: null,
  botColor: null,
  botConfig: DEFAULT_BOT,
  thinking: false,

  timeControl: null,
  clock: null,
  flagged: null,

  analysisOn: true,
  multipv: 3,
  analysisLines: [],
  analysisDepth: 0,
  evalScore: null,

  init() {
    engine.onStatus.add((connected) => set({ connected }));
    engine.onWelcome.add(({ engines, styles }) => set({ availability: engines, styles }));
    engine.connect();
    get()._sync();
    get()._refreshAnalysis();
  },

  newGame(cfg) {
    game = new Chess();
    gameId++;
    const playerColor = cfg.mode === 'play' ? (cfg.playerColor ?? 'white') : null;
    const tc = get().timeControl;
    const clock = cfg.mode === 'play' && tc ? { whiteMs: tc.initialMs, blackMs: tc.initialMs } : null;
    set({
      mode: cfg.mode,
      orientation: playerColor ?? get().orientation,
      playerColor,
      botColor: playerColor ? opposite(playerColor) : null,
      botConfig: cfg.bot ?? get().botConfig,
      history: [],
      viewPly: 0,
      startFen: game.fen(),
      thinking: false,
      pendingPromotion: null,
      analysisLines: [],
      analysisDepth: 0,
      evalScore: null,
      clock,
      flagged: null,
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
      set({ history, viewPly: history.length, clock: nextClock });
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
    set({ history, viewPly: history.length, thinking: false, pendingPromotion: null });
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
    let status = `${colorOfFen(game.fen()) === 'white' ? 'White' : 'Black'} to move`;
    let isGameOver = false;
    if (game.isCheckmate()) {
      status = `Checkmate — ${colorOfFen(game.fen()) === 'white' ? 'Black' : 'White'} wins`;
      isGameOver = true;
    } else if (game.isStalemate()) {
      status = 'Draw — stalemate';
      isGameOver = true;
    } else if (game.isInsufficientMaterial()) {
      status = 'Draw — insufficient material';
      isGameOver = true;
    } else if (game.isThreefoldRepetition()) {
      status = 'Draw — threefold repetition';
      isGameOver = true;
    } else if (game.isDraw()) {
      status = 'Draw — 50-move rule';
      isGameOver = true;
    } else if (game.inCheck()) {
      status = `${colorOfFen(game.fen()) === 'white' ? 'White' : 'Black'} to move — check`;
    }

    // a flag fall ends the game regardless of board state
    const flagged = get().flagged;
    if (flagged) {
      status = `${flagged === 'white' ? 'White' : 'Black'} flagged — ${flagged === 'white' ? 'Black' : 'White'} wins on time`;
      isGameOver = true;
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
