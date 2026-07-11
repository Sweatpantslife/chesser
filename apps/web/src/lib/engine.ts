import type {
  AnalysisLine,
  AnalysisMessage,
  AnalyzeRequest,
  BotConfig,
  BotMoveMessage,
  BotStyle,
  ClientMessage,
  EngineAvailability,
  Score,
  ServerMessage,
} from '@chesser/shared';

type WelcomeData = { engines: EngineAvailability; styles: BotStyle[] };
type AnalysisHandler = (msg: AnalysisMessage) => void;

let counter = 0;
const nextId = () => `r${Date.now().toString(36)}_${(counter++).toString(36)}`;

/**
 * Singleton WebSocket client to the engine server. Handles reconnection,
 * correlates bot-move replies by request id, and routes streaming analysis to
 * the current handler (stale analysis ids are ignored).
 */
class EngineClient {
  private ws: WebSocket | null = null;
  private buffer: string[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;

  private analysisReqId: string | null = null;
  private analysisHandler: AnalysisHandler | null = null;
  private botWaiters = new Map<string, { resolve: (m: BotMoveMessage) => void; reject: (e: Error) => void }>();

  availability: EngineAvailability | null = null;
  styles: BotStyle[] = [];
  connected = false;

  readonly onWelcome = new Set<(w: WelcomeData) => void>();
  readonly onStatus = new Set<(connected: boolean) => void>();

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempts = 0; // a real connection resets the backoff
      this.onStatus.forEach((fn) => fn(true));
      for (const m of this.buffer.splice(0)) ws.send(m);
    };
    ws.onclose = () => {
      this.connected = false;
      this.onStatus.forEach((fn) => fn(false));
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (ev) => this.dispatch(JSON.parse(ev.data) as ServerMessage);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    // Exponential backoff with jitter, capped at 30s. Without this a socket the
    // server refuses (e.g. it is at its /ws session cap, closing us with 1013)
    // would hot-loop the handshake ~every 1.5s forever, and after a server
    // restart every tab would reconnect in lockstep (thundering herd). The
    // jitter spreads that out; onopen resets reconnectAttempts to 0 so a normal
    // transient drop still reconnects quickly.
    const base = Math.min(30_000, 1500 * 2 ** this.reconnectAttempts);
    const delay = base / 2 + Math.random() * (base / 2); // 50–100% of base
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private send(msg: ClientMessage): void {
    const data = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
    else this.buffer.push(data);
  }

  private dispatch(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.availability = msg.engines;
        this.styles = msg.styles;
        this.onWelcome.forEach((fn) => fn({ engines: msg.engines, styles: msg.styles }));
        break;
      case 'analysis':
        if (msg.reqId === this.analysisReqId) this.analysisHandler?.(msg);
        break;
      case 'botMove': {
        const w = this.botWaiters.get(msg.reqId);
        if (w) {
          this.botWaiters.delete(msg.reqId);
          w.resolve(msg);
        }
        break;
      }
      case 'error': {
        if (msg.reqId && this.botWaiters.has(msg.reqId)) {
          const w = this.botWaiters.get(msg.reqId)!;
          this.botWaiters.delete(msg.reqId);
          w.reject(new Error(msg.message));
        } else {
          console.error('[engine]', msg.message);
        }
        break;
      }
    }
  }

  /** Start (or replace) a streaming analysis of a position. */
  analyze(fen: string, opts: { multipv?: number; depth?: number; movetimeMs?: number }, handler: AnalysisHandler): void {
    const reqId = nextId();
    this.analysisReqId = reqId;
    this.analysisHandler = handler;
    const req: AnalyzeRequest = { t: 'analyze', reqId, fen, ...opts };
    this.send(req);
  }

  stopAnalysis(): void {
    if (this.analysisReqId) this.send({ t: 'stop', reqId: this.analysisReqId });
    this.analysisReqId = null;
    this.analysisHandler = null;
  }

  /** One-shot evaluation of a position (White-POV score), used by game review. */
  evalOnce(fen: string, opts: { depth?: number; movetimeMs?: number } = {}): Promise<Score | null> {
    return new Promise((resolve) => {
      const reqId = nextId();
      this.analysisReqId = reqId;
      let done = false;
      const finish = (s: Score | null) => {
        if (done) return;
        done = true;
        if (this.analysisReqId === reqId) {
          this.analysisReqId = null;
          this.analysisHandler = null;
        }
        resolve(s);
      };
      this.analysisHandler = (msg) => {
        if (msg.final) finish(msg.lines[0]?.score ?? null);
      };
      this.send({ t: 'analyze', reqId, fen, multipv: 1, ...opts } as AnalyzeRequest);
      setTimeout(() => finish(null), 8000); // safety
    });
  }

  /**
   * One-shot multi-PV analysis: resolves with the final lines once the search
   * hits its movetime/depth cap. Used by the game review (fixed-depth, `fresh`
   * engine state for deterministic evals) and to generate tactics from a game.
   */
  analyzeManyOnce(
    fen: string,
    opts: { multipv?: number; depth?: number; movetimeMs?: number; fresh?: boolean } = {},
  ): Promise<AnalysisLine[]> {
    return new Promise((resolve) => {
      const reqId = nextId();
      this.analysisReqId = reqId;
      let last: AnalysisLine[] = [];
      let done = false;
      const finish = (lines: AnalysisLine[]) => {
        if (done) return;
        done = true;
        if (this.analysisReqId === reqId) {
          this.analysisReqId = null;
          this.analysisHandler = null;
        }
        resolve(lines);
      };
      this.analysisHandler = (msg) => {
        last = msg.lines;
        if (msg.final) finish(msg.lines);
      };
      this.send({ t: 'analyze', reqId, fen, multipv: opts.multipv ?? 2, ...opts } as AnalyzeRequest);
      // Safety net: resolve with the deepest lines seen so far. Pure
      // fixed-depth searches (no movetime) get a longer leash — cutting one
      // short would also cut determinism short.
      setTimeout(() => finish(last), opts.movetimeMs ? 12000 : 30000);
    });
  }

  /** Request a single bot move. Resolves with the move or rejects on error. */
  botMove(fen: string, bot: BotConfig, recentFens?: string[]): Promise<BotMoveMessage> {
    const reqId = nextId();
    return new Promise((resolve, reject) => {
      this.botWaiters.set(reqId, { resolve, reject });
      this.send({ t: 'botMove', reqId, fen, bot, ...(recentFens?.length ? { recentFens } : {}) });
      setTimeout(() => {
        if (this.botWaiters.has(reqId)) {
          this.botWaiters.delete(reqId);
          reject(new Error('Bot move timed out'));
        }
      }, 30000);
    });
  }
}

export const engine = new EngineClient();
