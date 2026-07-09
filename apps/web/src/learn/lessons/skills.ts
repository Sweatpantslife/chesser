/**
 * Track 2 — Level up: beginner→intermediate concepts once the rules are down.
 * Piece values, the classic tactic motifs, opening principles, the two
 * must-know mates and pawn-endgame survival skills.
 */
import type { Lesson } from '../types';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const SKILLS_LESSONS: Lesson[] = [
  {
    id: 'skill-value',
    title: 'What Is It Worth?',
    icon: '⚖️',
    summary: 'Pawn 1 · knight 3 · bishop 3 · rook 5 · queen 9. Trade up, not down.',
    steps: [
      {
        kind: 'info',
        title: 'The price list',
        text: 'Every piece has a rough value in pawns: pawn 1, knight 3, bishop 3, rook 5, queen 9 — and the king is priceless. Use the price list to judge every trade: winning a rook for a bishop is +2, losing your queen for a rook is -4.',
      },
      {
        kind: 'exercise',
        fen: '7k/8/3r4/6b1/4N3/8/8/7K w - - 0 1',
        prompt: 'Your knight can capture a rook or a bishop. Grab the bigger prize!',
        goal: { type: 'move', moves: ['e4d6'] },
        hint: 'Bishop = 3, rook = 5. Take the rook on d6.',
        success: 'Rook (5) beats bishop (3). Always count your loot.',
      },
      {
        kind: 'exercise',
        fen: '7k/8/4p3/3r4/n7/8/8/3Q3K w - - 0 1',
        prompt: 'Your queen can take a rook or a knight. But look closer — one of them is a trap. Make the capture that wins material.',
        goal: { type: 'move', moves: ['d1a4'] },
        hint: 'The pawn on e6 guards the rook — queen (9) for rook (5) is a terrible deal. The knight on a4 is completely free.',
        success: 'A free knight beats a poisoned rook. Defenders change everything.',
      },
    ],
  },
  {
    id: 'skill-forks',
    title: 'Forks',
    icon: '🍴',
    summary: 'Attack two things at once — they can’t both escape.',
    steps: [
      {
        kind: 'info',
        title: 'One move, two threats',
        text: 'A fork attacks two targets with one piece at the same time. Your opponent can only save one. Knights are the fork champions — their weird jump hits squares no one is watching.',
      },
      {
        kind: 'exercise',
        fen: 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1',
        prompt: 'Jump your knight to the square that attacks the king AND the rook at once — then collect your prize.',
        goal: { type: 'line', moves: ['b5c7', 'e8e7', 'c7a8'] },
        hint: 'From c7 the knight checks the king on e8 and eyes the rook on a8.',
        success: 'The royal fork: check forces the king to move, and the rook is yours.',
      },
      {
        kind: 'exercise',
        fen: '7k/8/8/2n1b3/8/3P4/8/7K w - - 0 1',
        prompt: 'Even a humble pawn can fork. Attack both black pieces with one pawn move!',
        goal: { type: 'move', moves: ['d3d4'] },
        hint: 'Push the pawn one square — it will attack diagonally in both directions.',
        success: 'A one-pawn ambush. One of the pieces must fall.',
      },
      {
        kind: 'exercise',
        fen: 'r5k1/8/8/8/8/8/8/3Q2K1 w - - 0 1',
        prompt: 'The queen forks from long range. Check the king and attack the loose rook with one move — then take it.',
        goal: { type: 'line', moves: ['d1d5', 'g8f8', 'd5a8'] },
        hint: 'Find the square where the queen sees g8 on one diagonal and a8 on the other.',
        success: 'Check, king moves, rook falls. Queens love loose pieces.',
      },
    ],
  },
  {
    id: 'skill-pins',
    title: 'Pins',
    icon: '📌',
    summary: 'Freeze a piece against something more valuable behind it.',
    steps: [
      {
        kind: 'info',
        title: 'Stuck in place',
        text: 'A pin happens when a bishop, rook or queen attacks through an enemy piece to something precious behind it. If the king is behind, the pinned piece literally cannot move. A pinned piece is a frozen target — pile up on it!',
      },
      {
        kind: 'exercise',
        fen: '4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1',
        prompt: 'Slide your bishop to the square that pins the knight to its king.',
        goal: { type: 'move', moves: ['f1b5'] },
        hint: 'Find the diagonal where the bishop, the knight and the black king all line up.',
        success: 'Pinned! That knight is frozen solid — it cannot legally move.',
      },
      {
        kind: 'exercise',
        fen: '4k3/8/2n5/1B6/3P4/8/8/4K3 w - - 0 1',
        prompt: 'The knight is pinned — it even wants to take your pawn but legally can’t. Attack the frozen knight with your pawn!',
        goal: { type: 'move', moves: ['d4d5'] },
        hint: 'Push the d-pawn. The knight cannot run — moving it would expose the king.',
        success: 'The knight can’t flee and can’t be saved. Pins turn pieces into targets.',
      },
    ],
  },
  {
    id: 'skill-skewers',
    title: 'Skewers',
    icon: '🍢',
    summary: 'A pin in reverse: the big piece must move and expose the one behind.',
    steps: [
      {
        kind: 'info',
        title: 'The reverse pin',
        text: 'A skewer is a pin flipped around: the MORE valuable piece stands in front. When you attack it, it must move — revealing the piece behind, which you take. King in front, rook behind is the classic.',
      },
      {
        kind: 'exercise',
        fen: '4r3/8/8/4k3/8/8/8/R5K1 w - - 0 1',
        prompt: 'King and rook share the e-file. Check the king — when it steps aside, take what it was hiding.',
        goal: { type: 'line', moves: ['a1e1', 'e5f6', 'e1e8'] },
        hint: 'Swing your rook to e1. The king must leave the file, abandoning the rook on e8.',
        success: 'Skewered! The king had to move and the rook was left behind.',
      },
      {
        kind: 'exercise',
        fen: '6r1/k7/8/3q4/8/1P6/4B3/4K3 w - - 0 1',
        prompt: 'The queen and rook share a diagonal. Attack the queen with your (protected!) bishop — she must run, then collect the rook.',
        goal: { type: 'line', moves: ['e2c4', 'd5d6', 'c4g8'] },
        hint: 'Bishop to c4 — your b3 pawn protects it, so the queen can’t just take. She must flee the diagonal.',
        success: 'A bishop for a rook — the skewer pays out again.',
      },
    ],
  },
  {
    id: 'skill-opening',
    title: 'Opening Principles',
    icon: '🚀',
    summary: 'Center, develop, castle — the three golden rules of move one.',
    steps: [
      {
        kind: 'info',
        title: 'The three golden rules',
        text: 'You don’t need to memorize openings — you need principles: 1) Fight for the center with a pawn. 2) Develop your knights and bishops toward the middle. 3) Castle early to tuck your king away. Do these every game and you’ll be fine.',
      },
      {
        kind: 'exercise',
        fen: START_FEN,
        prompt: 'Rule one: stake a claim in the center. Push a center pawn two squares!',
        goal: { type: 'move', moves: ['e2e4', 'd2d4'] },
        hint: 'e4 or d4 — the two most popular first moves in history.',
        success: 'Center claimed. Your pieces now have room to breathe.',
      },
      {
        kind: 'exercise',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
        prompt: 'Rule two: develop! Bring a knight toward the center (knights before bishops).',
        goal: { type: 'move', moves: ['g1f3', 'b1c3'] },
        hint: 'Nf3 is the dream square — it develops AND attacks the e5 pawn.',
        success: 'Developed with tempo. Every move should put a piece to work.',
      },
      {
        kind: 'exercise',
        fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
        prompt: 'Rule three: your kingside is clear — castle and get your king to safety!',
        goal: { type: 'move', moves: ['e1g1'] },
        shapes: [{ orig: 'g1', brush: 'green' }],
        hint: 'Slide the king two squares to g1.',
        success: 'King safe, rook connected — opening accomplished.',
      },
    ],
  },
  {
    id: 'skill-mate-kq',
    title: 'Mate with the Queen',
    icon: '💃',
    summary: 'King + queen vs. king — the win you must never fumble.',
    steps: [
      {
        kind: 'info',
        title: 'Teamwork wins it',
        text: 'A lone queen cannot mate by herself — she needs the king’s help. The plan: box the enemy king to the edge with the queen, march your king over, then deliver mate. Two classic finishes: the queen lands right in front of the king (protected by yours), or checks along the edge.',
      },
      {
        kind: 'exercise',
        fen: '4k3/8/4K3/8/8/8/8/7Q w - - 0 1',
        prompt: 'Your king already faces his rival. Find the queen move that mates on the spot!',
        goal: { type: 'checkmate' },
        hint: 'Check along the 8th rank — your king covers all the escape squares in front.',
        success: 'Mate! The king blocks the front door, the queen slams the back one.',
      },
      {
        kind: 'exercise',
        fen: '1k6/8/1K6/8/8/8/8/5Q2 w - - 0 1',
        prompt: 'Same teamwork, new corner of the board. Deliver mate in one!',
        goal: { type: 'checkmate' },
        hint: 'The 8th rank again — everything on the 7th is already covered by your king.',
        success: 'Textbook. Face the kings off, then check along the edge.',
      },
      {
        kind: 'info',
        title: 'Beware the stalemate!',
        text: 'The queen is so strong she can accidentally end the game in a draw: here Black, to move, is NOT in check but has zero legal moves — stalemate. Until your own king arrives, always leave the cornered king at least one square to shuffle on.',
        fen: 'k7/8/1Q6/8/8/8/8/4K3 b - - 0 1',
        shapes: [
          { orig: 'a7', brush: 'red' },
          { orig: 'b7', brush: 'red' },
          { orig: 'b8', brush: 'red' },
        ],
      },
    ],
  },
  {
    id: 'skill-mate-rooks',
    title: 'Mate with Rooks',
    icon: '🪜',
    summary: 'The rook ladder and the classic king-and-rook finish.',
    steps: [
      {
        kind: 'info',
        title: 'The ladder mate',
        text: 'Two rooks mate without any help: one rook checks, cutting off a rank — the other leapfrogs to check the next rank. Like climbing a ladder, the enemy king gets pushed to the edge, where the final check is mate.',
      },
      {
        kind: 'exercise',
        fen: '8/8/8/3k4/8/8/8/R3K2R w - - 0 1',
        prompt: 'Climb the ladder! Alternate your rooks — check, cut off, check — and drive the king up the board into mate.',
        goal: { type: 'line', moves: ['h1h5', 'd5d6', 'a1a6', 'd6d7', 'h5h7', 'd7d8', 'a6a8'] },
        hint: 'Check with one rook, then leapfrog the other: Rh5+, Ra6+, Rh7+, Ra8#.',
        success: 'Rung by rung to the top — the ladder mate never fails.',
      },
      {
        kind: 'info',
        title: 'One rook needs the king',
        text: 'With a single rook your king must help: use the rook to fence the enemy king in, walk your king up until the two kings face each other, then check along the edge — mate.',
      },
      {
        kind: 'exercise',
        fen: '4k3/8/4K3/8/8/8/8/7R w - - 0 1',
        prompt: 'The kings face off — exactly what the rook was waiting for. Mate in one!',
        goal: { type: 'checkmate' },
        hint: 'Check along the 8th rank. Your king guards every square the enemy king could run to.',
        success: 'The king-and-rook mate — the endgame everyone must know cold.',
      },
    ],
  },
  {
    id: 'skill-endgame-pawns',
    title: 'Pawn Endgame Essentials',
    icon: '🏃',
    summary: 'Catch runaway pawns and escort your own to the finish line.',
    steps: [
      {
        kind: 'info',
        title: 'Endgames are king games',
        text: 'When the queens come off, your king stops hiding and becomes a fighting piece. Two skills win most pawn endgames: chasing down enemy runners before they promote, and escorting your own pawn with the king in front.',
      },
      {
        kind: 'exercise',
        fen: '7k/8/8/7p/8/5K2/8/8 w - - 0 1',
        prompt: 'That pawn is sprinting for h1! Step into its path with your king and catch it before it promotes.',
        goal: { type: 'line', moves: ['f3g3', 'h5h4', 'g3h4'] },
        hint: 'Kg3 blocks the road — when the pawn dashes to h4 with check, capture it.',
        success: 'Caught! If your king can step inside the pawn’s “square”, it never escapes.',
      },
      {
        kind: 'exercise',
        fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1',
        prompt: 'Now escort your own pawn home. Golden rule: the king leads, the pawn follows. Walk it all the way to a new queen!',
        goal: {
          type: 'line',
          moves: ['e6d6', 'e8d8', 'e5e6', 'd8e8', 'e6e7', 'e8f7', 'd6d7', 'f7f6', 'e7e8q'],
        },
        hint: 'Sidestep with Kd6 first — the king clears the road one diagonal step ahead of the pawn, and guards e8 at the end.',
        success: 'Escort complete — new queen! King in front of the pawn = winning.',
      },
    ],
  },
];
