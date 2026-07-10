import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  annotateRepeats,
  blunderChanceFor,
  blunderLossCapFor,
  hardLossCapFor,
  mulberry32,
  pickHumanMove,
  pickMaiaVariety,
  plyOfFen,
  searchPlanFor,
  temperatureFor,
  type HumanCandidate,
} from './humanize.js';

// ---------------------------------------------------------------------------
// Distribution-level assertions: sample many seeded picks and check the shape.
// ---------------------------------------------------------------------------

/** A typical middlegame candidate spread: best, near-equal, then worse moves. */
const SPREAD: HumanCandidate[] = [
  { uci: 'a1a2', cp: 20 }, // best
  { uci: 'b1b2', cp: -10 }, // -30
  { uci: 'c1c2', cp: -60 }, // -80
  { uci: 'd1d2', cp: -130 }, // -150
  { uci: 'e1e2', cp: -280 }, // -300
  { uci: 'f1f2', cp: -580 }, // -600
];

function samplePicks(candidates: HumanCandidate[], rating: number, ply: number, n = 4000) {
  const rng = mulberry32(rating * 7919 + ply + 1);
  const picks = [];
  for (let i = 0; i < n; i++) picks.push(pickHumanMove(candidates, { rating, ply, rng }));
  return picks;
}
function sample(candidates: HumanCandidate[], rating: number, ply: number, n = 4000) {
  return samplePicks(candidates, rating, ply, n).map((p) => p.index);
}
const rate = (picks: number[], pred: (i: number) => boolean) => picks.filter(pred).length / picks.length;

test('curves are monotone in rating (temperature, blunder chance/magnitude fall)', () => {
  const ratings = [500, 800, 1100, 1400, 1700, 2000, 2400];
  for (let i = 1; i < ratings.length; i++) {
    assert.ok(temperatureFor(ratings[i]!) < temperatureFor(ratings[i - 1]!), `temperature @${ratings[i]}`);
    assert.ok(blunderChanceFor(ratings[i]!) <= blunderChanceFor(ratings[i - 1]!), `blunder chance @${ratings[i]}`);
    assert.ok(blunderLossCapFor(ratings[i]!) <= blunderLossCapFor(ratings[i - 1]!), `blunder cap @${ratings[i]}`);
    assert.ok(hardLossCapFor(ratings[i]!) <= hardLossCapFor(ratings[i - 1]!), `hard cap @${ratings[i]}`);
  }
});

test('top-move pick rate rises with rating', () => {
  const ply = 30; // out of the opening-variety window
  const rates = [600, 1100, 1500, 1900, 2400].map((r) => rate(sample(SPREAD, r, ply), (i) => i === 0));
  for (let i = 1; i < rates.length; i++) {
    assert.ok(rates[i]! > rates[i - 1]!, `pick rate must rise: ${rates.join(', ')}`);
  }
  assert.ok(rates[0]! < 0.6, `a 600 is far from engine-perfect (got ${rates[0]})`);
  assert.ok(rates[rates.length - 1]! > 0.8, `a 2400 nearly always plays the best move (got ${rates.at(-1)})`);
});

test('expected centipawn loss falls with rating', () => {
  const ply = 30;
  const losses = [600, 1000, 1400, 1800, 2200].map((r) => {
    const picks = sample(SPREAD, r, ply);
    const lossOf = (i: number) => 20 - SPREAD[i]!.cp;
    return picks.reduce((a, i) => a + lossOf(i), 0) / picks.length;
  });
  for (let i = 1; i < losses.length; i++) {
    assert.ok(losses[i]! < losses[i - 1]!, `mean loss must fall: ${losses.map((l) => l.toFixed(1)).join(', ')}`);
  }
});

test('blunder frequency by band: real errors at 600, mostly-small slips at 1900', () => {
  const ply = 30;
  const low = sample(SPREAD, 600, ply);
  const high = sample(SPREAD, 1900, ply);
  // A 600 plays a ≥300cp-losing move a meaningful fraction of the time…
  assert.ok(rate(low, (i) => i >= 4) > 0.05, 'low rating should blunder sometimes');
  // …a 1900 almost never does (its lapse cap is ~115cp), and errors are graded:
  assert.ok(rate(high, (i) => i >= 4) < 0.01, 'high rating must not blunder outright');
  assert.ok(rate(high, (i) => i === 1) > rate(high, (i) => i === 3), 'small errors outnumber big ones');
});

test('errors are graded, not engine-perfect-then-random', () => {
  const picks = sample(SPREAD, 1000, 30);
  const small = rate(picks, (i) => i === 1 || i === 2); // 30–80cp slips
  const large = rate(picks, (i) => i >= 4); // ≥300cp
  assert.ok(small > 0.1, `plenty of small inaccuracies (got ${small})`);
  assert.ok(large > 0, 'occasional large errors exist');
  assert.ok(small > large * 2, 'small errors dominate large ones');
});

test('lapse tier is pinned: rate tracks blunderChanceFor, errors are graded, tail mass exceeds pure softmax', () => {
  const ply = 30;
  const low = samplePicks(SPREAD, 600, ply, 20000);

  // (a) The viaLapse rate matches the configured chance per band.
  const lapseRate = low.filter((p) => p.viaLapse).length / low.length;
  assert.ok(lapseRate > 0.1 && lapseRate < 0.17, `600 lapse rate tracks ~13% (got ${lapseRate})`);
  const high = samplePicks(SPREAD, 1900, ply, 8000);
  const highRate = high.filter((p) => p.viaLapse).length / high.length;
  assert.ok(highRate > 0 && highRate < 0.02, `1900 lapses are rare but present (got ${highRate})`);

  // (b) Lapse errors are graded: small slips outnumber near-cap throws.
  const lapses = low.filter((p) => p.viaLapse);
  const smallLapses = lapses.filter((p) => p.lossCp <= 100).length;
  const bigLapses = lapses.filter((p) => p.lossCp >= 300).length;
  assert.ok(bigLapses > 0, 'near-cap lapses occur');
  assert.ok(smallLapses > bigLapses, 'small lapses outnumber near-cap ones');

  // (c) Differential: the tier adds ≥300cp tail mass beyond what the pure
  //     softmax predicts — disabling the tier fails this even if viaLapse lies.
  const t = temperatureFor(600);
  const w = SPREAD.map((c) => Math.exp(-(20 - c.cp) / t));
  const softmaxTail = (w[4]! + w[5]!) / w.reduce((a, b) => a + b, 0);
  const observedTail = low.filter((p) => p.lossCp >= 300).length / low.length;
  assert.ok(
    observedTail > softmaxTail + 0.01,
    `lapse tier must add blunder mass beyond softmax (softmax ${softmaxTail.toFixed(3)}, observed ${observedTail.toFixed(3)})`,
  );
});

test('a won position is never thrown into a loss at club level and above', () => {
  const winning: HumanCandidate[] = [
    { uci: 'a1a2', cp: 620 }, // clearly winning
    { uci: 'b1b2', cp: 560 },
    { uci: 'c1c2', cp: -140 }, // throws the game (loss 760)
  ];
  for (const rating of [1300, 1600, 2000]) {
    const picks = sample(winning, rating, 40, 5000);
    assert.equal(rate(picks, (i) => i === 2), 0, `rating ${rating} must not throw a won game`);
  }
  // …while a true beginner still can (no hard cap below 1000):
  const beginner = sample(winning, 700, 40, 8000);
  assert.ok(rate(beginner, (i) => i === 2) > 0, 'a 700 can still throw a won game');
});

test('mate-losing moves are never played above ~1200 when a safe move exists', () => {
  const cands: HumanCandidate[] = [
    { uci: 'a1a2', cp: 40 },
    { uci: 'b1b2', cp: -99800 }, // walks into mate
  ];
  const picks = sample(cands, 1250, 40, 6000);
  assert.equal(rate(picks, (i) => i === 1), 0);
  // The only move being mate-losing must still return a move.
  const only = pickHumanMove([{ uci: 'a1a2', cp: -99900 }], { rating: 1500, ply: 40, rng: mulberry32(1) });
  assert.equal(only.uci, 'a1a2');
});

test('forced mates: a crushing alternative is a human choice, and the rails have no cliff at 1000', () => {
  const cands: HumanCandidate[] = [
    { uci: 'a1a2', cp: 99800 }, // mate in 2
    { uci: 'b1b2', cp: 1600 }, // completely winning queen-grab
    { uci: 'c1c2', cp: 500 }, // merely winning
    { uci: 'd1d2', cp: -400 }, // actually bad
  ];
  // Even strong bots may take the crushing move instead of the fastest mate —
  // humans convert material; only engines insist on the mating line…
  const strong = sample(cands, 1800, 40, 6000);
  assert.ok(rate(strong, (i) => i === 1) > 0.1, 'crushing alternative stays playable at 1800');
  // …but clearly inferior moves are still railed off.
  assert.equal(rate(strong, (i) => i >= 2), 0, 'worse moves stay excluded at 1800');
  // The rails phase in across 900-1100 instead of switching at exactly 1000.
  const missRate = (r: number) => rate(sample(cands, r, 40, 6000), (i) => i !== 0);
  assert.ok(missRate(950) > 0, 'sub-1000 can still miss the mate');
  assert.ok(missRate(1001) > 0, 'no engine-perfect cliff just above 1000');
});

test('opening variety: near-equal moves all get played; fades by the middlegame', () => {
  const nearEqual: HumanCandidate[] = [
    { uci: 'e2e4', cp: 25 },
    { uci: 'd2d4', cp: 15 }, // -10
    { uci: 'c2c4', cp: -5 }, // -30
    { uci: 'g1h3', cp: -180 }, // clearly worse, not part of the "book" set
  ];
  const opening = sample(nearEqual, 2000, 2);
  const distinct = new Set(opening);
  assert.ok(distinct.has(0) && distinct.has(1) && distinct.has(2), 'all near-equal moves appear in the opening');
  assert.ok(rate(opening, (i) => i === 1) > 0.15, 'second move gets a real share');
  assert.equal(rate(opening, (i) => i === 3), 0, 'clearly worse moves are not part of the variety');
  const middlegame = sample(nearEqual, 2000, 30);
  assert.ok(rate(opening, (i) => i === 2) > rate(middlegame, (i) => i === 2) + 0.05, 'variety fades outside the opening');
  assert.ok(rate(opening, (i) => i === 0) < rate(middlegame, (i) => i === 0));
});

test('repetition while winning is heavily penalised; harmless when not winning', () => {
  const cands: HumanCandidate[] = [
    { uci: 'a1a2', cp: 420, repeats: 2 }, // best but repeats a seen position
    { uci: 'b1b2', cp: 390, repeats: 0 },
  ];
  const winning = sample(cands, 1800, 40);
  assert.ok(rate(winning, (i) => i === 0) < 0.1, 'winning: must not shuffle into repetition');

  const level: HumanCandidate[] = [
    { uci: 'a1a2', cp: 0, repeats: 2 },
    { uci: 'b1b2', cp: -30, repeats: 0 },
  ];
  const equal = sample(level, 1800, 40);
  assert.ok(rate(equal, (i) => i === 0) > 0.5, 'equal position: repetition is a legitimate choice');
});

test('sampling is deterministic for a fixed seed', () => {
  const a = sample(SPREAD, 1200, 20, 200);
  const b = sample(SPREAD, 1200, 20, 200);
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// Search plan / helpers
// ---------------------------------------------------------------------------

test('searchPlanFor: shallow fixed depth below 1320, movetime above; MultiPV 6-8', () => {
  const low = searchPlanFor(600);
  assert.match(low.go, /^go depth [1-6]$/);
  const mid = searchPlanFor(1500, 700);
  assert.equal(mid.go, 'go movetime 700');
  const high = searchPlanFor(1900);
  assert.equal(high.go, 'go movetime 600');
  for (const r of [500, 900, 1300, 1700, 2100]) {
    const { multiPv } = searchPlanFor(r);
    assert.ok(multiPv >= 6 && multiPv <= 12, `MultiPV in range at ${r}`);
  }
  // Sub-1000 pools are widened so genuinely losing moves are reachable.
  assert.ok(searchPlanFor(800).multiPv > searchPlanFor(1200).multiPv);
  // Depth grows with rating within the beginner band.
  const d = (r: number) => Number(searchPlanFor(r).go.split(' ')[2]);
  assert.ok(d(500) < d(900) && d(900) < d(1319));
});

test('plyOfFen derives plies from turn + fullmove', () => {
  assert.equal(plyOfFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), 0);
  assert.equal(plyOfFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'), 1);
  assert.equal(plyOfFen('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'), 4);
});

test('annotateRepeats counts how often a candidate recreates a seen position', () => {
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  // Position after 1.Nf3 Nf6 2.Ng1 Ng8 — back to the start; Nf3 would recreate
  // the position after 1.Nf3 (seen once).
  const seen = [
    start,
    'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1', // after 1.Nf3
    'rnbqkb1r/pppppppp/5n2/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 2 2',
    'rnbqkb1r/pppppppp/5n2/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 3 2',
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 4 3', // start again
  ];
  const fen = seen[4]!;
  const out = annotateRepeats(fen, [{ uci: 'g1f3', cp: 20 }, { uci: 'e2e4', cp: 25 }], seen);
  assert.equal(out[0]!.repeats, 1, 'Nf3 recreates the after-1.Nf3 position');
  assert.equal(out[1]!.repeats, 0, 'e4 reaches a fresh position');
});

test('pickMaiaVariety: near-top sampling early, argmax later / when degenerate', () => {
  const cands = [{ cp: 30 }, { cp: 10 }, { cp: -10 }, { cp: -200 }];
  const rng = mulberry32(42);
  const early = new Set<number>();
  for (let i = 0; i < 300; i++) early.add(pickMaiaVariety(cands, 4, rng));
  assert.ok(early.size > 1, 'opening plies vary the move');
  assert.ok(!early.has(3), 'moves outside the near-top window are never played');
  for (let i = 0; i < 50; i++) {
    assert.equal(pickMaiaVariety(cands, 20, rng), 0, 'past the opening: rank-1 policy move');
  }
  assert.equal(pickMaiaVariety([{ cp: 5 }], 2, rng), 0, 'single candidate');
});
