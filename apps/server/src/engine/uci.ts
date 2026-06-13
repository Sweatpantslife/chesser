import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';

/** A single parsed `info` line from a UCI engine. Scores are side-to-move POV. */
export interface UciInfo {
  depth: number;
  seldepth?: number;
  multipv: number;
  scoreCp?: number;
  scoreMate?: number;
  bound?: 'lower' | 'upper';
  nodes?: number;
  nps?: number;
  timeMs?: number;
  pv: string[];
}

export interface BestMove {
  bestmove: string; // UCI, or '(none)'
  ponder?: string;
}

export interface SearchOptions {
  fen?: string; // omit for startpos
  moves?: string[]; // applied after the position
  go: string; // full go command, e.g. "go movetime 800" / "go infinite" / "go nodes 1"
  onInfo?: (info: UciInfo) => void;
}

interface ActiveSearch {
  onInfo?: (info: UciInfo) => void;
  resolve: (b: BestMove) => void;
  reject: (e: Error) => void;
}

/**
 * Thin, promise-friendly wrapper around a UCI engine process.
 *
 * Only one search runs at a time; callers must serialise (the services do).
 * The process is kept resident with stdin open, which avoids the classic
 * "EOF aborts the search" pitfall you hit when piping commands.
 */
export class UciEngine {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rl: Interface | null = null;
  private active: ActiveSearch | null = null;
  private waiters = new Map<string, Array<() => void>>();
  private dead = false;
  idName = 'engine';

  constructor(
    private readonly bin: string,
    private readonly args: string[] = [],
    readonly label = 'engine',
  ) {}

  get isBusy(): boolean {
    return this.active !== null;
  }
  get isAlive(): boolean {
    return !this.dead && this.proc !== null;
  }

  async start(): Promise<void> {
    const proc = spawn(this.bin, this.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    proc.stderr.on('data', (d) => {
      const s = String(d).trim();
      if (s) console.error(`[${this.label}] ${s}`);
    });
    proc.on('exit', (code) => {
      this.dead = true;
      const err = new Error(`${this.label} exited (code ${code})`);
      if (this.active) {
        this.active.reject(err);
        this.active = null;
      }
      for (const list of this.waiters.values()) list.splice(0).forEach((fn) => fn());
      this.waiters.clear();
    });
    this.rl = createInterface({ input: proc.stdout });
    this.rl.on('line', (line) => this.onLine(line.trim()));

    this.send('uci');
    await this.once('uciok');
    await this.ready();
  }

  send(cmd: string): void {
    if (!this.proc || this.dead) return;
    this.proc.stdin.write(cmd + '\n');
  }

  setOption(name: string, value: string | number | boolean): void {
    this.send(`setoption name ${name} value ${value}`);
  }

  newGame(): void {
    this.send('ucinewgame');
  }

  /** Resolve once the engine answers `isready`. Use to flush option changes. */
  ready(): Promise<void> {
    const p = this.once('readyok');
    this.send('isready');
    return p;
  }

  /** Run one search; streams info via onInfo, resolves on bestmove. */
  search(opts: SearchOptions): Promise<BestMove> {
    if (this.dead) return Promise.reject(new Error(`${this.label} is not running`));
    if (this.active) return Promise.reject(new Error(`${this.label} is busy`));

    const posCmd = opts.fen
      ? `position fen ${opts.fen}${opts.moves?.length ? ' moves ' + opts.moves.join(' ') : ''}`
      : `position startpos${opts.moves?.length ? ' moves ' + opts.moves.join(' ') : ''}`;
    this.send(posCmd);

    return new Promise<BestMove>((resolve, reject) => {
      this.active = { onInfo: opts.onInfo, resolve, reject };
      this.send(opts.go);
    });
  }

  /** Ask the engine to stop the current search; it will emit a bestmove. */
  stop(): void {
    if (this.active) this.send('stop');
  }

  async quit(): Promise<void> {
    if (!this.proc) return;
    this.send('stop');
    this.send('quit');
    this.rl?.close();
    // Give it a moment to exit cleanly, then make sure it's gone.
    await new Promise((r) => setTimeout(r, 50));
    if (!this.dead) this.proc.kill('SIGKILL');
  }

  // --- internals -----------------------------------------------------------

  private once(token: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const list = this.waiters.get(token) ?? [];
      list.push(resolve);
      this.waiters.set(token, list);
    });
  }

  private resolveWaiter(token: string): void {
    const list = this.waiters.get(token);
    if (list && list.length) {
      const fn = list.shift()!;
      if (list.length === 0) this.waiters.delete(token);
      fn();
    }
  }

  private onLine(line: string): void {
    if (line === 'uciok') return this.resolveWaiter('uciok');
    if (line === 'readyok') return this.resolveWaiter('readyok');
    if (line.startsWith('id name ')) {
      this.idName = line.slice('id name '.length);
      return;
    }
    if (line.startsWith('bestmove')) return this.handleBestmove(line);
    if (line.startsWith('info ')) return this.handleInfo(line);
  }

  private handleBestmove(line: string): void {
    const search = this.active;
    this.active = null;
    if (!search) return;
    const parts = line.split(/\s+/);
    const bestmove = parts[1] ?? '(none)';
    const ponderIdx = parts.indexOf('ponder');
    const ponder = ponderIdx >= 0 ? parts[ponderIdx + 1] : undefined;
    search.resolve({ bestmove, ponder });
  }

  private handleInfo(line: string): void {
    const search = this.active;
    if (!search?.onInfo) return;
    const info = parseInfo(line);
    if (info) search.onInfo(info);
  }
}

/** Parse a UCI `info` line into structured data. Returns null for non-PV info. */
export function parseInfo(line: string): UciInfo | null {
  const tokens = line.split(/\s+/);
  let i = 1; // skip "info"
  const info: Partial<UciInfo> = { multipv: 1 };
  let sawScore = false;

  while (i < tokens.length) {
    const tok = tokens[i++];
    switch (tok) {
      case 'depth':
        info.depth = Number(tokens[i++]);
        break;
      case 'seldepth':
        info.seldepth = Number(tokens[i++]);
        break;
      case 'multipv':
        info.multipv = Number(tokens[i++]);
        break;
      case 'nodes':
        info.nodes = Number(tokens[i++]);
        break;
      case 'nps':
        info.nps = Number(tokens[i++]);
        break;
      case 'time':
        info.timeMs = Number(tokens[i++]);
        break;
      case 'score': {
        const kind = tokens[i++];
        const val = Number(tokens[i++]);
        if (kind === 'cp') info.scoreCp = val;
        else if (kind === 'mate') info.scoreMate = val;
        sawScore = true;
        // optional bound flag
        if (tokens[i] === 'lowerbound' || tokens[i] === 'upperbound') {
          info.bound = tokens[i] === 'lowerbound' ? 'lower' : 'upper';
          i++;
        }
        break;
      }
      case 'pv': {
        info.pv = tokens.slice(i);
        i = tokens.length;
        break;
      }
      default:
        // skip unknown token's value if it looks like key/value
        break;
    }
  }

  // We only care about lines that carry an evaluation + PV.
  if (info.depth === undefined || !sawScore || !info.pv) return null;
  return {
    depth: info.depth,
    seldepth: info.seldepth,
    multipv: info.multipv ?? 1,
    scoreCp: info.scoreCp,
    scoreMate: info.scoreMate,
    bound: info.bound,
    nodes: info.nodes,
    nps: info.nps,
    timeMs: info.timeMs,
    pv: info.pv,
  };
}
