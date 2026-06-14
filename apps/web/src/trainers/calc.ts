// Calculation / visualization puzzles. The board is shown briefly, then the
// pieces are hidden and a forced line is announced in notation; the trainee
// must visualize it and answer a question about the final position. Every line
// is validated for legality and every answer is recomputed from the final
// position (see scripts/validate-trainers.mjs).

export interface CalcPuzzle {
  id: string;
  /** Starting position (shown, then hidden). */
  fen: string;
  /** The line to visualize, in SAN. */
  line: string[];
  /** Short framing shown above the move list. */
  prompt: string;
  question: string;
  choices: string[];
  /** Index into `choices`. */
  answer: number;
  theme: string;
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const CALC_PUZZLES: CalcPuzzle[] = [
  {
    id: 'calc-spanish',
    fen: START,
    line: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
    prompt: 'The Ruy Lopez opening.',
    question: "Where is White's light-squared bishop after these moves?",
    choices: ['b5', 'c4', 'a4', 'f1'],
    answer: 0,
    theme: 'Piece tracking',
  },
  {
    id: 'calc-evans',
    fen: START,
    line: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4', 'Bxb4', 'c3', 'Ba5'],
    prompt: 'The Evans Gambit.',
    question: "Which square does Black's dark-squared bishop end on?",
    choices: ['a5', 'b4', 'c5', 'b6'],
    answer: 0,
    theme: 'Piece tracking',
  },
  {
    id: 'calc-scholars',
    fen: START,
    line: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'],
    prompt: "Black just played 3...Nf6??",
    question: 'What is the result of the final move?',
    choices: ['Checkmate', 'Check only', 'Wins the queen', 'Nothing special'],
    answer: 0,
    theme: 'Visualize the mate',
  },
  {
    id: 'calc-knight-tour',
    fen: '7k/8/8/8/8/8/8/N6K w - - 0 1',
    line: ['Nb3', 'Kh7', 'Nd4', 'Kh8', 'Nf5', 'Kh7', 'Nd6', 'Kh8'],
    prompt: 'Follow the knight only — ignore the king shuffles.',
    question: 'Which square is the knight on at the end?',
    choices: ['d6', 'f5', 'd4', 'b3'],
    answer: 0,
    theme: 'Knight geometry',
  },
  {
    id: 'calc-castle',
    fen: START,
    line: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O'],
    prompt: 'The Queen’s Gambit Declined.',
    question: "After Black castles, which square is Black's king on?",
    choices: ['g8', 'e8', 'f8', 'h8'],
    answer: 0,
    theme: 'Castling',
  },
  {
    id: 'calc-smother',
    fen: '5r1k/6pp/4Q2N/8/8/8/8/K7 w - - 0 1',
    line: ['Qg8+', 'Rxg8', 'Nf7#'],
    prompt: 'A queen sacrifice forces the smothered mate.',
    question: 'Which square delivers the checkmate?',
    choices: ['f7', 'g8', 'h6', 'e6'],
    answer: 0,
    theme: 'Smothered mate',
  },
];

export const CALC_IDS = CALC_PUZZLES.map((c) => c.id);
