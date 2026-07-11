/**
 * WebSocket client for friend-link games (/ws/friend). One instance per
 * OnlineGame mount. Handles reconnection: when the socket drops it retries,
 * and once reopened it automatically rejoins the room with the seat token, so
 * a refresh or a network blip resumes the game seamlessly.
 */
import type { FriendClientMessage, FriendGameState, FriendServerMessage, FriendColor, FriendTimeControl } from '@chesser/shared';

export interface Seat {
  code: string;
  token: string;
  color: FriendColor;
}

export interface FriendClientHandlers {
  onSeat(seat: Seat): void;
  onState(state: FriendGameState): void;
  onError(message: string): void;
  onConnection(up: boolean): void;
}

const SEAT_PREFIX = 'chesser.friendSeat.';

export function loadSeat(code: string): Seat | null {
  try {
    const raw = localStorage.getItem(SEAT_PREFIX + code.toUpperCase());
    return raw ? (JSON.parse(raw) as Seat) : null;
  } catch {
    return null;
  }
}

/** Persist a seat so a (re)join by code resumes it — also used when a
 * challenge acceptance hands this client a pre-seated room. */
export function saveSeat(seat: Seat): void {
  try {
    localStorage.setItem(SEAT_PREFIX + seat.code, JSON.stringify(seat));
  } catch {
    /* private mode — rejoin after refresh just won't work */
  }
}

export type FriendIntent =
  | { kind: 'create'; name: string; timeControl: FriendTimeControl | null; color: FriendColor | 'random' }
  | { kind: 'join'; code: string; name: string };

export class FriendClient {
  private ws: WebSocket | null = null;
  private seat: Seat | null = null;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly intent: FriendIntent,
    private readonly handlers: FriendClientHandlers,
  ) {
    if (intent.kind === 'join') this.seat = loadSeat(intent.code);
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/friend`);
    this.ws = ws;
    ws.onopen = () => {
      this.handlers.onConnection(true);
      if (this.seat) {
        // Rejoin our seat (reconnect / refresh).
        this.send({ t: 'join', code: this.seat.code, token: this.seat.token });
      } else if (this.intent.kind === 'create') {
        this.send({ t: 'create', name: this.intent.name, timeControl: this.intent.timeControl, color: this.intent.color });
      } else {
        this.send({ t: 'join', code: this.intent.code.toUpperCase(), name: this.intent.name });
      }
    };
    ws.onclose = () => {
      this.handlers.onConnection(false);
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (ev) => {
      let msg: FriendServerMessage;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      this.dispatch(msg);
    };
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1200);
  }

  private dispatch(msg: FriendServerMessage): void {
    switch (msg.t) {
      case 'created':
      case 'joined': {
        this.seat = { code: msg.code, token: msg.token, color: msg.color };
        saveSeat(this.seat);
        this.handlers.onSeat(this.seat);
        this.handlers.onState(msg.state);
        break;
      }
      case 'state':
        this.handlers.onState(msg.state);
        break;
      case 'error':
        this.handlers.onError(msg.message);
        break;
    }
  }

  private send(msg: FriendClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private act(build: (seat: Seat) => FriendClientMessage): void {
    if (this.seat) this.send(build(this.seat));
  }

  move(uci: string): void {
    this.act((s) => ({ t: 'move', code: s.code, token: s.token, uci }));
  }

  resign(): void {
    this.act((s) => ({ t: 'resign', code: s.code, token: s.token }));
  }

  abort(): void {
    this.act((s) => ({ t: 'abort', code: s.code, token: s.token }));
  }

  offerDraw(): void {
    this.act((s) => ({ t: 'offerDraw', code: s.code, token: s.token }));
  }

  respondDraw(accept: boolean): void {
    this.act((s) => ({ t: 'respondDraw', code: s.code, token: s.token, accept }));
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      // Unbind before closing: the async onclose would otherwise fire after a
      // replacement client exists and wrongly report "disconnected".
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
    }
    this.ws = null;
  }
}
