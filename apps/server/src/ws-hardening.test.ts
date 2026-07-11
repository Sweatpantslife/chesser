/**
 * WebSocket hardening tests — the per-IP/global session guard, trusted-proxy
 * IP extraction for raw upgrade requests, and a live ws server proving the
 * maxPayload cap actually closes oversized senders (code 1009) while the
 * guard turns away over-limit connections (code 1013), mirroring index.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import { clientIpFromUpgrade, WS_MAX_PAYLOAD_BYTES, WsSessionGuard } from './ws-hardening.js';

// ---------------------------------------------------------------------------
// WsSessionGuard (pure unit tests)
// ---------------------------------------------------------------------------

test('guard enforces the per-IP cap and frees the slot on release', () => {
  const guard = new WsSessionGuard({ maxSessions: 10, maxSessionsPerIp: 2 });
  const a1 = guard.acquire('1.1.1.1');
  const a2 = guard.acquire('1.1.1.1');
  assert.ok(a1 && a2, 'two sessions per IP allowed');
  assert.equal(guard.acquire('1.1.1.1'), null, 'third from the same IP refused');
  assert.ok(guard.acquire('2.2.2.2'), 'other IPs unaffected');
  a1!();
  assert.ok(guard.acquire('1.1.1.1'), 'released slot is reusable');
});

test('guard enforces the global cap across IPs', () => {
  const guard = new WsSessionGuard({ maxSessions: 2, maxSessionsPerIp: 10 });
  assert.ok(guard.acquire('1.1.1.1'));
  assert.ok(guard.acquire('2.2.2.2'));
  assert.equal(guard.acquire('3.3.3.3'), null, 'global ceiling holds');
  assert.equal(guard.size, 2);
});

test('release is idempotent — double-calling cannot leak capacity', () => {
  const guard = new WsSessionGuard({ maxSessions: 1, maxSessionsPerIp: 1 });
  const release = guard.acquire('1.1.1.1')!;
  release();
  release();
  assert.equal(guard.size, 0);
  assert.ok(guard.acquire('1.1.1.1'));
  assert.equal(guard.acquire('1.1.1.1'), null, 'still just one slot per IP');
});

// ---------------------------------------------------------------------------
// clientIpFromUpgrade
// ---------------------------------------------------------------------------

function fakeUpgradeReq(remoteAddress: string, xff?: string): http.IncomingMessage {
  return { socket: { remoteAddress }, headers: xff ? { 'x-forwarded-for': xff } : {} } as http.IncomingMessage;
}

test('clientIpFromUpgrade honors the TRUST_PROXY hop count from the right', () => {
  const req = fakeUpgradeReq('10.0.0.2', '198.51.100.7, 203.0.113.9');
  assert.equal(clientIpFromUpgrade(req, false), '10.0.0.2', 'no trust → socket address');
  assert.equal(clientIpFromUpgrade(req, 1), '203.0.113.9', 'one hop → rightmost XFF entry');
  assert.equal(clientIpFromUpgrade(req, 2), '198.51.100.7', 'two hops → second from the right');
  assert.equal(clientIpFromUpgrade(req, 5), '198.51.100.7', 'hop count past the list clamps to leftmost');
  assert.equal(clientIpFromUpgrade(fakeUpgradeReq('10.0.0.2'), 1), '10.0.0.2', 'no XFF → socket address');
  // A client-forged header is worthless when nothing is trusted.
  assert.equal(clientIpFromUpgrade(fakeUpgradeReq('9.9.9.9', '127.0.0.1'), false), '9.9.9.9');
  // String address-specs are conservatively resolved to the socket address.
  assert.equal(clientIpFromUpgrade(req, '10.0.0.0/8'), '10.0.0.2');
});

// ---------------------------------------------------------------------------
// Live server — wired like index.ts
// ---------------------------------------------------------------------------

interface LiveServer {
  url: string;
  guard: WsSessionGuard;
  close(): Promise<void>;
}

async function startWsServer(guard: WsSessionGuard, maxPayload = WS_MAX_PAYLOAD_BYTES): Promise<LiveServer> {
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true, maxPayload });
  wss.on('connection', (ws, req) => {
    // Session/FriendSession attach an error handler in production; without one
    // the payload-cap RangeError would crash the process.
    ws.on('error', () => {});
    const release = guard.acquire(clientIpFromUpgrade(req, false));
    if (!release) {
      ws.close(1013, 'Server is busy — try again shortly.');
      return;
    }
    ws.once('close', release);
    ws.on('message', (data) => ws.send(data.toString())); // echo, stands in for Session
  });
  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}/ws`,
    guard,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close();
        server.close(() => resolve());
      }),
  };
}

async function openClient(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await once(ws, 'open');
  return ws;
}

/** Wait for a close event and return its code. */
function closedWith(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once('close', (code: number) => resolve(code)));
}

/** The server processes its side of a close asynchronously — poll briefly. */
async function waitForSize(guard: WsSessionGuard, want: number): Promise<void> {
  for (let i = 0; i < 50 && guard.size !== want; i++) await new Promise((r) => setTimeout(r, 10));
}

test('oversized ws message closes the connection with 1009, small ones pass', async (t) => {
  const live = await startWsServer(new WsSessionGuard({ maxSessions: 4, maxSessionsPerIp: 4 }));
  t.after(() => live.close());

  const ws = await openClient(live.url);
  const closed = closedWith(ws);

  ws.send('hello');
  const [echo] = (await once(ws, 'message')) as [Buffer];
  assert.equal(echo.toString(), 'hello', 'normal messages still flow');

  ws.send(Buffer.alloc(WS_MAX_PAYLOAD_BYTES + 1));
  assert.equal(await closed, 1009, 'payload over the cap → 1009 (message too big)');
});

test('connections beyond the session cap are turned away with 1013 and slots free on close', async (t) => {
  const live = await startWsServer(new WsSessionGuard({ maxSessions: 2, maxSessionsPerIp: 2 }));
  t.after(() => live.close());

  const first = await openClient(live.url);
  const second = await openClient(live.url);

  const third = await openClient(live.url);
  assert.equal(await closedWith(third), 1013, 'over-limit socket refused with try-again-later');

  // Refused sockets must not consume capacity...
  assert.equal(live.guard.size, 2);

  // ...and a closed session hands its slot back.
  const firstClosed = closedWith(first);
  first.close();
  await firstClosed;
  await waitForSize(live.guard, 1);
  assert.equal(live.guard.size, 1, 'slot released after close');

  const replacement = await openClient(live.url);
  const replacementClosed = closedWith(replacement);
  replacement.send('ping');
  const [echo] = (await once(replacement, 'message')) as [Buffer];
  assert.equal(echo.toString(), 'ping', 'replacement session is fully functional');

  second.close();
  replacement.close();
  await replacementClosed;
});
