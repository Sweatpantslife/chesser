import { Chess } from 'chess.js';
import { create } from 'zustand';
import type { AnalysisLine, BotConfig, BotStyle, EngineAvailability, Score } from '@chesser/shared';
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

  // game review (annotations keyed by node id; evalGraph aligned to the main line)
  annotations: Record<string, Annotation>;
  reviewing: boolean;
  reviewProgress: number; // 0–100
  evalGraph: number[]; // White win% per main-line position (start + after each ply)
  reviewStats: ReviewStats | null;

  // actions
  init(): void;
  newGame(cfg: { mode: Mode; playerColor?: Color; bot?: BotConfig }): void;
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
    gameId++;
    const fresh = newTree(new Chess().fen());
    const playerColor = cfg.mode === 'play' ? (cfg.playerColor ?? 'white') : null;
    const tc = get().timeControl;
    const clock = cfg.mode === 'play' && tc ? { whiteMs: tc.initialMs, blackMs: tc.initialMs } : null;
    set({
      mode: cfg.mode,
      orientation: playerColor ?? get().orientation,
      playerColor,
      botColor: playerColor ? opposite(playerColor) : null,
      botConfig: cfg.bot ?? get().botConfig,
      tree: fresh.tree,
      rootId: fresh.rootId,
      currentId: fresh.rootId,
      startFen: fresh.tree[fresh.rootId]!.fen,
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
    const existingId = base.children.find((id) => s.tree[id]!.uci === uci);
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
      ...(structural ? { annotations: {}, evalGraph: [], reviewStats: null } : {}),
    });
    get()._sync();
    get()._refreshAnalysis();
    if (s.mode === 'play') get()._maybeTriggerBot();
  },

  _maybeTriggerBot() {
    const s = get();
    if (s.mode !== 'play' || s.thinking) return;
    const liveFen = s.tree[tipOf(s.tree, s.rootId)]!.fen;
    const live = new Chess(liveFen);
    if (live.isGameOver()) return;
    if (colorOfFen(liveFen) !== s.botColor) return;
    const myGame = gameId;
    set({ thinking: true });
    const bot = s.botConfig;
    window.setTimeout(async () => {
      try {
        const res = await engine.botMove(liveFen, bot);
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
    });
    get()._sync();
    get()._refreshAnalysis();
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
    engine.stopAnalysis();
    set({ reviewing: true, reviewProgress: 0, annotations: {}, evalGraph: [], reviewStats: null });

    const cap = (cp: number) => Math.max(-1500, Math.min(1500, cp));
    const cpOf = (sc: Score | null): number =>
      !sc ? 0 : sc.kind === 'mate' ? (sc.value > 0 ? 1500 : sc.value < 0 ? -1500 : 0) : cap(sc.value);

    const fens = [s0.startFen, ...mainline.map((n) => n.fen)];
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
    const ann: Record<string, Annotation> = {};
    const agg = {
      white: { accSum: 0, cpl: 0, moves: 0 },
      black: { accSum: 0, cpl: 0, moves: 0 },
    };
    for (let i = 0; i < mainline.length; i++) {
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

      if (winDrop >= 30) ann[mainline[i]!.id] = 'blunder';
      else if (winDrop >= 18) ann[mainline[i]!.id] = 'mistake';
      else if (winDrop >= 9) ann[mainline[i]!.id] = 'inaccuracy';
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

    // Outcome: the live tip in play, the viewed position in analysis.
    const liveFen = s.tree[tipId]!.fen;
    const outcomeFen = s.mode === 'play' ? liveFen : viewedFen;
    const outcome = new Chess(outcomeFen);
    let status = `${colorOfFen(outcomeFen) === 'white' ? 'White' : 'Black'} to move`;
    let isGameOver = false;
    if (outcome.isCheckmate()) {
      status = `Checkmate — ${colorOfFen(outcomeFen) === 'white' ? 'Black' : 'White'} wins`;
      isGameOver = true;
    } else if (outcome.isStalemate()) {
      status = 'Draw — stalemate';
      isGameOver = true;
    } else if (outcome.isInsufficientMaterial()) {
      status = 'Draw — insufficient material';
      isGameOver = true;
    } else if (outcome.isThreefoldRepetition()) {
      status = 'Draw — threefold repetition';
      isGameOver = true;
    } else if (outcome.isDraw()) {
      status = 'Draw — 50-move rule';
      isGameOver = true;
    } else if (outcome.inCheck()) {
      status = `${colorOfFen(outcomeFen) === 'white' ? 'White' : 'Black'} to move — check`;
    }

    // a flag fall ends the game regardless of board state
    const flagged = s.flagged;
    if (flagged) {
      status = `${flagged === 'white' ? 'White' : 'Black'} flagged — ${flagged === 'white' ? 'Black' : 'White'} wins on time`;
      isGameOver = true;
    }

    // interaction
    const atLive = s.currentId === tipId;
    const canMove = s.mode === 'analysis' ? !new Chess(viewedFen).isGameOver() : atLive && !isGameOver;
    let movableColor: Color | 'both' | undefined;
    const dests = new Map<string, string[]>();
    if (canMove) {
      const allowed = s.mode === 'analysis' || (colorOfFen(viewedFen) === s.playerColor && !s.thinking);
      if (allowed) {
        movableColor = s.mode === 'analysis' ? 'both' : (s.playerColor ?? undefined);
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
