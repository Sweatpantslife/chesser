import { describe, expect, it } from 'vitest';
import { BOOK_PLIES, botThinkTimeMs, plyOfFen, THINK_MAX_MS, THINK_MIN_MS, type ThinkTimeContext } from './thinkTime';

/** Deterministic RNG (mulberry32) so the sampled distributions are stable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function samples(ctx: Omit<ThinkTimeContext, 'rng'>, n = 1000, seed = 1): number[] {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => botThinkTimeMs({ ...ctx, rng }));
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const stddev = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))));
};

describe('botThinkTimeMs', () => {
  it('always stays inside the stall-proof bounds', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 3000; i++) {
      const ms = botThinkTimeMs({
        rating: 400 + rng() * 2800,
        ply: Math.floor(rng() * 100),
        legalMoves: 1 + Math.floor(rng() * 40),
        recaptureAvailable: rng() < 0.2,
        inCheck: rng() < 0.2,
        rng,
      });
      expect(ms).toBeGreaterThanOrEqual(THINK_MIN_MS);
      expect(ms).toBeLessThanOrEqual(THINK_MAX_MS);
    }
  });

  it('only-moves are answered near-instantly', () => {
    for (const ms of samples({ rating: 1500, ply: 30, legalMoves: 1 }, 500)) {
      expect(ms).toBeLessThanOrEqual(520);
    }
  });

  it('recaptures come fast', () => {
    for (const ms of samples({ rating: 900, ply: 30, legalMoves: 25, recaptureAvailable: true }, 500)) {
      expect(ms).toBeLessThanOrEqual(1000);
    }
    expect(mean(samples({ rating: 900, ply: 30, legalMoves: 25, recaptureAvailable: true }))).toBeLessThan(
      mean(samples({ rating: 900, ply: 30, legalMoves: 25 })),
    );
  });

  it('book moves are quicker than middlegame thinks', () => {
    const book = mean(samples({ rating: 1500, ply: 2, legalMoves: 25 }));
    const middlegame = mean(samples({ rating: 1500, ply: 30, legalMoves: 30 }));
    expect(book).toBeLessThan(middlegame * 0.7);
  });

  it('lower-rated bots are slower and more erratic', () => {
    const weak = samples({ rating: 700, ply: 30, legalMoves: 30 }, 2000);
    const strong = samples({ rating: 2200, ply: 30, legalMoves: 30 }, 2000);
    expect(mean(weak)).toBeGreaterThan(mean(strong));
    expect(stddev(weak)).toBeGreaterThan(stddev(strong));
  });

  it('occasionally takes a genuine long think in the middlegame', () => {
    const xs = samples({ rating: 1600, ply: 30, legalMoves: 35 }, 1000);
    expect(Math.max(...xs)).toBeGreaterThan(2500);
    // …but long thinks are the exception, not the rule.
    expect(xs.filter((x) => x > 2500).length / xs.length).toBeLessThan(0.25);
  });

  it('a low clock caps the simulated thought so the bot cannot dawdle into flagging', () => {
    for (const ms of samples({ rating: 1500, ply: 30, legalMoves: 30, clockMs: 3000 }, 300)) {
      expect(ms).toBeLessThanOrEqual(250);
    }
    for (const ms of samples({ rating: 1500, ply: 30, legalMoves: 30, clockMs: 24_000 }, 300)) {
      expect(ms).toBeLessThanOrEqual(2000);
    }
  });
});

describe('plyOfFen', () => {
  it('derives plies from turn + fullmove', () => {
    expect(plyOfFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(0);
    expect(plyOfFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')).toBe(1);
    expect(plyOfFen('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3')).toBe(4);
    expect(plyOfFen(`8/8/8/8/8/4k3/8/4K3 w - - 30 80`)).toBeGreaterThan(BOOK_PLIES);
  });
});
