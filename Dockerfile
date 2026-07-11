# Chesser — production image.
#
# A single container that serves the React client, the HTTP API and the
# WebSocket engine protocol from one origin/port, so it sits cleanly behind a
# single reverse proxy (e.g. Coolify's built-in Traefik). Bundled engines are
# baked in at build time (Stockfish by default; Lc0/Maia/Syzygy are opt-in).
#
#   docker build -t chesser .                          # Stockfish-only (fast)
#   docker build -t chesser \                          # + Maia (human-like bots)
#     --build-arg ENGINE_SETUP= \
#     --build-arg ENGINE_TOOLCHAIN=1 .
#
# Target platform is linux/amd64 (the bundled Stockfish/Lc0 binaries are x86-64).
# Override *_IMAGE to pull bases from a mirror if Docker Hub is rate-limited.

ARG NODE_IMAGE=node:22-bookworm-slim
ARG ENGINE_BASE_IMAGE=buildpack-deps:bookworm

# ---------------------------------------------------------------------------
# Base — pnpm via corepack.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
# Dependencies — cached on the lockfile + package manifests only.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Build — compile shared + server, bundle the web client, then carve out a
# self-contained production server (node_modules incl. the built @chesser/shared).
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm --filter @chesser/shared build \
 && pnpm --filter @chesser/server build \
 && pnpm --filter @chesser/web build \
 && pnpm --filter @chesser/server deploy --prod /deploy

# ---------------------------------------------------------------------------
# Engines — Stockfish by default (buildpack-deps ships curl + a C/C++ toolchain,
# so no extra packages are needed). Set ENGINE_SETUP= and ENGINE_TOOLCHAIN=1 to
# also build Lc0 + fetch the Maia nets; SF_VARIANT pins the Stockfish binary so
# the build host's CPU need not match the deploy host's.
#
# REQUIRE_CHECKSUMS=1 makes the image build fail rather than ship an engine
# binary the script cannot verify against its pinned SHA-256 table. When
# overriding SF_VERSION to a release outside that table, pass its checksum
# through ENGINE_SETUP, e.g.:
#   --build-arg ENGINE_SETUP="ONLY=stockfish SF_VERSION=sf_18 SF_SHA256=<sha256 of the tar>"
# ---------------------------------------------------------------------------
FROM ${ENGINE_BASE_IMAGE} AS engines
ARG ENGINE_SETUP="ONLY=stockfish"
ARG ENGINE_TOOLCHAIN=0
ARG SF_VARIANT=x86-64-avx2
WORKDIR /app
RUN if [ "$ENGINE_TOOLCHAIN" = "1" ]; then \
      apt-get update \
   && apt-get install -y --no-install-recommends meson ninja-build pkg-config libeigen3-dev python3 python3-pip \
   && rm -rf /var/lib/apt/lists/*; \
    fi
COPY scripts/setup-engines.sh scripts/setup-engines.sh
# REQUIRE_CHECKSUMS first so ENGINE_SETUP can still opt out explicitly.
RUN env REQUIRE_CHECKSUMS=1 ${ENGINE_SETUP} SF_VARIANT="${SF_VARIANT}" bash scripts/setup-engines.sh

# ---------------------------------------------------------------------------
# Runtime — slim, non-root. Run under an init (compose `init: true`, or
# `docker run --init`) so spawned engine processes are reaped on shutdown.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    CHESSER_ENGINES_DIR=/app/engines \
    CHESSER_WEB_DIR=/app/web \
    CHESSER_DATA_DIR=/data
WORKDIR /app

# Self-contained server (dist + production node_modules).
COPY --from=build /deploy ./
# Built web client, served statically by the server.
COPY --from=build /app/apps/web/dist ./web
# Engine binaries, networks and manifest.
COPY --from=engines /app/engines ./engines

# The app only ever writes to the data volume; /app stays root-owned and
# world-readable (the copied files keep their read/exec perms), which avoids a
# costly chown -R copy-up of the engine binaries and follows least privilege.
#
# /data (CHESSER_DATA_DIR) holds ALL persistent state — accounts/sessions/
# progress (db.json) and the social layer (social.json). Always mount a volume
# here in production and include it in backups; see DEPLOYMENT.md.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787

# Liveness probe. /healthz is the dedicated always-200 endpoint (kept out of
# request logs and metrics); /readyz additionally checks the data dir is
# writable + web assets are present, if you want a stricter gate.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
