// Anti-blunder "are you sure?" drills. Each position has one natural-looking
// move (`tempting`) that loses on the spot, a forcing `refutation` that proves
// it (every refutation here ends in checkmate, so it is fully verifiable — see
// scripts/validate-trainers.mjs), and a sound `best` reply. The trainer lets
// the user play any legal move but intercepts the tempting one with an
// "are you sure?" prompt — training the habit of a blunder-check before moving.

export interface BlunderPosition {
  id: string;
  fen: string;
  turn: 'white' | 'black';
  /** UCI of the natural-but-losing move. */
  tempting: string;
  /** UCI line that punishes `tempting` (starts with it); ends in mate. */
  refutation: string[];
  /** UCI of the recommended move (best[0]) plus any illustrative follow-up. */
  best: string[];
  theme: string;
  /** Shown on the "are you sure?" interception. */
  warning: string;
  /** Shown afterwards — the lesson. */
  explanation: string;
}

export const BLUNDER_POSITIONS: BlunderPosition[] = [
  {
    id: 'blunder-backrank-1',
    fen: '4r1k1/3p1ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
    turn: 'white',
    tempting: 'd1d7',
    refutation: ['d1d7', 'e8e1'],
    best: ['h2h3'],
    theme: 'Back rank',
    warning: 'Grabbing the pawn looks free — but what happens to your first rank?',
    explanation: 'Rxd7?? abandons the back rank and runs into …Re1#. Make luft with h3 first; the d7-pawn is going nowhere.',
  },
  {
    id: 'blunder-long-diagonal-1',
    fen: '6k1/1b1p1ppp/8/8/8/7q/5PPP/3Q2K1 w - - 0 1',
    turn: 'white',
    tempting: 'd1d7',
    refutation: ['d1d7', 'h3g2'],
    best: ['d1f3'],
    theme: 'King safety',
    warning: 'The queen on h3 and bishop on b7 are both aiming at g2. Are you sure you can leave?',
    explanation: 'Qxd7?? ignores the threat and allows …Qxg2#, supported by the b7-bishop. Qf3 blocks the diagonal and defends g2.',
  },
  {
    id: 'blunder-backrank-2',
    fen: 'r5k1/5ppp/8/8/8/8/P4PPP/3R2K1 b - - 0 1',
    turn: 'black',
    tempting: 'a8a2',
    refutation: ['a8a2', 'd1d8'],
    best: ['h7h6'],
    theme: 'Back rank',
    warning: 'Snatching the a2-pawn pulls your rook off the eighth rank. Sure about that?',
    explanation: '…Rxa2?? lets White mate with Rd8#. Your own back rank is just as weak as White’s — play …h6 for luft.',
  },
  {
    id: 'blunder-queen-guard-1',
    fen: '6k1/p4ppp/8/8/4q3/8/5PPP/Q5K1 w - - 0 1',
    turn: 'white',
    tempting: 'a1a7',
    refutation: ['a1a7', 'e4e1'],
    best: ['h2h3'],
    theme: 'Overworked piece',
    warning: 'Your queen is the only thing guarding e1. Win a pawn, or keep the guard?',
    explanation: 'Qxa7?? deserts the first rank and allows …Qe1#. The queen is overworked — give the king luft with h3 instead.',
  },
  {
    id: 'blunder-smother-1',
    fen: '6rk/6pp/8/6N1/8/2q5/1P6/6K1 b - - 0 1',
    turn: 'black',
    tempting: 'c3b2',
    refutation: ['c3b2', 'g5f7'],
    best: ['h7h6'],
    theme: 'King safety',
    warning: 'That knight on g5 is eyeing f7, and your king is boxed in. Sure you want to grab the pawn?',
    explanation: '…Qxb2?? walks into the smothered mate Nf7#. Kick the knight with …h6 (or give the king a flight) before grabbing material.',
  },
];

export const BLUNDER_IDS = BLUNDER_POSITIONS.map((b) => b.id);
