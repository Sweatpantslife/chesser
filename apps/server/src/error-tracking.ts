/**
 * Pluggable error tracking + the app-wide error handler.
 *
 * Reporting is Sentry-protocol-compatible but hand-rolled (~100 lines instead
 * of the @sentry/node dependency tree): set CHESSER_SENTRY_DSN to a standard
 * DSN (Sentry, GlitchTip, or anything speaking the store API) and unhandled
 * server errors are POSTed there. Without the env var everything here is a
 * silent no-op — nothing is required in CI or dev.
 *
 * The Fastify error handler keeps two faces:
 *   • 4xx (validation, body limits, thrown client errors): Fastify's default
 *     response shape, message intact — existing clients/tests rely on it.
 *   • 5xx: full error logged server-side and reported, but the response body
 *     is generic — no messages, stacks or paths leak to clients. The response
 *     carries the request id so users can quote it to support.
 *
 * registerProcessErrorHandlers() wires uncaughtException/unhandledRejection:
 * log + report + flush, then exit(1) — crashes stay crashes.
 */
import crypto from 'node:crypto';
import os from 'node:os';
import type { FastifyBaseLogger, FastifyError, FastifyInstance } from 'fastify';
import { logger } from './logging.js';
import { TokenBucketLimiter } from './rate-limit.js';

export interface ErrorReporter {
  readonly enabled: boolean;
  /** Fire-and-forget; never throws, never blocks the caller. */
  captureException(err: unknown, context?: Record<string, unknown>): void;
  /** Best-effort wait for in-flight deliveries (bounded by timeoutMs). */
  flush(timeoutMs?: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// DSN + event plumbing
// ---------------------------------------------------------------------------

export interface ParsedDsn {
  /** Full store-API endpoint, e.g. https://o1.ingest.sentry.io/api/42/store/ */
  endpoint: string;
  publicKey: string;
}

/** Parse `https://<key>@<host>[/prefix]/<projectId>` into a store endpoint. */
export function parseSentryDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const publicKey = u.username;
    const segments = u.pathname.split('/').filter(Boolean);
    const projectId = segments.pop();
    if (!publicKey || !projectId || !/^[A-Za-z0-9_-]+$/.test(projectId)) return null;
    const prefix = segments.length ? `/${segments.join('/')}` : '';
    return { publicKey, endpoint: `${u.protocol}//${u.host}${prefix}/api/${projectId}/store/` };
  } catch {
    return null;
  }
}

interface StackFrame {
  function: string;
  filename: string;
  lineno: number;
  colno: number;
  in_app: boolean;
}

/** V8 stack → Sentry frames (oldest call first). Best-effort; never throws. */
function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split('\n').slice(1, 51)) {
    const m = /^\s*at (?:(.*?) \()?([^()]+?):(\d+):(\d+)\)?$/.exec(line);
    if (!m) continue;
    const filename = m[2]!;
    frames.push({
      function: m[1] ?? '<anonymous>',
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !filename.includes('node_modules') && !filename.startsWith('node:'),
    });
  }
  return frames.reverse();
}

function toException(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const frames = parseStack(err.stack);
    return {
      type: err.name || 'Error',
      value: err.message,
      ...(frames.length > 0 ? { stacktrace: { frames } } : {}),
    };
  }
  return { type: 'Error', value: String(err) };
}

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------

export interface SentryReporterOptions {
  fetchFn?: typeof fetch;
  log?: Pick<FastifyBaseLogger, 'warn' | 'info'>;
  environment?: string;
  serverName?: string;
  /** Outbound events: burst capacity / sustained per-minute (self-DoS guard). */
  maxBurst?: number;
  refillPerMinute?: number;
  now?: () => number;
}

export class SentryReporter implements ErrorReporter {
  readonly enabled: boolean;
  private readonly dsn: ParsedDsn | null;
  private readonly fetchFn: typeof fetch;
  private readonly log: Pick<FastifyBaseLogger, 'warn' | 'info'>;
  private readonly environment: string;
  private readonly serverName: string;
  private readonly bucket: TokenBucketLimiter;
  private readonly inflight = new Set<Promise<unknown>>();

  constructor(dsn: string | undefined, opts: SentryReporterOptions = {}) {
    this.log = opts.log ?? logger;
    this.dsn = dsn ? parseSentryDsn(dsn) : null;
    if (dsn && !this.dsn) {
      this.log.warn('CHESSER_SENTRY_DSN is set but is not a valid DSN — error tracking disabled.');
    }
    this.enabled = this.dsn !== null;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.environment = opts.environment ?? process.env.NODE_ENV ?? 'development';
    this.serverName = opts.serverName ?? os.hostname();
    this.bucket = new TokenBucketLimiter(opts.maxBurst ?? 20, opts.refillPerMinute ?? 10, opts.now);
  }

  captureException(err: unknown, context: Record<string, unknown> = {}): void {
    if (!this.enabled || !this.dsn) return;
    if (!this.bucket.take('events')) return; // error storm — drop, don't amplify
    const { level, ...extra } = context;
    const event = {
      event_id: crypto.randomBytes(16).toString('hex'),
      timestamp: new Date().toISOString(),
      platform: 'node',
      level: typeof level === 'string' ? level : 'error',
      logger: 'chesser-server',
      server_name: this.serverName,
      environment: this.environment,
      exception: { values: [toException(err)] },
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
    };
    const delivery = this.fetchFn(this.dsn.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_client=chesser-server/1.0, sentry_key=${this.dsn.publicKey}`,
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(5000),
    })
      .then((res) => {
        if (!res.ok) this.log.warn(`error tracking: upstream responded ${res.status}`);
      })
      .catch((e: unknown) => {
        this.log.warn({ err: e }, 'error tracking: failed to deliver event');
      });
    this.inflight.add(delivery);
    void delivery.finally(() => this.inflight.delete(delivery));
  }

  async flush(timeoutMs = 2000): Promise<void> {
    if (this.inflight.size === 0) return;
    await Promise.race([
      Promise.allSettled([...this.inflight]),
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, timeoutMs);
        t.unref?.();
      }),
    ]);
  }
}

/** Process-wide reporter — a silent no-op unless CHESSER_SENTRY_DSN is set. */
export const errorTracker: ErrorReporter = new SentryReporter(process.env.CHESSER_SENTRY_DSN?.trim() || undefined);

// ---------------------------------------------------------------------------
// Fastify + process wiring
// ---------------------------------------------------------------------------

export interface ErrorHandlingOptions {
  reporter?: ErrorReporter;
}

export function registerErrorHandling(app: FastifyInstance, opts: ErrorHandlingOptions = {}): void {
  const reporter = opts.reporter ?? errorTracker;
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 ? err.statusCode : 500;
    if (status < 500) {
      // Expected client errors (bad JSON, body too large, thrown 4xx):
      // Fastify's default response shape, message intact.
      req.log.info({ err }, 'request errored');
      return reply.code(status).send(err);
    }
    // Server faults: everything to the log and the tracker, nothing but a
    // generic body (plus the correlating request id) to the client.
    req.log.error({ err }, 'request failed');
    reporter.captureException(err, {
      method: req.method,
      path: req.url.split('?', 1)[0],
      requestId: String(req.id),
      statusCode: status,
    });
    return reply.code(status).send({
      statusCode: status,
      error: 'Internal Server Error',
      message: 'Something went wrong. Please try again.',
      requestId: String(req.id),
    });
  });
}

/**
 * Last-resort handlers: log + report + flush, then exit(1). The process still
 * dies (state after an uncaught throw is unknowable) — the point is that it
 * dies loudly and the crash reaches the tracker first.
 */
export function registerProcessErrorHandlers(log: FastifyBaseLogger, reporter: ErrorReporter = errorTracker): void {
  const fail = (kind: string) => (cause: unknown) => {
    const err = cause instanceof Error ? cause : new Error(String(cause));
    log.fatal({ err }, `${kind} — shutting down`);
    reporter.captureException(err, { level: 'fatal', mechanism: kind });
    void reporter.flush(2000).finally(() => process.exit(1));
  };
  process.on('uncaughtException', fail('uncaughtException'));
  process.on('unhandledRejection', fail('unhandledRejection'));
}
