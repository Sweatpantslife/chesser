/**
 * Friend-link game rooms: in-memory, unrated, two-player games behind a short
 * shareable code. The room is the single source of truth — it validates every
 * move with chess.js, enforces turn order via per-seat secret tokens, runs the
 * clocks, and pushes the full state to every attached outlet after any change.
 *
 * The wall clock (`now`) and the flag scheduler are injectable so the clock
 * logic is unit-testable without real timers.
 */
import { randomUUID } from 'node:crypto';
import { Chess } from 'chess.js';
import type {
  FriendColor,
  FriendGameResult,
  FriendGameState,
  FriendGameStatus,
  FriendServerMessage,
  FriendTimeControl,
} from '@chesser/shared';
import { cleanDisplayName } from '../trust/moderation.js';

/** A user-facing failure (bad move, wrong turn, room full, …). */
export class RoomError extends Error {}

export type Outlet = (msg: FriendServerMessage) => void;

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const CODE_LENGTH = 6;
const MAX_ROOMS = 500;
const MAX_PLIES = 1000; // hard safety cap; casual games end long before this
const NAME_MAX = 24;

/** How long an untouched room lives, by status. */
const TTL_MS: Record<FriendGameStatus, number> = {
  waiting: 2 * 60 * 60 * 1000, // 2h to share the link and start
  active: 6 * 60 * 60 * 1000, // generous — slow untimed games
  over: 30 * 60 * 1000, // enough to see the result after a refresh
};

const opposite = (c: FriendColor): FriendColor => (c === 'white' ? 'black' : 'white');

/**
 * Can `color` still deliver mate, even with the opponent's cooperation?
 * Lichess/FIDE practice for wins on time: a lone king, or king + one minor,
 * cannot win — flagging against them yields a draw instead.
 */
function hasMatingMaterial(chess: Chess, color: FriendColor): boolean {
  const want = color === 'white' ? 'w' : 'b';
  let minors = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== want || sq.type === 'k') continue;
      if (sq.type === 'p' || sq.type === 'r' || sq.type === 'q') return true;
      minors += 1;
      if (minors >= 2) return true;
    }
  }
  return false;
}

function sanitizeName(name: string | undefined, fallback: string): string {
  // Moderated like every user-set display text (trust/moderation.ts): control
  // chars stripped, length bounded, and profane/impersonating names degrade
  // to the seat default instead of erroring mid-join.
  return cleanDisplayName(name, NAME_MAX, fallback);
}

/** Clamp/validate a client-supplied time control (also used by challenges). */
export function validTimeControl(tc: FriendTimeControl | null | undefined): FriendTimeControl | null {
  if (!tc) return null;
  const initialMs = Number(tc.initialMs);
  const incrementMs = Number(tc.incrementMs);
  if (!Number.isFinite(initialMs) || initialMs < 10_000 || initialMs > 3 * 60 * 60 * 1000) return null;
  if (!Number.isFinite(incrementMs) || incrementMs < 0 || incrementMs > 60_000) return null;
  return { initialMs, incrementMs, label: String(tc.label ?? '').slice(0, 12) || 'custom' };
}

interface Seat {
  token: string;
  name: string;
  outlets: Set<Outlet>;
}

export interface RoomDeps {
  now: () => number;
  /** Schedule `fn` after `ms`; returns a cancel function. */
  schedule: (fn: () => void, ms: number) => () => void;
}

const realDeps: RoomDeps = {
  now: () => Date.now(),
  schedule: (fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
};

export class FriendRoom {
  private readonly chess: Chess;
  private readonly moves: string[] = [];
  private readonly sans: string[] = [];
  private readonly seats: Record<FriendColor, Seat | null> = { white: null, black: null };
  private clock: { whiteMs: number; blackMs: number } | null = null;
  /** When the side to move took over the clock (active games only). */
  private turnStartedAt = 0;
  private cancelFlagTimer: (() => void) | null = null;
  private status: FriendGameStatus = 'waiting';
  private result: FriendGameResult | null = null;
  private drawOffer: FriendColor | null = null;
  lastActivityAt: number;

  constructor(
    readonly code: string,
    readonly timeControl: FriendTimeControl | null,
    private readonly deps: RoomDeps,
    /** Test-only: start from a custom position (not exposed over the wire). */
    startFen?: string,
  ) {
    this.chess = startFen ? new Chess(startFen) : new Chess();
    this.lastActivityAt = deps.now();
  }

  // --- seats & connections --------------------------------------------------

  /** Create the first seat (the room creator). */
  seatCreator(name: string | undefined, prefer: FriendColor | 'random' | undefined): { token: string; color: FriendColor } {
    const color: FriendColor =
      prefer === 'white' || prefer === 'black' ? prefer : Math.random() < 0.5 ? 'white' : 'black';
    const token = randomUUID();
    this.seats[color] = { token, name: sanitizeName(name, color === 'white' ? 'White' : 'Black'), outlets: new Set() };
    this.touch();
    return { token, color };
  }

  /**
   * Join the room: with a valid seat token this is a rejoin (refresh / second
   * tab); without one it claims the open seat and starts the game.
   */
  join(token: string | undefined, name: string | undefined): { token: string; color: FriendColor } {
    if (token) {
      const color = this.colorOf(token);
      if (color) {
        this.touch();
        return { token, color };
      }
      // A stale token for another room falls through to a normal join.
    }
    const open: FriendColor | null = !this.seats.white ? 'white' : !this.seats.black ? 'black' : null;
    if (!open) throw new RoomError('This game already has two players.');
    const fresh = randomUUID();
    this.seats[open] = { token: fresh, name: sanitizeName(name, open === 'white' ? 'White' : 'Black'), outlets: new Set() };
    if (this.status === 'waiting') {
      this.status = 'active';
      if (this.timeControl) {
        this.clock = { whiteMs: this.timeControl.initialMs, blackMs: this.timeControl.initialMs };
        this.turnStartedAt = this.deps.now();
        this.armFlagTimer();
      }
    }
    this.touch();
    return { token: fresh, color: open };
  }

  colorOf(token: string): FriendColor | null {
    if (this.seats.white?.token === token) return 'white';
    if (this.seats.black?.token === token) return 'black';
    return null;
  }

  attach(token: string, outlet: Outlet): FriendColor | null {
    const color = this.colorOf(token);
    if (color) {
      this.seats[color]!.outlets.add(outlet);
      this.touch();
    }
    return color;
  }

  detach(token: string, outlet: Outlet): void {
    const color = this.colorOf(token);
    if (color) this.seats[color]!.outlets.delete(outlet);
  }

  // --- game actions ----------------------------------------------------------

  /** Apply a move for the seat holding `token`. Throws RoomError when invalid. */
  move(token: string, uci: string): void {
    const color = this.requireSeat(token);
    this.requireLive();
    if (this.status === 'waiting') throw new RoomError('Waiting for your opponent to join.');
    this.checkFlag();
    if (this.status !== 'active') throw new RoomError('The game is over.');
    const turn: FriendColor = this.chess.turn() === 'w' ? 'white' : 'black';
    if (turn !== color) throw new RoomError('Not your turn.');
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new RoomError('Malformed move.');
    if (this.moves.length >= MAX_PLIES) throw new RoomError('Game is too long.');

    let mv;
    try {
      mv = this.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      throw new RoomError('Illegal move.');
    }
    if (!mv) throw new RoomError('Illegal move.');

    // Clock: charge the mover for the time used, then add the increment.
    if (this.clock && this.timeControl) {
      const now = this.deps.now();
      const used = Math.max(0, now - this.turnStartedAt);
      const key = color === 'white' ? 'whiteMs' : 'blackMs';
      const left = this.clock[key] - used;
      if (left <= 0) {
        // Flag beat the move: roll the move back and end the game on time.
        this.chess.undo();
        this.clock[key] = 0;
        this.finishOnTime(color);
        return;
      }
      this.clock[key] = left + this.timeControl.incrementMs;
      this.turnStartedAt = now;
    }

    this.moves.push(uci);
    this.sans.push(mv.san);
    this.drawOffer = null; // any move clears a pending offer

    // Board-decided endings. Unrated casual play: claimable draws end the game
    // automatically (threefold / 50-move), matching how friends actually play.
    if (this.chess.isGameOver()) {
      if (this.chess.isCheckmate()) this.finish({ winner: color, reason: 'checkmate' });
      else if (this.chess.isStalemate()) this.finish({ winner: 'draw', reason: 'stalemate' });
      else if (this.chess.isInsufficientMaterial()) this.finish({ winner: 'draw', reason: 'insufficient material' });
      else if (this.chess.isThreefoldRepetition()) this.finish({ winner: 'draw', reason: 'threefold repetition' });
      else this.finish({ winner: 'draw', reason: 'fifty-move rule' });
      return;
    }
    this.armFlagTimer();
    this.touch();
  }

  resign(token: string): void {
    const color = this.requireSeat(token);
    this.requireLive();
    if (this.status === 'waiting') throw new RoomError('The game has not started.');
    this.finish({ winner: opposite(color), reason: 'resignation' });
  }

  /**
   * Abort a game that has barely started (fewer than 2 plies) — the standard
   * no-fault escape hatch when an opponent never actually plays.
   */
  abort(token: string): void {
    this.requireSeat(token);
    this.requireLive();
    if (this.status === 'active' && this.moves.length >= 2) throw new RoomError('The game can no longer be aborted.');
    this.finish({ winner: 'draw', reason: 'aborted' });
  }

  offerDraw(token: string): void {
    const color = this.requireSeat(token);
    this.requireLive();
    if (this.status !== 'active') throw new RoomError('The game has not started.');
    if (this.drawOffer === opposite(color)) {
      // Both sides want a draw — treat as acceptance.
      this.finish({ winner: 'draw', reason: 'agreement' });
      return;
    }
    this.drawOffer = color;
    this.touch();
  }

  respondDraw(token: string, accept: boolean): void {
    const color = this.requireSeat(token);
    this.requireLive();
    if (this.drawOffer !== opposite(color)) throw new RoomError('No draw offer to respond to.');
    if (accept) {
      this.finish({ winner: 'draw', reason: 'agreement' });
    } else {
      this.drawOffer = null;
      this.touch();
    }
  }

  /**
   * End the game on time if the side to move has run out. Safe to call any
   * time. Broadcasts the game-over state itself: a caller that trips the flag
   * mid-action (e.g. a move arriving after time expired) throws before its own
   * broadcast, and the opponent must still learn the game ended.
   */
  checkFlag(): void {
    if (this.status !== 'active' || !this.clock) return;
    const turn: FriendColor = this.chess.turn() === 'w' ? 'white' : 'black';
    const key = turn === 'white' ? 'whiteMs' : 'blackMs';
    const left = this.clock[key] - Math.max(0, this.deps.now() - this.turnStartedAt);
    if (left <= 0) {
      this.clock[key] = 0;
      this.finishOnTime(turn);
      this.broadcast();
    }
  }

  /**
   * `flagged` ran out of time. The opponent wins — unless they lack mating
   * material, in which case the game is a draw (FIDE 6.9 / Lichess rule).
   */
  private finishOnTime(flagged: FriendColor): void {
    const winner = opposite(flagged);
    if (hasMatingMaterial(this.chess, winner)) this.finish({ winner, reason: 'on time' });
    else this.finish({ winner: 'draw', reason: 'timeout vs insufficient material' });
  }

  // --- state -----------------------------------------------------------------

  state(): FriendGameState {
    const seatInfo = (c: FriendColor) => {
      const s = this.seats[c];
      return s ? { name: s.name, connected: s.outlets.size > 0 } : null;
    };
    // Project the running clock to now so a client renders accurate times on join.
    let clock = this.clock ? { ...this.clock } : null;
    if (clock && this.status === 'active') {
      const turn = this.chess.turn() === 'w' ? 'whiteMs' : 'blackMs';
      clock[turn] = Math.max(0, clock[turn] - Math.max(0, this.deps.now() - this.turnStartedAt));
    }
    return {
      code: this.code,
      status: this.status,
      fen: this.chess.fen(),
      moves: [...this.moves],
      sans: [...this.sans],
      turn: this.chess.turn() === 'w' ? 'white' : 'black',
      players: { white: seatInfo('white'), black: seatInfo('black') },
      timeControl: this.timeControl,
      clock,
      drawOffer: this.drawOffer,
      result: this.result,
    };
  }

  broadcast(): void {
    const msg: FriendServerMessage = { t: 'state', state: this.state() };
    for (const c of ['white', 'black'] as const) {
      for (const outlet of this.seats[c]?.outlets ?? []) outlet(msg);
    }
  }

  get finished(): boolean {
    return this.status === 'over';
  }

  expired(now: number): boolean {
    return now - this.lastActivityAt > TTL_MS[this.status];
  }

  dispose(): void {
    this.cancelFlagTimer?.();
    this.cancelFlagTimer = null;
  }

  // --- internals ---------------------------------------------------------------

  private requireSeat(token: string): FriendColor {
    const color = this.colorOf(token);
    if (!color) throw new RoomError('You are not a player in this game.');
    return color;
  }

  private requireLive(): void {
    if (this.status === 'over') throw new RoomError('The game is over.');
  }

  private finish(result: FriendGameResult): void {
    this.status = 'over';
    this.result = result;
    this.drawOffer = null;
    this.dispose();
    this.touch();
  }

  private armFlagTimer(): void {
    this.cancelFlagTimer?.();
    this.cancelFlagTimer = null;
    if (!this.clock || this.status !== 'active') return;
    const turn = this.chess.turn() === 'w' ? 'whiteMs' : 'blackMs';
    const ms = this.clock[turn] + 50; // small grace so the timer fires after zero
    this.cancelFlagTimer = this.deps.schedule(() => this.checkFlag(), ms); // checkFlag broadcasts the flag
  }

  private touch(): void {
    this.lastActivityAt = this.deps.now();
  }
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class FriendRoomManager {
  private readonly rooms = new Map<string, FriendRoom>();

  constructor(private readonly deps: RoomDeps = realDeps) {}

  create(opts: {
    name?: string;
    timeControl?: FriendTimeControl | null;
    color?: FriendColor | 'random';
    /** Test-only: custom starting position. */
    startFen?: string;
  }): {
    room: FriendRoom;
    token: string;
    color: FriendColor;
  } {
    this.sweep();
    if (this.rooms.size >= MAX_ROOMS) throw new RoomError('Too many active games right now — try again later.');
    let code = this.generateCode();
    while (this.rooms.has(code)) code = this.generateCode();
    const room = new FriendRoom(code, validTimeControl(opts.timeControl), this.deps, opts.startFen);
    const seat = room.seatCreator(opts.name, opts.color);
    this.rooms.set(code, room);
    return { room, ...seat };
  }

  get(code: string): FriendRoom | null {
    const room = this.rooms.get(code.toUpperCase().trim());
    if (!room) return null;
    if (room.expired(this.deps.now())) {
      this.remove(room);
      return null;
    }
    return room;
  }

  /** Drop rooms whose TTL has lapsed. Called on create and periodically. */
  sweep(): void {
    const now = this.deps.now();
    for (const room of this.rooms.values()) {
      if (room.expired(now)) this.remove(room);
    }
  }

  get size(): number {
    return this.rooms.size;
  }

  private remove(room: FriendRoom): void {
    room.dispose();
    this.rooms.delete(room.code);
  }

  private generateCode(): string {
    let out = '';
    for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return out;
  }
}
