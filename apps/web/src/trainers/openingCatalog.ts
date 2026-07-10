import type { OpeningLine } from './openings';

/**
 * The curated opening catalog for repertoire building: a starter set of
 * common openings, each with 2-4 named lines. Users pick lines from here
 * (per side) into "My repertoire" and drill them with spaced repetition.
 *
 * Conventions (enforced by openingCatalog.test.ts):
 * - every line is a legal SAN sequence from the initial position;
 * - white lines have odd length (end on the trainee's move), black lines
 *   even, so a drill always finishes on a move you had to recall;
 * - ids are unique across the whole catalog and never collide with the
 *   legacy starter-repertoire ids (they are prefixed per opening).
 */
export interface CatalogOpening {
  id: string;
  name: string;
  /** Representative ECO code for the opening family. */
  eco: string;
  /** The side whose moves you train. */
  side: 'white' | 'black';
  /** One-liner shown on the opening card in the browser. */
  summary: string;
  lines: OpeningLine[];
}

export const OPENING_CATALOG: CatalogOpening[] = [
  // ---------------- WHITE ----------------
  {
    id: 'italian',
    name: 'Italian Game',
    eco: 'C50',
    side: 'white',
    summary: 'Classical 1.e4 development: bishop to c4, quick castling, slow central build-up or a gambit punch.',
    lines: [
      {
        id: 'it-pianissimo',
        name: 'Giuoco Pianissimo',
        eco: 'C53',
        side: 'white',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O', 'Re1'],
        idea: 'Slow build-up: clamp the centre with c3/d3, castle, then expand with Nbd2-f1-g3 and a later d4.',
      },
      {
        id: 'it-two-knights',
        name: 'Two Knights — Quiet d3',
        eco: 'C55',
        side: 'white',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'd3', 'Be7', 'O-O', 'O-O', 'Re1', 'd6', 'c3'],
        idea: 'Against ...Nf6, avoid the Ng5 melee: play d3, castle and reach the same pianissimo structure.',
      },
      {
        id: 'it-evans',
        name: 'Evans Gambit',
        eco: 'C51',
        side: 'white',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4', 'Bxb4', 'c3', 'Ba5', 'd4', 'exd4', 'O-O'],
        idea: 'Sacrifice the b-pawn to build a big centre with c3/d4 and open lines while Black loses time.',
      },
    ],
  },
  {
    id: 'ruy-lopez',
    name: 'Ruy Lopez',
    eco: 'C60',
    side: 'white',
    summary: 'The Spanish: pressure e5 with Bb5 and squeeze Black over the whole game.',
    lines: [
      {
        id: 'rl-closed',
        name: 'Closed Main Line',
        eco: 'C84',
        side: 'white',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O', 'h3'],
        idea: 'Keep the tension: retreat to b3, prepare d4 with c3, and stop ...Bg4 with h3 before expanding.',
      },
      {
        id: 'rl-exchange',
        name: 'Exchange Variation',
        eco: 'C68',
        side: 'white',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6', 'O-O', 'f6', 'd4', 'exd4', 'Nxd4', 'c5', 'Nb3', 'Qxd1', 'Rxd1'],
        idea: 'Trade on c6 to damage the pawns, then head for a favourable endgame with the healthier majority.',
      },
    ],
  },
  {
    id: 'scotch',
    name: 'Scotch Game',
    eco: 'C45',
    side: 'white',
    summary: 'Open the centre on move 3 and develop with a small, lasting space edge.',
    lines: [
      {
        id: 'sc-classical',
        name: 'Classical ...Bc5',
        eco: 'C45',
        side: 'white',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Bc5', 'Be3', 'Qf6', 'c3', 'Nge7', 'Bc4'],
        idea: 'Meet ...Bc5 with Be3 and c3: blunt the bishop, keep the strong d4 knight, develop with tempo.',
      },
      {
        id: 'sc-four-knights',
        name: 'Scotch Four Knights',
        eco: 'C47',
        side: 'white',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Nf6', 'Nc3', 'Bb4', 'Nxc6', 'bxc6', 'Bd3', 'd5', 'exd5', 'cxd5', 'O-O'],
        idea: 'Simple and sound: trade on c6, castle fast and play against the hanging centre pawns.',
      },
    ],
  },
  {
    id: 'queens-gambit',
    name: "Queen's Gambit",
    eco: 'D06',
    side: 'white',
    summary: 'The classical 1.d4 d5 2.c4 — fight for the centre with a queenside lever.',
    lines: [
      {
        id: 'qg-exchange',
        name: 'QGD Exchange',
        eco: 'D35',
        side: 'white',
        moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'cxd5', 'exd5', 'Bg5', 'c6', 'e3', 'Be7', 'Bd3'],
        idea: 'Fix the structure early, then grind the minority attack with b4-b5 against the c6 pawn.',
      },
      {
        id: 'qg-accepted',
        name: 'QGA — Classical',
        eco: 'D20',
        side: 'white',
        moves: ['d4', 'd5', 'c4', 'dxc4', 'Nf3', 'Nf6', 'e3', 'e6', 'Bxc4', 'c5', 'O-O', 'a6', 'a4'],
        idea: 'Reclaim the pawn with Bxc4, clamp ...b5 with a4, and use the open lines for the pieces.',
      },
      {
        id: 'qg-vs-slav',
        name: 'vs Slav — Main Line',
        eco: 'D17',
        side: 'white',
        moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'a4', 'Bf5', 'e3', 'e6', 'Bxc4', 'Bb4', 'O-O'],
        idea: 'Against the Slav, a4 stops ...b5; regain c4 calmly and castle before pushing in the centre.',
      },
    ],
  },
  {
    id: 'london',
    name: 'London System',
    eco: 'D02',
    side: 'white',
    summary: 'One solid setup against nearly everything: d4, Nf3, Bf4, e3, c3.',
    lines: [
      {
        id: 'lo-main',
        name: 'Main Line vs ...d5',
        eco: 'D02',
        side: 'white',
        moves: ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'e6', 'e3', 'c5', 'c3', 'Nc6', 'Nbd2', 'Bd6', 'Bg3', 'O-O', 'Bd3'],
        idea: 'The classic pyramid: c3/e3 support d4, Bg3 keeps the good bishop, then castle and play Ne5.',
      },
      {
        id: 'lo-vs-kid',
        name: 'vs King’s Indian Setup',
        eco: 'A48',
        side: 'white',
        moves: ['d4', 'Nf6', 'Nf3', 'g6', 'Bf4', 'Bg7', 'e3', 'O-O', 'Be2', 'd6', 'h3', 'Nbd7', 'O-O'],
        idea: 'Same London recipe vs the fianchetto: h3 saves the bishop a retreat square, then castle and expand.',
      },
    ],
  },

  // ---------------- BLACK ----------------
  {
    id: 'sicilian',
    name: 'Sicilian Defence',
    eco: 'B20',
    side: 'black',
    summary: 'The fighting reply to 1.e4 — trade the c-pawn for central play and winning chances.',
    lines: [
      {
        id: 'si-najdorf',
        name: 'Najdorf',
        eco: 'B90',
        side: 'black',
        moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be2', 'e5', 'Nb3', 'Be7'],
        idea: 'The sharpest Sicilian: ...a6 keeps every plan open — ...e5 to seize the centre, ...b5 to expand.',
      },
      {
        id: 'si-dragon',
        name: 'Dragon',
        eco: 'B70',
        side: 'black',
        moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6', 'Be2', 'Bg7', 'O-O', 'O-O'],
        idea: 'Fianchetto the dragon bishop onto the long diagonal and counterattack down the c-file.',
      },
      {
        id: 'si-sveshnikov',
        name: 'Sveshnikov',
        eco: 'B33',
        side: 'black',
        moves: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'e5', 'Ndb5', 'd6'],
        idea: 'Accept a backward d-pawn and the d5 hole in return for the bishop pair and active pieces.',
      },
    ],
  },
  {
    id: 'french',
    name: 'French Defence',
    eco: 'C00',
    side: 'black',
    summary: 'Solid ...e6/...d5 chain — let White over-extend, then strike at the base with ...c5 and ...f6.',
    lines: [
      {
        id: 'fr-winawer',
        name: 'Winawer',
        eco: 'C18',
        side: 'black',
        moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4', 'e5', 'c5', 'a3', 'Bxc3+', 'bxc3', 'Ne7'],
        idea: 'Pin and trade on c3 to wreck White’s queenside pawns, then pressure the centre with ...c5.',
      },
      {
        id: 'fr-advance',
        name: 'Advance',
        eco: 'C02',
        side: 'black',
        moves: ['e4', 'e6', 'd4', 'd5', 'e5', 'c5', 'c3', 'Nc6', 'Nf3', 'Qb6', 'Be2', 'cxd4', 'cxd4', 'Nh6'],
        idea: 'Gang up on d4: ...c5, ...Nc6, ...Qb6, and reroute ...Nh6-f5 to add one more attacker.',
      },
      {
        id: 'fr-tarrasch',
        name: 'Tarrasch — Open',
        eco: 'C09',
        side: 'black',
        moves: ['e4', 'e6', 'd4', 'd5', 'Nd2', 'c5', 'exd5', 'exd5', 'Ngf3', 'Nc6', 'Bb5', 'Bd6', 'O-O', 'Nge7'],
        idea: 'Accept the isolated d-pawn for free piece play: rapid development and central activity.',
      },
    ],
  },
  {
    id: 'caro-kann',
    name: 'Caro-Kann Defence',
    eco: 'B10',
    side: 'black',
    summary: 'Rock-solid ...c6/...d5: challenge e4 without locking in the light-squared bishop.',
    lines: [
      {
        id: 'ck-classical',
        name: 'Classical',
        eco: 'B18',
        side: 'black',
        moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Nf3', 'Nd7'],
        idea: 'Develop the bishop to f5 before ...e6, meet h4 with ...h6, and build the trademark solid shell.',
      },
      {
        id: 'ck-advance',
        name: 'Advance',
        eco: 'B12',
        side: 'black',
        moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'Be2', 'c5', 'O-O', 'Nc6'],
        idea: 'Get the bishop out to f5 first, then attack the chain base with ...c5 like a good French.',
      },
      {
        id: 'ck-exchange',
        name: 'Exchange',
        eco: 'B13',
        side: 'black',
        moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Bd3', 'Nc6', 'c3', 'Nf6', 'Bf4', 'Bg4', 'Qb3', 'Qd7'],
        idea: 'Mirror the Carlsbad structure: develop actively with ...Bg4 and meet Qb3 calmly with ...Qd7.',
      },
    ],
  },
  {
    id: 'kings-indian',
    name: "King's Indian Defence",
    eco: 'E60',
    side: 'black',
    summary: 'Concede the centre, castle short, then launch the thematic ...e5 / kingside storm.',
    lines: [
      {
        id: 'ki-classical',
        name: 'Classical — Mar del Plata',
        eco: 'E97',
        side: 'black',
        moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'e5', 'O-O', 'Nc6', 'd5', 'Ne7'],
        idea: 'After d5 closes the centre, the plan is fixed: ...f5, ...f4 and a pawn storm against the king.',
      },
      {
        id: 'ki-fianchetto',
        name: 'Fianchetto — Panno',
        eco: 'E62',
        side: 'black',
        moves: ['d4', 'Nf6', 'c4', 'g6', 'Nf3', 'Bg7', 'g3', 'O-O', 'Bg2', 'd6', 'O-O', 'Nc6', 'Nc3', 'a6'],
        idea: 'Against the fianchetto, switch plans: ...Nc6/...a6 prepares ...Rb8 and ...b5 on the queenside.',
      },
    ],
  },
  {
    id: 'slav',
    name: 'Slav Defence',
    eco: 'D10',
    side: 'black',
    summary: 'Defend d5 with ...c6 and keep the light-squared bishop free — the sturdy reply to the Queen’s Gambit.',
    lines: [
      {
        id: 'sl-main',
        name: 'Main Line — Dutch',
        eco: 'D17',
        side: 'black',
        moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'a4', 'Bf5', 'e3', 'e6', 'Bxc4', 'Bb4'],
        idea: 'Grab c4 at the right moment, develop the bishop outside the chain, then pin with ...Bb4.',
      },
      {
        id: 'sl-semi',
        name: 'Semi-Slav — Meran',
        eco: 'D45',
        side: 'black',
        moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'e6', 'e3', 'Nbd7', 'Bd3', 'dxc4', 'Bxc4', 'b5', 'Bd3', 'a6'],
        idea: 'Take on c4 only after Bd3, gaining time for the Meran expansion ...b5, ...a6 and ...c5.',
      },
    ],
  },
];

/** Every catalog line, flattened. */
export const CATALOG_LINES: OpeningLine[] = OPENING_CATALOG.flatMap((o) => o.lines);

const byId = new Map(CATALOG_LINES.map((l) => [l.id, l] as const));
const openingByLineId = new Map(OPENING_CATALOG.flatMap((o) => o.lines.map((l) => [l.id, o] as const)));

export const catalogLine = (id: string): OpeningLine | undefined => byId.get(id);
export const catalogOpeningOf = (lineId: string): CatalogOpening | undefined => openingByLineId.get(lineId);
