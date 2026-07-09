import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FriendTimeControl } from '@chesser/shared';
import { FriendRoomManager, RoomError, type RoomDeps } from './rooms.js';

/** Manual clock + scheduler so clock behaviour is fully deterministic. */
function fakeDeps() {
  let now = 1_000_000;
  const timers: { at: number; fn: () => void; cancelled: boolean }[] = [];
  const deps: RoomDeps = {
    now: () => now,
    schedule: (fn, ms) => {
      const t = { at: now + ms, fn, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
  };
  return {
    deps,
    advance(ms: number) {
      now += ms;
      for (const t of timers.splice(0)) if (!t.cancelled && t.at <= now) t.fn();
    },
  };
}

const TC_1_0: FriendTimeControl = { initialMs: 60_000, incrementMs: 0, label: '1+0' };
const TC_3_2: FriendTimeControl = { initialMs: 180_000, incrementMs: 2_000, label: '3+2' };

function pair(mgr: FriendRoomManager, timeControl: FriendTimeControl | null = null) {
  const { room, token: whiteToken } = mgr.create({ name: 'Alice', color: 'white', timeControl });
  const { token: blackToken } = room.join(undefined, 'Bob');
  return { room, whiteToken, blackToken };
}

describe('friend room lifecycle', () => {
  it('creates a waiting room, becomes active when the second player joins', () => {
    const mgr = new FriendRoomManager(fakeDeps().deps);
    const { room, token, color } = mgr.create({ name: 'Alice', color: 'white' });
    assert.equal(color, 'white');
    assert.equal(room.state().status, 'waiting');
    assert.equal(room.state().players.white?.name, 'Alice');
    assert.equal(room.state().players.black, null);

    const joined = room.join(undefined, 'Bob');
    assert.equal(joined.color, 'black');
    assert.notEqual(joined.token, token);
    assert.equal(room.state().status, 'active');
    assert.equal(room.state().players.black?.name, 'Bob');
  });

  it('rejects a third player but lets a seat rejoin with its token', () => {
    const mgr = new FriendRoomManager(fakeDeps().deps);
    const { room, blackToken } = pair(mgr);
    assert.throws(() => room.join(undefined, 'Mallory'), RoomError);

    const rejoined = room.join(blackToken, 'Bob again');
    assert.equal(rejoined.color, 'black');
    assert.equal(rejoined.token, blackToken); // same seat, same secret
    assert.equal(room.state().players.black?.name, 'Bob'); // name unchanged on rejoin
  });

  it('rejoin after moves returns the full game state', () => {
    const mgr = new FriendRoomManager(fakeDeps().deps);
    const { room, whiteToken, blackToken } = pair(mgr);
    room.move(whiteToken, 'e2e4');
    room.move(blackToken, 'e7e5');
    const rejoined = room.join(whiteToken, undefined);
    assert.equal(rejoined.color, 'white');
    const s = room.state();
    assert.deepEqual(s.moves, ['e2e4', 'e7e5']);
    assert.deepEqual(s.sans, ['e4', 'e5']);
    assert.equal(s.turn, 'white');
  });

  it('looks up rooms by code and expires idle ones', () => {
    const fake = fakeDeps();
    const mgr = new FriendRoomManager(fake.deps);
    const { room } = mgr.create({ name: 'Alice' });
    assert.equal(mgr.get(room.code), room);
    assert.equal(mgr.get(room.code.toLowerCase()), room); // codes are case-insensitive
    assert.equal(mgr.get('NOSUCH'), null);

    fake.advance(3 * 60 * 60 * 1000); // beyond the waiting-room TTL
    assert.equal(mgr.get(room.code), null);
    assert.equal(mgr.size, 0);
  });

  it('sweep removes finished rooms after their (shorter) TTL', () => {
    const fake = fakeDeps();
    const mgr = new FriendRoomManager(fake.deps);
    const { room, whiteToken } = pair(mgr);
    room.resign(whiteToken);
    assert.equal(room.state().status, 'over');
    fake.advance(31 * 60 * 1000);
    mgr.sweep();
    assert.equal(mgr.size, 0);
  });
});

describe('move validation', () => {
  it('rejects illegal moves and leaves the game untouched', () => {
    const mgr = new FriendRoomManager(fakeDeps().deps);
    const { room, whiteToken } = pair(mgr);
    assert.throws(() => room.move(whiteToken, 'e2e5'), /Illegal move/);
    assert.throws(() => room.move(whiteToken, 'garbage'), /Malformed move/);
    assert.equal(room.state().moves.length, 0);
    assert.equal(room.state().turn, 'white');
  });

  it('enforces turn order and seat tokens', () => {
    const mgr = new FriendRoomManager(fakeDeps().deps);
    const { room, whiteToken, blackToken } = pair(mgr);
    assert.throws(() => room.move(blackToken, 'e7e5'), /Not your turn/);
    room.move(whiteToken, 'e2e4');
    assert.throws(() => room.move(whiteToken, 'd2d4'), /Not your turn/);
    assert.throws(() => room.move('bogus-token', 'e7e5'), /not a player/);
    room.move(blackToken, 'e7e5');
    assert.deepEqual(room.state().moves, ['e2e4', 'e7e5']);
  });

  it('rejects moves before the second player joins and after the game ends', () => {
    const mgr = new FriendRoomManager(fakeDeps().deps);
    const { room, token } = mgr.create({ name: 'Alice', color: 'white' });
    assert.throws(() => room.move(token, 'e2e4'), /Waiting for your opponent/);

    const { room: r2, whiteToken, blackToken } = pair(mgr);
    r2.resign(blackToken);
    assert.throws(() => r2.move(whiteToken, 'e2e4'), /over/);
  });

  it('detects checkmate and reports the winner', () => {
    const mgr = new FriendRoomManager(fakeDeps().deps);
    const { room, whiteToken, blackToken } = pair(mgr);
    // Fool's mate
    room.move(whiteToken, 'f2f3');
    room.move(blackToken, 'e7e5');
    room.move(whiteToken, 'g2g4');
    room.move(blackToken, 'd8h4');
    const s = room.state();
    assert.equal(s.status, 'over');
    assert.deepEqual(s.result, { winner: 'black', reason: 'checkmate' });
  });

  it('auto-draws on threefold repetition (tracked from move history, not bare FEN)', () => {
    const mgr = new FriendRoomManager(fakeDeps().deps);
    const { room, whiteToken, blackToken } = pair(mgr);
    // Shuffle the knights back and forth until the start position occurs 3 times.
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'];
    shuffle.forEach((uci, i) => room.move(i % 2 === 0 ? whiteToken : blackToken, uci));
    const s = room.state();
    assert.equal(s.status, 'over');
    assert.deepEqual(s.result, { winner: 'draw', reason: 'threefold repetition' });
  });

  it('handles promotion moves (UCI 5th char)', () => {
    const mgr = new FriendRoomManager(fakeDeps().deps);
    const { room, whiteToken, blackToken } = pair(mgr);
    const line = ['a2a4', 'b7b5', 'a4b5', 'a7a6', 'b5b6', 'a6a5', 'b6b7', 'a5a4', 'b7a8q'];
    for (let i = 0; i < line.length; i++) room.move(i % 2 === 0 ? whiteToken : blackToken, line[i]!);
    assert.equal(room.state().sans.at(-1), 'bxa8=Q');
  });
});

describe('resign and draw offers', () => {
  it('resignation ends the game for the resigner', () => {
    const mgr = new FriendRoomManager(fakeDeps().deps);
    const { room, whiteToken } = pair(mgr);
    room.resign(whiteToken);
    assert.deepEqual(room.state().result, { winner: 'black', reason: 'resignation' });
  });

  it('draw offer can be accepted, declined, or cleared by a move', () => {
    const mgr = new FriendRoomManager(fakeDeps().deps);
    const { room, whiteToken, blackToken } = pair(mgr);
    room.offerDraw(whiteToken);
    assert.equal(room.state().drawOffer, 'white');
    assert.throws(() => room.respondDraw(whiteToken, true), /No draw offer/); // can't accept your own
    room.respondDraw(blackToken, false);
    assert.equal(room.state().drawOffer, null);
  });

  it('a played move clears a pending offer; acceptance draws the game', () => {
    const mgr = new FriendRoomManager(fakeDeps().deps);
    const { room, whiteToken, blackToken } = pair(mgr);
    room.offerDraw(blackToken);
    room.move(whiteToken, 'e2e4');
    assert.equal(room.state().drawOffer, null);

    room.offerDraw(whiteToken);
    room.respondDraw(blackToken, true);
    assert.deepEqual(room.state().result, { winner: 'draw', reason: 'agreement' });
  });
});

describe('abort', () => {
  it('either player can abort before 2 plies; not after', () => {
    const mgr = new FriendRoomManager(fakeDeps().deps);
    const { room, whiteToken, blackToken } = pair(mgr);
    room.move(whiteToken, 'e2e4');
    room.abort(blackToken); // 1 ply played — still abortable
    assert.deepEqual(room.state().result, { winner: 'draw', reason: 'aborted' });

    const { room: r2, whiteToken: w2, blackToken: b2 } = pair(mgr);
    r2.move(w2, 'e2e4');
    r2.move(b2, 'e7e5');
    assert.throws(() => r2.abort(w2), /no longer be aborted/);
    assert.equal(r2.state().status, 'active');
  });
});

describe('clocks', () => {
  it('charges thinking time to the mover and adds the increment', () => {
    const fake = fakeDeps();
    const mgr = new FriendRoomManager(fake.deps);
    const { room, whiteToken, blackToken } = pair(mgr, TC_3_2);
    fake.advance(10_000);
    room.move(whiteToken, 'e2e4'); // used 10s, +2s increment
    let s = room.state();
    assert.equal(s.clock?.whiteMs, 180_000 - 10_000 + 2_000);
    assert.equal(s.clock?.blackMs, 180_000);

    fake.advance(5_000);
    room.move(blackToken, 'e7e5');
    s = room.state();
    assert.equal(s.clock?.blackMs, 180_000 - 5_000 + 2_000);
  });

  it('projects the running clock in state()', () => {
    const fake = fakeDeps();
    const mgr = new FriendRoomManager(fake.deps);
    const { room } = pair(mgr, TC_1_0);
    fake.advance(15_000);
    assert.equal(room.state().clock?.whiteMs, 45_000); // white is on move
    assert.equal(room.state().clock?.blackMs, 60_000);
  });

  it('flags the side to move when its time runs out (scheduled timer)', () => {
    const fake = fakeDeps();
    const mgr = new FriendRoomManager(fake.deps);
    const { room } = pair(mgr, TC_1_0);
    fake.advance(60_100); // past white's 60s — fires the armed flag timer
    const s = room.state();
    assert.equal(s.status, 'over');
    assert.deepEqual(s.result, { winner: 'black', reason: 'on time' });
    assert.equal(s.clock?.whiteMs, 0);
  });

  it('a move that arrives after the flag loses on time instead of landing', () => {
    const fake = fakeDeps();
    const mgr = new FriendRoomManager(fake.deps);
    const { room, whiteToken, blackToken } = pair(mgr, TC_1_0);
    room.move(whiteToken, 'e2e4');
    fake.deps.now(); // (no-op) keep sequence obvious
    fake.advance(61_000);
    assert.throws(() => room.move(blackToken, 'e7e5'), /over/);
    const s = room.state();
    assert.equal(s.status, 'over');
    assert.deepEqual(s.result, { winner: 'white', reason: 'on time' });
    assert.deepEqual(s.moves, ['e2e4']); // the late move never landed
  });

  it('flagging against a bare king is a draw (timeout vs insufficient material)', () => {
    const fake = fakeDeps();
    const mgr = new FriendRoomManager(fake.deps);
    // White: K+Q. Black: bare king, to move. Black flags → white would win…
    const kqk = '8/8/8/1k6/8/8/8/K6Q b - - 0 1';
    const { room } = mgr.create({ name: 'Alice', color: 'white', timeControl: TC_1_0, startFen: kqk });
    room.join(undefined, 'Bob');
    fake.advance(61_000);
    assert.deepEqual(room.state().result, { winner: 'white', reason: 'on time' });

    // …but a bare-king white gets only a draw when black flags.
    const kk = '8/8/8/8/8/2k5/4q3/6K1 b - - 0 1';
    const { room: r2 } = mgr.create({ name: 'Alice', color: 'white', timeControl: TC_1_0, startFen: kk });
    r2.join(undefined, 'Bob');
    fake.advance(61_000);
    assert.deepEqual(r2.state().result, { winner: 'draw', reason: 'timeout vs insufficient material' });
  });

  it('untimed games never flag', () => {
    const fake = fakeDeps();
    const mgr = new FriendRoomManager(fake.deps);
    const { room, whiteToken } = pair(mgr, null);
    fake.advance(24 * 60 * 60 * 1000 / 8); // 3h thinking
    room.checkFlag();
    assert.equal(room.state().status, 'active');
    assert.equal(room.state().clock, null);
    room.move(whiteToken, 'e2e4');
    assert.equal(room.state().moves.length, 1);
  });
});
