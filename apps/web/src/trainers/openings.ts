export interface OpeningLine {
  id: string;
  name: string;
  eco: string;
  /** The side you train (whose moves you must recall). */
  side: 'white' | 'black';
  /** Main line in SAN from the initial position. */
  moves: string[];
  idea: string;
}

export const OPENING_LINES: OpeningLine[] = [
  {
    id: 'italian',
    name: 'Italian Game — Giuoco Pianissimo',
    eco: 'C50',
    side: 'white',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O'],
    idea: 'Slow build-up: clamp the centre with c3/d3, castle, then expand with Nbd2–f1–g3 and d4.',
  },
  {
    id: 'ruy-lopez',
    name: 'Ruy Lopez — Closed',
    eco: 'C84',
    side: 'white',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O'],
    idea: 'Pressure e5 with Bb5; after a6/b5 retreat to b3 and prepare d4 with c3 and Nbd2.',
  },
  {
    id: 'scotch',
    name: 'Scotch Game',
    eco: 'C45',
    side: 'white',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Bc5', 'Be3', 'Qf6', 'c3', 'Nge7'],
    idea: 'Open the centre early; trade on d4 and develop quickly with a small space edge.',
  },
  {
    id: 'qgd',
    name: "Queen's Gambit Declined",
    eco: 'D37',
    side: 'white',
    moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Nf3', 'Be7', 'Bf4', 'O-O', 'e3', 'c5'],
    idea: 'Classical centre. Develop harmoniously and aim for the minority attack or e4 break.',
  },
  {
    id: 'london',
    name: 'London System',
    eco: 'D02',
    side: 'white',
    moves: ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'e6', 'e3', 'c5', 'c3', 'Nc6', 'Nbd2', 'Bd6'],
    idea: 'A solid, easy-to-learn setup: Bf4, e3, c3, Nbd2. Reliable structure against almost anything.',
  },
  {
    id: 'najdorf',
    name: 'Sicilian Defence — Najdorf',
    eco: 'B90',
    side: 'black',
    moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'],
    idea: 'The sharpest Sicilian. ...a6 prepares ...e5 or ...b5 and keeps maximum flexibility.',
  },
  {
    id: 'caro-kann',
    name: 'Caro-Kann — Classical',
    eco: 'B18',
    side: 'black',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Nf3', 'Nd7'],
    idea: 'Solid and sound: trade the bad bishop early with ...Bf5–g6 and build a sturdy structure.',
  },
  {
    id: 'kings-indian',
    name: "King's Indian Defence",
    eco: 'E92',
    side: 'black',
    moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'e5'],
    idea: 'Cede the centre, then strike back with ...e5 and a kingside pawn storm.',
  },
  {
    id: 'slav',
    name: 'Slav Defence',
    eco: 'D15',
    side: 'black',
    moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'a4', 'Bf5'],
    idea: "Support d5 with ...c6 keeping the light-squared bishop free; grab c4 and develop ...Bf5.",
  },
  {
    id: 'french-winawer',
    name: 'French Defence — Winawer',
    eco: 'C18',
    side: 'black',
    moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4', 'e5', 'c5', 'a3', 'Bxc3+', 'bxc3', 'Ne7'],
    idea: 'Pin and trade on c3 to wreck White’s queenside pawns, then pressure the centre with ...c5.',
  },
];
