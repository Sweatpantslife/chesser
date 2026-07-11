/**
 * Structured logging (pino) shared by the Fastify instance and every module
 * that used to write through console.*.
 *
 *   • JSON lines in production; pretty-printed only in dev (TTY + pino-pretty
 *     installed) or when CHESSER_LOG_PRETTY says so. pino-pretty is a
 *     devDependency, so a prod deploy (`pnpm deploy --prod`) can never be
 *     asked to load it — the transport is only wired when it resolves.
 *   • STRICT redaction, as defense-in-depth: authorization/cookie headers,
 *     password/token/api-key-shaped fields up to two object levels deep, the
 *     BYOK coach headers, and whole request bodies (they can carry user PII).
 *     Fastify's default request logs never include headers or bodies — this
 *     guards the day someone logs them anyway.
 *   • Request ids: honour a well-formed incoming x-request-id (so a reverse
 *     proxy's id threads through), mint a UUID otherwise, and echo the id on
 *     every response via registerRequestIdHeader().
 *
 * Env:
 *   CHESSER_LOG_LEVEL   pino level (fatal|error|warn|info|debug|trace|silent),
 *                       default "info".
 *   CHESSER_LOG_PRETTY  force pretty output on/off; default: on for a dev TTY,
 *                       off in production.
 *   CHESSER_LOG         (pre-existing, see config.ts) gates per-request
 *                       logging, not this logger.
 */
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import type { IncomingMessage } from 'node:http';
import { pino, stdSerializers, type LoggerOptions } from 'pino';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/** Key names whose values are secrets wherever they appear in a log object. */
const SENSITIVE_KEYS = [
  'password',
  'currentPassword',
  'newPassword',
  'oldPassword',
  'token',
  'accessToken',
  'refreshToken',
  'sessionToken',
  'apiKey',
  'api_key',
  'apikey',
  'secret',
  'clientSecret',
  'authorization',
  'cookie',
];

/** Header names redacted under any of the usual "headers" parents. */
const SENSITIVE_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-coach-key',
];

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Append `key` to a fast-redact path, bracket-quoting non-identifier keys. */
function joinPath(prefix: string, key: string): string {
  if (IDENT_RE.test(key)) return prefix ? `${prefix}.${key}` : key;
  return `${prefix}["${key}"]`;
}

function buildRedactPaths(): string[] {
  const paths = new Set<string>();
  for (const key of SENSITIVE_KEYS) {
    // Top level plus up to two levels of nesting (fast-redact wildcards are
    // per-level, not recursive) — covers `{ password }`, `{ body: {...} }`,
    // `{ user: { creds: {...} } }` and the like.
    paths.add(joinPath('', key));
    paths.add(joinPath('*', key));
    paths.add(joinPath('*.*', key));
  }
  for (const header of SENSITIVE_HEADERS) {
    for (const parent of ['headers', 'req.headers', 'request.headers', 'res.headers', 'reply.headers']) {
      paths.add(joinPath(parent, header));
    }
  }
  // Request bodies can carry anything the user typed (passwords, PII) — if
  // one is ever attached to a log line, censor it wholesale.
  paths.add('req.body');
  paths.add('request.body');
  return [...paths];
}

/** Exported for tests (and for anyone building a compatible child logger). */
export const REDACT_PATHS: string[] = buildRedactPaths();

// ---------------------------------------------------------------------------
// Logger construction
// ---------------------------------------------------------------------------

const LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

function envFlag(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function prettyTransportAvailable(): boolean {
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/**
 * Mirrors Fastify's default request/response serializers (method/url/host/
 * remote address only — never headers, never bodies), so the same shape is
 * kept when the logger is handed to Fastify as `loggerInstance`.
 */
const serializers: LoggerOptions['serializers'] = {
  req(req: { method?: string; url?: string; host?: string; hostname?: string; ip?: string; socket?: { remotePort?: number } }) {
    return {
      method: req.method,
      url: req.url,
      host: req.host ?? req.hostname,
      remoteAddress: req.ip,
      remotePort: req.socket?.remotePort,
    };
  },
  res(res: { statusCode?: number }) {
    return { statusCode: res.statusCode };
  },
  err: stdSerializers.err,
};

export interface LoggerConfig {
  /** pino level; default CHESSER_LOG_LEVEL or "info". */
  level?: string;
  /** Force pretty output on/off (tests pass false for stable JSON lines). */
  pretty?: boolean;
}

export function buildLoggerOptions(cfg: LoggerConfig = {}): LoggerOptions {
  const rawLevel = cfg.level ?? process.env.CHESSER_LOG_LEVEL?.trim().toLowerCase();
  const level = rawLevel && LEVELS.has(rawLevel) ? rawLevel : 'info';

  const opts: LoggerOptions = {
    level,
    redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
    serializers,
  };

  const wantPretty =
    cfg.pretty ??
    envFlag(process.env.CHESSER_LOG_PRETTY) ??
    (process.env.NODE_ENV !== 'production' && process.stdout.isTTY === true);
  if (wantPretty && prettyTransportAvailable()) {
    opts.transport = {
      target: 'pino-pretty',
      options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
    };
  }

  return opts;
}

/**
 * The process-wide logger. Handed to Fastify as `loggerInstance` (so request
 * logs share redaction and formatting) and imported directly by modules that
 * log outside a request context (stores, engines, config). Typed as
 * FastifyBaseLogger so the Fastify instance keeps its default logger generic
 * (every registerX(app) signature stays untouched).
 */
export const logger: FastifyBaseLogger = pino(buildLoggerOptions());

// ---------------------------------------------------------------------------
// Request ids
// ---------------------------------------------------------------------------

const REQ_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;

/**
 * Fastify `genReqId`: reuse a syntactically safe incoming x-request-id (a
 * reverse proxy or client correlating retries), otherwise mint a UUID.
 * Anything long or oddly-shaped is ignored — request ids end up in log lines
 * and response headers.
 */
export function genReqId(req: IncomingMessage): string {
  const raw = req.headers['x-request-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value && REQ_ID_RE.test(value)) return value;
  return crypto.randomUUID();
}

/** Echo the request id on every response so clients/support can correlate. */
export function registerRequestIdHeader(app: FastifyInstance): void {
  app.addHook('onSend', async (req, reply) => {
    if (!reply.getHeader('x-request-id')) reply.header('x-request-id', String(req.id));
  });
}
