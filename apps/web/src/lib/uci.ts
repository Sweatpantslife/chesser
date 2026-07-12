import { Chess } from 'chess.js';

/**
 * Convert a SAN line played from the STANDARD start position into lowercase
 * UCI moves (promotion suffix appended, e.g. `e7e8q`) — the wire format of
 * the analyze-handoff contract (`#/play/analysis?moves=e2e4,c7c5,…`).
 * Returns null if any move is illegal from its position; callers must not
 * emit a handoff link in that case.
 */
export function sanLineToUci(sans: string[]): string[] | null {
  const chess = new Chess();
  const ucis: string[] = [];
  for (const san of sans) {
    let mv;
    try {
      mv = chess.move(san);
    } catch {
      return null;
    }
    ucis.push(mv.from + mv.to + (mv.promotion ?? ''));
  }
  return ucis;
}
