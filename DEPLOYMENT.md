# Deploying Chesser

Chesser ships as a single process that serves the React SPA, the HTTP API and
the WebSocket engine protocol from one origin/port (default `8787`). There is
no external database — all persistent state is two JSON files under
`CHESSER_DATA_DIR`. Run exactly **one instance** per data directory (the store
is single-process by design).

- [Docker](#docker)
- [Docker Compose / Coolify](#docker-compose--coolify)
- [Bare Node](#bare-node)
- [Environment variables](#environment-variables)
- [Health, readiness & metrics](#health-readiness--metrics)
- [Data & backups](#data--backups)
- [Engines & supply chain](#engines--supply-chain)
- [Threat model](#threat-model)

## Docker

The published image (built by `.github/workflows/docker.yml`) lives at
`ghcr.io/<owner>/chesser`; `docker build -t chesser .` produces the same thing
locally (Stockfish-only by default — see [Engines](#engines--supply-chain)).

```sh
docker build -t chesser .
docker run -d --name chesser \
  --init \                        # reaps spawned engine processes on shutdown
  -p 8787:8787 \
  -v chesser-data:/data \         # ALL persistent state lives here
  chesser
```

The image runs as the non-root `node` user, only ever writes to `/data`
(`CHESSER_DATA_DIR`), and has a built-in `HEALTHCHECK` against `GET /healthz`.
Add `-e` flags from the [table below](#environment-variables); when the
container sits behind a TLS-terminating reverse proxy, set `TRUST_PROXY=1`
(per-IP rate limits and HSTS depend on it) and do not publish the port
directly.

## Docker Compose / Coolify

`docker-compose.yml` at the repo root is production-ready and
Coolify-oriented: Coolify's Traefik terminates TLS and routes the generated
domain to port 8787, `TRUST_PROXY=1` is already set, the `chesser-data` volume
is mounted at `/data`, and healthcheck/`restart: unless-stopped`/`init: true`
are configured.

```sh
docker compose up --build -d
```

For plain Compose (no Coolify) uncomment the `ports:` mapping and remove the
`SERVICE_FQDN_CHESSER_8787` line. Secrets (`CHESSER_LICHESS_TOKEN`,
`ANTHROPIC_API_KEY`, …) are commented in the compose file — supply them via
your orchestrator's secret store, not by committing an `.env`.

## Bare Node

Requires Node >= 20 (`.nvmrc` says 22) and pnpm 9 (`corepack enable`).

```sh
pnpm install --frozen-lockfile
pnpm setup:engines           # optional: downloads/verifies Stockfish & friends
pnpm build                   # shared -> server -> web
NODE_ENV=production \
CHESSER_DATA_DIR=/var/lib/chesser \
node apps/server/dist/index.js
```

The server finds the built SPA at `apps/web/dist` automatically (override with
`CHESSER_WEB_DIR`) and engines at `engines/` (override with
`CHESSER_ENGINES_DIR`); it boots fine with no engines installed and simply
reports them unavailable. Run it under a supervisor (systemd, etc.), behind a
TLS-terminating proxy, with `TRUST_PROXY=1`.

## Environment variables

Everything has a working default; **nothing is required just to boot**. The
variables marked "prod: yes" are the ones a real deployment should set
deliberately. `.env.example` mirrors this list.

### Set these in production

| Variable | Default | Purpose / notes |
|---|---|---|
| `CHESSER_DATA_DIR` | `<repo>/data` (`/data` in Docker) | Directory for `db.json` (accounts, bearer sessions, progress, games) and `social.json`. Must be writable and persistent — mount a volume, back it up. One server process per data dir. |
| `NODE_ENV` | unset (`production` in Docker) | `production` enables request logging by default and JSON log output. |
| `TRUST_PROXY` | off | How many `X-Forwarded-*` hops to trust (`1` = one reverse proxy; address/CIDR lists also accepted). Required behind Traefik/Nginx/Coolify so per-IP rate limits key on real client IPs and HSTS is emitted. Never set it when clients connect directly — trusting client-supplied XFF lets them spoof their IP. |
| `CHESSER_METRICS_TOKEN` | unset (= `/metrics` **open**) | Bearer token guarding `GET /metrics`. Set it whenever the app is reachable from the public internet; scrape with `Authorization: Bearer <token>`. |

### Optional — network & CORS

| Variable | Default | Purpose / notes |
|---|---|---|
| `PORT` | `8787` | Listen port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `CHESSER_ALLOWED_ORIGINS` | unset (= **no** cross-origin browser access) | Comma-separated extra origins allowed to call the API cross-origin. Unset is correct for the normal single-origin deployment (the server serves the SPA itself). |

### Optional — sessions & abuse limits

| Variable | Default | Purpose / notes |
|---|---|---|
| `CHESSER_SESSION_TTL_DAYS` | `30` | Bearer-token lifetime in days, sliding (each authenticated use extends it). Legacy tokens from before expiry existed are backfilled to now + TTL, so existing logins keep working after upgrade. |
| `CHESSER_WS_MAX_SESSIONS` | `32` | Global cap on concurrent `/ws` engine sessions (each may spawn up to two Stockfish processes). |
| `CHESSER_WS_MAX_SESSIONS_PER_IP` | `8` | Per-client-IP cap on `/ws` engine sessions (needs `TRUST_PROXY` behind a proxy, otherwise all clients share the proxy's IP). |

### Optional — logging & observability

| Variable | Default | Purpose / notes |
|---|---|---|
| `CHESSER_LOG` | on when `NODE_ENV=production` | Per-request log lines on/off. |
| `CHESSER_LOG_LEVEL` | `info` | `fatal`…`trace`/`silent` for all log output. |
| `CHESSER_LOG_PRETTY` | dev TTY only | Human-readable logs (pino-pretty). Production images don't ship pino-pretty — leave unset. |
| `CHESSER_SENTRY_DSN` | unset (= no-op) | Sentry-compatible DSN (Sentry, GlitchTip, …) for unhandled 5xx errors and crashes. |

Secrets never reach the logs: authorization/cookie/BYOK headers, passwords,
tokens and request bodies are redacted or never serialized in the first place.

### Optional — engines & tablebases

| Variable | Default | Purpose / notes |
|---|---|---|
| `CHESSER_THREADS` | `min(2, cpus − 1)`, at least 1 | Threads per Stockfish process. |
| `CHESSER_HASH_MB` | `128` | Hash table MB per Stockfish process. |
| `CHESSER_SYZYGY_PATH` | unset | Local Syzygy tablebase directory/ies (see the compose file's optional mount). |
| `CHESSER_TABLEBASE_URL` | `https://tablebase.lichess.ovh/standard` | Online tablebase upstream. |
| `CHESSER_EXPLORER_MASTERS_URL` | `https://explorer.lichess.ovh/masters` | Opening-explorer upstream (masters db). |
| `CHESSER_EXPLORER_LICHESS_URL` | `https://explorer.lichess.ovh/lichess` | Opening-explorer upstream (lichess db). |
| `CHESSER_LICHESS_TOKEN` | unset | **SECRET.** Lichess API token for the opening explorer (explorer.lichess.ovh requires auth). Sent as a Bearer header to Lichess only; the `/api/explorer` proxy is per-IP rate-limited so visitors can't burn the token's quota. Without it the explorer reports itself unavailable. |

### Optional — AI coach (LLM)

| Variable | Default | Purpose / notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | unset | **SECRET.** Server-side key for LLM coach explanations. Anthropic wins when both keys are set. |
| `OPENAI_API_KEY` | unset | **SECRET.** OpenAI(-compatible) alternative. |
| `COACH_LLM_MODEL` | `claude-haiku-4-5-20251001` / `gpt-4o-mini` | Model override for either provider. |
| `COACH_LLM_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base URL (e.g. a local Ollama). |

With no server key configured, `/api/coach/status` reports
`{ configured: false }` and the web client falls back to rule-based
explanations — or users bring their own key (BYOK). BYOK keys live only in the
user's browser (`localStorage`); when relayed through the server as a CORS
fallback they are stripped from the request headers before any logging, never
cached, never stored, and scrubbed from error messages. User-supplied BYOK
base URLs must be https, pass a private-network/SSRF check **including DNS
resolution**, and are refused otherwise.

### Optional — paths (rarely needed)

| Variable | Default | Purpose / notes |
|---|---|---|
| `CHESSER_WEB_DIR` | auto-detected (`/app/web` in Docker) | Built SPA directory. |
| `CHESSER_ENGINES_DIR` | `<repo>/engines` (`/app/engines` in Docker) | Engine binaries/networks/manifest. |
| `CHESSER_ROOT` | auto-detected | Repo-root override for the default path derivations above. |
| `SERVICE_FQDN_CHESSER_8787` | — | Coolify-only routing hint; see `docker-compose.yml`. |

## Health, readiness & metrics

| Endpoint | Auth | Meaning |
|---|---|---|
| `GET /healthz` | none | Liveness: always `200 { ok: true }` while the process serves requests. Docker `HEALTHCHECK` uses this. Excluded from logs/metrics. |
| `GET /readyz` | none | Readiness: verifies the data dir is writable and (when configured) web assets exist; `503` with per-check detail on failure. |
| `GET /api/health` | none | Legacy health endpoint (`{ ok, syzygy }`), kept for compatibility (Playwright, older probes). |
| `GET /metrics` | Bearer `CHESSER_METRICS_TOKEN` (open if unset) | Prometheus text: `http_requests_total`, `auth_failures_total`, `proxy_requests_total`, `ws_connections_current`, `engine_processes_current`. |

Every response echoes an `x-request-id` (honoring a well-formed incoming one),
which is also the `reqId` in log lines.

## Data & backups

- `CHESSER_DATA_DIR/db.json` — accounts (scrypt-hashed passwords), bearer
  sessions, synced progress, saved games.
- `CHESSER_DATA_DIR/social.json` — leaderboards, profiles, friends.

Back up the directory (it's small); restoring it on a fresh container/host is
a complete restore. Existing user logins survive upgrades: session tokens are
opaque and stored server-side, and pre-expiry tokens are backfilled with a TTL
rather than invalidated.

## Engines & supply chain

Engines are baked into the image at build time by `scripts/setup-engines.sh`
(default: Stockfish only, `SF_VARIANT=x86-64-avx2`; use
`x86-64-sse41-popcnt` for older CPUs). Every fetched artifact is verified
against **pinned SHA-256 checksums** (Stockfish release tars; Maia networks,
which are also fetched from a commit-pinned URL). The Docker build sets
`REQUIRE_CHECKSUMS=1`, so an image can never silently ship an unverified
binary; overriding `SF_VERSION` requires passing `SF_SHA256=<sha256 of the
tar>` through `ENGINE_SETUP` (see the comments in the `Dockerfile`).
`LC0_REF` optionally pins the Lc0 source build to a tag. Opt-in Syzygy
downloads (`WITH_SYZYGY=1`, ~1 GB from tablebase.lichess.ovh) are not
checksum-pinned.

The app works with no engines at all — play-vs-computer and analysis simply
report the engines as unavailable.

## Threat model

What the shipped hardening protects against:

- **Credential brute force / stuffing** — per-IP rate limits on
  login/register, per-account lockout with exponential backoff (works even
  without `TRUST_PROXY`), async scrypt with a password length cap (no
  hash-based CPU DoS), uniform errors and timing for nonexistent users.
- **Session theft longevity** — server-side opaque bearer tokens with a
  sliding TTL (`CHESSER_SESSION_TTL_DAYS`); logout revokes server-side.
- **XSS / clickjacking / MIME sniffing** — strict CSP (hashed inline
  bootstrap script, no `unsafe-eval`), `X-Frame-Options: DENY`, `nosniff`,
  Referrer-Policy, Permissions-Policy, COOP/CORP on every response; HSTS when
  serving over TLS. This matters because auth tokens and BYOK keys live in
  `localStorage` — CSP is the primary defense for them.
- **Cross-origin abuse** — CORS fails closed (no cross-origin browser access
  unless `CHESSER_ALLOWED_ORIGINS` opts in).
- **SSRF via BYOK base URLs** — https-only, no credentials, hostname AND
  every DNS answer must be public address space; private/link-local/CGNAT/
  multicast ranges refused (v4 + v6, v4-mapped unwrapped).
- **Upstream-quota theft & outbound amplification** — `/api/explorer`,
  `/api/tablebase`, `/api/import` and `/api/coach/explain` are per-IP
  rate-limited; the Lichess token is only ever sent to Lichess.
- **Resource exhaustion via WebSockets** — 1 MiB `maxPayload` (was 100 MiB
  default), global + per-IP caps on engine-spawning `/ws` sessions, friend
  rooms capped and TTL-swept.
- **Proxy misconfiguration** — `TRUST_PROXY` uses explicit hop counts; the
  client-controlled leftmost XFF entry is never trusted.
- **Secrets in logs** — pino redaction for auth headers/passwords/tokens,
  bodies never serialized; BYOK headers deleted before any handler logic runs.
- **Supply chain (engines)** — SHA-256-pinned downloads, commit-pinned Maia
  source, `REQUIRE_CHECKSUMS=1` in image builds; non-root runtime user.
- **Crash-loop opacity** — structured logs, request IDs, optional Sentry DSN,
  Prometheus metrics, liveness/readiness probes.

Explicitly **out of scope** (documented decisions, not oversights):

- **Email-based password reset / account recovery** — accounts are
  username+password only; there is no email collection and no mailer. A lost
  password means a lost account. Revisit only if an email provider is added.
- **WAF / volumetric DDoS protection** — put a CDN/reverse proxy (Cloudflare,
  etc.) in front if you need it; the built-in limits are abuse valves, not
  DDoS mitigation.
- **Multi-instance / HA** — the JSON store is single-process. Scale up, not
  out.
- **DNS-rebinding TOCTOU on BYOK URLs** — DNS is checked at request time; a
  re-resolving fetch is a documented residual risk (judged disproportionate
  to fix for this feature).
- **CAPTCHA / bot detection** on registration — rate limits bound account
  creation per IP instead.
