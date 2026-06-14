// Checkmate-pattern library. Each pattern is a named mating motif with one or
// more drill positions. A drill is solved by finding `solution[0]` (the key
// move); the rest of the forced line is then played out automatically, exactly
// like the tactics trainer. Every FEN and mating line here is validated with
// chess.js (see scripts/validate-trainers.mjs) so the drills are always sound.

export interface MateDrill {
  id: string;
  fen: string;
  /** UCI moves; solution[0] is the key move, the rest is the forced mate. */
  solution: string[];
  turn: 'white' | 'black';
  /** Number of the mover's moves to deliver mate. */
  mateIn: number;
}

export interface MatePattern {
  id: string;
  name: string;
  /** Also-known-as / alternate names. */
  aka?: string;
  /** One-line description of the motif and how it works. */
  description: string;
  drills: MateDrill[];
}

export const MATE_PATTERNS: MatePattern[] = [
  {
    id: 'back-rank',
    name: 'Back-rank mate',
    description:
      "A rook or queen mates the king on its first rank, where its own pawns block every escape. The classic reason to make 'luft'.",
    drills: [
      { id: 'backrank-1', fen: '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', solution: ['e1e8'], turn: 'white', mateIn: 1 },
    ],
  },
  {
    id: 'smothered',
    name: 'Smothered mate',
    aka: "Philidor's legacy",
    description:
      'A knight mates a king hemmed in entirely by its own pieces. Often set up by a queen sacrifice that forces the king into the corner.',
    drills: [
      { id: 'smothered-1', fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', solution: ['g5f7'], turn: 'white', mateIn: 1 },
      {
        id: 'smothered-2',
        fen: '5r1k/6pp/4Q2N/8/8/8/8/K7 w - - 0 1',
        solution: ['e6g8', 'f8g8', 'h6f7'],
        turn: 'white',
        mateIn: 2,
      },
    ],
  },
  {
    id: 'anastasia',
    name: "Anastasia's mate",
    description:
      "A knight (on e7/e2) covers the g-file flight squares while a rook delivers mate along the h-file. The king is trapped against the edge.",
    drills: [
      { id: 'anastasia-1', fen: '8/4N1pk/8/8/8/8/8/K3R3 w - - 0 1', solution: ['e1h1'], turn: 'white', mateIn: 1 },
    ],
  },
  {
    id: 'arabian',
    name: 'Arabian mate',
    description:
      'One of the oldest known mates: a knight and rook combine in the corner. The rook gives mate, defended by the knight, which also guards the only flight.',
    drills: [{ id: 'arabian-1', fen: '7k/R7/5N2/8/8/8/8/K7 w - - 0 1', solution: ['a7h7'], turn: 'white', mateIn: 1 }],
  },
  {
    id: 'greco',
    name: "Greco's mate",
    description:
      'A bishop controls the long diagonal (covering the king’s only escape) while a rook or queen mates down the h-file, with a friendly pawn sealing g7.',
    drills: [{ id: 'greco-1', fen: '7k/6p1/8/8/8/8/B7/K3R3 w - - 0 1', solution: ['e1h1'], turn: 'white', mateIn: 1 }],
  },
  {
    id: 'damiano',
    name: "Damiano's mate",
    description:
      'A pawn on the sixth rank supports a queen that mates on the rook-file or knight-file beside the cornered king. A recurring kingside-attack finish.',
    drills: [{ id: 'damiano-1', fen: '7k/5p2/6P1/8/8/8/8/K6Q w - - 0 1', solution: ['h1h7'], turn: 'white', mateIn: 1 }],
  },
  {
    id: 'epaulette',
    name: 'Epaulette mate',
    description:
      "The king is flanked by its own rooks (the 'epaulettes') on the same rank, so a supported queen mates from in front with no escape.",
    drills: [{ id: 'epaulette-1', fen: '3rkr2/8/3P4/8/8/8/8/4Q2K w - - 0 1', solution: ['e1e7'], turn: 'white', mateIn: 1 }],
  },
  {
    id: 'boden',
    name: "Boden's mate",
    description:
      'Two bishops on crossing diagonals mate a king (typically after queenside castling) whose escape squares are blocked by its own pieces.',
    drills: [{ id: 'boden-1', fen: '2kr4/B1pp4/8/8/2B5/8/8/7K w - - 0 1', solution: ['c4a6'], turn: 'white', mateIn: 1 }],
  },
  {
    id: 'lawnmower',
    name: 'Lawnmower mate',
    aka: 'Ladder / two-rook mate',
    description:
      'Two rooks drive the king to the edge, one cutting it off on the file while the other delivers mate along the back rank.',
    drills: [{ id: 'lawnmower-1', fen: 'k7/6R1/8/8/8/8/8/6KR w - - 0 1', solution: ['h1h8'], turn: 'white', mateIn: 1 }],
  },
  {
    id: 'scholars',
    name: "Scholar's mate",
    description:
      'The beginner’s four-move attack: the queen, supported by the bishop on c4, captures on f7 where the king cannot recapture.',
    drills: [
      {
        id: 'scholars-1',
        fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
        solution: ['h5f7'],
        turn: 'white',
        mateIn: 1,
      },
    ],
  },
];

/** Flat list of every drill, tagged with its parent pattern. */
export const MATE_DRILLS: (MateDrill & { patternId: string; patternName: string })[] = MATE_PATTERNS.flatMap((p) =>
  p.drills.map((d) => ({ ...d, patternId: p.id, patternName: p.name })),
);

export const MATE_DRILL_IDS = MATE_DRILLS.map((d) => d.id);
