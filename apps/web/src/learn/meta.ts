/**
 * Lightweight lesson metadata for surfaces that must NOT pull the full lesson
 * content (steps/FENs) into the initial bundle — the Today page's "next
 * lesson" card and the Graduate achievement only need ids/titles/counts,
 * while the content itself (./index -> ./lessons/*) stays inside the lazy
 * Learn chunk.
 *
 * KEEP IN SYNC with the catalogue in ./index.ts — learn/content.test.ts
 * asserts this file matches ALL_LESSONS exactly, so a drift fails the tests.
 */
export interface LessonMeta {
  id: string;
  icon: string;
  title: string;
  summary: string;
}

export const LESSON_META: LessonMeta[] = [
  { id: "rules-pawn", icon: "♙", title: "The Pawn", summary: "Small steps, big dreams — learn how pawns march and capture." },
  { id: "rules-knight", icon: "♘", title: "The Knight", summary: "The trickster of the board — it jumps in an L and leaps over anything." },
  { id: "rules-bishop", icon: "♗", title: "The Bishop", summary: "A laser on diagonals — but forever stuck on one color." },
  { id: "rules-rook", icon: "♖", title: "The Rook", summary: "A heavy tower that owns ranks and files." },
  { id: "rules-queen", icon: "♕", title: "The Queen", summary: "Rook + bishop in one — the strongest piece on the board." },
  { id: "rules-king", icon: "♔", title: "The King", summary: "Slow but precious — one step at a time, never into danger." },
  { id: "rules-capturing", icon: "⚔️", title: "Capturing Safely", summary: "Free snacks vs. poisoned bait — check who defends before you grab." },
  { id: "rules-check", icon: "⚠️", title: "Check!", summary: "When your king is attacked you must act — run, block, or fight back." },
  { id: "rules-checkmate", icon: "🏁", title: "Checkmate & Stalemate", summary: "How games are won — and the sneaky draw that ruins parties." },
  { id: "rules-castling", icon: "🏰", title: "Castling", summary: "The two-for-one special: tuck your king away and activate a rook." },
  { id: "rules-enpassant", icon: "🥖", title: "En Passant", summary: "The rule everyone swears is made up. It isn’t." },
  { id: "rules-promotion", icon: "👑", title: "Promotion", summary: "Walk a pawn to the end of the board and crown it." },
  { id: "skill-value", icon: "⚖️", title: "What Is It Worth?", summary: "Pawn 1 · knight 3 · bishop 3 · rook 5 · queen 9. Trade up, not down." },
  { id: "skill-forks", icon: "🍴", title: "Forks", summary: "Attack two things at once — they can’t both escape." },
  { id: "skill-pins", icon: "📌", title: "Pins", summary: "Freeze a piece against something more valuable behind it." },
  { id: "skill-skewers", icon: "🍢", title: "Skewers", summary: "A pin in reverse: the big piece must move and expose the one behind." },
  { id: "skill-opening", icon: "🚀", title: "Opening Principles", summary: "Center, develop, castle — the three golden rules of move one." },
  { id: "skill-mate-kq", icon: "💃", title: "Mate with the Queen", summary: "King + queen vs. king — the win you must never fumble." },
  { id: "skill-mate-rooks", icon: "🪜", title: "Mate with Rooks", summary: "The rook ladder and the classic king-and-rook finish." },
  { id: "skill-endgame-pawns", icon: "🏃", title: "Pawn Endgame Essentials", summary: "Catch runaway pawns and escort your own to the finish line." },
  { id: "tactics-adv-discovered", icon: "🎭", title: "Discovered Attacks", summary: "Move one piece, unleash another — the attack your opponent never sees coming." },
  { id: "tactics-adv-deflection", icon: "🧲", title: "Deflection", summary: "Drag the defender away from its post — then strike what it left behind." },
  { id: "tactics-adv-decoy", icon: "🪤", title: "Decoy & Attraction", summary: "Sacrifice to drag an enemy piece ONTO a doomed square — then spring the trap." },
  { id: "tactics-adv-zwischenzug", icon: "⏸️", title: "Zwischenzug", summary: "The in-between move: before you recapture, look for something stronger." },
  { id: "tactics-adv-windmill", icon: "🌀", title: "The Windmill", summary: "Discovered check on repeat — the rook that eats a whole army, one free bite at a time." },
  { id: "tactics-adv-xray", icon: "🩻", title: "Skewers & X-Rays", summary: "See through the pieces: skewer the big one to win the one hiding behind it." },
  { id: "positional-weak-squares", icon: "🕳️", title: "Weak Squares", summary: "Spot the holes no enemy pawn can ever defend — then move in for good." },
  { id: "positional-outposts", icon: "🏰", title: "Outposts", summary: "Plant a knight on a protected square in enemy territory — and leave it there." },
  { id: "positional-iqp", icon: "🏝️", title: "The Isolated Queen’s Pawn", summary: "One pawn, two stories: attack with the isolani — or blockade and besiege it." },
  { id: "positional-passed-pawns", icon: "🎖️", title: "Passed Pawns & Majorities", summary: "Turn a pawn majority into a passer, race it home, and back it the right way." },
  { id: "positional-bishops", icon: "👼", title: "Good Bishop, Bad Bishop", summary: "Keep pawns off your bishop’s colour — and hunt pawns stuck on the enemy’s." },
  { id: "positional-open-files", icon: "🛣️", title: "Open Files & the 7th Rank", summary: "Rooks crave open files — grab the file first, then invade the 7th rank." },
  { id: "cm2-anastasia", icon: "🗼", title: "Anastasia's Mate", summary: "Intermediate · a knight on e7 seals the king in the corridor, the rook slams the door on the h-file." },
  { id: "cm2-boden", icon: "✂️", title: "Boden's Mate", summary: "Intermediate · two bishops slice across a queenside-castled king on criss-crossing diagonals." },
  { id: "cm2-smothered", icon: "🐴", title: "The Smothered Mate", summary: "Advanced · Philidor’s legacy: a queen sacrifice forces the king to suffocate behind its own pieces." },
  { id: "cm2-arabian", icon: "🏜️", title: "The Arabian Mate", summary: "Intermediate · the oldest recorded mate: rook and knight team up on a cornered king." },
  { id: "cm2-greek-gift", icon: "🎁", title: "The Greek Gift", summary: "Advanced · Bxh7+! — the classic bishop sacrifice that tears a castled king wide open." },
];

export const LESSON_COUNT = LESSON_META.length;
