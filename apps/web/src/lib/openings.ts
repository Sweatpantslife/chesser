import { Chess } from 'chess.js';

export interface OpeningInfo {
  eco: string;
  name: string;
  ply: number; // ply at which this name was reached
}

export interface OpeningEntry {
  eco: string;
  name: string;
  san: string[]; // SAN moves from the initial position
}

interface OpeningData {
  epdMap: Map<string, { eco: string; name: string }>;
  entries: OpeningEntry[];
}

// The ECO database is ~600 KB; load it lazily (its own chunk) the first time
// opening-name lookup is actually used, and memoise the parsed result.
let dataPromise: Promise<OpeningData> | null = null;

function ensureData(): Promise<OpeningData> {
  if (!dataPromise) {
    dataPromise = import('../data/openings-eco').then((m) => {
      const epdMap = new Map<string, { eco: string; name: string }>();
      const entries: OpeningEntry[] = [];
      for (const [eco, name, epd, san] of m.ECO_OPENINGS) {
        epdMap.set(epd, { eco, name });
        entries.push({ eco, name, san: san.split(' ') });
      }
      return { epdMap, entries };
    });
  }
  return dataPromise;
}

/** Warm the dataset in the background (e.g. when the analysis board mounts). */
export function preloadOpenings(): void {
  void ensureData();
}

const epdOf = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

/**
 * The deepest named opening reached along a SAN move list from the initial
 * position — transposition-aware, since it keys on the position (EPD), not the
 * move order. Returns null before any named position is reached.
 */
export async function detectOpening(sanMoves: string[]): Promise<OpeningInfo | null> {
  const { epdMap } = await ensureData();
  const c = new Chess();
  let best: OpeningInfo | null = null;
  for (let i = 0; i < sanMoves.length; i++) {
    try {
      c.move(sanMoves[i]!);
    } catch {
      break;
    }
    const hit = epdMap.get(epdOf(c.fen()));
    if (hit) best = { eco: hit.eco, name: hit.name, ply: i + 1 };
  }
  return best;
}

/** Case-insensitive search over opening names (and exact ECO codes). */
export async function searchOpenings(query: string, limit = 40): Promise<OpeningEntry[]> {
  const { entries } = await ensureData();
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: OpeningEntry[] = [];
  for (const e of entries) {
    if (e.eco.toLowerCase() === q || e.name.toLowerCase().includes(q)) {
      out.push(e);
      if (out.length >= limit) break;
    }
  }
  return out;
}
