import { toPgn } from '../lib/pgn';

/**
 * Annotated master games — a curated library of famous instructive games.
 *
 * Everything is plain data so adding a game is a copy-paste job. Moves are SAN
 * from the initial position; the unit test (masterGames.test.ts) replays every
 * game through chess.js, so an illegal or mistyped move fails CI.
 *
 * Ply indexing is 1-based to match the game store's goToPly: ply 1 is the
 * position after White's first move, ply 2 after Black's reply, and so on.
 * `sans[i]` therefore corresponds to ply `i + 1`.
 */

export type GameTheme = 'attack' | 'sacrifice' | 'tactics' | 'endgame' | 'positional';

export const GAME_THEMES: GameTheme[] = ['attack', 'sacrifice', 'tactics', 'endgame', 'positional'];

export const THEME_LABELS: Record<GameTheme, string> = {
  attack: 'Attack',
  sacrifice: 'Sacrifice',
  tactics: 'Tactics',
  endgame: 'Endgame',
  positional: 'Positional',
};

export type GameDifficulty = 'beginner' | 'intermediate' | 'advanced';

export const DIFFICULTY_LABELS: Record<GameDifficulty, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export interface MoveAnnotation {
  /** Why this move — shown in the annotation panel at this ply. */
  text: string;
  /** A defining moment of the game (starred in the move list). */
  key?: boolean;
  /** NAG-style glyph rendered after the SAN, e.g. '!', '!!', '?', '?!'. */
  glyph?: '!' | '!!' | '?' | '??' | '!?' | '?!';
}

export interface MasterGame {
  id: string;
  white: string;
  black: string;
  event: string;
  year: number;
  result: '1-0' | '0-1' | '1/2-1/2';
  eco: string;
  opening: string;
  themes: GameTheme[];
  difficulty: GameDifficulty;
  /** One-or-two-sentence pitch shown on the library card. */
  blurb: string;
  /** Full game in SAN from the standard start position. */
  sans: string[];
  /** Commentary keyed by 1-based ply (ply 1 = after White's 1st move). */
  annotations: Record<number, MoveAnnotation>;
  /** 2–4 plies to jump straight to the turning points. */
  keyMoments: number[];
}

/** "12." or "12…" — the move-number label for a 1-based ply. */
export function plyLabel(ply: number): string {
  const moveNo = Math.ceil(ply / 2);
  return ply % 2 === 1 ? `${moveNo}.` : `${moveNo}…`;
}

/** Full PGN (with headers) for a library game, ready for useGame.loadPgn. */
export function masterGamePgn(g: MasterGame): string {
  return toPgn(g.sans, { white: g.white, black: g.black, result: g.result, date: `${g.year}.??.??` });
}

export const MASTER_GAMES: MasterGame[] = [
  {
    id: 'opera-1858',
    white: 'Paul Morphy',
    black: 'Duke Karl / Count Isouard',
    event: 'Paris Opera House',
    year: 1858,
    result: '1-0',
    eco: 'C41',
    opening: 'Philidor Defence',
    themes: ['attack', 'sacrifice'],
    difficulty: 'beginner',
    blurb:
      'The most famous teaching game ever played. Between opera acts, Morphy punishes slow development with a lesson in open lines, culminating in a queen sacrifice and mate with his last two pieces.',
    sans: [
      'e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4', 'dxe5', 'Bxf3', 'Qxf3', 'dxe5',
      'Bc4', 'Nf6', 'Qb3', 'Qe7', 'Nc3', 'c6', 'Bg5', 'b5', 'Nxb5', 'cxb5',
      'Bxb5+', 'Nbd7', 'O-O-O', 'Rd8', 'Rxd7', 'Rxd7', 'Rd1', 'Qe6', 'Bxd7+', 'Nxd7',
      'Qb8+', 'Nxb8', 'Rd8#',
    ],
    annotations: {
      6: { text: 'A premature pin. Black spends time on this bishop while the rest of his army sleeps — Morphy will exploit every lost tempo.', glyph: '?!' },
      13: { text: 'A double attack: the queen hits both b7 and, together with the bishop, the weak f7-square. Black is already forced to grovel.', key: true },
      14: { text: 'The queen must babysit the queenside, blocking the f8-bishop and condemning Black to passivity.' },
      17: { text: 'Every Morphy move develops a piece with a threat. Note that White has three pieces out and castling next; Black has one.' },
      19: { text: 'A piece sacrifice to rip open the b- and d-files toward the uncastled king. Development beats material when the king is stuck in the centre.', key: true, glyph: '!' },
      23: { text: 'Castling long puts the rook on the open d-file instantly — attacking and king safety in one move.' },
      25: { text: 'Removing the defender. The rook gives itself up for the knight so the last defenders of d8 are overloaded.', key: true, glyph: '!' },
      27: { text: 'The fresh rook takes over the pin on d7. Every White piece attacks; every Black piece is tied down.' },
      31: { text: 'The immortal queen sacrifice: the queen gives herself to drag the knight away from the d-file.', key: true, glyph: '!!' },
      33: { text: 'Mate with the last two pieces: bishop and rook. A perfect miniature on development, open files and the pin.', glyph: '!' },
    },
    keyMoments: [13, 19, 25, 31],
  },
  {
    id: 'immortal-1851',
    white: 'Adolf Anderssen',
    black: 'Lionel Kieseritzky',
    event: 'London (casual)',
    year: 1851,
    result: '1-0',
    eco: 'C33',
    opening: "King's Gambit Accepted, Bishop's Gambit",
    themes: ['attack', 'sacrifice'],
    difficulty: 'intermediate',
    blurb:
      'The Immortal Game: Anderssen gives up a bishop, both rooks and the queen — and mates with the three minor pieces he has left. Romantic chess at its absolute peak.',
    sans: [
      'e4', 'e5', 'f4', 'exf4', 'Bc4', 'Qh4+', 'Kf1', 'b5', 'Bxb5', 'Nf6',
      'Nf3', 'Qh6', 'd3', 'Nh5', 'Nh4', 'Qg5', 'Nf5', 'c6', 'g4', 'Nf6',
      'Rg1', 'cxb5', 'h4', 'Qg6', 'h5', 'Qg5', 'Qf3', 'Ng8', 'Bxf4', 'Qf6',
      'Nc3', 'Bc5', 'Nd5', 'Qxb2', 'Bd6', 'Bxg1', 'e5', 'Qxa1+', 'Ke2', 'Na6',
      'Nxg7+', 'Kd8', 'Qf6+', 'Nxf6', 'Be7#',
    ],
    annotations: {
      6: { text: 'An early queen raid. It wins the right to annoy White, but the queen will spend the whole game being chased around the board.' },
      21: { text: 'The first offer: the g1-rook is left to its fate. White wants open lines and time, not material.', key: true },
      28: { text: 'Driven all the way home. Count the tempi Black has lost with queen and knight moves — that time is what funds the sacrifices.' },
      33: { text: 'Both knights head for the king. White simply ignores the hanging rooks on a1 and g1.', glyph: '!' },
      34: { text: 'Grabbing the b2-pawn with the queen — miles from the defence of her own king. Fatally greedy.', glyph: '?' },
      35: { text: 'The point of everything: the bishop cuts the board in half and threatens the deadly discovered attack. Both rooks are still en prise.', key: true, glyph: '!!' },
      38: { text: 'Black takes the second rook — with check! — and still loses. Material means nothing when every one of your pieces is a spectator.' },
      41: { text: 'The knight crashes in; the king must walk. Note that Black is a queen, two bishops and a rook UP right now.' },
      43: { text: 'The queen goes too — the third and greatest gift, deflecting the knight from e7.', key: true, glyph: '!!' },
      45: { text: 'Mate by three minor pieces against a full army. The final position is one of the most famous in chess history.', key: true, glyph: '!' },
    },
    keyMoments: [21, 35, 43, 45],
  },
  {
    id: 'evergreen-1852',
    white: 'Adolf Anderssen',
    black: 'Jean Dufresne',
    event: 'Berlin (casual)',
    year: 1852,
    result: '1-0',
    eco: 'C52',
    opening: 'Evans Gambit',
    themes: ['attack', 'sacrifice', 'tactics'],
    difficulty: 'intermediate',
    blurb:
      'The Evergreen Game. A year after the Immortal, Anderssen does it again: a quiet rook move sets up a queen sacrifice and a double-check finish that is still studied in every combination book.',
    sans: [
      'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4', 'Bxb4', 'c3', 'Ba5',
      'd4', 'exd4', 'O-O', 'd3', 'Qb3', 'Qf6', 'e5', 'Qg6', 'Re1', 'Nge7',
      'Ba3', 'b5', 'Qxb5', 'Rb8', 'Qa4', 'Bb6', 'Nbd2', 'Bb7', 'Ne4', 'Qf5',
      'Bxd3', 'Qh5', 'Nf6+', 'gxf6', 'exf6', 'Rg8', 'Rad1', 'Qxf3', 'Rxe7+', 'Nxe7',
      'Qxd7+', 'Kxd7', 'Bf5+', 'Ke8', 'Bd7+', 'Kf8', 'Bxe7#',
    ],
    annotations: {
      7: { text: 'The Evans Gambit: a wing pawn buys two tempi for the classical centre and rapid development.' },
      21: { text: 'The a3-bishop takes dead aim at e7, freezing the black king in the centre — the strategic backbone of the whole attack.', key: true },
      33: { text: 'A knight sacrifice to tear open the g-file and expose the king that never castled.', glyph: '!' },
      36: { text: 'Black lines up mate on g2 himself — the game has become a race, and it is White to move.' },
      37: { text: 'The quiet move of the century. Amid mutual mating threats, the OTHER rook calmly joins in on d1, preparing the combination.', key: true, glyph: '!!' },
      38: { text: 'Black takes the knight, threatening mate in one on g2. It looks decisive — but Anderssen has seen one move further.', glyph: '?' },
      39: { text: 'The first hammer blow: the rook rips out the knight so the d-file battery can fire.', key: true, glyph: '!' },
      41: { text: 'The queen sacrifice — deflecting the king onto the d-file where bishop and rook wait.', key: true, glyph: '!!' },
      43: { text: 'Double check! The king must move, and every square leads into the net.' },
      47: { text: 'Mate. Two bishops deliver it while Black’s queen still stands one move from mating White. Calculation beats threats.', glyph: '!' },
    },
    keyMoments: [21, 37, 39, 41],
  },
  {
    id: 'paulsen-morphy-1857',
    white: 'Louis Paulsen',
    black: 'Paul Morphy',
    event: 'First American Chess Congress, New York',
    year: 1857,
    result: '0-1',
    eco: 'C48',
    opening: 'Four Knights Game',
    themes: ['sacrifice', 'tactics'],
    difficulty: 'intermediate',
    blurb:
      'Morphy’s most famous combination as Black: a stunning queen sacrifice for a light-square bind, ending in an unstoppable mating attack conducted by rook and bishop alone.',
    sans: [
      'e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6', 'Bb5', 'Bc5', 'O-O', 'O-O',
      'Nxe5', 'Re8', 'Nxc6', 'dxc6', 'Bc4', 'b5', 'Be2', 'Nxe4', 'Nxe4', 'Rxe4',
      'Bf3', 'Re6', 'c3', 'Qd3', 'b4', 'Bb6', 'a4', 'bxa4', 'Qxa4', 'Bd7',
      'Ra2', 'Rae8', 'Qa6', 'Qxf3', 'gxf3', 'Rg6+', 'Kh1', 'Bh3', 'Rd1', 'Bg2+',
      'Kg1', 'Bxf3+', 'Kf1', 'Bg2+', 'Kg1', 'Bh3+', 'Kh1', 'Bxf2', 'Qf1', 'Bxf1',
      'Rxf1', 'Re2', 'Ra1', 'Rh6', 'd4', 'Be3',
    ],
    annotations: {
      24: { text: 'The queen plants herself in the heart of White’s position, paralysing the d- and f-pawns. White has no good way to evict her.', key: true, glyph: '!' },
      33: { text: 'White finally attacks the intruder — but leaves the f3-bishop, his best defender, hanging in a deeper sense than he realises.', glyph: '?' },
      34: { text: 'One of the most celebrated moves ever played: the queen is given up for the bishop, because the light squares around White’s king cannot be defended.', key: true, glyph: '!!' },
      36: { text: 'The rook lifts into the attack with check. Every Black piece now aims at the naked king.', key: true },
      38: { text: 'The bishop settles on h3, weaving the mating net. White’s extra queen watches helplessly from a6.' },
      48: { text: 'Morphy repeats to reach the time control, then cashes in: the f2-pawn falls and the attack refreshes itself.' },
      52: { text: 'The rook infiltrates on the seventh; mate threats multiply faster than White can parry.', key: true },
      56: { text: 'The final quiet move — mate on h2 (or g1) cannot be stopped, so Paulsen resigned. An attack conducted a full queen down.', glyph: '!' },
    },
    keyMoments: [24, 34, 36, 56],
  },
  {
    id: 'steinitz-bardeleben-1895',
    white: 'Wilhelm Steinitz',
    black: 'Curt von Bardeleben',
    event: 'Hastings',
    year: 1895,
    result: '1-0',
    eco: 'C54',
    opening: 'Italian Game, Giuoco Piano',
    themes: ['attack', 'tactics'],
    difficulty: 'beginner',
    blurb:
      'The battle of Hastings. Steinitz keeps the enemy king stuck in the middle, then launches a rook that cannot be captured — by anything, for four moves running. Von Bardeleben left the hall rather than resign.',
    sans: [
      'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4',
      'cxd4', 'Bb4+', 'Nc3', 'd5', 'exd5', 'Nxd5', 'O-O', 'Be6', 'Bg5', 'Be7',
      'Bxd5', 'Bxd5', 'Nxd5', 'Qxd5', 'Bxe7', 'Nxe7', 'Re1', 'f6', 'Qe2', 'Qd7',
      'Rac1', 'c6', 'd5', 'cxd5', 'Nd4', 'Kf7', 'Ne6', 'Rhc8', 'Qg4', 'g6',
      'Ng5+', 'Ke8', 'Rxe7+', 'Kf8', 'Rf7+', 'Kg8', 'Rg7+', 'Kh8', 'Rxh7+',
    ],
    annotations: {
      12: { text: 'A well-known theoretical position of the Giuoco Piano: White accepts an isolated d-pawn in exchange for open lines and activity.' },
      28: { text: 'This little pawn move keeps the king in the centre one move too long — the e-file never stops mattering after this.', glyph: '?!' },
      33: { text: 'A pawn sacrifice to blast open the position while the black king still sits between the rooks.', key: true, glyph: '!' },
      37: { text: 'The knight lands on e6, a monster that cannot be taken because of the back-rank pins. Black’s pieces trip over each other.', key: true },
      41: { text: 'The knight retreats with check to clear the e-file — the calm before one of the most famous storms in chess.' },
      43: { text: 'The immortal rook: it can be captured by king, queen or... nothing safely. Kxe7 loses the queen to Re1+, Qxe7 drops the rook on c8 with mate to follow.', key: true, glyph: '!!' },
      45: { text: 'And again — the rook is still immune. Taking with the king or queen still loses on the spot.' },
      47: { text: 'Untouchable a third time: every capture fails tactically while the rook eats the kingside.' },
      49: { text: 'Von Bardeleben walked out of the tournament hall here. Steinitz demonstrated the forced mate in ten to the spectators.', key: true, glyph: '!' },
    },
    keyMoments: [33, 37, 43, 49],
  },
  {
    id: 'capablanca-tartakower-1924',
    white: 'José Raúl Capablanca',
    black: 'Savielly Tartakower',
    event: 'New York',
    year: 1924,
    result: '1-0',
    eco: 'A80',
    opening: 'Dutch Defence',
    themes: ['endgame', 'positional'],
    difficulty: 'advanced',
    blurb:
      'The most quoted rook endgame ever. Capablanca gives up pawns without blinking to activate his king and rook — the textbook demonstration that in rook endings, activity outranks material.',
    sans: [
      'd4', 'f5', 'Nf3', 'e6', 'c4', 'Nf6', 'Bg5', 'Be7', 'Nc3', 'O-O',
      'e3', 'b6', 'Bd3', 'Bb7', 'O-O', 'Qe8', 'Qe2', 'Ne4', 'Bxe7', 'Nxc3',
      'bxc3', 'Qxe7', 'a4', 'Bxf3', 'Qxf3', 'Nc6', 'Rfb1', 'Rae8', 'Qh3', 'Rf6',
      'f4', 'Na5', 'Qf3', 'd6', 'Re1', 'Qd7', 'e4', 'fxe4', 'Qxe4', 'g6',
      'g3', 'Kf8', 'Kg2', 'Rf7', 'h4', 'd5', 'cxd5', 'exd5', 'Qxe8+', 'Qxe8',
      'Rxe8+', 'Kxe8', 'h5', 'Rf6', 'hxg6', 'hxg6', 'Rh1', 'Kf8', 'Rh7', 'Rc6',
      'g4', 'Nc4', 'g5', 'Ne3+', 'Kf3', 'Nf5', 'Bxf5', 'gxf5', 'Kg3', 'Rxc3+',
      'Kh4', 'Rf3', 'g6', 'Rxf4+', 'Kg5', 'Re4', 'Kf6', 'Kg8', 'Rg7+', 'Kh8',
      'Rxc7', 'Re8', 'Kxf5', 'Re4', 'Kf6', 'Rf4+', 'Ke5', 'Rg4', 'g7+', 'Kg8',
      'Rxa7', 'Rg1', 'Kxd5', 'Rc1', 'Kd6', 'Rc2', 'd5', 'Rc1', 'Rc7', 'Ra1',
      'Kc6', 'Rxa4', 'd6',
    ],
    annotations: {
      49: { text: 'Capablanca happily trades into a rook endgame a pawn structure worse — he has judged that piece activity will decide, not pawn counting.', key: true },
      57: { text: 'The rook heads for the open h-file: the only file, and therefore the only thing that matters.' },
      59: { text: 'Seventh rank secured. From h7 the rook eyes every black pawn while the king prepares to march.', key: true, glyph: '!' },
      64: { text: 'Black wins a pawn with this check and will grab another — and it does not matter at all.' },
      69: { text: 'The legendary decision: White lets both queenside pawns go. The king walks INTO the kingside via g3–h4–g5–f6, escorted by the g-pawn.', key: true, glyph: '!!' },
      73: { text: 'A second pawn offered to open the road. Passed pawn plus active king plus seventh-rank rook beats two extra pawns.' },
      77: { text: 'The king arrives on f6. Mate threats appear from nowhere and Black must give back everything to survive.', key: true, glyph: '!' },
      89: { text: 'The g-pawn touches down on g7 with tempo; Black’s rook is now permanently tied to the back rank.' },
      103: { text: 'With the d-pawn racing and the black rook still babysitting g8, Tartakower resigned. Activity first — the eternal rook-endgame lesson.' },
    },
    keyMoments: [49, 59, 69, 77],
  },
  {
    id: 'byrne-fischer-1956',
    white: 'Donald Byrne',
    black: 'Robert James Fischer',
    event: 'Rosenwald Trophy, New York',
    year: 1956,
    result: '0-1',
    eco: 'D92',
    opening: 'Grünfeld Defence',
    themes: ['tactics', 'sacrifice'],
    difficulty: 'advanced',
    blurb:
      'The Game of the Century. Thirteen-year-old Fischer plays the immortal queen sacrifice 17...Be6!!, unleashes a windmill of discovered checks, and mates with a swarm of minor pieces.',
    sans: [
      'Nf3', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'd4', 'O-O', 'Bf4', 'd5',
      'Qb3', 'dxc4', 'Qxc4', 'c6', 'e4', 'Nbd7', 'Rd1', 'Nb6', 'Qc5', 'Bg4',
      'Bg5', 'Na4', 'Qa3', 'Nxc3', 'bxc3', 'Nxe4', 'Bxe7', 'Qb6', 'Bc4', 'Nxc3',
      'Bc5', 'Rfe8+', 'Kf1', 'Be6', 'Bxb6', 'Bxc4+', 'Kg1', 'Ne2+', 'Kf1', 'Nxd4+',
      'Kg1', 'Ne2+', 'Kf1', 'Nc3+', 'Kg1', 'axb6', 'Qb4', 'Ra4', 'Qxb6', 'Nxd1',
      'h3', 'Rxa2', 'Kh2', 'Nxf2', 'Re1', 'Rxe1', 'Qd8+', 'Bf8', 'Nxe1', 'Bd5',
      'Nf3', 'Ne4', 'Qb8', 'b5', 'h4', 'h5', 'Ne5', 'Kg7', 'Kg1', 'Bc5+',
      'Kf1', 'Ng3+', 'Ke1', 'Bb4+', 'Kd1', 'Bb3+', 'Kc1', 'Ne2+', 'Kb1', 'Nc3+',
      'Kc1', 'Rc2#',
    ],
    annotations: {
      21: { text: 'A natural developing move — and the losing mistake. The bishop steps away from the queenside just as lines are about to open there.', glyph: '?' },
      22: { text: 'The bolt from the blue that made the game famous: the knight offers itself to deflect the queen. If Qxa4, Nxe4 wins material by force.', key: true, glyph: '!!' },
      26: { text: 'Fischer takes the central pawn anyway: the knight is immune because of the fork on c3 and threats down the e-file.', glyph: '!' },
      32: { text: 'The rook check forces the king to f1 — the e-file and the a6-f1 diagonal become the geometry of the whole combination.' },
      34: { text: 'The immortal move. Thirteen-year-old Fischer leaves his queen hanging; the bishop’s discovered attack means White cannot afford to take it.', key: true, glyph: '!!' },
      36: { text: 'White grabs the queen — and now the machine starts: every Black move comes with check.' },
      38: { text: 'The windmill begins. Knight and bishop take turns checking while Black harvests material around the helpless king.', key: true },
      46: { text: 'Count again: for the queen, Black has a rook, two bishops and a pawn — and every piece active. The game is strategically over.' },
      58: { text: 'The bishop retreat covers the back rank; White’s queen checks run dry, and the material tells.' },
      70: { text: 'The mating net starts to close: the king is chased across the whole board by the minor pieces.', key: true },
      82: { text: 'Mate. Rook, two bishops and knight coordinate perfectly — the finish of what Hans Kmoch immediately named "The Game of the Century".', glyph: '!' },
    },
    keyMoments: [22, 34, 38, 82],
  },
  {
    id: 'tal-smyslov-1959',
    white: 'Mikhail Tal',
    black: 'Vasily Smyslov',
    event: 'Candidates Tournament, Bled–Zagreb–Belgrade',
    year: 1959,
    result: '1-0',
    eco: 'B10',
    opening: 'Caro-Kann Defence',
    themes: ['attack', 'sacrifice'],
    difficulty: 'intermediate',
    blurb:
      'Tal at his most Tal: against a world champion’s bulletproof Caro-Kann he sacrifices a pawn, then the queen itself, and the resulting piece storm decides before Smyslov’s extra material means anything.',
    sans: [
      'e4', 'c6', 'd3', 'd5', 'Nd2', 'e5', 'Ngf3', 'Nd7', 'd4', 'dxe4',
      'Nxe4', 'exd4', 'Qxd4', 'Ngf6', 'Bg5', 'Be7', 'O-O-O', 'O-O', 'Nd6', 'Qa5',
      'Bc4', 'b5', 'Bd2', 'Qa6', 'Nf5', 'Bd8', 'Qh4', 'bxc4', 'Qg5', 'Nh5',
      'Nh6+', 'Kh8', 'Qxh5', 'Qxa2', 'Bc3', 'Nf6', 'Qxf7', 'Qa1+', 'Kd2', 'Rxf7',
      'Nxf7+', 'Kg8', 'Rxa1', 'Kxf7', 'Ne5+', 'Ke6', 'Nxc6', 'Ne4+', 'Ke3', 'Bb6+',
      'Bd4',
    ],
    annotations: {
      9: { text: 'Tal opens the centre a tempo down, betting the whole game on piece activity — exactly the fight Smyslov’s solid setup wants to avoid.' },
      19: { text: 'The knight plants itself on d6, splitting Black’s position in two. Taking it would only help White’s dark-square grip.', key: true, glyph: '!' },
      25: { text: 'The knight hops onward to f5 — Tal simply ignores the attacked bishop on c4. Every move adds an attacker to the kingside.' },
      29: { text: 'A piece down for one pawn, Tal calmly improves the queen and threatens mate on g7. The attack plays itself.', key: true, glyph: '!' },
      34: { text: 'Smyslov grabs the a2-pawn with counter-threats of his own — the position is a knife fight, exactly where Tal wanted it.' },
      37: { text: 'The thunderbolt: the queen is offered on f7. Accepting it walks into the knight fork; declining loses the house anyway.', key: true, glyph: '!!' },
      41: { text: 'The point: the knight fork on f7 regains the queen with interest. Tal emerges a clean exchange and pawn up.' },
      45: { text: 'Even in the "technical" phase the knight keeps checking and eating. Smyslov resigned a few moves later.', key: true },
      51: { text: 'The bishop blocks the last check; Black has no follow-up and is hopelessly down material. A world champion beaten in 26 moves.' },
    },
    keyMoments: [19, 29, 37, 45],
  },
  {
    id: 'kasparov-topalov-1999',
    white: 'Garry Kasparov',
    black: 'Veselin Topalov',
    event: 'Hoogovens, Wijk aan Zee',
    year: 1999,
    result: '1-0',
    eco: 'B07',
    opening: 'Pirc Defence',
    themes: ['attack', 'sacrifice', 'tactics'],
    difficulty: 'advanced',
    blurb:
      'Kasparov’s Immortal. A rook sacrifice on d4 launches a fifteen-move king hunt that drives Topalov’s king from b8 all the way to d1 — many call it the greatest attacking game ever played.',
    sans: [
      'e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'Be3', 'Bg7', 'Qd2', 'c6',
      'f3', 'b5', 'Nge2', 'Nbd7', 'Bh6', 'Bxh6', 'Qxh6', 'Bb7', 'a3', 'e5',
      'O-O-O', 'Qe7', 'Kb1', 'a6', 'Nc1', 'O-O-O', 'Nb3', 'exd4', 'Rxd4', 'c5',
      'Rd1', 'Nb6', 'g3', 'Kb8', 'Na5', 'Ba8', 'Bh3', 'd5', 'Qf4+', 'Ka7',
      'Rhe1', 'd4', 'Nd5', 'Nbxd5', 'exd5', 'Qd6', 'Rxd4', 'cxd4', 'Re7+', 'Kb6',
      'Qxd4+', 'Kxa5', 'b4+', 'Ka4', 'Qc3', 'Qxd5', 'Ra7', 'Bb7', 'Rxb7', 'Qc4',
      'Qxf6', 'Kxa3', 'Qxa6+', 'Kxb4', 'c3+', 'Kxc3', 'Qa1+', 'Kd2', 'Qb2+', 'Kd1',
      'Bf1', 'Rd2', 'Rd7', 'Rxd7', 'Bxc4', 'bxc4', 'Qxh8', 'Rd3', 'Qa8', 'c3',
      'Qa4+', 'Ke1', 'f4', 'f5', 'Kc1', 'Rd2', 'Qa7',
    ],
    annotations: {
      38: { text: 'Topalov strikes in the centre, confident his king is safe on the queenside. The next few moves prove otherwise.' },
      43: { text: 'The knight offers itself on d5 to blow open the long diagonal and the centre files.', glyph: '!' },
      47: { text: 'The immortal rook sacrifice: Rxd4!! draws the pawn away so the queen arrives on d4 with tempo against the exposed king.', key: true, glyph: '!!' },
      49: { text: 'The rook joins with check and cannot be taken. The king hunt officially begins.', key: true, glyph: '!' },
      52: { text: 'Forced to march: the king must capture on a5, stepping onto the conveyor belt Kasparov has built.' },
      55: { text: 'A quiet queen retreat in the middle of a hurricane — threatening mate and cutting off the escape squares. Calculated to the end.', key: true, glyph: '!!' },
      65: { text: 'Another silent killer: the c-pawn joins with check, and the king is dragged into White’s own camp.', glyph: '!' },
      66: { text: 'The black king reaches c3 — deeper in enemy territory than any world-class king before or since. It never gets home.', key: true },
      71: { text: 'With the king finally cornered on d1, Kasparov switches flanks: the bishop retreat renews threats the exhausted defence cannot meet.', glyph: '!' },
      87: { text: 'The dust settles: White’s queen dominates and the h-pawn will cost the rook. Topalov resigned — the end of a fifteen-move king hunt.' },
    },
    keyMoments: [47, 49, 55, 66],
  },
  {
    id: 'carlsen-ernst-2004',
    white: 'Magnus Carlsen',
    black: 'Sipke Ernst',
    event: 'Corus C, Wijk aan Zee',
    year: 2004,
    result: '1-0',
    eco: 'B19',
    opening: 'Caro-Kann Defence, Classical',
    themes: ['attack', 'sacrifice'],
    difficulty: 'intermediate',
    blurb:
      'Thirteen-year-old Magnus announces himself: a knight, a bishop and a rook all land on the black king’s doorstep in succession, and the game ends in a picture-perfect mate after 29 moves.',
    sans: [
      'e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6',
      'h4', 'h6', 'Nf3', 'Nd7', 'h5', 'Bh7', 'Bd3', 'Bxd3', 'Qxd3', 'e6',
      'Bf4', 'Ngf6', 'O-O-O', 'Be7', 'Ne4', 'Qa5', 'Kb1', 'O-O', 'Nxf6+', 'Nxf6',
      'Ne5', 'Rad8', 'Qe2', 'c5', 'Ng6', 'fxg6', 'Qxe6+', 'Kh8', 'hxg6', 'Ng8',
      'Bxh6', 'gxh6', 'Rxh6+', 'Nxh6', 'Qxe7', 'Nf7', 'gxf7', 'Kg7', 'Rd3', 'Rd6',
      'Rg3+', 'Rg6', 'Qe5+', 'Kxf7', 'Qf5+', 'Rf6', 'Qd7#',
    ],
    annotations: {
      15: { text: 'Standard Classical Caro-Kann theory: White gains kingside space with h4–h5 while both sides develop calmly.' },
      28: { text: 'Castling into it. The kingside pawns around Black’s king are about to face every White piece.', glyph: '?!' },
      31: { text: 'The knight takes the e5 outpost and eyes g6/f7. White’s whole army points at the king.', key: true },
      35: { text: 'The first sacrifice: the knight crashes into g6, shredding the pawn cover. Declining was impossible.', key: true, glyph: '!' },
      41: { text: 'The second sacrifice — the bishop goes, too, opening the h-file the h5-pawn spent the opening preparing.', glyph: '!' },
      43: { text: 'And the third: the rook gives itself on h6 to drag the knight away from defending e7 and f6.', key: true, glyph: '!!' },
      47: { text: 'Material is roughly equal again — but every remaining White piece attacks, and the black king has no shelter at all.' },
      53: { text: 'The queen closes in with checks; the king is walked into the crossfire of queen, rook and pawn.' },
      57: { text: 'A pure mate: king walled in by his own rooks, queen delivering from d7. A 13-year-old’s masterpiece — Carlsen’s first famous brilliancy.', key: true, glyph: '!' },
    },
    keyMoments: [31, 35, 43, 57],
  },
];

export const MASTER_GAMES_BY_ID: Record<string, MasterGame> = Object.fromEntries(
  MASTER_GAMES.map((g) => [g.id, g]),
);
