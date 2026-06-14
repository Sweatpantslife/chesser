import type { BotStyle, EngineAvailability } from '@chesser/shared';
import { BOT_STYLES } from '@chesser/shared';
import {
  availabilityFrom,
  ENGINE_HASH_MB,
  ENGINE_THREADS,
  loadManifest,
  resetSyzygyCache,
  syzygyInfo,
  type EngineManifest,
} from '../config.js';
import { UciEngine } from './uci.js';

/**
 * Owns engine binaries and process lifetimes.
 *
 *  - Stockfish processes are created per session (analysis + bot get their own
 *    so a running eval search never blocks a bot move).
 *  - Lc0/Maia processes are expensive to spin up (they load a net), so they're
 *    cached globally and keyed by network id, shared across sessions.
 */
export class EngineManager {
  private manifest: EngineManifest;
  private maiaCache = new Map<string, Promise<UciEngine>>();

  constructor() {
    this.manifest = loadManifest();
  }

  reload(): void {
    this.manifest = loadManifest();
    resetSyzygyCache();
    // Existing cached Maia engines keep running; new ones use the new manifest.
  }

  availability(): EngineAvailability {
    return availabilityFrom(this.manifest);
  }

  /** Styles offered to clients, filtered to engines that actually exist. */
  styles(): BotStyle[] {
    const have = this.availability();
    return BOT_STYLES.filter((s) => (s.engine === 'lc0' ? have.lc0 : have.stockfish));
  }

  get hasStockfish(): boolean {
    return !!this.manifest.stockfishBin;
  }

  maiaNetworkId(rating?: number): string | null {
    const nets = this.manifest.maiaNetworks;
    if (nets.length === 0) return null;
    if (rating == null) return nets[Math.floor(nets.length / 2)]!.id;
    // closest available rating
    let best = nets[0]!;
    for (const n of nets) if (Math.abs(n.rating - rating) < Math.abs(best.rating - rating)) best = n;
    return best.id;
  }

  /** Create and initialise a fresh Stockfish process with sane defaults. */
  async createStockfish(label = 'stockfish'): Promise<UciEngine> {
    if (!this.manifest.stockfishBin) throw new Error('Stockfish is not installed (run pnpm setup:engines)');
    const eng = new UciEngine(this.manifest.stockfishBin, [], label);
    await eng.start();
    eng.setOption('Threads', ENGINE_THREADS);
    eng.setOption('Hash', ENGINE_HASH_MB);
    // Local Syzygy tablebases: Stockfish then plays/evaluates ≤maxPieces endings
    // perfectly, offline. Cap probing to what we actually have so it never hunts
    // for absent larger tables.
    const syzygy = syzygyInfo();
    if (syzygy) {
      eng.setOption('SyzygyPath', syzygy.path);
      eng.setOption('SyzygyProbeLimit', syzygy.maxPieces);
    }
    await eng.ready();
    return eng;
  }

  /** Get a shared, ready Lc0 engine loaded with the given Maia network. */
  getMaia(networkId: string): Promise<UciEngine> {
    const cached = this.maiaCache.get(networkId);
    if (cached) return cached;

    const net = this.manifest.maiaNetworks.find((n) => n.id === networkId);
    if (!this.manifest.lc0Bin || !net) {
      return Promise.reject(new Error(`Maia network "${networkId}" is not available`));
    }

    const promise = (async () => {
      const eng = new UciEngine(this.manifest.lc0Bin!, [`--weights=${net.path}`, '--backend=eigen'], `maia-${net.rating}`);
      await eng.start();
      // Maia plays its raw human-like policy at one node — no tree search.
      await eng.ready();
      return eng;
    })();

    this.maiaCache.set(networkId, promise);
    promise.catch(() => this.maiaCache.delete(networkId));
    return promise;
  }

  async shutdown(): Promise<void> {
    for (const p of this.maiaCache.values()) {
      try {
        const eng = await p;
        await eng.quit();
      } catch {
        /* ignore */
      }
    }
    this.maiaCache.clear();
  }
}

export const engines = new EngineManager();
