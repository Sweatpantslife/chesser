import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { WebSocketServer } from 'ws';
import { engines } from './engine/manager.js';
import { Session } from './ws.js';
import { HOST, LOG_ENABLED, PORT, WEB_DIR } from './config.js';
import { probeTablebase } from './tablebase.js';
import { shutdownLocalTablebase } from './tablebase-local.js';
import { probeExplorer } from './explorer.js';
import { importGames } from './import.js';
import { registerAccountRoutes } from './accounts/routes.js';
import type { ExplorerDb } from '@chesser/shared';

const app = Fastify({ logger: LOG_ENABLED });
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
registerAccountRoutes(app);

// Serve the built web client (single-origin deployment). Real asset paths are
// served as files; anything else falls through to the SPA's index.html. The
// /ws upgrade is handled on the raw HTTP server below, so it bypasses routing.
if (WEB_DIR && fs.existsSync(path.join(WEB_DIR, 'index.html'))) {
  await app.register(fastifyStatic, { root: WEB_DIR, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' || req.url.startsWith('/api') || req.url.startsWith('/ws')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });
  console.log(`[server] serving web client from ${WEB_DIR}`);
} else if (process.env.CHESSER_WEB_DIR) {
  console.warn(`[server] CHESSER_WEB_DIR is set but no index.html found at ${process.env.CHESSER_WEB_DIR}`);
}

const wss = new WebSocketServer({ server: app.server, path: '/ws' });
wss.on('connection', (ws) => {
  new Session(ws);
});

async function shutdown(): Promise<void> {
  try {
    await shutdownLocalTablebase();
    await engines.shutdown();
    await app.close();
  } finally {
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
