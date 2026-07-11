/**
 * Curated endgame drills — the essential techniques, playable against perfect
 * defence. Extends the EndgameStudy shape (trainers/endgames.ts) with a bundled
 * principal variation so every drill works offline:
 *
 * - Online, each of your moves is judged by the Lichess tablebase (proxied
 *   through the server's /api/tablebase endpoint) and the defender replies with
 *   a tablebase-best move.
 * - Offline (or above 7 men), the bundled `solution` is the book line: your
 *   moves are checked against it and the defender replies from it.
 *
 * Every solution here was generated and verified move-by-move against the
 * Lichess 7-man tablebase (player moves preserve the goal; defender moves are
 * category-optimal). The one 8-man start (pawn-breakthrough) is book theory;
 * it enters tablebase coverage from the second move on, and both first-move
 * captures were probed as tablebase wins. Everything is then re-validated
 * structurally by scripts/validate-trainers.mts:
 * the FEN parses, the line replays legally in chess.js with canonical SAN, and
 * the terminal position matches the goal (mate/promotion/bare king for wins,
 * a book draw or a survival line for draws).
 */
export interface EndgameDrill {
  id: string;
  name: string;
  /** The technique the drill teaches — shown as a badge. */
  technique: string;
  /** You play this side; the tablebase (or the book line) defends the other. */
  youPlay: 'white' | 'black';
  /** 'win' = mate, queen a pawn or win the last defending piece; 'draw' = hold. */
  goal: 'win' | 'draw';
  fen: string;
  /** Principal variation in canonical SAN, starting with YOUR move. */
  solution: string[];
  /** Short lesson blurb naming the technique. */
  lesson: string;
}

export const ENDGAME_DRILLS: EndgameDrill[] = [
  {
    id: 'kpk-opposition-win',
    name: 'K+P vs K — The King Leads',
    technique: 'Key squares & opposition',
    youPlay: 'white',
    goal: 'win',
    fen: '8/4k3/8/4K3/8/4P3/8/8 w - - 0 1',
    solution: [
      'Kd5', 'Kf6', 'e4', 'Ke7', 'Ke5', 'Kd7', 'Kf6', 'Kd8', 'Kf7', 'Kc7', 'e5', 'Kb6', 'e6', 'Kb5', 'e7', 'Kc4',
      'e8=Q',
    ],
    lesson:
      'Your king stands two ranks ahead of its pawn — every square it reaches is a key square, so this wins no matter whose move it is. Lead with the king: outflank to d5 or f5, walk it to the seventh, and only then let the pawn run. Pushing the pawn first is the classic way to throw the win away.',
  },
  {
    id: 'kpk-opposition-draw',
    name: 'K+P vs K — Hold with the Opposition',
    technique: 'The opposition',
    youPlay: 'black',
    goal: 'draw',
    fen: '8/4k3/8/8/4K3/4P3/8/8 b - - 0 1',
    solution: [
      'Ke6', 'Kd4', 'Kd6', 'e4', 'Ke6', 'e5', 'Ke7', 'Kd5', 'Kd7', 'e6+', 'Ke8', 'Kd6', 'Kd8', 'e7+', 'Ke8', 'Ke6',
    ],
    lesson:
      'Only one move holds: Ke6, stepping straight in front of the king and taking the opposition. Mirror every sidestep, retreat straight back when the pawn advances, and meet the final pawn check on the queening square — the stalemate at the end is the whole point, not an accident.',
  },
  {
    id: 'krk-box',
    name: 'K+R vs K — Shrink the Box',
    technique: 'Rook mate — the box',
    youPlay: 'white',
    goal: 'win',
    fen: '3k4/8/8/8/3K4/7R/8/8 w - - 0 1',
    solution: ['Rh7', 'Kc8', 'Kd5', 'Kd8', 'Ke6', 'Kc8', 'Kd6', 'Kb8', 'Kc6', 'Ka8', 'Kb6', 'Kb8', 'Rh8#'],
    lesson:
      'The rook fences the king onto the back rank while your own king marches up to face it. Never check for the sake of it — keep the fence, gain the opposition, and deliver the one check that matters: mate on the eighth. Watch for stalemate when the king sits in the corner.',
  },
  {
    id: 'lucena-bridge',
    name: 'Lucena — Build the Bridge',
    technique: 'Lucena position',
    youPlay: 'white',
    goal: 'win',
    fen: '4K3/2k1P3/8/8/8/8/r7/3R4 w - - 0 1',
    solution: [
      'Rc1+', 'Kd6', 'Rc4', 'Re2', 'Rd4+', 'Kc7', 'Rd1', 'Rf2', 'Rc1+', 'Kb7', 'Rc4', 'Kb6', 'Kd7', 'Rd2+', 'Ke6',
      'Rg2', 'e8=Q',
    ],
    lesson:
      'The most important winning position in rook endings. Check the defending king away, then lift your rook to the fourth rank — the “bridge”. Your king steps out of the pawn’s way, walks down the board, and when the checks come it hides beside the bridge (or the rook blocks). The pawn queens by force.',
  },
  {
    id: 'philidor-third-rank',
    name: 'Philidor — The Third-Rank Defence',
    technique: 'Philidor position',
    youPlay: 'black',
    goal: 'draw',
    fen: '3k4/1R6/8/3K4/3P4/8/r7/8 b - - 0 1',
    solution: ['Ra6', 'Ke5', 'Rc6', 'd5', 'Ra6', 'd6', 'Ra1', 'Ke6', 'Re1+'],
    lesson:
      'The drawing method every player must know. Park your rook on your third rank (here the sixth) so the enemy king can never step in front of its pawn. The moment the pawn advances onto that rank, swing the rook behind it and check from the rear forever — the king has nowhere to hide.',
  },
  {
    id: 'outside-passer',
    name: 'Outside Passed Pawn — The Decoy',
    technique: 'Outside passed pawn',
    youPlay: 'white',
    goal: 'win',
    fen: '8/8/3k4/7p/P2K3P/8/8/8 w - - 0 1',
    solution: [
      'a5', 'Kc6', 'Ke3', 'Kb5', 'Kf4', 'Ka6', 'Kg5', 'Kb5', 'Kxh5', 'Ka6', 'Kg4', 'Kb5', 'h5', 'Kc5', 'h6', 'Kb5',
      'h7', 'Kxa5', 'h8=Q',
    ],
    lesson:
      'The passed pawn far from the action isn’t there to queen — it’s bait. Push it just far enough to drag the defending king across the board, then race your own king the other way, eat the kingside, and promote on the opposite wing. Two plans, one board: the defender can only stop one.',
  },
  {
    id: 'pawn-breakthrough',
    name: 'Pawn Breakthrough — Three vs Three',
    technique: 'Breakthrough',
    youPlay: 'white',
    goal: 'win',
    fen: '6k1/ppp5/8/PPP5/8/8/8/6K1 w - - 0 1',
    solution: ['b6', 'axb6', 'c6', 'Kf7', 'cxb7', 'bxa5', 'b8=Q'],
    lesson:
      'The classic combination every pawn ending hides: sacrifice the middle pawn with b6!, and whichever way it is taken, the follow-up capture clears a runway no king can reach in time. Three healthy pawns become one unstoppable passer — count the squares before the defender does.',
  },
  {
    id: 'triangulation-zugzwang',
    name: 'Zugzwang — Win the Tempo War',
    technique: 'Triangulation & zugzwang',
    youPlay: 'white',
    goal: 'win',
    fen: '8/1k6/3p4/3P4/1K6/8/8/8 w - - 0 1',
    solution: ['Kb5', 'Kc7', 'Ka6', 'Kc8', 'Kb6', 'Kd7', 'Kb7', 'Kd8', 'Kc6', 'Ke7', 'Kc7', 'Kf6', 'Kxd6'],
    lesson:
      'Blocked pawns turn every king move into a commitment — whoever runs out of good moves loses. Seize the opposition with Kb5!: the defender must give ground, and you outflank along the edge, square by square. If he could mirror you forever, you would triangulate — walk a three-square triangle his king can’t copy — to hand him the move. The squeeze wins d6 by force.',
  },
  {
    id: 'q-vs-p7',
    name: 'Queen vs Pawn on the 7th',
    technique: 'The checking ladder',
    youPlay: 'white',
    goal: 'win',
    fen: '8/8/8/1K5Q/8/8/4pk2/8 w - - 0 1',
    solution: ['Qh4+', 'Kf1', 'Qf4+', 'Ke1', 'Kc4', 'Kd1', 'Qf3', 'Kd2', 'Qf2', 'Kd1', 'Kd3', 'Kc1', 'Qxe2'],
    lesson:
      'Against a centre or knight pawn one square from queening, the queen wins by the checking ladder: check ever closer until the king is forced onto the queening square in front of its own pawn — that frozen tempo is your king’s cue to step in. Repeat until your king arrives and the pawn falls. (A rook or bishop pawn would draw — stalemate tricks.)',
  },
];

export const ENDGAME_DRILL_IDS = ENDGAME_DRILLS.map((d) => d.id);
