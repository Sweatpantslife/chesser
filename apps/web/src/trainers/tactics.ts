// Curated tactics puzzles.
//
// Two sources, one export:
//  - LEGACY_PUZZLES: 15 hand-audited positions from the original generated set
//    (stable ids t2…t49 — kept verbatim so existing SRS decks keyed
//    'tactics:<id>' retain their history).
//  - CORE_PUZZLES: an embedded core sample of the Lichess open puzzle database
//    (CC0), bundled via ./tacticsCore.json so the trainer works fully offline.
//    Regenerate with scripts/import-lichess-puzzles.mjs — see
//    docs/puzzles-dataset.md. The much larger full set lives in
//    public/puzzles/band-*.json (same row format, lazily fetchable).
//
// Every bundled puzzle is replay-validated by scripts/validate-puzzles.mts
// (wired into `pnpm test`).
import coreRowsJson from './tacticsCore.json';

export type Difficulty = 'easy' | 'medium' | 'hard';
export interface Puzzle {
  id: string;
  fen: string;
  /** UCI moves; solution[0] is the key move, the rest is the main line. */
  solution: string[];
  theme: string;
  difficulty: Difficulty;
  turn: 'white' | 'black';
  /** Lichess puzzle rating — imported (lc_*) puzzles only. */
  rating?: number;
  /** Full Lichess theme tags — imported (lc_*) puzzles only. */
  themes?: string[];
}

/**
 * Compact storage row used by tacticsCore.json and public/puzzles/band-*.json:
 * [id, fen, moves, rating, themes]
 *  - fen is the position AFTER Lichess's setup move (the solver is to move)
 *  - moves: space-joined UCI solution; moves[0] is the solver's key move
 *  - themes: space-joined Lichess theme tags
 */
export type PuzzleRow = [string, string, string, number, string];

/** Rating-band layout of the full dataset in public/puzzles/. This is the
 *  client's source of truth for which files exist; scripts/validate-puzzles.mts
 *  asserts the generated index.json matches it, so a re-import that changes
 *  the layout fails the test gate instead of 404ing at runtime. */
export interface PuzzleBand {
  min: number;
  max: number;
  file: string;
}
export const PUZZLE_BANDS: PuzzleBand[] = Array.from({ length: 10 }, (_, i) => {
  const min = 600 + i * 200;
  return { min, max: min + 200, file: `band-${String(min).padStart(4, '0')}.json` };
});

/** Rating → difficulty (aligned with lib/puzzleRating's 1100/1500/1900 bases). */
export function difficultyForRating(rating: number): Difficulty {
  return rating < 1300 ? 'easy' : rating < 1800 ? 'medium' : 'hard';
}

/** Display label per theme tag, most specific first. The first tag of
 *  THEME_PRIORITY found in a puzzle's themes is its primary/display theme.
 *  KEEP IN SYNC with THEME_PRIORITY in scripts/import-lichess-puzzles.mjs. */
const THEME_PRIORITY: [string, string][] = [
  ['smotheredMate', 'Smothered mate'],
  ['backRankMate', 'Back-rank mate'],
  ['arabianMate', 'Arabian mate'],
  ['anastasiaMate', "Anastasia's mate"],
  ['bodenMate', "Boden's mate"],
  ['doubleBishopMate', 'Two-bishop mate'],
  ['hookMate', 'Hook mate'],
  ['dovetailMate', 'Dovetail mate'],
  ['killBoxMate', 'Kill-box mate'],
  ['vukovicMate', 'Vukovic mate'],
  ['mateIn1', 'Mate in 1'],
  ['mateIn2', 'Mate in 2'],
  ['mateIn3', 'Mate in 3'],
  ['mateIn4', 'Mate in 4'],
  ['mateIn5', 'Mate in 5'],
  ['mate', 'Checkmate'],
  ['doubleCheck', 'Double check'],
  ['discoveredAttack', 'Discovered attack'],
  ['fork', 'Fork'],
  ['pin', 'Pin'],
  ['skewer', 'Skewer'],
  ['deflection', 'Deflection'],
  ['attraction', 'Attraction'],
  ['sacrifice', 'Sacrifice'],
  ['interference', 'Interference'],
  ['intermezzo', 'Intermezzo'],
  ['clearance', 'Clearance'],
  ['xRayAttack', 'X-ray attack'],
  ['capturingDefender', 'Capture the defender'],
  ['hangingPiece', 'Hanging piece'],
  ['trappedPiece', 'Trapped piece'],
  ['underPromotion', 'Underpromotion'],
  ['promotion', 'Promotion'],
  ['enPassant', 'En passant'],
  ['zugzwang', 'Zugzwang'],
  ['quietMove', 'Quiet move'],
  ['defensiveMove', 'Defensive move'],
  ['exposedKing', 'Exposed king'],
  ['kingsideAttack', 'Kingside attack'],
  ['queensideAttack', 'Queenside attack'],
  ['attackingF2F7', 'f2/f7 attack'],
  ['advancedPawn', 'Advanced pawn'],
  ['endgame', 'Endgame'],
];

export function themeLabelOf(themes: string[]): string {
  for (const [tag, label] of THEME_PRIORITY) if (themes.includes(tag)) return label;
  return 'Tactic';
}

/** Decode a compact storage row into a Puzzle (shared by the embedded core
 *  set and any lazy loader of public/puzzles/band-*.json). */
export function decodePuzzleRow(row: PuzzleRow): Puzzle {
  const [id, fen, moves, rating, themes] = row;
  const themeTags = themes ? themes.split(' ') : [];
  return {
    id,
    fen,
    solution: moves.split(' '),
    theme: themeLabelOf(themeTags),
    difficulty: difficultyForRating(rating),
    turn: fen.split(' ')[1] === 'b' ? 'black' : 'white',
    rating,
    themes: themeTags,
  };
}

/** Embedded Lichess core set (~1500 puzzles across all rating bands/themes). */
export const CORE_PUZZLES: Puzzle[] = (coreRowsJson as unknown as PuzzleRow[]).map(decodePuzzleRow);

/** Hand-audited survivors of the original generated set (engine-sound). */
const LEGACY_PUZZLES: Puzzle[] = [
  {
    "id": "t2",
    "fen": "rnbqkbnr/ppppp2p/8/5pp1/4P3/6PB/PPPP1P1P/RNBQK1NR w KQkq - 0 4",
    "solution": [
      "d1h5"
    ],
    "theme": "Mate in 1",
    "difficulty": "easy",
    "turn": "white"
  },
  {
    "id": "t7",
    "fen": "1r6/3n2Q1/3k1n2/3b3p/1pp5/2b2B1P/5PP1/3R2K1 w - - 0 28",
    "solution": [
      "f3d5",
      "f6d5",
      "d1d5",
      "d6d5",
      "g7d7",
      "d5e4"
    ],
    "theme": "Winning tactic",
    "difficulty": "hard",
    "turn": "white"
  },
  {
    "id": "t8",
    "fen": "1r6/3n2Q1/3k4/3n3p/1pp5/2b4P/5PP1/3R2K1 w - - 0 29",
    "solution": [
      "d1d5",
      "d6d5",
      "g7d7",
      "d5e4",
      "d7c7",
      "e4d3"
    ],
    "theme": "Winning tactic",
    "difficulty": "medium",
    "turn": "white"
  },
  {
    "id": "t9",
    "fen": "1r6/3n2Q1/8/3k3p/1pp5/2b4P/5PP1/6K1 w - - 0 30",
    "solution": [
      "g7d7",
      "d5e4",
      "d7c7",
      "b8h8",
      "c7c4",
      "e4e5"
    ],
    "theme": "Winning tactic",
    "difficulty": "medium",
    "turn": "white"
  },
  {
    "id": "t11",
    "fen": "6k1/1q1p3p/4p3/p1p1P1bp/2P2r2/1PN1R1PP/3Q4/6K1 w - - 0 32",
    "solution": [
      "g3f4",
      "g5f4",
      "c3e2",
      "b7b4",
      "e3g3",
      "f4g3"
    ],
    "theme": "Winning tactic",
    "difficulty": "medium",
    "turn": "white"
  },
  {
    "id": "t16",
    "fen": "r3rbk1/3p1ppp/b4n2/qP1P2P1/8/2N2B1P/1nQN1P2/R4K1R b - - 0 25",
    "solution": [
      "a5a1",
      "f1g2",
      "a1a3",
      "g5f6",
      "a6b7",
      "d2e4"
    ],
    "theme": "Winning tactic",
    "difficulty": "medium",
    "turn": "black"
  },
  {
    "id": "t20",
    "fen": "r1b1kbnr/ppp3p1/3pp3/3Np2q/4P2p/3P1N2/PPP2P2/R1BQK1R1 w Qkq - 0 14",
    "solution": [
      "d5c7",
      "e8d8",
      "c7a8",
      "g8f6",
      "c1e3",
      "h4h3"
    ],
    "theme": "Winning tactic",
    "difficulty": "hard",
    "turn": "white"
  },
  {
    "id": "t22",
    "fen": "r2q1r1k/1pp1bpp1/p1n4n/3NP2p/4P3/1QP1Bb1P/PP4P1/2KR1B1R w - - 0 14",
    "solution": [
      "g2f3",
      "c6e5",
      "f3f4",
      "e5d7",
      "b3b7",
      "e7c5"
    ],
    "theme": "Winning tactic",
    "difficulty": "medium",
    "turn": "white"
  },
  {
    "id": "t36",
    "fen": "6k1/8/p1p1pp1p/1p1pPB1q/1P1P2p1/P1P2rP1/3Q1PK1/5R2 b - - 0 32",
    "solution": [
      "h5h3",
      "g2g1",
      "f3f5",
      "d2d3",
      "f6e5",
      "f1e1"
    ],
    "theme": "Winning tactic",
    "difficulty": "medium",
    "turn": "black"
  },
  {
    "id": "t38",
    "fen": "rn1qkb1r/1ppbpppp/5n2/p2P4/Q2P4/6P1/PP2PPBP/RNB2RK1 b kq - 0 8",
    "solution": [
      "d7a4",
      "b1c3",
      "a4d7",
      "e2e4",
      "e7e6",
      "d5e6"
    ],
    "theme": "Winning tactic",
    "difficulty": "easy",
    "turn": "black"
  },
  {
    "id": "t39",
    "fen": "rn1qkb1r/1ppb1ppp/4p3/p2B4/3P4/1Q4P1/PP2PP1P/RNB2RK1 b kq - 0 10",
    "solution": [
      "e6d5",
      "b3d5",
      "d7c6",
      "d5e5",
      "d8e7",
      "e5f4"
    ],
    "theme": "Winning tactic",
    "difficulty": "medium",
    "turn": "black"
  },
  {
    "id": "t43",
    "fen": "3qk2r/3nbppp/p3p3/1p6/3nQBP1/P1p4P/5P2/RN2K1NR b KQk - 1 16",
    "solution": [
      "d7c5",
      "f4c7",
      "c5e4",
      "c7d8",
      "e8d8",
      "b1c3"
    ],
    "theme": "Winning tactic",
    "difficulty": "medium",
    "turn": "black"
  },
  {
    "id": "t44",
    "fen": "7r/4kppp/p3pb2/1p6/4N1P1/P4n1P/5P2/RN3K1R b - - 0 22",
    "solution": [
      "f6a1",
      "f1g2",
      "f3h4",
      "g2g3",
      "h4g6",
      "f2f4"
    ],
    "theme": "Winning tactic",
    "difficulty": "medium",
    "turn": "black"
  },
  {
    "id": "t45",
    "fen": "2r4k/p2p1p1n/1p2r3/1b6/Pn1p3P/6P1/1P1B1PBR/R5K1 b - - 1 26",
    "solution": [
      "b4c2",
      "a1c1",
      "b5a4",
      "g2d5",
      "e6e7",
      "f2f3"
    ],
    "theme": "Winning tactic",
    "difficulty": "medium",
    "turn": "black"
  },
  {
    "id": "t49",
    "fen": "r1b2rk1/pPp3bp/3p4/3Pp3/2B2B2/2PP1R2/1P3P2/R3K3 b - - 0 27",
    "solution": [
      "c8b7",
      "d3d4",
      "f8f4",
      "f3f4",
      "e5f4",
      "b2b4"
    ],
    "theme": "Winning tactic",
    "difficulty": "medium",
    "turn": "black"
  }
];

export const PUZZLES: Puzzle[] = [...LEGACY_PUZZLES, ...CORE_PUZZLES];
