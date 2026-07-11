/**
 * Track 4 — Positional Play: the quiet skills that decide games between
 * tactics. Weak squares, outposts, the isolated queen's pawn (both sides),
 * passed pawns and majorities, good vs bad bishops, and open files.
 */
import type { Lesson, LessonTrack } from '../types';

export const POSITIONAL_LESSONS: Lesson[] = [
  {
    id: 'positional-weak-squares',
    title: 'Weak Squares',
    icon: '🕳️',
    summary: 'Spot the holes no enemy pawn can ever defend — then move in for good.',
    steps: [
      {
        kind: 'info',
        title: 'What makes a square weak?',
        text: 'A weak square (a “hole”) is a square that can never again be defended by an enemy pawn — usually because the pawns that could have guarded it have advanced or disappeared. Here Black’s c6 and e6 pawns have marched past d6: no black pawn will ever attack d6 again. A piece you park there can’t be shooed away.',
        fen: '1r4k1/5ppp/2p1p3/8/2N5/8/5PPP/6K1 w - - 0 1',
        shapes: [
          { orig: 'd6', brush: 'red' },
          { orig: 'c6', dest: 'b5', brush: 'yellow' },
          { orig: 'e6', dest: 'f5', brush: 'yellow' },
        ],
      },
      {
        kind: 'exercise',
        fen: '1r4k1/5ppp/2p1p3/8/2N5/8/5PPP/6K1 w - - 0 1',
        prompt: 'Occupy the hole! Land your knight on the square Black’s pawns abandoned forever.',
        goal: { type: 'move', moves: ['c4d6'] },
        shapes: [{ orig: 'd6', brush: 'green' }],
        hint: 'Nd6! The c6 and e6 pawns only guard b5/d5 and d5/f5 — d6 itself can never be hit by a pawn again, so the knight sits there for the rest of the game.',
        success: 'A knight on d6 is worth its weight in gold — Black can never kick it with a pawn, only trade a whole piece for it.',
      },
      {
        kind: 'info',
        title: 'Weak squares around the king',
        text: 'Weak squares are deadliest near a king. Black once had a bishop on g7 guarding the dark squares — it’s gone, and the pawn on g6 can’t cover g7 or h6. Those dark holes are an open invitation for your queen, and your b2 bishop already stares down the long diagonal.',
        fen: 'r4rk1/pp3p1p/6p1/8/8/8/PB1Q1PPP/6K1 w - - 0 1',
        shapes: [
          { orig: 'h6', brush: 'red' },
          { orig: 'g7', brush: 'red' },
          { orig: 'b2', dest: 'g7', brush: 'blue' },
        ],
      },
      {
        kind: 'exercise',
        fen: 'r4rk1/pp3p1p/6p1/8/8/8/PB1Q1PPP/6K1 w - - 0 1',
        prompt: 'Sink your queen into the dark-square hole next to the king, then finish the game on the other one.',
        goal: { type: 'line', moves: ['d2h6', 'f8e8', 'h6g7'] },
        hint: 'Qh6! No black pawn or piece can touch that square. The mate threat on g7 is backed by your b2 bishop — Black’s only defence was ...f6, and the rook move doesn’t help.',
        success: 'Qg7 mate — queen protected by the bishop, king trapped by its own pawns. Weak squares near a king decide games.',
      },
    ],
  },
  {
    id: 'positional-outposts',
    title: 'Outposts',
    icon: '🏰',
    summary: 'Plant a knight on a protected square in enemy territory — and leave it there.',
    steps: [
      {
        kind: 'info',
        title: 'The perfect knight square',
        text: 'An outpost is a weak square upgraded: it sits in the opponent’s half, no enemy pawn can ever attack it, AND one of your own pawns defends it. A knight on an outpost is often stronger than a rook — it dominates everything around it and can only be removed by giving up a piece.',
        fen: 'r1b1r1k1/pp2bppp/3p4/4p3/2P1P3/2N5/PP3PPP/R1B2RK1 w - - 0 1',
        shapes: [
          { orig: 'd5', brush: 'green' },
          { orig: 'c4', dest: 'd5', brush: 'blue' },
        ],
      },
      {
        kind: 'exercise',
        fen: 'r1b1r1k1/pp2bppp/3p4/4p3/2P1P3/2N5/PP3PPP/R1B2RK1 w - - 0 1',
        prompt: 'Black’s pawns on d6 and e5 have left a gorgeous square undefendable — and your c4 pawn covers it. Jump in!',
        goal: { type: 'move', moves: ['c3d5'] },
        hint: 'Nd5 is the move. Nb5 looks similar but gets kicked at once by ...a6 — an outpost must be a square enemy pawns can never reach, and only d5 qualifies (Black’s c-pawn is gone, and d6/e5 have marched past it).',
        success: 'A monster on d5: protected by the c4 pawn, immune to enemy pawns, hitting e7, c7, b6 and f6 all at once.',
      },
      {
        kind: 'info',
        title: 'Outposts near the king',
        text: 'The closer an outpost sits to the enemy king, the more dangerous it is. Black has traded off the g6 fianchetto pawn structure — with the g-pawn gone and the e-pawn on e5, the f5 square right next to the king can never be touched by a black pawn, and your e4 pawn guards it.',
        fen: 'r2q1rk1/pp3p1p/3p4/4p3/4P3/6N1/PPP2PPP/R2Q1RK1 w - - 0 1',
        shapes: [
          { orig: 'f5', brush: 'green' },
          { orig: 'e4', dest: 'f5', brush: 'blue' },
        ],
      },
      {
        kind: 'exercise',
        fen: 'r2q1rk1/pp3p1p/3p4/4p3/4P3/6N1/PPP2PPP/R2Q1RK1 w - - 0 1',
        prompt: 'Post your knight on the hole beside Black’s king — the attack will play itself from there.',
        goal: { type: 'move', moves: ['g3f5'] },
        shapes: [{ orig: 'f5', brush: 'green' }],
        hint: 'Nf5! Protected by e4, unreachable by any black pawn (the g-pawn is gone), and from f5 the knight eyes g7, h6 and d6 — Black must constantly watch for Nh6+ and queen-and-knight mating nets.',
        success: 'From f5 the knight ties Black to permanent defence — Nh6+ and Qg4-with-Qg7 ideas hang over the king forever.',
      },
    ],
  },
  {
    id: 'positional-iqp',
    title: 'The Isolated Queen’s Pawn',
    icon: '🏝️',
    summary: 'One pawn, two stories: attack with the isolani — or blockade and besiege it.',
    steps: [
      {
        kind: 'info',
        title: 'A pawn with no friends',
        text: 'An isolated queen’s pawn (IQP) has no pawns on the neighbouring files — nothing can ever defend it except pieces. But it’s not just a weakness: it grants you the e5 outpost, open lines for your pieces, and the thematic d4–d5 break. Rule of thumb: with the IQP, attack in the middlegame; against it, trade pieces and besiege it in the endgame.',
        fen: 'r1bq1rk1/pp3ppp/4pn2/8/3P4/5N2/PP3PPP/R1BQ1RK1 w - - 0 1',
        shapes: [
          { orig: 'd4', brush: 'yellow' },
          { orig: 'e5', brush: 'green' },
        ],
      },
      {
        kind: 'exercise',
        fen: 'r1bq1rk1/pp3ppp/4pn2/8/3P4/5N2/PP3PPP/R1BQ1RK1 w - - 0 1',
        prompt: 'Play WITH the isolani: your d4 pawn guards a beautiful advanced square. Put your knight on it.',
        goal: { type: 'move', moves: ['f3e5'] },
        shapes: [{ orig: 'e5', brush: 'green' }],
        hint: 'Ne5! The IQP’s gift: e5 is protected by d4, and Black’s e-pawn on e6 has already walked past it. From e5 the knight spearheads every kingside attack.',
        success: 'The classic IQP knight — protected by the isolani itself and glaring at d7, f7 and g6.',
      },
      {
        kind: 'exercise',
        fen: 'r2q1rk1/pp3ppp/2n1b3/8/3P4/5N2/PP3PPP/R1BQ1RK1 w - - 0 1',
        prompt: 'The isolani’s other weapon: the breakthrough. Push it and fork two pieces at once!',
        goal: { type: 'move', moves: ['d4d5'] },
        hint: 'd5! The pawn attacks the c6 knight and the e6 bishop simultaneously, and your queen on d1 backs it up — after ...Bxd5 Qxd5 you’ve won a bishop for a pawn.',
        success: 'The d5 break in full glory: whichever piece runs, you win the other. An isolani that reaches d5 stops being weak.',
      },
      {
        kind: 'info',
        title: 'Switching sides',
        text: 'Now Black has the isolated pawn, on d5. The square directly in front of it — d4 — is your prize: no black pawn can ever attack it, and a piece parked there both blockades the pawn (so it can never advance) and radiates power. Knights make the best blockaders.',
        fen: 'r1bq1rk1/pp3ppp/5n2/3p4/8/5N2/PP2QPPP/R1B2RK1 w - - 0 1',
        shapes: [
          { orig: 'd5', brush: 'red' },
          { orig: 'd4', brush: 'green' },
        ],
      },
      {
        kind: 'exercise',
        fen: 'r1bq1rk1/pp3ppp/5n2/3p4/8/5N2/PP2QPPP/R1B2RK1 w - - 0 1',
        prompt: 'Play AGAINST the isolani: blockade it. Plant your knight on the square the pawn can never cross.',
        goal: { type: 'move', moves: ['f3d4'] },
        shapes: [{ orig: 'd4', brush: 'green' }],
        hint: 'Nd4! First restrain, then blockade, then destroy (Nimzowitsch). On d4 the knight can never be hit by a pawn — Black’s c- and e-pawns are gone — and the frozen d5 pawn becomes a lasting target.',
        success: 'Blockade complete. The pawn is stopped forever; now trade pieces, gang up on d5 and win it in the endgame.',
      },
    ],
  },
  {
    id: 'positional-passed-pawns',
    title: 'Passed Pawns & Majorities',
    icon: '🎖️',
    summary: 'Turn a pawn majority into a passer, race it home, and back it the right way.',
    steps: [
      {
        kind: 'info',
        title: 'The criminal that must be stopped',
        text: 'A passed pawn has no enemy pawn ahead of it — on its own file or the neighbouring ones. Nothing but pieces can stop it, so it ties the opponent down and grows stronger with every step. You manufacture one from a pawn majority: here White’s three queenside pawns face only two.',
        fen: '6k1/pp3ppp/8/8/8/8/PPP2PPP/6K1 w - - 0 1',
        shapes: [
          { orig: 'a2', brush: 'blue' },
          { orig: 'b2', brush: 'blue' },
          { orig: 'c2', brush: 'green' },
        ],
      },
      {
        kind: 'exercise',
        fen: '6k1/pp3ppp/8/8/8/8/PPP2PPP/6K1 w - - 0 1',
        prompt: 'Convert the 3-vs-2 majority. Golden rule: the CANDIDATE — the pawn with no opponent on its file — advances first. Push it!',
        goal: { type: 'move', moves: ['c2c4', 'c2c3'] },
        shapes: [{ orig: 'c2', brush: 'green' }],
        hint: 'The c-pawn is the candidate — it faces no black pawn. Leading with 1.b4? runs into ...b5!, fixing your pawns so no passer can be created without your king’s help.',
        success: 'Candidate first! Now b4 and c5 follow, and a passed c-pawn is born while Black’s two pawns hold nothing back.',
      },
      {
        kind: 'exercise',
        fen: '8/5k2/8/1P6/8/8/8/6K1 w - - 0 1',
        prompt: 'Race! The black king sprints over — but is it fast enough? Run your passer all the way to a queen.',
        goal: { type: 'line', moves: ['b5b6', 'f7e8', 'b6b7', 'e8d7', 'b7b8q'] },
        hint: 'Just push: b6, b7, b8=Q. Draw the “square” from b5 to e8 — the king on f7 stands outside it, so it can never catch the pawn.',
        success: 'Promoted! The square rule told you before move one: king outside the square = the pawn walks in untouched.',
      },
      {
        kind: 'info',
        title: 'Rooks belong behind passed pawns',
        text: 'Tarrasch’s famous rule: place your rook BEHIND a passed pawn — your own or the opponent’s. Behind your passer, the rook gains scope with every advance and shoves it forward. A rook in FRONT of the pawn does the opposite: it blocks its own pawn and loses squares as it marches.',
        fen: 'r5k1/5ppp/8/P7/8/8/5PPP/4R1K1 w - - 0 1',
        shapes: [
          { orig: 'a5', brush: 'green' },
          { orig: 'a8', brush: 'red' },
        ],
      },
      {
        kind: 'exercise',
        fen: 'r5k1/5ppp/8/P7/8/8/5PPP/4R1K1 w - - 0 1',
        prompt: 'Black’s rook sits in front of your passer — the worst square for it. Put YOUR rook on the best one.',
        goal: { type: 'move', moves: ['e1a1'] },
        shapes: [{ orig: 'a1', brush: 'green' }],
        hint: 'Ra1! From behind, your rook escorts the pawn up the board. Black’s rook on a8 is now a full-time babysitter: every pawn step steals another square from it, and the moment it leaves, the pawn runs.',
        success: 'Textbook Tarrasch. Your rook grows stronger as the pawn advances; Black’s rook is chained to the a-file for life.',
      },
    ],
  },
  {
    id: 'positional-bishops',
    title: 'Good Bishop, Bad Bishop',
    icon: '👼',
    summary: 'Keep pawns off your bishop’s colour — and hunt pawns stuck on the enemy’s.',
    steps: [
      {
        kind: 'info',
        title: 'What makes a bishop bad?',
        text: 'A bishop only ever sees half the board, so its worth depends entirely on the pawns. Pawns fixed on the SAME colour as a bishop block it — that’s a bad bishop. Here Black’s pawns on b5 and d5 are frozen on light squares: Black’s own dark-squared bishop can never defend them, while your light-squared bishop attacks them at will.',
        fen: '6k1/5ppp/3b4/1p1p4/8/8/4BPPP/6K1 w - - 0 1',
        shapes: [
          { orig: 'b5', brush: 'red' },
          { orig: 'd5', brush: 'red' },
          { orig: 'd6', brush: 'yellow' },
          { orig: 'e2', brush: 'green' },
        ],
      },
      {
        kind: 'exercise',
        fen: 'r4rk1/pp3ppp/8/8/3P4/8/PB3PPP/R5K1 w - - 0 1',
        prompt: 'Your b2 bishop stares at… its own d4 pawn. One pawn move opens the long diagonal straight at Black’s king. Find it.',
        goal: { type: 'move', moves: ['d4d5'] },
        shapes: [{ orig: 'b2', dest: 'g7', brush: 'blue' }],
        hint: 'd5! The pawn steps from a dark square to a light one, out of the bishop’s way — suddenly Bb2 rakes the a1–h8 diagonal and hits g7. Any other move leaves the bishop biting on its own pawn.',
        success: 'Diagonal open, bishop reborn. Rule: put your pawns on the OPPOSITE colour of your bishop.',
      },
      {
        kind: 'exercise',
        fen: '6k1/5ppp/3b4/1p1p4/8/8/4BPPP/6K1 w - - 0 1',
        prompt: 'Good bishop vs bad bishop, live. Attack the frozen d5 pawn — Black’s bishop can’t ever defend it — then take it.',
        goal: { type: 'line', moves: ['e2f3', 'd6c5', 'f3d5'] },
        hint: 'Bf3 hits d5, and no black piece of the right colour exists to guard it. Even ...d4 only postpones the pain — your bishop reroutes via e2 and picks up b5 instead. Pawns on your bishop’s colour are permanent targets.',
        success: 'Pawn won, and b5 is next. A good bishop farms enemy pawns fixed on its colour while the bad bishop can only watch.',
      },
    ],
  },
  {
    id: 'positional-open-files',
    title: 'Open Files & the 7th Rank',
    icon: '🛣️',
    summary: 'Rooks crave open files — grab the file first, then invade the 7th rank.',
    steps: [
      {
        kind: 'info',
        title: 'Highways for rooks',
        text: 'A rook behind its own pawns is a sleeping giant. An OPEN file — one with no pawns on it — is a highway into the enemy camp, and whoever controls it first usually owns it for the rest of the game. Here only the d-file is open; the fight for it starts now.',
        fen: 'r4rk1/ppp1pp1p/6p1/8/8/6P1/PPP1PP1P/R4RK1 w - - 0 1',
        shapes: [
          { orig: 'd1', brush: 'green' },
          { orig: 'd8', brush: 'green' },
        ],
      },
      {
        kind: 'exercise',
        fen: 'r4rk1/ppp1pp1p/6p1/8/8/6P1/PPP1PP1P/R4RK1 w - - 0 1',
        prompt: 'One file on the board has no pawns at all. Claim it with a rook before Black does!',
        goal: { type: 'move', moves: ['f1d1', 'a1d1'] },
        hint: 'The d-file is the only open one — put either rook on d1. Rooks on closed files (like a1 or f1 right now) stare at their own pawns and do nothing.',
        success: 'File seized! If Black contests with ...Rd8 you exchange or double — either way the highway is yours first.',
      },
      {
        kind: 'exercise',
        fen: '5rk1/pp3ppp/8/8/8/8/PP3PPP/3R2K1 w - - 0 1',
        prompt: 'You own the open file — now cash it in. Invade the 7th rank, where the pawns live, and win one.',
        goal: { type: 'line', moves: ['d1d7', 'a7a6', 'd7b7'] },
        hint: 'Rd7! On the 7th rank the rook attacks b7 sideways and pins Black to defence. When Black scurries with ...a6, simply take: Rxb7 — the pawn had no defender left.',
        success: 'A rook on the 7th eats pawns for breakfast and cages the king on the back rank — the classic payoff of file control.',
      },
      {
        kind: 'info',
        title: 'The full plan',
        text: 'Remember the sequence: 1) spot or create an open file, 2) be first to put a rook (or doubled rooks) on it, 3) invade the 7th rank and harvest. Grandmasters call two rooks on the 7th “pigs” — they gobble everything. Combine this with the outposts and weak squares from earlier lessons and you have a complete positional toolkit.',
      },
    ],
  },
];

/**
 * Ready-to-register track object (intermediate→advanced difficulty). The
 * integrator adds this to LESSON_TRACKS in learn/index.ts and bumps the track
 * count in content.test.ts.
 */
export const POSITIONAL_TRACK: LessonTrack = {
  id: 'positional',
  title: 'Positional Play',
  blurb: 'Intermediate–advanced strategy: weak squares, outposts, pawn play, bishops and rooks.',
  lessons: POSITIONAL_LESSONS,
};
