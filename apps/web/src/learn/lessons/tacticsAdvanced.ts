/**
 * Track 3 — Tactical Mastery: intermediate/advanced tactic motifs for players
 * who already know forks, pins and skewers. Discovered attacks, deflection,
 * decoys, zwischenzug, the windmill and x-ray tricks — one motif per lesson,
 * every position verified move-by-move.
 */
import type { Lesson, LessonTrack } from '../types';

export const TACTICS_ADVANCED_LESSONS: Lesson[] = [
  {
    id: 'tactics-adv-discovered',
    title: 'Discovered Attacks',
    icon: '🎭',
    summary: 'Move one piece, unleash another — the attack your opponent never sees coming.',
    steps: [
      {
        kind: 'info',
        title: 'The hidden gun',
        text: 'A discovered attack happens when a piece steps aside and unmasks an attack from the piece behind it. Suddenly you make two threats with one move: whatever the moving piece attacks, plus whatever the unmasked piece hits. Intermediate players who master this motif win material out of thin air.',
        fen: 'r5k1/p3qppp/3b4/2P5/4N3/8/PP3PPP/4RK2 w - - 0 1',
        shapes: [
          { orig: 'e4', dest: 'd6', brush: 'green' },
          { orig: 'e1', dest: 'e7', brush: 'blue' },
        ],
      },
      {
        kind: 'exercise',
        fen: 'r5k1/p3qppp/3b4/2P5/4N3/8/PP3PPP/4RK2 w - - 0 1',
        prompt: 'Your knight shields your rook on the e-file. Capture the bishop and unmask the rook at the same time — the queen will be too busy to recapture.',
        goal: { type: 'move', moves: ['e4d6'] },
        shapes: [{ orig: 'e7', brush: 'red' }],
        hint: 'Nxd6 hits the bishop AND opens the e-file: the rook attacks the queen. Qxd6 fails to cxd6, and Qxe1+ fails to Kxe1.',
        success: 'Two threats in one move: you took a bishop, and the unmasked rook chases the queen away — she has no time to take back.',
      },
      {
        kind: 'exercise',
        fen: '4k3/ppp2ppp/2q5/4N3/8/8/PPP2PPP/4R1K1 w - - 0 1',
        prompt: 'The black queen looks safe — the b7-pawn guards her. But your knight can move with a discovered CHECK. Grab the queen!',
        goal: { type: 'move', moves: ['e5c6'] },
        shapes: [{ orig: 'e1', dest: 'e8', brush: 'blue' }],
        hint: 'Nxc6 unmasks the rook on e1 — check! Black must answer the check first, so bxc6 never happens: your knight escapes next move.',
        success: 'A queen for free! The pawn "defended" her, but during a discovered check the recapture must wait — and your knight simply runs away.',
      },
      {
        kind: 'info',
        title: 'Double check — the nuclear option',
        text: 'When the moving piece ALSO gives check, both pieces check at once: a double check. Blocking is impossible (you cannot block two lines) and capturing is impossible (you cannot take two pieces) — the king MUST move. Double checks power many forced mates.',
      },
      {
        kind: 'exercise',
        fen: '4kr2/5ppp/8/6B1/4B3/8/8/4R1K1 w - - 0 1',
        prompt: 'Move the e4-bishop so that it checks the king itself AND unmasks your rook — a double check the king cannot survive. Mate in one!',
        goal: { type: 'checkmate' },
        shapes: [
          { orig: 'e4', brush: 'green' },
          { orig: 'e1', dest: 'e8', brush: 'blue' },
        ],
        hint: 'From c6 the bishop checks e8 through d7 while the rook checks along the e-file. The king cannot block or capture two checks at once — and every escape square is covered.',
        success: 'Mate! Bc6 is the pure double check — bishop through d7, rook down the e-file, g5-bishop sealing d8. (Bf5 mates too: the rook alone checks while f5 covers the d7 escape.)',
      },
    ],
  },
  {
    id: 'tactics-adv-deflection',
    title: 'Deflection',
    icon: '🧲',
    summary: 'Drag the defender away from its post — then strike what it left behind.',
    steps: [
      {
        kind: 'info',
        title: 'Overworked defenders',
        text: 'Many pieces hold a position together by guarding something important. Deflection means forcing that defender to abandon its post — usually with a check or a capture it cannot refuse. Ask of every enemy piece: "what is your job?" Then make it quit.',
      },
      {
        kind: 'exercise',
        fen: '3r2k1/pp3ppp/3q4/8/8/3Q4/PP3PPP/4R1K1 w - - 0 1',
        prompt: 'The queens stare each other down, but Black’s queen is guarded by the rook on d8. Deflect that rook with a check — then take the queen.',
        goal: { type: 'line', moves: ['e1e8', 'd8e8', 'd3d6'] },
        shapes: [
          { orig: 'd8', dest: 'd6', brush: 'red' },
          { orig: 'e8', brush: 'green' },
        ],
        hint: 'Qxd6?? Rxd6 is just a trade. Re8+! forces the d8-rook to leave its queen: after Rxe8, Qxd6 wins her for a rook.',
        success: 'The rook had one job — guard the queen — and your check gave it a second job it could not refuse. Queen for rook!',
      },
      {
        kind: 'exercise',
        fen: '2r3k1/2P2p1p/1P4p1/8/8/8/8/R5K1 w - - 0 1',
        prompt: 'Your c7-pawn is one square from glory, but the rook on c8 blocks the door. Deflect it with a rook sacrifice and promote!',
        goal: { type: 'line', moves: ['a1a8', 'c8a8', 'c7c8q', 'g8g7', 'c8a8'] },
        shapes: [
          { orig: 'a1', dest: 'a8', brush: 'green' },
          { orig: 'c7', dest: 'c8', brush: 'blue' },
        ],
        hint: 'Ra8! attacks the blockader — and pins it: with your rook x-raying the king along the 8th rank, Rxc7 is not even legal. After Rxa8 the pawn queens WITH CHECK, and your new queen takes the rook back.',
        success: 'A whole rook invested, a queen earned: c8=Q came with check, so Black never got to punish you — and Qxa8 collected the deflected rook.',
      },
      {
        kind: 'info',
        title: 'How to spot deflections',
        text: 'Checklist: (1) find an enemy piece doing a vital defensive job — guarding a queen, a mating square, or a promotion square; (2) find a forcing move (check, capture or big threat) that attacks it or lures it away; (3) count the material after it leaves. If the defender is also needed elsewhere, it is "overloaded" — and overloaded pieces always fail one of their jobs.',
      },
    ],
  },
  {
    id: 'tactics-adv-decoy',
    title: 'Decoy & Attraction',
    icon: '🪤',
    summary: 'Sacrifice to drag an enemy piece ONTO a doomed square — then spring the trap.',
    steps: [
      {
        kind: 'info',
        title: 'Deflection’s evil twin',
        text: 'Deflection pulls a defender AWAY from a square; a decoy (attraction) drags a piece ONTO a bad square — into a fork, a skewer or a mating net. The bait is usually a sacrifice so juicy or so forcing that it cannot be declined. The most famous decoy in chess is Philidor’s smothered mate — you are about to play it.',
      },
      {
        kind: 'exercise',
        fen: '5r1k/pp4pp/7N/8/2Q5/8/5PPP/6K1 w - - 0 1',
        prompt: 'Philidor’s legacy: the black king is boxed in by his own pawns. Sacrifice your queen to drag the rook onto g8 — then deliver the legendary smothered mate.',
        goal: { type: 'line', moves: ['c4g8', 'f8g8', 'h6f7'] },
        shapes: [
          { orig: 'c4', dest: 'g8', brush: 'green' },
          { orig: 'h6', dest: 'f7', brush: 'blue' },
        ],
        hint: 'Qg8+!! The queen is guarded by your h6-knight, so Kxg8 is illegal — Rxg8 is forced. Now the rook plugs the king’s only escape square, and Nf7 is mate.',
        success: 'The immortal smothered mate: your queen died to decoy the rook onto g8, where it suffocates its own king. Nf7# — every neighbouring square is occupied by Black’s own army.',
      },
      {
        kind: 'exercise',
        fen: '5k2/6pp/N5P1/3q4/8/8/5P1P/4R1K1 w - - 0 1',
        prompt: 'Your rook and knight can beat queen and king — if you drag the king onto the right square first. Sacrifice the rook with check, then fork king and queen.',
        goal: { type: 'line', moves: ['e1e8', 'f8e8', 'a6c7', 'e8d7', 'c7d5'] },
        shapes: [
          { orig: 'e1', dest: 'e8', brush: 'green' },
          { orig: 'c7', brush: 'blue' },
        ],
        hint: 'Re8+! The king must take — f7 is covered by your g6-pawn and g8 stays on the rook’s line. On e8 the king steps straight into Nc7+, a royal fork that wins the queen on d5.',
        success: 'Rook for queen! The king was attracted onto e8, the one square where Nc7+ forks king and queen at once. Decoys turn "safe" squares into landmines.',
      },
      {
        kind: 'info',
        title: 'Where decoys live',
        text: 'Look for a decoy when a fork, skewer or mate would work "if only the king (or queen) stood one square over". Checks and captures are your tow-ropes: a check with a protected piece forces a capture or a fatal king move, and greedy queens rarely decline free rooks. Calculate the forced reply first, the payoff second.',
      },
    ],
  },
  {
    id: 'tactics-adv-zwischenzug',
    title: 'Zwischenzug',
    icon: '⏸️',
    summary: 'The in-between move: before you recapture, look for something stronger.',
    steps: [
      {
        kind: 'info',
        title: 'Never recapture on autopilot',
        text: 'Zwischenzug is German for "in-between move". When your opponent captures something, the recapture feels automatic — but forcing moves (especially checks and mate threats) do not wait. Insert your own threat FIRST; the recapture, or something far better, will still be there afterwards.',
      },
      {
        kind: 'exercise',
        fen: '5rk1/pp3ppp/8/7Q/8/2rB4/PP3PPP/6K1 w - - 0 1',
        prompt: 'Black just grabbed your knight on c3 and expects bxc3 back. Don’t recapture — find something much, much stronger.',
        goal: { type: 'checkmate' },
        shapes: [{ orig: 'c3', brush: 'red' }],
        hint: 'bxc3 wins the rook back — and misses mate in one. Your d3-bishop guards h7, so the queen can land there: Qxh7#.',
        success: 'Qxh7# — the bishop backs her up, f8 is blocked by Black’s own rook, and the "obvious" recapture is forgotten forever. Checks before recaptures!',
      },
      {
        kind: 'exercise',
        fen: 'r5k1/3q1p1p/2p3p1/3N4/8/8/5PPP/R5K1 w - - 0 1',
        prompt: 'Your knight on d5 is attacked twice — by the c6-pawn and the queen. Retreating loses the initiative. Find the in-between move that turns the tables.',
        goal: { type: 'line', moves: ['d5f6', 'g8g7', 'f6d7'] },
        shapes: [
          { orig: 'c6', dest: 'd5', brush: 'red' },
          { orig: 'f6', brush: 'green' },
        ],
        hint: 'An attacked piece doesn’t have to run — it can make a bigger threat. Nf6+! is check, and from f6 the knight eyes d7: after the king steps aside, Nxd7 wins the queen.',
        success: 'Check first, count later: the "trapped" knight gave check and forked the queen on d7 at the same time. Your opponent never got to take it.',
      },
      {
        kind: 'info',
        title: 'The zwischenzug habit',
        text: 'Before every recapture, run a 3-second scan: do I have a check? a mate threat? a capture of something bigger? Forcing moves outrank equal trades because your opponent must answer them — and your recapture usually keeps. The players who punish "automatic" moves are the ones who stopped making them.',
      },
    ],
  },
  {
    id: 'tactics-adv-windmill',
    title: 'The Windmill',
    icon: '🌀',
    summary: 'Discovered check on repeat — the rook that eats a whole army, one free bite at a time.',
    steps: [
      {
        kind: 'info',
        title: 'A machine made of checks',
        text: 'A windmill (see-saw) is a repeating battery: a rook gives check, the king must step back, the rook swings away with DISCOVERED check from the bishop behind it, capturing whatever it likes — and returns with check to start again. Black spends every move answering checks while you harvest material. Carlos Torre famously mowed down former world champion Emanuel Lasker with one in Moscow 1925.',
      },
      {
        kind: 'exercise',
        fen: '5rk1/pq3ppp/7Q/8/7B/6R1/5P1P/6K1 w - - 0 1',
        prompt: 'Build the machine. Your rook wants g7, but alone it would just be captured. Post your bishop on the long diagonal so the battery is ready — Torre’s famous move.',
        goal: { type: 'move', moves: ['h4f6'] },
        shapes: [
          { orig: 'h4', dest: 'f6', brush: 'green' },
          { orig: 'g3', dest: 'g7', brush: 'blue' },
        ],
        hint: 'Bf6! The bishop protects the g7 entry square AND aims at the king’s corner. Black cannot even take it: gxf6 is illegal — the g7-pawn is pinned, since opening the g-file would expose the king to your g3-rook.',
        success: 'Bf6 — the windmill is assembled: the rook can crash into g7, and every time it swings off that square the bishop’s check brings the king right back.',
      },
      {
        kind: 'exercise',
        fen: '5r1k/pq3pRp/5B1P/8/8/8/5P2/6K1 w - - 0 1',
        prompt: 'The machine is running: your g7-rook and f6-bishop form the battery. Take the f7-pawn with discovered check, swing back with check, and come around again to win the queen. Black can only shuffle!',
        goal: {
          type: 'line',
          moves: ['g7f7', 'h8g8', 'f7g7', 'g8h8', 'g7b7'],
        },
        shapes: [
          { orig: 'g7', dest: 'f7', brush: 'green' },
          { orig: 'f6', dest: 'h8', brush: 'blue' },
          { orig: 'b7', brush: 'red' },
        ],
        hint: 'Rxf7+ — the bishop checks from f6, so Kg8 is the only legal move. Then Rg7+ Kh8 (Kxg7 is impossible — the bishop and the h6-pawn both guard the rook, and Qxg7 hxg7 just trades the queen for a rook), and Rxb7 collects the queen with yet another discovered check. Grab f7 first: spin the wheel one capture at a time.',
        success: 'Pawn, tempo, queen — all for free. The king shuffled h8–g8–h8 while your rook did the shopping. That is the windmill: discovered check on an infinite loop.',
      },
      {
        kind: 'info',
        title: 'Windmill ingredients',
        text: 'You need three things: (1) a rear piece (usually a bishop) hitting the king’s square, (2) a rook on the file or rank next to the king, protected on its pivot square, and (3) a king with no escape from the two-square shuffle. When you see the first two, look hard for the third — a windmill can justify sacrificing almost anything to set it up.',
      },
    ],
  },
  {
    id: 'tactics-adv-xray',
    title: 'Skewers & X-Rays',
    icon: '🩻',
    summary: 'See through the pieces: skewer the big one to win the one hiding behind it.',
    steps: [
      {
        kind: 'info',
        title: 'The reverse pin',
        text: 'A skewer is a pin turned upside down: the MORE valuable piece stands in front and must move, exposing the piece behind it. Long-range pieces — rooks, bishops, queens — deliver skewers along ranks, files and diagonals. The deadliest version checks the king, because the king cannot decline.',
      },
      {
        kind: 'exercise',
        fen: '8/7p/8/q3k3/8/8/5PP1/6KR w - - 0 1',
        prompt: 'King and queen share the fifth rank — a fatal alignment. Check the king from the side, force it off the rank, and harvest the queen.',
        goal: { type: 'line', moves: ['h1h5', 'e5e6', 'h5a5'] },
        shapes: [
          { orig: 'h1', dest: 'h5', brush: 'green' },
          { orig: 'e5', dest: 'a5', brush: 'red' },
        ],
        hint: 'Rh5+! The queen cannot block (her own king stands in the way), so the king must abandon the rank — and Rxa5 follows.',
        success: 'The classic rank skewer: the king was forced to step aside, and the queen behind him fell. Watch for king and queen on one line — always.',
      },
      {
        kind: 'exercise',
        fen: '8/pp6/5k1B/8/3q4/8/5P2/6RK w - - 0 1',
        prompt: 'King on f6, queen on d4 — same diagonal. Your bishop can deliver the skewer, and your rook makes it untouchable. Win the queen!',
        goal: { type: 'line', moves: ['h6g7', 'f6e6', 'g7d4'] },
        shapes: [
          { orig: 'h6', dest: 'g7', brush: 'green' },
          { orig: 'g1', dest: 'g7', brush: 'blue' },
        ],
        hint: 'Bg7+! The king would love to take the cheeky bishop, but your g1-rook guards it. Off the long diagonal the king goes — and Bxd4 scoops the queen.',
        success: 'A protected skewer: the rook made Kxg7 illegal, so the king had to retreat and surrender the queen on the diagonal. Teamwork makes the skewer work.',
      },
      {
        kind: 'info',
        title: 'X-ray vision',
        text: 'An x-ray is attacking THROUGH a piece: your rook behind your own queen still "counts" on the square she attacks, because after any capture the rook recaptures. Defenders who only count the pieces they can see get ambushed by the ones behind.',
      },
      {
        kind: 'exercise',
        fen: 'r3r1k1/5ppp/8/8/4Q3/8/5PPP/4R1K1 w - - 0 1',
        prompt: 'Black’s e8-rook attacks your queen and looks safely defended by the a8-rook. But x-ray the e-file: your rook backs the queen up. Capture on e8 and force mate!',
        goal: { type: 'line', moves: ['e4e8', 'a8e8', 'e1e8'] },
        shapes: [
          { orig: 'e1', dest: 'e8', brush: 'blue' },
          { orig: 'e8', brush: 'red' },
        ],
        hint: 'Count the e8 square: two attackers (queen + rook behind her), one defender. Qxe8+! Rxe8 Rxe8 is mate — the back rank has no escape hatch.',
        success: 'Qxe8+!! Rxe8, Rxe8# — the x-rayed rook finished what the queen started. Two attackers beat one defender, even when one attacker is hiding.',
      },
      {
        kind: 'info',
        title: 'Mastery unlocked',
        text: 'Discovered attacks, deflections, decoys, in-between moves, windmills and skewers are the vocabulary of every great combination — most brilliancies are just two or three of these motifs chained together. When you solve puzzles from here on, name the motif out loud: naming it is how you learn to see it in your own games.',
      },
    ],
  },
];

export const TACTICS_ADVANCED_TRACK: LessonTrack = {
  id: 'tactics-advanced',
  title: 'Tactical Mastery',
  blurb: 'Know the basics? These are the combinations that decide real games.',
  lessons: TACTICS_ADVANCED_LESSONS,
};
