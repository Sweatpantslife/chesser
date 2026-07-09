export interface EndgameStudy {
  id: string;
  name: string;
  /** You play this side; Stockfish defends with the other. */
  youPlay: 'white' | 'black';
  /** 'win' = deliver checkmate / queen; 'draw' = hold the balance. */
  goal: 'win' | 'draw';
  fen: string;
  technique: string;
}

export const ENDGAMES: EndgameStudy[] = [
  {
    id: 'kq-vs-k',
    name: 'Queen vs King',
    youPlay: 'white',
    goal: 'win',
    fen: '4k3/8/8/8/8/8/3QK3/8 w - - 0 1',
    technique:
      'Use the queen a knight’s-move away to herd the king to the edge, bring your own king up, then mate. Watch for stalemate!',
  },
  {
    id: 'kr-vs-k',
    name: 'Rook vs King',
    youPlay: 'white',
    goal: 'win',
    fen: '4k3/8/8/8/8/8/4K3/3R4 w - - 0 1',
    technique: 'Box the king with the rook, march your king up to take the opposition, then drive it to the back rank.',
  },
  {
    id: 'two-rooks',
    name: 'Two Rooks — Ladder Mate',
    youPlay: 'white',
    goal: 'win',
    fen: '4k3/8/8/8/8/8/R6R/4K3 w - - 0 1',
    technique: 'The “lawnmower”: cut the king off rank by rank, lifting each rook away when attacked.',
  },
  {
    id: 'two-bishops',
    name: 'Two Bishops Mate',
    youPlay: 'white',
    goal: 'win',
    fen: '4k3/8/8/8/8/8/3BB3/4K3 w - - 0 1',
    technique: 'Drive the king to a corner with the bishops working on adjacent diagonals, king in support.',
  },
  {
    id: 'bishop-knight',
    name: 'Bishop & Knight Mate',
    youPlay: 'white',
    goal: 'win',
    fen: '4k3/8/8/8/8/5N2/4B3/4K3 w - - 0 1',
    technique: 'The hardest basic mate: force the king to a corner the bishop controls using the “W” knight manoeuvre.',
  },
  {
    id: 'kp-sixth',
    name: 'King & Pawn — King on the 6th',
    youPlay: 'white',
    goal: 'win',
    fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1',
    technique: 'With your king on the sixth rank in front of the pawn, it wins no matter whose move it is. Take the opposition.',
  },
  {
    id: 'connected-passers',
    name: 'Connected Passed Pawns',
    youPlay: 'white',
    goal: 'win',
    fen: '4k3/8/8/8/8/3PP3/8/4K3 w - - 0 1',
    technique: 'Advance the pawns side by side, supported by the king, until one queens.',
  },
  {
    id: 'lucena',
    name: 'Rook Endgame — Lucena (“building a bridge”)',
    youPlay: 'white',
    goal: 'win',
    fen: '3K4/3P1k2/8/8/8/8/7r/4R3 w - - 0 1',
    technique:
      'The most important rook ending. Free your king with a check, then build a bridge on the 4th rank to shelter from checks and promote.',
  },
  {
    id: 'q-vs-r',
    name: 'Queen vs Rook',
    youPlay: 'white',
    goal: 'win',
    // Rook defended by its king (the old FEN started with White in check and
    // the rook en prise to Kxe2 — the drill was over on move one).
    fen: '6k1/5r2/8/3Q4/8/8/8/6K1 w - - 0 1',
    technique: 'Win the rook or mate by forcing the defender into checks and forks (the Philidor technique).',
  },
  {
    id: 'q-vs-pawn',
    name: 'Queen vs Pawn on the 7th',
    youPlay: 'white',
    goal: 'win',
    fen: '8/8/8/8/8/3k4/3p4/3KQ3 w - - 0 1',
    technique: 'For a centre pawn, repeatedly check and approach: each time the defender must block, you gain a tempo to bring your king.',
  },
  {
    id: 'rook-draw',
    name: 'Rook Endgame — Defensive Draw',
    youPlay: 'black',
    goal: 'draw',
    // Textbook Philidor position (the old FEN started with Black in check,
    // able to simply take the hanging rook — the advertised defence never arose).
    fen: '4k3/8/r7/4K3/4P3/8/8/7R b - - 0 1',
    technique:
      'The Philidor defence: keep your rook on your third rank so the king can never come forward; the moment the pawn advances, drop the rook behind for endless checks. Hold it.',
  },
  {
    id: 'two-knights',
    name: 'Two Knights Cannot Mate (Draw)',
    youPlay: 'black',
    goal: 'draw',
    fen: '4k3/8/4K3/8/8/5N2/4N3/8 b - - 0 1',
    technique: 'Two knights cannot force mate against a lone king. Keep your king central and out of the corners to hold the draw.',
  },
  {
    id: 'wrong-bishop',
    name: 'Wrong Bishop & Rook Pawn (Draw)',
    youPlay: 'black',
    goal: 'draw',
    fen: '7k/8/6KP/8/8/8/8/5B2 b - - 0 1',
    technique: 'The bishop is the wrong colour to control the queening square. Sit in the corner — the stronger side cannot make progress.',
  },
];
