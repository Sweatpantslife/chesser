/**
 * Hand-rolled Prometheus metrics — a registry of counters and gauges plus a
 * GET /metrics endpoint in the text exposition format. Deliberately not
 * prom-client/OpenTelemetry: five metrics don't justify a dependency tree.
 *
 * Collected here (wired in index.ts):
 *   http_requests_total{route,method,status}  every routed HTTP response
 *   auth_failures_total                        HTTP 401s (failed logins and
 *                                              rejected/expired bearer tokens)
 *   proxy_requests_total{route,status}         the upstream-proxy endpoints
 *   ws_connections_current                     open WebSocket connections
 *   engine_processes_current                   live UCI engine child processes
 *
 * Access: /metrics is open by default (fine for a private network scrape).
 * Set CHESSER_METRICS_TOKEN and the endpoint requires
 * `Authorization: Bearer <token>` — do this whenever the app is reachable
 * from the public internet, since the server always sits behind one proxy
 * port (no separate localhost-only bind to hide the endpoint on).
 * /metrics, /healthz and /readyz are excluded from http_requests_total so
 * scrapes and probes don't drown real traffic.
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function helpAndType(name: string, help: string, type: 'counter' | 'gauge'): string[] {
  return [`# HELP ${name} ${help.replace(/\n/g, ' ')}`, `# TYPE ${name} ${type}`];
}

export class Counter {
  /** label-values-key (\u0000-joined) → count */
  private readonly series = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[] = [],
  ) {}

  inc(labels: Record<string, string> = {}, by = 1): void {
    const key = this.labelNames.map((n) => labels[n] ?? '').join('\u0000');
    this.series.set(key, (this.series.get(key) ?? 0) + by);
  }

  /** Current value for a label set (tests / internal checks). */
  value(labels: Record<string, string> = {}): number {
    return this.series.get(this.labelNames.map((n) => labels[n] ?? '').join('\u0000')) ?? 0;
  }

  render(): string[] {
    const lines = helpAndType(this.name, this.help, 'counter');
    if (this.labelNames.length === 0) {
      lines.push(`${this.name} ${this.series.get('') ?? 0}`);
      return lines;
    }
    for (const [key, count] of this.series) {
      const values = key.split('\u0000');
      const labels = this.labelNames.map((n, i) => `${n}="${escapeLabelValue(values[i] ?? '')}"`).join(',');
      lines.push(`${this.name}{${labels}} ${count}`);
    }
    return lines;
  }
}

export class Gauge {
  constructor(
    readonly name: string,
    readonly help: string,
    private readonly collect: () => number,
  ) {}

  render(): string[] {
    let value: number;
    try {
      value = this.collect();
    } catch {
      value = 0;
    }
    if (!Number.isFinite(value)) value = 0;
    return [...helpAndType(this.name, this.help, 'gauge'), `${this.name} ${value}`];
  }
}

export class MetricsRegistry {
  private readonly metrics: (Counter | Gauge)[] = [];
  private readonly names = new Set<string>();

  private claim(name: string): void {
    if (!NAME_RE.test(name)) throw new Error(`invalid metric name: ${name}`);
    if (this.names.has(name)) throw new Error(`metric already registered: ${name}`);
    this.names.add(name);
  }

  counter(name: string, help: string, labelNames: readonly string[] = []): Counter {
    this.claim(name);
    const c = new Counter(name, help, labelNames);
    this.metrics.push(c);
    return c;
  }

  /** Gauge sampled at scrape time via `collect` — no bookkeeping on hot paths. */
  gauge(name: string, help: string, collect: () => number): Gauge {
    this.claim(name);
    const g = new Gauge(name, help, collect);
    this.metrics.push(g);
    return g;
  }

  /** Prometheus text exposition format (0.0.4). */
  render(): string {
    return this.metrics.flatMap((m) => m.render()).join('\n') + '\n';
  }
}

/** Constant-time bearer-token check (hash first so length never leaks). */
function bearerMatches(header: unknown, token: string): boolean {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const given = crypto.createHash('sha256').update(header.slice(7)).digest();
  const want = crypto.createHash('sha256').update(token).digest();
  return crypto.timingSafeEqual(given, want);
}

/** Routes that forward to upstreams on the operator's dime (see proxy-guard.ts). */
const PROXY_ROUTES = new Set(['/api/explorer', '/api/tablebase', '/api/import', '/api/coach/explain']);

/** Probe/scrape endpoints kept out of http_requests_total. */
const UNCOUNTED_ROUTES = new Set(['/metrics', '/healthz', '/readyz']);

export interface MetricsOptions {
  /**
   * Bearer token required to scrape /metrics; empty/unset leaves the endpoint
   * open. Defaults to CHESSER_METRICS_TOKEN.
   */
  token?: string;
  registry?: MetricsRegistry;
}

/**
 * Registers the counting hook and the /metrics route. Call BEFORE registering
 * the routes that should be counted (Fastify hooks only apply to routes added
 * after them). Returns the registry so index.ts can attach gauges whose
 * sources (WebSocket servers, engine manager) are constructed later.
 */
export function registerMetrics(app: FastifyInstance, opts: MetricsOptions = {}): MetricsRegistry {
  const registry = opts.registry ?? new MetricsRegistry();
  const token = (opts.token ?? process.env.CHESSER_METRICS_TOKEN ?? '').trim();

  const httpRequests = registry.counter(
    'http_requests_total',
    'HTTP requests by route, method and response status.',
    ['route', 'method', 'status'],
  );
  const authFailures = registry.counter(
    'auth_failures_total',
    'Responses with HTTP 401 (failed logins and rejected or expired tokens).',
  );
  const proxyRequests = registry.counter(
    'proxy_requests_total',
    'Requests to the upstream-proxy endpoints (Lichess/chess.com/coach LLM), by route and status.',
    ['route', 'status'],
  );

  app.addHook('onResponse', async (req, reply) => {
    // Requests that matched no route (404s, SPA fallback) share one label so
    // random URLs can't explode series cardinality.
    const route = req.routeOptions?.url ?? 'unrouted';
    if (UNCOUNTED_ROUTES.has(route)) return;
    const status = String(reply.statusCode);
    httpRequests.inc({ route, method: req.method, status });
    if (reply.statusCode === 401) authFailures.inc();
    if (PROXY_ROUTES.has(route)) proxyRequests.inc({ route, status });
  });

  app.get('/metrics', { logLevel: 'silent' }, async (req, reply) => {
    if (token && !bearerMatches(req.headers.authorization, token)) {
      return reply.code(401).send({ error: 'Unauthorized.' });
    }
    return reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8').send(registry.render());
  });

  return registry;
}
