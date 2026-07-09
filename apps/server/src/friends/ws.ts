/**
 * One live client connection on /ws/friend. Thin translation layer between the
 * socket and the authoritative FriendRoomManager: every accepted action ends
 * with a full-state broadcast to both seats, and errors go back only to the
 * sender. A connection is attached to at most one room/seat at a time.
 */
import type { WebSocket, RawData } from 'ws';
import type { FriendClientMessage, FriendServerMessage } from '@chesser/shared';
import { FriendRoomManager, FriendRoom, RoomError } from './rooms.js';

export class FriendSession {
  private room: FriendRoom | null = null;
  private token: string | null = null;
  private readonly outlet = (msg: FriendServerMessage) => this.send(msg);

  constructor(
    private readonly ws: WebSocket,
    private readonly rooms: FriendRoomManager,
  ) {
    ws.on('message', (data) => this.onMessage(data));
    ws.on('close', () => this.dispose());
    ws.on('error', () => this.dispose());
  }

  private send(msg: FriendServerMessage): void {
    if (this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  private onMessage(data: RawData): void {
    let msg: FriendClientMessage;
    try {
      const parsed: unknown = JSON.parse(data.toString());
      // Valid JSON that isn't a tagged message object (null, numbers, arrays,
      // strings) is silently dropped rather than exploding in handle().
      if (!parsed || typeof parsed !== 'object' || typeof (parsed as { t?: unknown }).t !== 'string') return;
      msg = parsed as FriendClientMessage;
    } catch {
      return;
    }
    try {
      this.handle(msg);
    } catch (e) {
      const message = e instanceof RoomError ? e.message : 'Something went wrong.';
      if (!(e instanceof RoomError)) console.error('[friends]', e);
      this.send({ t: 'error', message });
    }
  }

  private handle(msg: FriendClientMessage): void {
    switch (msg.t) {
      case 'create': {
        const { room, token, color } = this.rooms.create({
          name: msg.name,
          timeControl: msg.timeControl,
          color: msg.color,
        });
        this.bind(room, token);
        this.send({ t: 'created', code: room.code, token, color, state: room.state() });
        break;
      }
      case 'join': {
        const room = this.requireRoom(msg.code);
        const { token, color } = room.join(msg.token, msg.name);
        this.bind(room, token);
        this.send({ t: 'joined', code: room.code, token, color, state: room.state() });
        room.broadcast(); // presence / newly-active game for the other seat
        break;
      }
      case 'move': {
        const room = this.requireRoom(msg.code);
        room.move(msg.token, msg.uci);
        room.broadcast();
        break;
      }
      case 'resign': {
        const room = this.requireRoom(msg.code);
        room.resign(msg.token);
        room.broadcast();
        break;
      }
      case 'abort': {
        const room = this.requireRoom(msg.code);
        room.abort(msg.token);
        room.broadcast();
        break;
      }
      case 'offerDraw': {
        const room = this.requireRoom(msg.code);
        room.offerDraw(msg.token);
        room.broadcast();
        break;
      }
      case 'respondDraw': {
        const room = this.requireRoom(msg.code);
        room.respondDraw(msg.token, msg.accept);
        room.broadcast();
        break;
      }
    }
  }

  private requireRoom(code: string): FriendRoom {
    const room = this.rooms.get(String(code ?? ''));
    if (!room) throw new RoomError('Game not found — the code may be wrong or the game expired.');
    return room;
  }

  /** Point this connection at a room seat (moving off any previous one). */
  private bind(room: FriendRoom, token: string): void {
    if (this.room && this.token) this.room.detach(this.token, this.outlet);
    this.room = room;
    this.token = token;
    room.attach(token, this.outlet);
  }

  private dispose(): void {
    if (this.room && this.token) {
      this.room.detach(this.token, this.outlet);
      this.room.broadcast(); // let the opponent see the disconnect
    }
    this.room = null;
    this.token = null;
  }
}
