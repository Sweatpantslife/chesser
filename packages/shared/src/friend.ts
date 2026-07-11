/**
 * Friend-link games — types shared between the web client and the server.
 *
 * A "friend game" is a private, unrated, two-player room identified by a short
 * code. The server is authoritative: it validates every move, runs the clocks,
 * and broadcasts the full game state after every change. Clients render from
 * that state, which makes reconnection trivial (rejoin → receive state).
 */

export type FriendColor = 'white' | 'black';

export interface FriendTimeControl {
  initialMs: number;
  incrementMs: number;
  label: string;
}

export interface FriendPlayerInfo {
  name: string;
  /** At least one live connection for this seat. */
  connected: boolean;
}

export type FriendGameStatus = 'waiting' | 'active' | 'over';

export interface FriendGameResult {
  winner: FriendColor | 'draw';
  /** Short reason, e.g. "checkmate", "resignation", "on time". */
  reason: string;
}

export interface FriendGameState {
  code: string;
  status: FriendGameStatus;
  /** Position after all played moves. */
  fen: string;
  /** Moves from the standard starting position, in UCI. */
  moves: string[];
  /** The same moves in SAN (for the move list). */
  sans: string[];
  /** Side to move. */
  turn: FriendColor;
  players: { white: FriendPlayerInfo | null; black: FriendPlayerInfo | null };
  timeControl: FriendTimeControl | null;
  /** Remaining time, projected to "now" server-side. Null for untimed games. */
  clock: { whiteMs: number; blackMs: number } | null;
  /** Side with an outstanding draw offer, if any. */
  drawOffer: FriendColor | null;
  result: FriendGameResult | null;
}

// ---------------------------------------------------------------------------
// WebSocket protocol (path: /ws/friend)
// ---------------------------------------------------------------------------

export type FriendClientMessage =
  | {
      t: 'create';
      name?: string;
      timeControl?: FriendTimeControl | null;
      color?: FriendColor | 'random';
    }
  /** Join a room as the second player, or rejoin an existing seat with its token. */
  | { t: 'join'; code: string; token?: string; name?: string }
  | { t: 'move'; code: string; token: string; uci: string }
  | { t: 'resign'; code: string; token: string }
  /** No-fault cancel while fewer than 2 plies have been played. */
  | { t: 'abort'; code: string; token: string }
  | { t: 'offerDraw'; code: string; token: string }
  | { t: 'respondDraw'; code: string; token: string; accept: boolean };

export type FriendServerMessage =
  | { t: 'created'; code: string; token: string; color: FriendColor; state: FriendGameState }
  | { t: 'joined'; code: string; token: string; color: FriendColor; state: FriendGameState }
  | { t: 'state'; state: FriendGameState }
  | { t: 'error'; message: string };
