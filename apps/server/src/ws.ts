import type { WebSocket, RawData } from 'ws';
import type { ClientMessage, ServerMessage } from '@chesser/shared';
import { logger } from './logging.js';
import { engines } from './engine/manager.js';
import { AnalysisService } from './engine/analysis.js';
import { BotService } from './engine/bot.js';
import type { UciEngine } from './engine/uci.js';
import { withLock } from './util/lock.js';

/** One live client connection: its own Stockfish engines + shared Maia. */
export class Session {
  private sfAnalysis: UciEngine | null = null;
  private sfBot: UciEngine | null = null;
  private analysisPromise: Promise<AnalysisService> | null = null;
  private botEnginePromise: Promise<UciEngine> | null = null;
  private readonly bot: BotService;
  private readonly analysisLock = {}; // serialise analyze/stop on the shared analysis engine
  private closed = false;

  constructor(private readonly ws: WebSocket) {
    this.bot = new BotService(engines, () => this.ensureBotEngine());
    ws.on('message', (data) => void this.onMessage(data));
    ws.on('close', () => void this.dispose());
    ws.on('error', () => void this.dispose());
    this.send({ t: 'welcome', engines: engines.availability(), styles: engines.styles() });
  }

  private send(msg: ServerMessage): void {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  private ensureAnalysis(): Promise<AnalysisService> {
    return (this.analysisPromise ??= (async () => {
      const eng = await engines.createStockfish('sf-analysis');
      this.sfAnalysis = eng;
      return new AnalysisService(eng, (m) => this.send(m));
    })());
  }

  private ensureBotEngine(): Promise<UciEngine> {
    return (this.botEnginePromise ??= (async () => {
      const eng = await engines.createStockfish('sf-bot');
      this.sfBot = eng;
      return eng;
    })());
  }

  private async onMessage(data: RawData): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const reqId = 'reqId' in msg ? (msg as { reqId?: string }).reqId : undefined;
    try {
      switch (msg.t) {
        case 'hello':
          this.send({ t: 'welcome', engines: engines.availability(), styles: engines.styles() });
          break;
        case 'analyze': {
          const svc = await this.ensureAnalysis();
          await withLock(this.analysisLock, () => svc.analyze(msg));
          break;
        }
        case 'stop': {
          if (this.analysisPromise) {
            const svc = await this.analysisPromise;
            await withLock(this.analysisLock, () => svc.cancel());
          }
          break;
        }
        case 'botMove': {
          this.send(await this.bot.move(msg));
          break;
        }
      }
    } catch (e) {
      // Internal error text stays on the server (same pattern as friends/ws.ts)
      // — engine failures often carry paths and setup details a client has no
      // business seeing.
      logger.error({ err: e }, '[ws] session error');
      this.send({ t: 'error', reqId, message: 'Engine request failed.' });
    }
  }

  private async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.analysisPromise) await (await this.analysisPromise).cancel();
    } catch {
      /* ignore */
    }
    await this.sfAnalysis?.quit().catch(() => {});
    await this.sfBot?.quit().catch(() => {});
  }
}
