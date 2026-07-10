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
  {
    id: 'vienna',
    name: 'Vienna Game',
    eco: 'C25',
    side: 'white',
    summary: 'Flexible 2.Nc3: keep the f-pawn free for a gambit punch or fianchetto quietly with g3.',
    lines: [
      {
        id: 'vi-gambit',
        name: 'Vienna Gambit — Main Line',
        eco: 'C29',
        side: 'white',
        moves: ['e4', 'e5', 'Nc3', 'Nf6', 'f4', 'd5', 'fxe5', 'Nxe4', 'Nf3', 'Be7', 'd4', 'O-O', 'Bd3'],
        idea: 'A delayed King’s Gambit: after ...d5 grab space with fxe5 and d4, then challenge the e4 knight with Bd3 and use the half-open f-file.',
      },
      {
        id: 'vi-mieses',
        name: 'Mieses — 3.g3',
        eco: 'C26',
        side: 'white',
        moves: ['e4', 'e5', 'Nc3', 'Nf6', 'g3', 'd5', 'exd5', 'Nxd5', 'Bg2', 'Nxc3', 'bxc3', 'Bc5', 'Nf3', 'Nc6', 'O-O', 'O-O', 'd3'],
        idea: 'Positional Vienna: let Black trade on c3, then the g2 bishop rakes the long diagonal while c3/d3 build a compact centre for a later d4.',
      },
    ],
  },
  {
    id: 'kings-gambit',
    name: 'King’s Gambit',
    eco: 'C30',
    side: 'white',
    summary: 'Offer the f-pawn on move 2 for a lead in development and a raging attack down the f-file.',
    lines: [
      {
        id: 'kg-kieseritzky',
        name: 'Accepted — Kieseritzky',
        eco: 'C39',
        side: 'white',
        moves: ['e4', 'e5', 'f4', 'exf4', 'Nf3', 'g5', 'h4', 'g4', 'Ne5', 'Nf6', 'd4', 'd6', 'Nd3', 'Nxe4', 'Bxf4'],
        idea: 'Against ...g5 strike with h4 and Ne5: break up the kingside pawns, regain f4 with Bxf4 and develop fast while Black’s king has no safe home.',
      },
      {
        id: 'kg-declined',
        name: 'Declined — Classical',
        eco: 'C30',
        side: 'white',
        moves: ['e4', 'e5', 'f4', 'Bc5', 'Nf3', 'd6', 'Nc3', 'Nf6', 'Bc4', 'Nc6', 'd3', 'Bg4', 'h3', 'Bxf3', 'Qxf3'],
        idea: 'When Black declines with ...Bc5, treat it like an Italian with extra space: develop, win the bishop pair with h3, then choose between f5 or fxe5.',
      },
      {
        id: 'kg-falkbeer',
        name: 'Falkbeer Countergambit',
        eco: 'C32',
        side: 'white',
        moves: ['e4', 'e5', 'f4', 'd5', 'exd5', 'e4', 'd3', 'Nf6', 'dxe4', 'Nxe4', 'Nf3', 'Bc5', 'Qe2'],
        idea: 'Meet the counter-punch calmly: undermine the e4 wedge with d3, then Qe2 pins the knight — Black’s activity fades and the extra d5 pawn remains.',
      },
    ],
  },
  {
    id: 'catalan',
    name: 'Catalan',
    eco: 'E00',
    side: 'white',
    summary: 'Queen’s Gambit meets fianchetto: the g2 bishop pressures d5-b7 for the whole game.',
    lines: [
      {
        id: 'ca-open',
        name: 'Open — Classical',
        eco: 'E05',
        side: 'white',
        moves: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2', 'Be7', 'Nf3', 'O-O', 'O-O', 'dxc4', 'Qc2', 'a6', 'Qxc4', 'b5', 'Qc2', 'Bb7', 'Bd2'],
        idea: 'Let Black take c4 and calmly win it back with Qc2/Qxc4; then Bd2-a5 and a4 nag the queenside while the g2 bishop eyes b7 and d5.',
      },
      {
        id: 'ca-closed',
        name: 'Closed — Qc2 & e4',
        eco: 'E09',
        side: 'white',
        moves: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2', 'Be7', 'Nf3', 'O-O', 'O-O', 'Nbd7', 'Qc2', 'c6', 'Nbd2', 'b6', 'e4'],
        idea: 'Against the solid ...c6/...Nbd7 shell, mass behind the e-pawn: Qc2 and Nbd2 prepare e4, seizing the centre before Black frees up with ...c5 or ...e5.',
      },
      {
        id: 'ca-bb4',
        name: 'vs ...Bb4+ — Bd2-f4 Plan',
        eco: 'E11',
        side: 'white',
        moves: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'Bb4+', 'Bd2', 'Be7', 'Bg2', 'd5', 'Nf3', 'O-O', 'O-O', 'Nbd7', 'Qc2', 'c6', 'Bf4'],
        idea: 'The check costs Black time: block with Bd2, and once the bishop retreats, reroute your own to f4 — a full extra tempo over normal closed lines.',
      },
    ],
  },
  {
    id: 'english',
    name: 'English Opening',
    eco: 'A10',
    side: 'white',
    summary: '1.c4 — fight for d5 from the flank, often steering into a Sicilian a tempo up.',
    lines: [
      {
        id: 'en-four-knights',
        name: 'Four Knights — Reversed Dragon',
        eco: 'A29',
        side: 'white',
        moves: ['c4', 'e5', 'Nc3', 'Nf6', 'Nf3', 'Nc6', 'g3', 'd5', 'cxd5', 'Nxd5', 'Bg2', 'Nb6', 'O-O', 'Be7', 'd3', 'O-O', 'a3'],
        idea: 'You play a Dragon Sicilian with an extra move: the g2 bishop hits the queenside and a3 prepares the thematic b4-b5 pawn storm.',
      },
      {
        id: 'en-symmetrical',
        name: 'Symmetrical — Rubinstein',
        eco: 'A34',
        side: 'white',
        moves: ['c4', 'c5', 'Nc3', 'Nf6', 'Nf3', 'd5', 'cxd5', 'Nxd5', 'g3', 'Nc7', 'Bg2', 'Nc6', 'O-O', 'e5', 'd3', 'Be7', 'Nd2'],
        idea: 'When Black grabs the centre with ...e5, hit back at it: Nd2-c4 (or b3/a4) gnaws at e5 and d6 while the g2 bishop pins down the long diagonal.',
      },
      {
        id: 'en-botvinnik',
        name: 'Botvinnik System vs KID Setup',
        eco: 'A16',
        side: 'white',
        moves: ['c4', 'Nf6', 'Nc3', 'g6', 'g3', 'Bg7', 'Bg2', 'O-O', 'e4', 'd6', 'Nge2', 'e5', 'O-O', 'Nc6', 'd3'],
        idea: 'The c4/e4/g3 clamp: the pawn duo strangles d5, Nge2 keeps the f-pawn free, and the plans are f4 on one wing or b4/Rb1 on the other.',
      },
    ],
  },
  {
    id: 'reti',
    name: 'Réti Opening',
    eco: 'A09',
    side: 'white',
    summary: 'Hypermodern 1.Nf3 and 2.c4: pressure d5 from the wings before committing your centre.',
    lines: [
      {
        id: 're-neo-catalan',
        name: 'vs ...e6 — Double Fianchetto',
        eco: 'A14',
        side: 'white',
        moves: ['Nf3', 'd5', 'c4', 'e6', 'g3', 'Nf6', 'Bg2', 'Be7', 'O-O', 'O-O', 'b3', 'c5', 'Bb2', 'Nc6', 'e3'],
        idea: 'Both bishops on the long diagonals bite into d4 and e5; keep the structure fluid, then choose the right break — cxd5, d4 or even Ne5 and f4.',
      },
      {
        id: 're-slav',
        name: 'vs ...c6 — Anglo-Slav Variation',
        eco: 'A12',
        side: 'white',
        moves: ['Nf3', 'd5', 'c4', 'c6', 'b3', 'Nf6', 'g3', 'Bf5', 'Bg2', 'e6', 'O-O', 'Nbd7', 'Bb2', 'h6', 'd3'],
        idea: 'Against the Slav wall, never touch the tension: b3/g3 develop both bishops, d3 keeps everything flexible, and Nbd2 with e4 is the master plan.',
      },
      {
        id: 're-accepted',
        name: 'Réti Accepted',
        eco: 'A09',
        side: 'white',
        moves: ['Nf3', 'd5', 'c4', 'dxc4', 'e3', 'Nf6', 'Bxc4', 'e6', 'O-O', 'c5', 'b3', 'Nc6', 'Bb2'],
        idea: 'If Black takes c4, regain it at leisure with e3/Bxc4 and fianchetto with b3 — a QGA-style game where only White has active plans: Qe2, Rd1 and a timely d4.',
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
  {
    id: 'pirc',
    name: 'Pirc Defence',
    eco: 'B07',
    side: 'black',
    summary: 'Let White build the big centre, fianchetto on g7, then chip at it with ...e5 or ...c5.',
    lines: [
      {
        id: 'pi-classical',
        name: 'Classical — Two Knights',
        eco: 'B08',
        side: 'black',
        moves: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'Nf3', 'Bg7', 'Be2', 'O-O', 'O-O', 'c6', 'a4', 'Nbd7'],
        idea: 'Against quiet development, prepare the freeing ...e5: ...c6 guards d5 and gives the queen b6/a5, while ...Nbd7 supports the central strike.',
      },
      {
        id: 'pi-austrian',
        name: 'Austrian Attack',
        eco: 'B09',
        side: 'black',
        moves: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'f4', 'Bg7', 'Nf3', 'O-O', 'Bd3', 'Na6', 'O-O', 'c5'],
        idea: 'White’s pawn storm needs counterplay NOW: ...Na6 backs up the ...c5 break (after dxc5, ...Nxc5 hits the d3 bishop) before the e5/f5 avalanche rolls.',
      },
      {
        id: 'pi-150',
        name: 'vs 150 Attack',
        eco: 'B07',
        side: 'black',
        moves: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'Be3', 'c6', 'Qd2', 'b5', 'Bd3', 'Nbd7', 'Nf3', 'e5'],
        idea: 'Be3/Qd2 aims for Bh6 and mate — so delay castling! Expand with ...b5, keep the king flexible, and strike the centre with ...e5 at the right moment.',
      },
    ],
  },
  {
    id: 'scandinavian',
    name: 'Scandinavian Defence',
    eco: 'B01',
    side: 'black',
    summary: 'Challenge e4 on move one and get a Caro-Kann structure without the theory mountain.',
    lines: [
      {
        id: 'sd-classical',
        name: 'Classical — 3...Qa5',
        eco: 'B01',
        side: 'black',
        moves: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4', 'Nf6', 'Nf3', 'c6', 'Bc4', 'Bf5', 'Bd2', 'e6', 'Qe2', 'Bb4'],
        idea: 'The queen sits safely on a5 while ...c6/...e6 build an unbreakable shell; the c8 bishop gets out to f5 first, and ...Bb4 piles onto the c3 knight to stop d5 tricks.',
      },
      {
        id: 'sd-gubinsky',
        name: 'Modern — 3...Qd6',
        eco: 'B01',
        side: 'black',
        moves: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qd6', 'd4', 'Nf6', 'Nf3', 'a6', 'g3', 'b5', 'Bg2', 'Bb7', 'O-O', 'e6'],
        idea: 'On d6 the queen watches both wings; ...a6 and ...b5 grab space, the bishop counters White’s fianchetto on b7, and ...c5 is the thematic break.',
      },
    ],
  },
  {
    id: 'alekhine',
    name: 'Alekhine’s Defence',
    eco: 'B02',
    side: 'black',
    summary: 'Provoke White’s pawns forward with 1...Nf6, then attack the over-extended centre.',
    lines: [
      {
        id: 'al-modern',
        name: 'Modern — 4...Bg4',
        eco: 'B05',
        side: 'black',
        moves: ['e4', 'Nf6', 'e5', 'Nd5', 'd4', 'd6', 'Nf3', 'Bg4', 'Be2', 'e6', 'O-O', 'Be7', 'c4', 'Nb6', 'Nc3', 'O-O'],
        idea: 'Pin the defender of the e5 wedge: ...Bg4 and ...dxe5 keep White’s centre under strain, and the b6 knight makes c4 a target, not an asset.',
      },
      {
        id: 'al-exchange',
        name: 'Exchange — ...cxd6',
        eco: 'B03',
        side: 'black',
        moves: ['e4', 'Nf6', 'e5', 'Nd5', 'd4', 'd6', 'c4', 'Nb6', 'exd6', 'cxd6', 'Nc3', 'g6', 'Nf3', 'Bg7', 'Be2', 'O-O'],
        idea: 'Recapture with the c-pawn for a half-open c-file: the b6 knight and ...Be6 gang up on c4 while ...Nc6 and ...Bg4 hit d4 — White’s space can become weakness.',
      },
      {
        id: 'al-four-pawns',
        name: 'Four Pawns Attack',
        eco: 'B03',
        side: 'black',
        moves: ['e4', 'Nf6', 'e5', 'Nd5', 'd4', 'd6', 'c4', 'Nb6', 'f4', 'dxe5', 'fxe5', 'Nc6', 'Be3', 'Bf5', 'Nc3', 'e6', 'Nf3', 'Be7'],
        idea: 'Four pawns look scary but leave holes: hit d4 with ...Nc6 and ...Bf5-e7 development, then ...f6 or ...Nb4 dismantle the front that must be defended.',
      },
    ],
  },
  {
    id: 'petroff',
    name: 'Petroff Defence',
    eco: 'C42',
    side: 'black',
    summary: 'Answer 1.e4 e5 2.Nf3 with 2...Nf6 — rock-solid symmetry that neutralises White’s initiative.',
    lines: [
      {
        id: 'pe-classical',
        name: 'Classical — 3.Nxe5',
        eco: 'C42',
        side: 'black',
        moves: ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'd6', 'Nf3', 'Nxe4', 'd4', 'd5', 'Bd3', 'Nc6', 'O-O', 'Be7', 'c4', 'Nb4'],
        idea: 'Remember ...d6 first, THEN take e4. The knight anchors on e4 behind ...d5, and ...Nb4 trades off White’s best attacker, the d3 bishop.',
      },
      {
        id: 'pe-steinitz',
        name: 'Steinitz — 3.d4',
        eco: 'C43',
        side: 'black',
        moves: ['e4', 'e5', 'Nf3', 'Nf6', 'd4', 'Nxe4', 'Bd3', 'd5', 'Nxe5', 'Nd7', 'Nxd7', 'Bxd7', 'O-O', 'Bd6', 'c4', 'c6'],
        idea: 'Trade the e5 knight with ...Nd7 and equalise comfortably: ...Bd6 aims at h2, ...c6 steadies d5, and the symmetric structure holds effortlessly.',
      },
    ],
  },
  {
    id: 'nimzo-indian',
    name: 'Nimzo-Indian Defence',
    eco: 'E20',
    side: 'black',
    summary: 'Pin the c3 knight with ...Bb4: control e4 with pieces and saddle White with doubled pawns.',
    lines: [
      {
        id: 'ni-rubinstein',
        name: 'Rubinstein — 4.e3',
        eco: 'E55',
        side: 'black',
        moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'e3', 'O-O', 'Bd3', 'd5', 'Nf3', 'c5', 'O-O', 'dxc4', 'Bxc4', 'Nbd7'],
        idea: 'Strike the centre from both sides with ...d5 and ...c5; after ...dxc4 the play targets White’s isolated or hanging pawns — blockade, then besiege.',
      },
      {
        id: 'ni-classical',
        name: 'Classical — 4.Qc2',
        eco: 'E32',
        side: 'black',
        moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'Qc2', 'O-O', 'a3', 'Bxc3+', 'Qxc3', 'b6', 'Bg5', 'Bb7', 'e3', 'd6'],
        idea: 'Concede the bishop pair but win the fight for e4: ...b6/...Bb7 and ...Ne4 ideas exploit the queen’s absence while White lags in development.',
      },
      {
        id: 'ni-saemisch',
        name: 'Sämisch — 4.a3',
        eco: 'E29',
        side: 'black',
        moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'a3', 'Bxc3+', 'bxc3', 'c5', 'e3', 'Nc6', 'Bd3', 'O-O', 'Ne2', 'b6'],
        idea: 'The doubled c-pawns are your long-term prize: fix them with ...c5/...b6, park a knight on a5 against c4, and keep the position closed.',
      },
    ],
  },
  {
    id: 'grunfeld',
    name: 'Grünfeld Defence',
    eco: 'D80',
    side: 'black',
    summary: 'Give White the big centre, then batter it with the g7 bishop, ...c5 and heavy pieces.',
    lines: [
      {
        id: 'gr-exchange-modern',
        name: 'Exchange — Modern 8.Rb1',
        eco: 'D85',
        side: 'black',
        moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5', 'cxd5', 'Nxd5', 'e4', 'Nxc3', 'bxc3', 'Bg7', 'Nf3', 'c5', 'Rb1', 'O-O', 'Be2', 'cxd4', 'cxd4', 'Qa5+'],
        idea: 'Every move hits d4: ...c5, ...cxd4 and the check on a5 win time; next come ...Qxa2 or ...Nc6/...Bg4, and White’s proud centre becomes a liability.',
      },
      {
        id: 'gr-exchange-classical',
        name: 'Exchange — Classical 7.Bc4',
        eco: 'D87',
        side: 'black',
        moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5', 'cxd5', 'Nxd5', 'e4', 'Nxc3', 'bxc3', 'Bg7', 'Bc4', 'c5', 'Ne2', 'Nc6', 'Be3', 'O-O', 'O-O', 'Bg4'],
        idea: 'The classic siege: ...c5, ...Nc6 and ...Bg4xf3 pile onto d4 until it drops or White’s pieces are tied to it — then ...Na5 harasses the c4 bishop.',
      },
      {
        id: 'gr-russian',
        name: 'Russian System — Hungarian',
        eco: 'D97',
        side: 'black',
        moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5', 'Nf3', 'Bg7', 'Qb3', 'dxc4', 'Qxc4', 'O-O', 'e4', 'a6'],
        idea: 'When the queen recaptures on c4, gain time on her: ...a6 readies ...b5 and ...c5 or ...Bg4/...Nfd7 — the queenside pawns become an attacking unit.',
      },
    ],
  },
  {
    id: 'benoni',
    name: 'Modern Benoni',
    eco: 'A60',
    side: 'black',
    summary: 'Unbalance 1.d4 completely: trade the e-pawn structure for a queenside majority and dark-square play.',
    lines: [
      {
        id: 'bn-classical',
        name: 'Classical — ...Re8',
        eco: 'A76',
        side: 'black',
        moves: ['d4', 'Nf6', 'c4', 'c5', 'd5', 'e6', 'Nc3', 'exd5', 'cxd5', 'd6', 'e4', 'g6', 'Nf3', 'Bg7', 'Be2', 'O-O', 'O-O', 'Re8'],
        idea: 'The Benoni machine: ...Re8 pressures e4, ...a6/...b5 roll the majority, and the g7 bishop plus ...c4/...Nc5 give constant dynamic chances.',
      },
      {
        id: 'bn-fianchetto',
        name: 'Fianchetto Variation',
        eco: 'A62',
        side: 'black',
        moves: ['d4', 'Nf6', 'c4', 'c5', 'd5', 'e6', 'Nc3', 'exd5', 'cxd5', 'd6', 'Nf3', 'g6', 'g3', 'Bg7', 'Bg2', 'O-O', 'O-O', 'a6'],
        idea: 'With White’s bishop on g2, e4 is slower — so start the queenside early: ...a6, ...Nbd7 and ...Rb8 prepare ...b5 before White gets Nd2-c4 in.',
      },
    ],
  },
  {
    id: 'benko',
    name: 'Benko Gambit',
    eco: 'A57',
    side: 'black',
    summary: 'Sacrifice the b-pawn for eternal pressure on the a- and b-files — a gambit you play for the endgame too.',
    lines: [
      {
        id: 'bk-accepted',
        name: 'Fully Accepted — King Walk',
        eco: 'A59',
        side: 'black',
        moves: ['d4', 'Nf6', 'c4', 'c5', 'd5', 'b5', 'cxb5', 'a6', 'bxa6', 'Bxa6', 'Nc3', 'd6', 'e4', 'Bxf1', 'Kxf1', 'g6', 'g3', 'Bg7', 'Kg2', 'O-O'],
        idea: 'The pawn buys open a- and b-files forever: ...Bxf1 robs White of castling, then ...Qb6/...Ra8-b8 double up while the g7 bishop x-rays d4 and b2.',
      },
      {
        id: 'bk-b6',
        name: 'b6 Return — 5.b6',
        eco: 'A57',
        side: 'black',
        moves: ['d4', 'Nf6', 'c4', 'c5', 'd5', 'b5', 'cxb5', 'a6', 'b6', 'Qxb6', 'Nc3', 'd6', 'e4', 'g6', 'Nf3', 'Bg7', 'Be2', 'O-O'],
        idea: 'If White hands the pawn back with b6, take it with the queen and enjoy a good Benoni: the half-open b-file and ...a5-a4 still give queenside play.',
      },
    ],
  },
  {
    id: 'dutch',
    name: 'Dutch Defence',
    eco: 'A80',
    side: 'black',
    summary: 'Fight 1.d4 with 1...f5: stake out e4 and aim your whole army at White’s king.',
    lines: [
      {
        id: 'du-leningrad',
        name: 'Leningrad — 7...Qe8',
        eco: 'A87',
        side: 'black',
        moves: ['d4', 'f5', 'g3', 'Nf6', 'Bg2', 'g6', 'Nf3', 'Bg7', 'O-O', 'O-O', 'c4', 'd6', 'Nc3', 'Qe8'],
        idea: 'The queen swings to e8 to power the one break that matters: ...e5. If White stops it, she re-routes to h5 or g6 and the f-pawn leads the attack.',
      },
      {
        id: 'du-stonewall',
        name: 'Modern Stonewall',
        eco: 'A90',
        side: 'black',
        moves: ['d4', 'f5', 'g3', 'Nf6', 'Bg2', 'e6', 'Nf3', 'd5', 'O-O', 'Bd6', 'c4', 'c6', 'b3', 'Qe7', 'Bb2', 'O-O'],
        idea: 'The d5/e6/f5 wall gives you e4 for a knight forever; put the bishop on d6, trade the bad one via ...b6/...Ba6 later, and attack with ...Ne4 and ...g5.',
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
