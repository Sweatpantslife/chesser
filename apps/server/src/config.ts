import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import type { EngineAvailability } from '@chesser/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
// src or dist both sit at apps/server/<x>, so repo root is three levels up.
export const REPO_ROOT = process.env.CHESSER_ROOT ?? path.resolve(here, '../../..');
export const ENGINES_DIR = process.env.CHESSER_ENGINES_DIR ?? path.join(REPO_ROOT, 'engines');

export const PORT = Number(process.env.PORT ?? 8787);
export const HOST = process.env.HOST ?? '0.0.0.0';

/**
 * Directory of the built web client (the Vite `dist/`). When present the server
 * serves the SPA itself, so the whole app runs from a single origin/port — one
 * container behind one reverse proxy (e.g. Coolify's Traefik). In local dev the
 * web client is served by Vite instead, so this is null until you `pnpm build`.
 */
function defaultWebDir(): string | null {
  // src and dist both sit at apps/server/<x>, so the sibling app is ../../web/dist.
  const candidate = path.resolve(here, '../../web/dist');
  return fs.existsSync(path.join(candidate, 'index.html')) ? candidate : null;
}
export const WEB_DIR: string | null = process.env.CHESSER_WEB_DIR ?? defaultWebDir();

/** Structured request logging (pino). On by default in production. */
export const LOG_ENABLED = process.env.CHESSER_LOG
  ? /^(1|true|yes|on)$/i.test(process.env.CHESSER_LOG)
  : process.env.NODE_ENV === 'production';

/** Resource budget for engines. Kept modest so several can coexist. */
export const ENGINE_THREADS = Number(process.env.CHESSER_THREADS ?? Math.min(2, Math.max(1, os.cpus().length - 1)));
export const ENGINE_HASH_MB = Number(process.env.CHESSER_HASH_MB ?? 128);

// ---------------------------------------------------------------------------
// Syzygy endgame tablebases (local files)
// ---------------------------------------------------------------------------

/**
 * A directory of Syzygy tablebase files (`*.rtbw` / `*.rtbz`). When present it
 * is handed to Stockfish via the `SyzygyPath` UCI option, so analysis and every
 * Stockfish opponent — including the endgame trainer's defender — play ≤N-piece
 * endings perfectly and offline. It also backs the `/api/tablebase` endpoint as
 * a fallback when the online proxy is unreachable.
 *
 * Discovery order:
 *   1. CHESSER_SYZYGY_PATH — one or more directories joined the way Stockfish
 *      expects (OS path-list separator), passed through verbatim.
 *   2. engines/syzygy/ — the default location `pnpm setup:engines` populates.
 * Returns null when no tablebase files exist, so the app behaves exactly as it
 * did before (online proxy + full-strength Stockfish).
 */
export interface SyzygyInfo {
  /** Path string in the form Stockfish's `SyzygyPath` option expects. */
  path: string;
  /** Largest piece count covered by the files present (e.g. 5 or 7). */
  maxPieces: number;
}

const SYZYGY_PATH_SEP = process.platform === 'win32' ? ';' : ':';

/** Largest piece count among the Syzygy files in `dir` (0 if none / unreadable). */
function syzygyMaxPiecesIn(dir: string): number {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  let max = 0;
  for (const name of entries) {
    // e.g. KQvK.rtbz (3), KRPvKR.rtbw (5), KQQvKQQ.rtbw (7)
    const m = /^([KQRBNP]+)v([KQRBNP]+)\.rtb[wz]$/.exec(name);
    if (!m) continue;
    const pieces = m[1]!.length + m[2]!.length;
    if (pieces > max) max = pieces;
  }
  return max;
}

let syzygyResolved: { value: SyzygyInfo | null } | null = null;

function resolveSyzygy(): SyzygyInfo | null {
  const fromEnv = process.env.CHESSER_SYZYGY_PATH?.trim();
  if (fromEnv) {
    const dirs = fromEnv
      .split(SYZYGY_PATH_SEP)
      .map((d) => d.trim())
      .filter(Boolean);
    const maxPieces = dirs.reduce((m, d) => Math.max(m, syzygyMaxPiecesIn(d)), 0);
    if (maxPieces > 0) return { path: dirs.join(SYZYGY_PATH_SEP), maxPieces };
    console.warn(`[config] CHESSER_SYZYGY_PATH is set but no .rtbw/.rtbz files were found in "${fromEnv}".`);
    return null;
  }
  const def = path.join(ENGINES_DIR, 'syzygy');
  const maxPieces = syzygyMaxPiecesIn(def);
  return maxPieces > 0 ? { path: def, maxPieces } : null;
}

/** Resolved local Syzygy tablebases, or null. Memoised (cheap & effectively static). */
export function syzygyInfo(): SyzygyInfo | null {
  if (!syzygyResolved) syzygyResolved = { value: resolveSyzygy() };
  return syzygyResolved.value;
}

/** Forget the cached Syzygy lookup (e.g. after files are added at runtime). */
export function resetSyzygyCache(): void {
  syzygyResolved = null;
}

interface RawManifest {
  generatedAt?: string;
  stockfish: { path: string } | null;
  lc0: { path: string } | null;
  maiaNetworks: { id: string; rating: number; path: string }[];
}

export interface EngineManifest {
  stockfishBin: string | null;
  lc0Bin: string | null;
  maiaNetworks: { id: string; rating: number; path: string }[];
}

const EMPTY: EngineManifest = { stockfishBin: null, lc0Bin: null, maiaNetworks: [] };

export function loadManifest(): EngineManifest {
  const file = path.join(ENGINES_DIR, 'manifest.json');
  if (!fs.existsSync(file)) {
    console.warn(`[config] No engines/manifest.json found at ${file}. Run "pnpm setup:engines".`);
    return EMPTY;
  }
  let raw: RawManifest;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('[config] Failed to parse manifest.json:', e);
    return EMPTY;
  }

  const resolve = (p: string) => path.join(ENGINES_DIR, p);
  const exists = (p: string | null | undefined) => !!p && fs.existsSync(p);

  const stockfishBin = raw.stockfish && exists(resolve(raw.stockfish.path)) ? resolve(raw.stockfish.path) : null;
  const lc0Bin = raw.lc0 && exists(resolve(raw.lc0.path)) ? resolve(raw.lc0.path) : null;
  const maiaNetworks = (raw.maiaNetworks ?? [])
    .filter((n) => exists(resolve(n.path)))
    .map((n) => ({ id: n.id, rating: n.rating, path: resolve(n.path) }))
    .sort((a, b) => a.rating - b.rating);

  return { stockfishBin, lc0Bin, maiaNetworks };
}

export function availabilityFrom(manifest: EngineManifest): EngineAvailability {
  const syzygy = syzygyInfo();
  return {
    stockfish: !!manifest.stockfishBin,
    // Maia needs both the lc0 binary and at least one network.
    lc0: !!manifest.lc0Bin && manifest.maiaNetworks.length > 0,
    maiaNetworks: manifest.maiaNetworks.map((n) => ({ id: n.id, rating: n.rating })),
    // Syzygy only helps Stockfish, so report it as available only when both exist.
    syzygy: !!syzygy && !!manifest.stockfishBin,
    syzygyMaxPieces: syzygy?.maxPieces,
  };
}
