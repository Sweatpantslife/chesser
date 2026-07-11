import { Chess } from 'chess.js';
import { create } from 'zustand';
import type { AnalysisLine, BotConfig, BotStyle, EngineAvailability, Score } from '@chesser/shared';
import { STARTING_FEN } from '@chesser/shared';
import { engine } from '../lib/engine';
import { whiteWinPercent } from '../lib/format';
import { playMoveSound, playSound } from '../lib/sound';
import type { MoveReview, PositionEval } from '../lib/coach';
import { detectOpening } from '../lib/openings';
import { countRepetitions } from '../lib/repetition';
import { agreedDrawIsRated, botAcceptsDraw, MIN_DRAW_ACCEPT_PLIES } from '../lib/drawPolicy';
import { botThinkTimeMs, plyOfFen } from '../lib/thinkTime';
import { recordGameResult } from '../lib/gamify';
import { useLadder } from './ladder';
import { useRatings, type GameOutcome } from './ratings';
// NOTE: lib/coach's grading code, lib/analytics/report and store/analysisReport
// are imported DYNAMICALLY inside reviewGame() — they are only needed when a
// game review actually runs, and keeping them out of this module's static
// graph keeps the whole analytics suite out of the initial bundle (this store
// is loaded eagerly by the app shell).

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

/**
 * A node in the variation tree. The root (ply 0) holds the starting position
 * and a null move. Every other node is a move; `children[0]` is the main
 * continuation and any further children are variations branching from the
 * *same* parent position.
 */
export interface MoveNode {
  id: string;
  parentId: string | null;
  san: string; // '' for the root
  uci: string; // '' for the root
  fen: string; // position AFTER this move (root: the start FEN)
  ply: number; // 0 for the root
  children: string[]; // [0] is the mainline continuation
}

interface PendingPromotion {
  from: string;
  to: string;
}

const opposite = (c: Color): Color => (c === 'white' ? 'black' : 'white');
const colorOfFen = (fen: string): Color => (fen.split(' ')[1] === 'b' ? 'black' : 'white');

let nodeCounter = 0;
const uid = () => `n${(nodeCounter++).toString(36)}`;

/** Build a fresh single-root tree for a starting position. */
function newTree(fen: string): { tree: Record<string, MoveNode>; rootId: string } {
  const rootId = uid();
  return { tree: { [rootId]: { id: rootId, parentId: null, san: '', uci: '', fen, ply: 0, children: [] } }, rootId };
}

/** FENs of every position from the root down to `id` (root's position first). */
function positionsTo(tree: Record<string, MoveNode>, id: string): string[] {
  const fens: string[] = [];
  let n: MoveNode | undefined = tree[id];
  while (n) {
    fens.push(n.fen);
    n = n.parentId ? tree[n.parentId] : undefined;
  }
  return fens.reverse();
}

/** Follow `children[0]` from the root to the end of the main line (excludes root). */
export function mainlineOf(tree: Record<string, MoveNode>, rootId: string): MoveNode[] {
  const out: MoveNode[] = [];
  let n = tree[rootId];
  while (n && n.children[0]) {
    n = tree[n.children[0]]!;
    out.push(n);
  }
  return out;
}

/** The id of the last node on the main line (the live tip), or the root. */
function tipOf(tree: Record<string, MoveNode>, rootId: string): string {
  let n = tree[rootId]!;
  while (n.children[0]) n = tree[n.children[0]]!;
  return n.id;
}

/**
 * The "current line": the path from the root through `currentId`, then continued
 * along `children[0]` to the end of that branch. Includes the root at index 0.
 */
function lineOf(tree: Record<string, MoveNode>, currentId: string): MoveNode[] {
  const up: MoveNode[] = [];
  let n: MoveNode | undefined = tree[currentId];
  while (n) {
    up.push(n);
    n = n.parentId ? tree[n.parentId] : undefined;
  }
  up.reverse(); // root … current
  let tail = tree[currentId]!;
  while (tail.children[0]) {
    tail = tree[tail.children[0]]!;
    up.push(tail);
  }
  return up;
}

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

/** Post-game snapshot driving the results modal (set once when a game ends). */
export interface GameSummary {
  gameNo: number;
  outcome: 'win' | 'loss' | 'draw';
  playerColor: Color;
  opponent: Opponent | null;
  endReason: string;
  statusText: string;
  timed: boolean;
  category: 'bots' | 'blitz';
  /** False for games that didn't count for rating (e.g. very early agreed draws). */
  rated: boolean;
  ratingBefore: number;
  ratingAfter: number;
  ratingDelta: number;
  plies: number;
  moves: number;
}

/** Everything needed to re-create the current vs-bot game (rematch / switch). */
interface PlaySetup {
  bot: BotConfig;
  playerColor: Color;
  startFen?: string;
  setupSan?: string[];
  opponent: Opponent | null;
}

const ANALYSIS_DEPTH_CAP = 30;

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

  // variation tree + navigation
  tree: Record<string, MoveNode>;
  rootId: string;
  currentId: string;
  history: HistoryMove[]; // the *current line*, derived (excludes root)
  viewPly: number; // index of the current node within the current line
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
  /**
   * gameNo of the last finished game whose result was recorded (ratings/XP).
   * Guards the exactly-once recording in {@link _recordFinishedGame}.
   */
  scoredGameNo: number;
  /**
   * The player used takeback in this play-mode game. Takebacks are a training
   * aid, so the game still finishes normally — but it records as unrated
   * (retrying blunders until a win would otherwise farm Elo/XP/ladder rungs).
   */
  takebackUsed: boolean;
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

  // game review (annotations keyed by node id; evalGraph aligned to the main line)
  annotations: Record<string, Annotation>;
  reviewing: boolean;
  reviewProgress: number; // 0–100
  evalGraph: number[]; // White win% per main-line position (start + after each ply)
  reviewStats: ReviewStats | null;
  /** Rich per-move grades + explanations (keyed by node id), from the last review. */
  moveReviews: Record<string, MoveReview>;
  /** gameNo the current review belongs to (0 = none / stale). */
  reviewGameNo: number;

  // post-game results modal + guided walkthrough
  gameSummary: GameSummary | null;
  /** The user dismissed the results modal for the current game. */
  modalDismissed: boolean;
  /** The move-by-move coach walkthrough is engaged. */
  coachActive: boolean;
  /** The walkthrough is auto-advancing. */
  coachPlaying: boolean;

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
  goToNode(id: string): void;
  stepView(delta: number): void;
  takeback(): void;
  flip(): void;
  promote(id: string): void;
  deleteVariation(id: string): void;
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

  // results modal + guided walkthrough
  setGameSummary(summary: GameSummary): void;
  dismissModal(): void;
  reopenSummary(): void;
  /** Switch the just-finished game to the analysis board and start the walkthrough. */
  analyzeFinishedGame(): Promise<void>;
  startCoach(): void;
  stopCoach(): void;
  setCoachPlaying(playing: boolean): void;

  // internals
  _sync(): void;
  _recordFinishedGame(): void;
  _refreshAnalysis(): void;
  _maybeTriggerBot(): void;
  _applyMove(move: { from: string; to: string; promotion?: string }): void;
  _tick(dtMs: number): void;
}

const DEFAULT_BOT: BotConfig = { style: 'human', maiaRating: 1500, elo: 1500, moveTimeMs: 700 };

const START = new Chess();
const initial = newTree(START.fen());

export const useGame = create<GameStore>((set, get) => ({
  connected: false,
  availability: null,
  styles: [],

  mode: 'analysis',
  orientation: 'white',

  fen: START.fen(),
  lastMove: undefined,
  turnColor: 'white',
  liveTurn: 'white',
  inCheck: false,

  tree: initial.tree,
  rootId: initial.rootId,
  currentId: initial.rootId,
  history: [],
  viewPly: 0,
  startFen: START.fen(),

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
  scoredGameNo: 0,
  takebackUsed: false,
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
  moveReviews: {},
  reviewGameNo: 0,

  gameSummary: null,
  modalDismissed: false,
  coachActive: false,
  coachPlaying: false,

  init() {
    engine.onStatus.add((connected) => set({ connected }));
    engine.onWelcome.add(({ engines, styles }) => set({ availability: engines, styles }));
    engine.connect();
    get()._sync();
    get()._refreshAnalysis();
  },

  newGame(cfg) {
    gameId++;
    let g: Chess;
    try {
      g = new Chess(cfg.startFen ?? STARTING_FEN);
    } catch {
      g = new Chess();
    }
    const startFen = g.fen(); // the root the line branches from (before any setup)
    const { tree, rootId } = newTree(startFen);
    // Pre-play any setup moves (e.g. an opening) into the main line.
    let tipId = rootId;
    if (cfg.setupSan) {
      for (const san of cfg.setupSan) {
        let mv;
        try {
          mv = g.move(san);
        } catch {
          break; // stop at the first move that doesn't apply
        }
        if (!mv) break;
        const id = uid();
        tree[id] = {
          id,
          parentId: tipId,
          san: mv.san,
          uci: mv.from + mv.to + (mv.promotion ?? ''),
          fen: mv.after,
          ply: tree[tipId]!.ply + 1,
          children: [],
        };
        tree[tipId]!.children.push(id);
        tipId = id;
      }
    }
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
      takebackUsed: false,
      playSetup,
      manualResult: null,
      drawOffer: 'idle',
      winner: null,
      endReason: '',
      drawClaimable: false,
      tree,
      rootId,
      currentId: tipId,
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
      moveReviews: {},
      reviewGameNo: 0,
      gameSummary: null,
      modalDismissed: false,
      coachActive: false,
      coachPlaying: false,
    });
    if (cfg.mode === 'play') playSound('gameStart');
    get()._sync();
    get()._refreshAnalysis();
    get()._maybeTriggerBot();
  },

  userMove(from, to) {
    const s = get();
    if (s.isGameOver) return;
    // In play, only the live tip is interactive; analysis can branch anywhere.
    if (s.mode === 'play' && s.currentId !== tipOf(s.tree, s.rootId)) return;
    const baseFen = s.tree[s.currentId]!.fen;
    const probe = new Chess(baseFen);
    const legal = probe.moves({ verbose: true, square: from as any }).filter((m) => m.to === to);
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
    const s = get();
    // Play always extends the live main line; analysis branches from the view.
    const baseId = s.mode === 'play' ? tipOf(s.tree, s.rootId) : s.currentId;
    const base = s.tree[baseId]!;
    let mv;
    try {
      const c = new Chess(base.fen);
      mv = c.move({ from: move.from, to: move.to, promotion: move.promotion });
    } catch {
      get()._sync();
      return;
    }
    if (!mv) {
      get()._sync();
      return;
    }
    const uci = mv.from + mv.to + (mv.promotion ?? '');

    // If this move already exists as a child, just descend into it.
    const existingId = base.children.find((id) => s.tree[id]?.uci === uci);
    let tree = s.tree;
    let currentId: string;
    let structural = false;
    if (existingId) {
      currentId = existingId;
    } else {
      currentId = uid();
      tree = {
        ...tree,
        [currentId]: { id: currentId, parentId: base.id, san: mv.san, uci, fen: mv.after, ply: base.ply + 1, children: [] },
        [base.id]: { ...base, children: [...base.children, currentId] },
      };
      structural = true;
    }
    playMoveSound(mv.san);

    // Clocks: add the increment to the side that just moved (play only).
    const tc = get().timeControl;
    const clock = get().clock;
    const moverColor = colorOfFen(base.fen);
    const nextClock =
      s.mode === 'play' && clock && tc && !get().flagged
        ? moverColor === 'white'
          ? { ...clock, whiteMs: clock.whiteMs + tc.incrementMs }
          : { ...clock, blackMs: clock.blackMs + tc.incrementMs }
        : clock;

    set({
      tree,
      currentId,
      clock: nextClock,
      // A new move invalidates a stale review (annotations are kept on navigation).
      ...(structural
        ? { annotations: {}, evalGraph: [], reviewStats: null, moveReviews: {}, reviewGameNo: 0, coachActive: false, coachPlaying: false }
        : {}),
    });
    get()._sync();
    get()._refreshAnalysis();
    if (s.mode === 'play') get()._maybeTriggerBot();
  },

  _maybeTriggerBot() {
    const s = get();
    if (s.mode !== 'play' || s.thinking) return;
    const tipId = tipOf(s.tree, s.rootId);
    const tipNode = s.tree[tipId]!;
    const liveFen = tipNode.fen;
    const live = new Chess(liveFen);
    if (live.isGameOver()) return;
    if (colorOfFen(liveFen) !== s.botColor) return;
    const myGame = gameId;
    set({ thinking: true });
    const bot = s.botConfig;

    // Simulated human thinking time: quick book moves, near-instant recaptures
    // and only-moves, longer (occasionally much longer) middlegame thinks —
    // instead of the old fixed 300ms that made every bot feel robotic.
    const legal = live.moves({ verbose: true });
    const lastTo = tipNode.uci ? tipNode.uci.slice(2, 4) : null;
    const recaptureAvailable =
      !!lastTo && tipNode.san.includes('x') && legal.some((m) => m.to === lastTo && !!m.captured);
    const thinkMs = botThinkTimeMs({
      rating: s.opponent?.rating ?? bot.elo ?? bot.maiaRating ?? 1500,
      ply: plyOfFen(liveFen),
      legalMoves: legal.length,
      recaptureAvailable,
      inCheck: live.inCheck(),
      clockMs: s.clock ? (s.botColor === 'white' ? s.clock.whiteMs : s.clock.blackMs) : undefined,
    });
    // Recent positions let human-like bots avoid shuffling into repetition
    // while winning (the server ignores the field for other styles).
    const recentFens = positionsTo(s.tree, tipId).slice(-24);
    const started = Date.now();
    window.setTimeout(async () => {
      try {
        if (gameId !== myGame) return; // a new game started during the dispatch delay
        const res = await engine.botMove(liveFen, bot, recentFens);
        // Hold fast engine replies (Maia answers near-instantly) until the
        // simulated think time has elapsed.
        const remaining = thinkMs - (Date.now() - started);
        if (remaining > 0 && gameId === myGame) {
          await new Promise((r) => window.setTimeout(r, remaining));
        }
        if (gameId !== myGame) return; // a new game started meanwhile
        const from = res.uci.slice(0, 2);
        const to = res.uci.slice(2, 4);
        const promotion = res.uci.length > 4 ? res.uci[4] : undefined;
        set({ thinking: false });
        get()._applyMove({ from, to, promotion });
      } catch (e) {
        // Surface the failure instead of leaving the board silently frozen
        // (e.g. a bot style whose engine isn't installed on this server).
        if (gameId === myGame) {
          set({ thinking: false, status: 'Bot failed to move — try a different bot style.' });
        }
        console.error('[bot]', e);
      }
    }, Math.min(300, thinkMs));
  },

  goToNode(id) {
    if (!get().tree[id]) return;
    set({ currentId: id });
    get()._sync();
    get()._refreshAnalysis();
  },

  goToPly(ply) {
    const s = get();
    const line = lineOf(s.tree, s.currentId);
    const clamped = Math.max(0, Math.min(ply, line.length - 1));
    get().goToNode(line[clamped]!.id);
  },

  stepView(delta) {
    get().goToPly(get().viewPly + delta);
  },

  takeback() {
    const s = get();
    const tipId = tipOf(s.tree, s.rootId);
    if (tipId === s.rootId) return;
    // In play, undo back to the human's turn (drop the bot's reply too).
    let undo = 1;
    if (s.mode === 'play' && s.botColor) {
      const lastFen = s.tree[tipId]!.fen;
      if (colorOfFen(lastFen) === s.playerColor) undo = 2;
    }
    const tree = { ...s.tree };
    let cut = tipId;
    for (let i = 0; i < undo; i++) {
      const node = tree[cut];
      if (!node || !node.parentId) break;
      const parent = { ...tree[node.parentId]! };
      parent.children = parent.children.filter((c) => c !== cut);
      tree[parent.id] = parent;
      delete tree[cut];
      cut = parent.id;
    }
    gameId++; // invalidate any in-flight bot move
    set({
      tree,
      currentId: tree[cut] ? cut : s.rootId,
      thinking: false,
      pendingPromotion: null,
      annotations: {},
      evalGraph: [],
      reviewStats: null,
      moveReviews: {},
      reviewGameNo: 0,
      coachActive: false,
      coachPlaying: false,
      manualResult: null, // taking back un-ends a resigned / drawn game
      drawOffer: 'idle',
      // Taking back in a game makes it a training game: it still plays out
      // normally but records as unrated (no Elo/XP/ladder), otherwise
      // blunder → takeback → retry would farm rated wins.
      ...(s.mode === 'play' ? { takebackUsed: true } : {}),
    });
    get()._sync();
    get()._refreshAnalysis();
    get()._maybeTriggerBot(); // resume the bot if the takeback left it on move
  },

  flip() {
    set({ orientation: opposite(get().orientation) });
  },

  // Make the line through `id` the main line (promote it at every level).
  promote(id) {
    const tree = { ...get().tree };
    let n = tree[id];
    while (n && n.parentId) {
      const cur = n;
      const p = tree[cur.parentId!]!;
      if (p.children[0] !== cur.id) {
        tree[p.id] = { ...p, children: [cur.id, ...p.children.filter((c) => c !== cur.id)] };
      }
      n = tree[p.id];
    }
    set({ tree });
    get()._sync();
  },

  // Remove a node and its whole subtree.
  deleteVariation(id) {
    const s = get();
    const node = s.tree[id];
    if (!node || !node.parentId) return;
    const tree = { ...s.tree };
    const remove: string[] = [];
    const stack = [id];
    while (stack.length) {
      const x = stack.pop()!;
      remove.push(x);
      for (const c of tree[x]!.children) stack.push(c);
    }
    const parent = { ...tree[node.parentId]! };
    parent.children = parent.children.filter((c) => c !== id);
    tree[parent.id] = parent;
    for (const d of remove) delete tree[d];
    const currentId = remove.includes(s.currentId) ? parent.id : s.currentId;
    set({ tree, currentId });
    get()._sync();
    get()._refreshAnalysis();
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
    const decline = () => {
      set({ drawOffer: 'declined' });
      window.setTimeout(() => {
        if (get().drawOffer === 'declined') set({ drawOffer: 'idle' });
      }, 2600);
    };
    const plies = mainlineOf(s.tree, s.rootId).length;
    // The anti-farming ply floor only matters for rated games. Casual games
    // (custom opponents, pasted-FEN starts, post-takeback) can't move ratings,
    // so a drawn endgame being practised from a FEN deserves an honest answer:
    // treat them as played-out and decide on the evaluation alone.
    const casual = !s.opponent?.id || s.tree[s.rootId]!.fen !== STARTING_FEN || s.takebackUsed;
    const effPlies = casual ? Math.max(plies, MIN_DRAW_ACCEPT_PLIES) : plies;
    // Far too early for the bot to even consider it — decline without an eval.
    // (Accepting move-2 draws was an infinite rating-farming exploit.)
    if (effPlies < MIN_DRAW_ACCEPT_PLIES) {
      decline();
      return;
    }
    const myGame = gameId;
    set({ drawOffer: 'pending' });
    const fen = s.tree[tipOf(s.tree, s.rootId)]!.fen;
    const botColor = s.botColor;
    try {
      const score = await engine.evalOnce(fen, { movetimeMs: 600 });
      if (gameId !== myGame) return; // game changed under us
      const whiteCp = !score ? null : score.kind === 'mate' ? (score.value > 0 ? 10_000 : score.value < 0 ? -10_000 : 0) : score.value;
      const botCp = whiteCp === null ? null : botColor === 'white' ? whiteCp : -whiteCp;
      // The bot agrees only in genuinely drawish, sufficiently played-out spots.
      if (botAcceptsDraw({ plies: effPlies, botCp, fen })) {
        set({ drawOffer: 'accepted', manualResult: { winner: 'draw', reason: 'Draw agreed' }, thinking: false });
        gameId++;
        get()._sync();
      } else {
        decline();
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
    const tipId = tipOf(s.tree, s.rootId);
    const reason =
      countRepetitions(positionsTo(s.tree, tipId), s.tree[tipId]!.fen) >= 3 ? 'Threefold repetition' : 'Fifty-move rule';
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
    if (get().mode !== 'analysis') return;
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
    gameId++;
    const startFen = verbose[0]!.before;
    const { tree, rootId } = newTree(startFen);
    let parentId = rootId;
    for (const m of verbose) {
      const id = uid();
      tree[id] = {
        id,
        parentId,
        san: m.san,
        uci: m.from + m.to + (m.promotion ?? ''),
        fen: m.after,
        ply: tree[parentId]!.ply + 1,
        children: [],
      };
      tree[parentId]!.children.push(id);
      parentId = id;
    }
    set({
      mode: 'analysis',
      playerColor: null,
      botColor: null,
      opponent: null,
      playSetup: null,
      manualResult: null,
      drawOffer: 'idle',
      winner: null,
      endReason: '',
      drawClaimable: false,
      gameNo: get().gameNo + 1,
      takebackUsed: false,
      tree,
      rootId,
      currentId: rootId,
      startFen,
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
      moveReviews: {},
      reviewGameNo: 0,
      gameSummary: null,
      modalDismissed: false,
      coachActive: false,
      coachPlaying: false,
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
    gameId++;
    const { tree, rootId } = newTree(c.fen());
    set({
      mode: 'analysis',
      playerColor: null,
      botColor: null,
      opponent: null,
      playSetup: null,
      manualResult: null,
      drawOffer: 'idle',
      gameNo: get().gameNo + 1,
      takebackUsed: false,
      orientation: c.turn() === 'b' ? 'black' : 'white',
      tree,
      rootId,
      currentId: rootId,
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
      moveReviews: {},
      reviewGameNo: 0,
      gameSummary: null,
      modalDismissed: false,
      coachActive: false,
      coachPlaying: false,
    });
    get()._sync();
    get()._refreshAnalysis();
    return true;
  },

  async reviewGame() {
    const s0 = get();
    const mainline = mainlineOf(s0.tree, s0.rootId);
    if (s0.reviewing || mainline.length === 0) return;
    const myGame = gameId;
    const myGameNo = s0.gameNo;
    engine.stopAnalysis();
    set({ reviewing: true, reviewProgress: 0, annotations: {}, evalGraph: [], reviewStats: null, moveReviews: {}, reviewGameNo: 0 });

    // Lazy-loaded review machinery (see the import note at the top of the
    // file). Loaded in parallel before the eval loop; the per-position
    // `gameId !== myGame` guard below covers anything changing during the
    // await exactly as it does during engine calls. A failed chunk fetch
    // (e.g. offline before the SW finished precaching) must not latch
    // `reviewing: true` forever — reset it so the user can simply retry.
    const mods = await Promise.all([
      import('../lib/coach'),
      import('../lib/analytics/report'),
      import('./analysisReport'),
    ]).catch(() => null);
    if (!mods) {
      set({ reviewing: false });
      return;
    }
    const [{ buildMoveReviews, checkmateWinner, cpOf }, { REVIEW_ENGINE_SETTINGS }, { useAnalysisReport }] = mods;

    // Evaluate every position with 2 lines, so we get the best move (and the
    // runner-up, for "only move" detection) at each step — not just the score.
    // REVIEW_ENGINE_SETTINGS (lib/analytics/report) is the single source of the
    // review budget: a FIXED-DEPTH search (movetimeMs 0 = no wall-clock cap) on
    // a fresh engine state (`fresh` sends ucinewgame, clearing the hash table),
    // so evals — and therefore grades and accuracy — are identical run to run
    // and device-independent, where the old 300 ms wall-clock budget produced
    // different (and shallower) evals on every review. The same object flows
    // into buildFromReview below, so the report cache key self-invalidates
    // whenever this budget changes.
    const fens = [s0.startFen, ...mainline.map((n) => n.fen)];
    const evals: PositionEval[] = [];
    const rawLines: AnalysisLine[][] = []; // full multipv lines, for the report layer's PVs
    for (let i = 0; i < fens.length; i++) {
      const lines = await engine.analyzeManyOnce(fens[i]!, { ...REVIEW_ENGINE_SETTINGS, fresh: true });
      if (gameId !== myGame) {
        set({ reviewing: false });
        return; // game changed under us
      }
      const best = lines[0];
      evals.push({
        score: best?.score ?? null,
        bestUci: best?.pvUci[0] ?? null,
        bestSan: best?.pvSan[0] ?? null,
        secondScore: lines[1]?.score ?? null,
      });
      rawLines.push(lines);
      set({ reviewProgress: Math.round(((i + 1) / fens.length) * 100) });
    }

    // How far the game stayed in opening theory (transposition-aware).
    let bookPly = 0;
    try {
      const op = await detectOpening(mainline.map((n) => n.san));
      bookPly = op?.ply ?? 0;
    } catch {
      bookPly = 0;
    }
    if (gameId !== myGame) {
      set({ reviewing: false });
      return;
    }

    const reviews = buildMoveReviews({
      startFen: s0.startFen,
      nodes: mainline.map((n) => ({ id: n.id, san: n.san, uci: n.uci, fen: n.fen, ply: n.ply })),
      evals,
      bookPly,
    });

    // Per-move accuracy (Lichess curve) + centipawn loss; annotations are derived
    // from the rich grades so the move list, eval graph and counts agree.
    // Terminal positions have no engine eval (score null → 50/50), so score a
    // checkmate from its FEN — otherwise the mating move reads as a huge drop.
    const mateWinner = fens.map((f) => checkmateWinner(f));
    const winWhite = evals.map((e, i) => {
      const w = mateWinner[i];
      return w ? (w === 'white' ? 100 : 0) : whiteWinPercent(e.score);
    });
    const cpWhite = evals.map((e, i) => {
      const w = mateWinner[i];
      return w ? (w === 'white' ? 1500 : -1500) : cpOf(e.score);
    });
    const moveReviews: Record<string, MoveReview> = {};
    const ann: Record<string, Annotation> = {};
    const agg = { white: { accSum: 0, cpl: 0, moves: 0 }, black: { accSum: 0, cpl: 0, moves: 0 } };
    for (let i = 0; i < mainline.length; i++) {
      const r = reviews[i];
      if (r) {
        moveReviews[r.id] = r;
        if (r.classification === 'blunder') ann[r.id] = 'blunder';
        else if (r.classification === 'mistake' || r.classification === 'miss') ann[r.id] = 'mistake';
        else if (r.classification === 'inaccuracy') ann[r.id] = 'inaccuracy';
      }
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
    }

    const side = (a: { accSum: number; cpl: number; moves: number }): SideReview => ({
      accuracy: a.moves ? Math.round(a.accSum / a.moves) : 100,
      acpl: a.moves ? Math.round(a.cpl / a.moves) : 0,
      moves: a.moves,
    });

    set({
      annotations: ann,
      moveReviews,
      reviewGameNo: myGameNo,
      evalGraph: winWhite,
      reviewStats: { white: side(agg.white), black: side(agg.black) },
      reviewing: false,
      reviewProgress: 100,
    });
    // Hand the raw review data to the report layer (builds the full analysis
    // report and caches it; self-invalidates via the gameNo comparison).
    void useAnalysisReport.getState().buildFromReview({
      startFen: s0.startFen,
      nodes: mainline.map((n) => ({ id: n.id, san: n.san, uci: n.uci, fen: n.fen, ply: n.ply })),
      evals,
      rawLines,
      moveReviews,
      bookPly,
      engine: REVIEW_ENGINE_SETTINGS, // the opts the eval loop above actually ran with
      gameNo: myGameNo,
      result: null,
      playerColor: s0.playerColor,
    });
    get()._refreshAnalysis();
  },

  // --- results modal + guided walkthrough -----------------------------------

  setGameSummary(summary) {
    set({ gameSummary: summary, modalDismissed: false });
  },

  dismissModal() {
    set({ modalDismissed: true });
  },

  reopenSummary() {
    if (get().gameSummary) set({ modalDismissed: false });
  },

  async analyzeFinishedGame() {
    const s = get();
    if (!s.gameSummary) return;
    const targetGameNo = s.gameSummary.gameNo;
    // Hand the played game over to the analysis board (the tree is already the
    // game), face it from the player's side, and rewind to the start.
    set({ mode: 'analysis', modalDismissed: true, analysisOn: true });
    get().goToPly(0);
    // Reuse the modal's background review when it's for this game; otherwise run it.
    if (engine.connected && get().reviewGameNo !== targetGameNo && !get().reviewing) {
      await get().reviewGame();
    }
    if (get().gameNo !== targetGameNo) return; // a new game started meanwhile
    get().startCoach();
  },

  startCoach() {
    const s = get();
    if (mainlineOf(s.tree, s.rootId).length === 0) return;
    set({ coachActive: true, coachPlaying: true });
    get().goToPly(1); // land on the first move so its explanation shows
  },

  stopCoach() {
    set({ coachActive: false, coachPlaying: false });
  },

  setCoachPlaying(playing) {
    set({ coachPlaying: playing });
  },

  _tick(dtMs) {
    const s = get();
    if (s.mode !== 'play' || !s.clock || s.flagged) return;
    if (s.currentId !== tipOf(s.tree, s.rootId)) return; // not at the live position
    const liveFen = s.tree[s.currentId]!.fen;
    if (new Chess(liveFen).isGameOver()) return;
    const turn = colorOfFen(liveFen);
    const ms = turn === 'white' ? s.clock.whiteMs : s.clock.blackMs;
    const left = Math.max(0, ms - dtMs);
    const clock = turn === 'white' ? { ...s.clock, whiteMs: left } : { ...s.clock, blackMs: left };
    if (left <= 0) {
      set({ clock, flagged: turn });
      get()._sync();
      // The game just ended on time — restart the (in-play suppressed)
      // analysis stream, like every other terminal path does.
      get()._refreshAnalysis();
    } else {
      set({ clock });
    }
  },

  _sync() {
    const s = get();
    const tipId = tipOf(s.tree, s.rootId);
    const line = lineOf(s.tree, s.currentId);
    const viewPly = line.findIndex((n) => n.id === s.currentId);
    const history: HistoryMove[] = line.slice(1).map((n) => ({ san: n.san, uci: n.uci, fen: n.fen }));

    const cur = s.tree[s.currentId]!;
    const viewedFen = cur.fen;
    const viewedLast: [string, string] | undefined = cur.parentId ? [cur.uci.slice(0, 2), cur.uci.slice(2, 4)] : undefined;

    const turnColor = colorOfFen(viewedFen);
    const viewProbe = new Chess(viewedFen);
    const inCheck = viewProbe.inCheck();

    // Outcome: the live tip in a vs-bot game, the viewed position when analysing.
    const liveFen = s.tree[tipId]!.fen;
    const outcomeFen = s.mode === 'play' ? liveFen : viewedFen;
    const outcome = new Chess(outcomeFen);
    const liveColor = colorOfFen(outcomeFen);
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
    } else if (outcome.isCheckmate()) {
      isGameOver = true;
      winner = opposite(liveColor);
      endReason = 'checkmate';
      status = `Checkmate — ${cap(winner)} wins`;
    } else if (outcome.isStalemate()) {
      isGameOver = true;
      winner = 'draw';
      endReason = 'stalemate';
      status = 'Draw — stalemate';
    } else if (outcome.isInsufficientMaterial()) {
      isGameOver = true;
      winner = 'draw';
      endReason = 'insufficient material';
      status = 'Draw — insufficient material';
    } else {
      // Threefold repetition and the 50-move rule are *claimable*, not automatic.
      // Repetition needs the whole line's positions — a Chess instance built
      // from a single FEN has no history, so isThreefoldRepetition() on
      // `outcome` would never fire. Count identical positions (placement +
      // side to move + castling + en-passant rights) along the played line.
      const threefold = countRepetitions(positionsTo(s.tree, s.mode === 'play' ? tipId : s.currentId), outcomeFen) >= 3;
      const fiftyMove = Number(outcomeFen.split(' ')[4] ?? '0') >= 100;
      const moveStatus = `${cap(liveColor)} to move${outcome.inCheck() ? ' — check' : ''}`;
      if ((threefold || fiftyMove) && s.mode === 'play') {
        drawClaimable = true;
        status = threefold ? 'Threefold repetition — you can claim a draw' : 'Fifty-move rule — you can claim a draw';
      } else if (fiftyMove && s.mode !== 'play') {
        // The 50-move rule is derivable from the FEN alone, matching what the
        // board itself refuses to play past — terminal on the analysis board.
        isGameOver = true;
        winner = 'draw';
        endReason = 'fifty-move rule';
        status = 'Draw — fifty-move rule';
      } else if (threefold && s.mode !== 'play') {
        // NEVER terminal on the analysis board: positions recur constantly
        // while exploring lines, and ending the "game" here would silently
        // block every further move (and mislabel decisive games as draws
        // when exported at the repeated ply). Annotate the status only.
        status = `${moveStatus} · threefold repetition`;
      } else {
        status = moveStatus;
      }
    }

    // interaction
    const atLive = s.currentId === tipId;
    const canMove = s.mode === 'analysis' ? !new Chess(viewedFen).isGameOver() : atLive && !isGameOver;
    let movableColor: Color | 'both' | undefined;
    const dests = new Map<string, string[]>();
    if (canMove) {
      if (s.mode === 'analysis') {
        movableColor = 'both';
      } else {
        // Keep the player's pieces grabbable even while the bot is on move so
        // chessground can queue a premove (it needs movable.color to stay the
        // player's colour). Real destinations only exist on the player's turn,
        // so no actual move can slip through out of turn.
        movableColor = s.playerColor ?? undefined;
      }
      const allowed = s.mode === 'analysis' || (colorOfFen(viewedFen) === s.playerColor && !s.thinking);
      if (allowed) {
        for (const m of viewProbe.moves({ verbose: true })) {
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
      liveTurn: colorOfFen(liveFen),
      inCheck,
      history,
      viewPly,
      startFen: s.tree[s.rootId]!.fen,
      status,
      isGameOver,
      winner,
      endReason,
      drawClaimable,
      movableColor,
      dests,
    });
    get()._recordFinishedGame();
  },

  /**
   * Score a finished vs-bot game (ratings + XP + achievements + ladder) and
   * snapshot the results modal. Idempotent: `scoredGameNo` is claimed before
   * recording, so no matter how many times `_sync` runs after the game ends
   * (navigation, page remounts, analysis updates), each game records once.
   */
  _recordFinishedGame() {
    const s = get();
    if (!s.isGameOver || s.mode !== 'play' || !s.playerColor || !s.botColor || s.winner === null) return;
    if (s.gameNo === s.scoredGameNo) return; // already recorded
    const plies = mainlineOf(s.tree, s.rootId).length;
    if (plies < 1) return; // ignore empty games
    set({ scoredGameNo: s.gameNo }); // claim first — recording must be exactly-once

    const outcome: GameOutcome = s.winner === 'draw' ? 'draw' : s.winner === s.playerColor ? 'win' : 'loss';
    const opponentRating =
      s.opponent?.rating ?? (s.botConfig.style === 'human' ? s.botConfig.maiaRating : s.botConfig.elo) ?? 1500;
    const timed = s.clock !== null;

    // Only proper games count for rating: a roster (ladder) opponent, playing
    // from the standard initial position, with no takebacks. Custom-tab games
    // (hand-picked bots, which never carry a roster id) and pasted-FEN starts
    // are casual (no Elo/XP): an arbitrary start position vs a mismatched bot
    // was a trivial rating farm. Takebacks turn the game into a training game:
    // blunder → takeback → retry must not farm rated wins.
    const casual = !s.opponent?.id || s.tree[s.rootId]!.fen !== STARTING_FEN || s.takebackUsed;
    // Very early agreed draws are rating-neutral even in proper games, so a
    // quick handshake can never farm rating points.
    const earlyAgreedDraw = outcome === 'draw' && s.endReason === 'Draw agreed' && !agreedDrawIsRated(plies);
    const isRated = !casual && !earlyAgreedDraw;
    let rated: { category: 'bots' | 'blitz' | 'puzzles'; ratingBefore: number; ratingAfter: number; ratingDelta: number };
    if (isRated) {
      rated = recordGameResult({ opponentRating, outcome, timed });
      if (s.opponent?.id && outcome === 'win') useLadder.getState().markDefeated(s.opponent.id);
    } else {
      const category = timed ? ('blitz' as const) : ('bots' as const);
      const elo = Math.round(useRatings.getState().categories[category].elo);
      rated = { category, ratingBefore: elo, ratingAfter: elo, ratingDelta: 0 };
    }

    // Capture a snapshot for the results modal (rating delta + headline stats).
    get().setGameSummary({
      gameNo: s.gameNo,
      outcome,
      playerColor: s.playerColor,
      opponent: s.opponent,
      endReason: s.endReason,
      statusText: s.status,
      timed,
      category: rated.category === 'blitz' ? 'blitz' : 'bots',
      rated: isRated,
      ratingBefore: rated.ratingBefore,
      ratingAfter: rated.ratingAfter,
      ratingDelta: rated.ratingDelta,
      plies,
      moves: Math.ceil(plies / 2),
    });
  },

  _refreshAnalysis() {
    const s = get();
    // The server runs one analysis engine per session; don't start a live
    // search while a one-shot batch (game review) owns the stream, or its
    // reqId gets clobbered and the review hangs on the safety timeout.
    if (!s.analysisOn || s.reviewing) return;
    // No engine assistance while a vs-bot game is in progress: live eval and
    // best lines would be built-in cheating. Analysis comes back the moment
    // the game ends, and is always available on the analysis board.
    if (s.mode === 'play' && !s.isGameOver) {
      engine.stopAnalysis();
      if (s.analysisLines.length > 0 || s.evalScore !== null || s.analysisDepth !== 0) {
        set({ analysisLines: [], evalScore: null, analysisDepth: 0 });
      }
      return;
    }
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
