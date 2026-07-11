/**
 * Track — Checkmate Patterns II: the classic named mating attacks.
 * Anastasia, Boden, the smothered mate with its queen-sacrifice buildup,
 * the Arabian mate and the Greek gift sacrifice.
 */
import type { Lesson, LessonTrack } from '../types';

export const CHECKMATES2_LESSONS: Lesson[] = [
  {
    id: 'cm2-anastasia',
    title: "Anastasia's Mate",
    icon: '🗼',
    summary: 'Intermediate · a knight on e7 seals the king in the corridor, the rook slams the door on the h-file.',
    steps: [
      {
        kind: 'info',
        title: 'The corridor mate',
        text: 'Anastasia’s mate traps a castled king between its own pawn and the edge of the board. A knight on e7 is the jailer: it covers BOTH g8 and g6. With those squares gone, a rook check down the h-file is fatal — the king has nowhere left to stand.',
        fen: 'r7/p3N1pk/8/8/8/8/5K2/3R4 w - - 0 1',
        shapes: [
          { orig: 'e7', dest: 'g8', brush: 'red' },
          { orig: 'e7', dest: 'g6', brush: 'red' },
          { orig: 'd1', dest: 'h1', brush: 'green' },
        ],
      },
      {
        kind: 'exercise',
        fen: 'r7/p3N1pk/8/8/8/8/5K2/3R4 w - - 0 1',
        prompt: 'The knight already guards g8 and g6, and the g7-pawn blocks the last exit. Deliver mate along the h-file.',
        goal: { type: 'checkmate' },
        shapes: [{ orig: 'h1', brush: 'green' }],
        hint: 'Rd1–h1. Any other rook move lets the king breathe: only a check on the h-file uses the knight’s grip on g8 and g6.',
        success: 'Rh1# — the pure Anastasia pattern. Knight seals the g-file squares, rook owns the h-file.',
      },
      {
        kind: 'info',
        title: 'Building it with a queen sacrifice',
        text: 'In real games the h-file starts closed — a pawn on h7 shields the king. The classic recipe: Ne7+ first (forcing the king into the corner), then rip the shield off with a queen sacrifice on h7, and only then bring the rook. You invest the queen; the pattern pays you back with mate.',
      },
      {
        kind: 'exercise',
        fen: 'r4rk1/pp3ppp/8/3N4/7Q/8/5KP1/4R3 w - - 0 1',
        prompt: 'Play the full combination: knight check to drive the king to the corner, sacrifice the queen on h7 to open the file, then mate with the rook.',
        goal: { type: 'line', moves: ['d5e7', 'g8h8', 'h4h7', 'h8h7', 'e1h1'] },
        shapes: [{ orig: 'd5', dest: 'e7', brush: 'green' }],
        hint: 'Start with Ne7+! The rook on f8 blocks f8, so the king must go to h8. Then Qxh7+!! forces Kxh7 — and Re1–h1 is mate. Starting with Qxh7? just loses the queen: after Kxh7 there is no knight on e7 yet, so the king slips out via g8 or g6.',
        success: 'Ne7+, Qxh7+!!, Rh1# — Anastasia’s mate with the classic queen sacrifice. A whole queen for a corridor: bargain.',
      },
    ],
  },
  {
    id: 'cm2-boden',
    title: "Boden's Mate",
    icon: '✂️',
    summary: 'Intermediate · two bishops slice across a queenside-castled king on criss-crossing diagonals.',
    steps: [
      {
        kind: 'info',
        title: 'The criss-cross',
        text: 'Boden’s mate punishes kings castled long. Two bishops cut criss-crossing diagonals: one covers the b8–c7 escape squares, the other checks along a6–c8. The king’s own rook and pawns block everything else. It usually costs a queen sacrifice on c6 to blow the b-file open — and it is worth every penny.',
        fen: '2kr3r/p2p1pp1/2p5/8/8/6B1/4BPPP/6K1 w - - 0 1',
        shapes: [
          { orig: 'g3', dest: 'b8', brush: 'red' },
          { orig: 'e2', dest: 'a6', brush: 'green' },
        ],
      },
      {
        kind: 'exercise',
        fen: '2kr3r/p2p1pp1/2p5/8/8/6B1/4BPPP/6K1 w - - 0 1',
        prompt: 'The b-file pawn is already gone and your dark-squared bishop covers b8 and c7. Deliver the criss-cross mate.',
        goal: { type: 'checkmate' },
        shapes: [{ orig: 'a6', brush: 'green' }],
        hint: 'Be2–a6. The check runs a6–b7–c8; the king can’t go to b8 or c7 (your g3-bishop covers both), and d7/d8 are blocked by its own pawn and rook.',
        success: 'Ba6# — Boden’s mate. Two bishops, one open diagonal each, zero escape squares.',
      },
      {
        kind: 'info',
        title: 'Opening the diagonal',
        text: 'The mating diagonal a6–c8 is normally shut by a pawn on b7. The signature move is a queen sacrifice on c6: the b7-pawn is forced to recapture, and the moment it leaves b7, the light-squared bishop strikes. The most famous example is Schulder–Boden, London 1853.',
      },
      {
        kind: 'exercise',
        fen: '2kr3r/pp3ppp/2p5/8/Q4B2/8/5PPP/3R1BK1 w - - 0 1',
        prompt: 'Everything is set: your bishop on f4 covers b8 and c7, and your rook watches d7. Sacrifice the queen to rip open the b7-square, then mate.',
        goal: { type: 'line', moves: ['a4c6', 'b7c6', 'f1a6'] },
        shapes: [{ orig: 'a4', dest: 'c6', brush: 'green' }],
        hint: 'Qxc6+!! is the move — bxc6 is forced (Kb8 is illegal, your f4-bishop covers it), and then Ba6 is mate. Quiet moves like Ba6 straight away fail: with the pawn still on b7, there is no check at all.',
        success: 'Qxc6+!! bxc6 Ba6# — the queen buys the b7-square, the bishops do the rest. Pure Boden.',
      },
    ],
  },
  {
    id: 'cm2-smothered',
    title: 'The Smothered Mate',
    icon: '🐴',
    summary: 'Advanced · Philidor’s legacy: a queen sacrifice forces the king to suffocate behind its own pieces.',
    steps: [
      {
        kind: 'info',
        title: 'Death by your own army',
        text: 'In a smothered mate the king is not trapped by enemy pieces — it is buried alive by its OWN. A lone knight delivers the blow: knights are the only piece whose check cannot be blocked. If every square around the king is occupied by friendly pieces, one knight check ends the game.',
        fen: 'r5rk/p5pp/8/4N3/8/8/5PPP/6K1 w - - 0 1',
        shapes: [
          { orig: 'g8', brush: 'red' },
          { orig: 'g7', brush: 'red' },
          { orig: 'h7', brush: 'red' },
        ],
      },
      {
        kind: 'exercise',
        fen: 'r5rk/p5pp/8/4N3/8/8/5PPP/6K1 w - - 0 1',
        prompt: 'The black king is walled in by its own rook and pawns. One knight jump delivers mate — find it.',
        goal: { type: 'checkmate' },
        hint: 'Ne5–f7. From f7 the knight checks h8; g8, g7 and h7 are all taken by Black’s own pieces, and a knight check can never be blocked.',
        success: 'Nf7# — smothered! The rook on g8 is the king’s own gravestone.',
      },
      {
        kind: 'exercise',
        fen: 'r4r1k/pp4pp/4Q2N/8/8/8/5PPP/6K1 w - - 0 1',
        prompt: 'The famous finish: g8 is the only open square, so force Black to fill it. Sacrifice your queen, then smother.',
        goal: { type: 'line', moves: ['e6g8', 'f8g8', 'h6f7'] },
        shapes: [{ orig: 'e6', dest: 'g8', brush: 'green' }],
        hint: 'Qg8+!! — the queen is protected by the knight on h6, so the king cannot take; Rxg8 is forced. Now g8 is plugged by Black’s own rook, and Nf7 is mate. Note Nf7+ immediately is only a draw by repetition: the king just shuffles to g8 and back.',
        success: 'Qg8+!! Rxg8 Nf7# — you forced Black to build his own tomb. The most beautiful queen sacrifice in chess.',
      },
      {
        kind: 'info',
        title: 'Philidor’s legacy — the full machine',
        text: 'The complete combination has been winning games since the 1700s. Ingredients: your queen on the a2–g8 diagonal, a knight ready to hop to f7, and a black rook stuck on f8. The engine runs on checks: Qe6+, Nf7+, then Nh6+ DOUBLE check (knight and discovered queen — the king MUST move), and finally Qg8+!! Rxg8 Nf7#.',
      },
      {
        kind: 'exercise',
        fen: '5rk1/pp4pp/8/6N1/8/8/4QPPP/6K1 w - - 0 1',
        prompt: 'Run the whole machine from the start: queen check, knight check, double check, queen sacrifice, smothered mate. Five white moves — every one forcing.',
        goal: { type: 'line', moves: ['e2e6', 'g8h8', 'g5f7', 'h8g8', 'f7h6', 'g8h8', 'e6g8', 'f8g8', 'h6f7'] },
        shapes: [{ orig: 'e2', dest: 'e6', brush: 'green' }],
        hint: 'Begin with Qe6+. If Black blocks with Rf7, Nxf7 simply wins the rook — the king can’t recapture while your queen guards f7. After Qe6+ Kh8 Nf7+, grabbing the knight with Rxf7 loses to Qe8+ Rf8 Qxf8#, a back-rank mate. So Black must dance: Kh8, Kg8, Kh8 — and then Qg8+!! Rxg8 Nf7#.',
        success: 'Qe6+ Kh8 Nf7+ Kg8 Nh6+ Kh8 Qg8+!! Rxg8 Nf7# — Philidor’s legacy, executed like it’s 1749.',
      },
    ],
  },
  {
    id: 'cm2-arabian',
    title: 'The Arabian Mate',
    icon: '🏜️',
    summary: 'Intermediate · the oldest recorded mate: rook and knight team up on a cornered king.',
    steps: [
      {
        kind: 'info',
        title: 'The oldest trick in the book',
        text: 'The Arabian mate appears in shatranj manuscripts over a thousand years old — it worked before the queen and bishop even had their modern powers. A knight stands two diagonal steps from the cornered king (f6 against h8): from there it guards BOTH g8 and the rook’s landing square h7. The rook checks on h7, protected by the knight, and the corner becomes a coffin.',
        fen: '1r5k/R7/5N2/p7/8/8/5PPP/6K1 w - - 0 1',
        shapes: [
          { orig: 'f6', dest: 'g8', brush: 'red' },
          { orig: 'f6', dest: 'h7', brush: 'blue' },
          { orig: 'a7', dest: 'h7', brush: 'green' },
        ],
      },
      {
        kind: 'exercise',
        fen: '1r5k/R7/5N2/p7/8/8/5PPP/6K1 w - - 0 1',
        prompt: 'Your knight on f6 already covers g8 and protects h7. Slide the rook in and mate.',
        goal: { type: 'checkmate' },
        shapes: [{ orig: 'h7', brush: 'green' }],
        hint: 'Ra7–h7. The king can’t capture — the knight on f6 guards h7 — and g8 and g7 are covered too. A check on the 8th rank instead (Ra8+?) lets Black trade rooks with Rxa8.',
        success: 'Rh7# — the Arabian mate, straight out of a 9th-century manuscript.',
      },
      {
        kind: 'exercise',
        fen: 'r4rk1/pp1R3p/7P/4P3/4N3/8/5PP1/6K1 w - - 0 1',
        prompt: 'Build the pattern in two moves: first the knight check to force the king into the corner, then the rook strike on h7.',
        goal: { type: 'line', moves: ['e4f6', 'g8h8', 'd7h7'] },
        shapes: [{ orig: 'e4', dest: 'f6', brush: 'green' }],
        hint: 'Ne4–f6+ first! The f8-rook blocks f8 and your h6-pawn covers g7, so Kh8 is forced — and capturing the knight with Rxf6 just loses the exchange to exf6. Then Rxh7 is mate: the knight guards the rook and covers g8. Playing Rxh7 first fails — with the king still on g8 it isn’t even check.',
        success: 'Nf6+ Kh8 Rxh7# — knight herds the king into the corner, rook finishes. Order matters!',
      },
      {
        kind: 'info',
        title: 'Why this duo is deadly',
        text: 'Remember the geometry: knight two diagonal squares from the corner king, rook checking on the adjacent file or rank. The knight does double duty — it protects the rook AND covers the only flight square. Rook + knight against a bare corner is one of the most common mating nets in real endgames, so burn this shape into your memory.',
      },
    ],
  },
  {
    id: 'cm2-greek-gift',
    title: 'The Greek Gift',
    icon: '🎁',
    summary: 'Advanced · Bxh7+! — the classic bishop sacrifice that tears a castled king wide open.',
    steps: [
      {
        kind: 'info',
        title: 'Beware of bishops bearing gifts',
        text: 'The Greek gift is a bishop sacrifice on h7 against a castled king. Check the ingredients before you fling the bishop: a bishop aiming at h7, a knight ready to jump to g5, a queen with a road to h5, and a pawn on e5 keeping defenders off f6. If Black has no knight covering h7’s neighbourhood, the sacrifice usually wins by force.',
        fen: 'r1b2rk1/ppq2ppp/1np1p3/2BpP3/3P4/3B1N2/PPP2PPP/R2Q1RK1 w - - 0 1',
        shapes: [
          { orig: 'd3', dest: 'h7', brush: 'green' },
          { orig: 'f3', dest: 'g5', brush: 'blue' },
          { orig: 'd1', dest: 'h5', brush: 'blue' },
          { orig: 'e5', brush: 'yellow' },
        ],
      },
      {
        kind: 'exercise',
        fen: 'r1b2rk1/ppq2ppp/1np1p3/2BpP3/3P4/3B1N2/PPP2PPP/R2Q1RK1 w - - 0 1',
        prompt: 'All four ingredients are on the board. Unwrap the gift — sacrifice the bishop!',
        goal: { type: 'move', moves: ['d3h7'] },
        shapes: [{ orig: 'h7', brush: 'green' }],
        hint: 'Bxh7+! Slow moves let Black consolidate with ...f5 or ...Nd7. The sacrifice comes with check, so Black gets no time to organise a defence.',
        success: 'Bxh7+! The pawn shield is breached. If Black declines with Kh8, you simply retreat the bishop — a clean extra pawn.',
      },
      {
        kind: 'info',
        title: 'The follow-up machine',
        text: 'After ...Kxh7 the attack runs on rails: Ng5+ — capturing is impossible, nothing attacks g5, so the king steps back (the bold ...Kg6 walks into Qd3+ and a ferocious king hunt) — and then Qh5, renewing the mate threat on h7. The knight on g5 is the star: it protects the queen’s entry square h7 AND covers f7, so the king cannot slip out via f7. Here even ...g6 fails — the queen simply walks into h7 anyway.',
      },
      {
        kind: 'exercise',
        fen: 'r1b2r2/ppq2ppk/1np1p3/2BpP3/3P4/5N2/PPP2PPP/R2Q1RK1 w - - 0 2',
        prompt: 'Black took the bishop. Finish the job: knight check, queen to h5, and mate on h7 — Black has no defence.',
        goal: { type: 'line', moves: ['f3g5', 'h7g8', 'd1h5', 'f8e8', 'h5h7'] },
        shapes: [{ orig: 'f3', dest: 'g5', brush: 'green' }],
        hint: 'Ng5+ first — the knight arrives with check and can never be captured or blocked. Then Qh5 threatens Qh7#, and nothing stops it: ...Re8 clears f8, but your c5-bishop covers that square, and even ...g6 fails because the g6-pawn does not defend h7 — Qh7 is mate regardless.',
        success: 'Ng5+ Kg8 Qh5 and Qh7# — the full Greek gift. Bishop, knight and queen each played their part; remember the ingredients and you’ll spot Bxh7+ for the rest of your life.',
      },
    ],
  },
];

export const CHECKMATES2_TRACK: LessonTrack = {
  id: 'checkmates-2',
  title: 'Checkmate Patterns II',
  blurb: 'Five legendary mating attacks — Anastasia, Boden, the smothered mate, the Arabian mate and the Greek gift.',
  lessons: CHECKMATES2_LESSONS,
};
