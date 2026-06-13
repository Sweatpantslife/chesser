import Fastify from 'fastify';
import cors from '@fastify/cors';
import { WebSocketServer } from 'ws';
import { engines } from './engine/manager.js';
import { Session } from './ws.js';
import { HOST, PORT } from './config.js';

const app = Fastify({ logger: false });
await app.register(cors, { origin: true });

app.get('/api/health', async () => ({ ok: true }));
app.get('/api/engines', async () => ({ engines: engines.availability(), styles: engines.styles() }));

const wss = new WebSocketServer({ server: app.server, path: '/ws' });
wss.on('connection', (ws) => {
  new Session(ws);
});

async function shutdown(): Promise<void> {
  try {
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
console.log(`[server] listening on http://${HOST}:${PORT}  (ws: /ws)`);
console.log(
  `[server] engines — stockfish:${av.stockfish}  lc0/maia:${av.lc0}  maia:[${av.maiaNetworks.map((n) => n.rating).join(', ')}]`,
);
if (!av.stockfish) console.warn('[server] Stockfish missing — run "pnpm setup:engines".');
