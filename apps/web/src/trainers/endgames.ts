export interface EndgameStudy {
  id: string;
  name: string;
  /** You play this side; Stockfish defends with the other. */
  youPlay: 'white' | 'black';
  /** 'win' = deliver checkmate; 'draw' = hold the balance. */
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
    id: 'q-vs-r',
    name: 'Queen vs Rook',
    youPlay: 'white',
    goal: 'win',
    fen: '4k3/8/8/8/8/8/4r3/3QK3 w - - 0 1',
    technique: 'Win the rook or mate by forcing the defender into checks and forks (the Philidor technique).',
  },
];
