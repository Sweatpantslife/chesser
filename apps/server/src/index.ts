import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { WebSocketServer } from 'ws';
import { engines } from './engine/manager.js';
import { Session } from './ws.js';
import { FriendRoomManager } from './friends/rooms.js';
import { FriendSession } from './friends/ws.js';
import { HOST, LOG_ENABLED, PORT, TRUST_PROXY, WEB_DIR } from './config.js';
import { probeTablebase } from './tablebase.js';
import { shutdownLocalTablebase } from './tablebase-local.js';
import { probeExplorer } from './explorer.js';
import { importGames } from './import.js';
import { registerAccountRoutes } from './accounts/routes.js';
import { registerCoachRoutes } from './coach/routes.js';
import { registerSocialRoutes } from './social/routes.js';
import { registerFriendRoutes } from './social/friends-routes.js';
import { socialStore } from './social/store.js';
import type { ExplorerDb } from '@chesser/shared';

// trustProxy: opt-in via TRUST_PROXY (see config.ts) — required behind a
// reverse proxy so per-IP rate limiting sees real client addresses.
// bodyLimit: an explicit cap on request bodies (matches Fastify's default of
// 1 MiB rather than relying on it) — the largest legitimate payloads are the
// synced progress blob and saved PGNs, both far under it.
const app = Fastify({ logger: LOG_ENABLED, trustProxy: TRUST_PROXY, bodyLimit: 1_048_576 });
await app.register(cors, { origin: true });

app.get('/api/health', async () => ({ ok: true, syzygy: !!engines.availability().syzygy }));
app.get('/api/engines', async () => ({ engines: engines.availability(), styles: engines.styles() }));
app.get('/api/tablebase', async (req) => {
  const fen = (req.query as { fen?: string }).fen;
  if (!fen) return { available: false, reason: 'no-fen' };
  return probeTablebase(fen);
});
app.get('/api/explorer', async (req) => {
  const { fen, db } = req.query as { fen?: string; db?: string };
  if (!fen) return { available: false, reason: 'no-fen' };
  return probeExplorer(fen, (db === 'lichess' ? 'lichess' : 'masters') as ExplorerDb);
});
app.get('/api/import', async (req) => {
  const { site, user, max } = req.query as { site?: string; user?: string; max?: string };
  if (!user) return { available: false, reason: 'no-user' };
  const n = Math.min(Math.max(Number(max) || 15, 1), 30);
  return importGames(site === 'chesscom' ? 'chesscom' : 'lichess', user, n);
});
// One room manager serves both the /ws/friend endpoint (below) and the
// challenge-accept flow: accepting a challenge creates a room here, so the
// resulting game is an ordinary friend-link game.
const friendRooms = new FriendRoomManager();

registerAccountRoutes(app);
registerCoachRoutes(app);
registerSocialRoutes(app);
registerFriendRoutes(app, friendRooms);

// Serve the built web client (single-origin deployment). Real asset paths are
// served as files; anything else falls through to the SPA's index.html. The
// /ws upgrade is handled on the raw HTTP server below, so it bypasses routing.
if (WEB_DIR && fs.existsSync(path.join(WEB_DIR, 'index.html'))) {
  await app.register(fastifyStatic, { root: WEB_DIR, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    const pathname = req.url.split('?', 1)[0] || '/';
    const isApiOrWs =
      pathname === '/api' || pathname.startsWith('/api/') || pathname === '/ws' || pathname.startsWith('/ws/');
    if (req.method !== 'GET' || isApiOrWs) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });
  console.log(`[server] serving web client from ${WEB_DIR}`);
} else if (process.env.CHESSER_WEB_DIR) {
  console.warn(`[server] CHESSER_WEB_DIR is set but no index.html found at ${process.env.CHESSER_WEB_DIR}`);
}

// Two WebSocket endpoints share the HTTP server, so upgrades are routed by
// path here (two path-bound WebSocketServer instances would each try to answer
// every upgrade): /ws is the engine session, /ws/friend the friend-game rooms.
const wss = new WebSocketServer({ noServer: true });
wss.on('connection', (ws) => {
  new Session(ws);
});
const friendWss = new WebSocketServer({ noServer: true });
friendWss.on('connection', (ws) => {
  new FriendSession(ws, friendRooms);
});
const friendSweep = setInterval(() => friendRooms.sweep(), 60_000);
friendSweep.unref();
app.server.on('upgrade', (req, socket, head) => {
  const pathname = (req.url ?? '').split('?', 1)[0];
  const target = pathname === '/ws' ? wss : pathname === '/ws/friend' ? friendWss : null;
  if (!target) {
    socket.destroy();
    return;
  }
  target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
});

async function shutdown(): Promise<void> {
  try {
    await shutdownLocalTablebase();
    await engines.shutdown();
    await app.close();
  } finally {
    // Social-store writes are queued off the request path; let them land
    // even when engine/tablebase teardown throws above.
    await socialStore.flush().catch(() => {});
    process.exit(0);
  }
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await app.listen({ host: HOST, port: PORT });

const av = engines.availability();
const syzygyStatus = av.syzygy ? `${av.syzygyMaxPieces}-man` : 'off';
console.log(`[server] listening on http://${HOST}:${PORT}  (ws: /ws)`);
console.log(
  `[server] engines — stockfish:${av.stockfish}  lc0/maia:${av.lc0}  maia:[${av.maiaNetworks
    .map((n) => n.rating)
    .join(', ')}]  syzygy:${syzygyStatus}`,
);
if (!av.stockfish) console.warn('[server] Stockfish missing — run "pnpm setup:engines".');
