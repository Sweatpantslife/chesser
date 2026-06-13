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

/** Resource budget for engines. Kept modest so several can coexist. */
export const ENGINE_THREADS = Number(process.env.CHESSER_THREADS ?? Math.min(2, Math.max(1, os.cpus().length - 1)));
export const ENGINE_HASH_MB = Number(process.env.CHESSER_HASH_MB ?? 128);

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
  return {
    stockfish: !!manifest.stockfishBin,
    // Maia needs both the lc0 binary and at least one network.
    lc0: !!manifest.lc0Bin && manifest.maiaNetworks.length > 0,
    maiaNetworks: manifest.maiaNetworks.map((n) => ({ id: n.id, rating: n.rating })),
  };
}
