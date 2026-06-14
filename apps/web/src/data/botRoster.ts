import type { BotConfig, EngineAvailability } from '@chesser/shared';

/**
 * A named opponent on the ladder. Ordered ascending by `rating` — that order
 * *is* the ladder. Each carries a display persona (name/title/bio/avatar) plus
 * the engine `bot` config it actually plays with. Maia-backed personas fall back
 * to Stockfish at the same rating when Lc0/Maia isn't installed (see
 * {@link resolveBotConfig}).
 */
export interface RosterBot {
  id: string;
  name: string;
  title: string;
  rating: number;
  bio: string;
  /** Avatar accent colour (hex). */
  accent: string;
  /** Emoji shown on the generated avatar. */
  motif: string;
  bot: BotConfig;
}

export const BOT_ROSTER: RosterBot[] = [
  {
    id: 'tilly',
    name: 'Tilly Tinker',
    title: 'Absolute beginner',
    rating: 600,
    bio: 'Just learned how the pieces move. Hangs pieces, misses easy captures — the perfect first rung.',
    accent: '#f59e0b',
    motif: '🐣',
    bot: { style: 'balanced', elo: 600, moveTimeMs: 300 },
  },
  {
    id: 'benny',
    name: 'Benny Blunders',
    title: 'Beginner',
    rating: 800,
    bio: 'Knows a knight from a bishop, but one-move threats sail right past him. Loves a hopeful queen raid.',
    accent: '#fb923c',
    motif: '🙃',
    bot: { style: 'balanced', elo: 800, moveTimeMs: 300 },
  },
  {
    id: 'cassie',
    name: 'Cassie Casual',
    title: 'Casual player',
    rating: 1000,
    bio: 'Plays for fun between coffees. Sensible opening moves, but gets lost once the position turns sharp.',
    accent: '#facc15',
    motif: '☕',
    bot: { style: 'balanced', elo: 1000, moveTimeMs: 400 },
  },
  {
    id: 'maya',
    name: 'Maya',
    title: 'Human-like · 1100',
    rating: 1100,
    bio: 'A neural net trained on real 1100-rated humans — she plays the natural, slightly-wrong move a beginner would.',
    accent: '#34d399',
    motif: '🧠',
    bot: { style: 'human', maiaRating: 1100, elo: 1100, moveTimeMs: 500 },
  },
  {
    id: 'patrick',
    name: 'Patrick Pawns',
    title: 'Club novice',
    rating: 1250,
    bio: "Solid and stubborn — trades down and clings to pawns. You'll have to actually outplay him.",
    accent: '#22d3ee',
    motif: '♟️',
    bot: { style: 'defensive', elo: 1250, moveTimeMs: 500 },
  },
  {
    id: 'rosa',
    name: 'Rookie Rosa',
    title: 'Club player',
    rating: 1350,
    bio: 'A real club regular. Develops sensibly, castles early, and punishes obvious mistakes.',
    accent: '#38bdf8',
    motif: '🌹',
    bot: { style: 'balanced', elo: 1350, moveTimeMs: 600 },
  },
  {
    id: 'gus',
    name: 'Gambit Gus',
    title: 'Coffeehouse attacker',
    rating: 1500,
    bio: 'Sacrifices first, asks questions later. Castle quickly and watch for cheap mating nets.',
    accent: '#f87171',
    motif: '⚔️',
    bot: { style: 'aggressive', elo: 1500, moveTimeMs: 700 },
  },
  {
    id: 'maxine',
    name: 'Maxine',
    title: 'Human-like · 1500',
    rating: 1550,
    bio: 'Maia at 1500: principled, human moves with the occasional very human oversight.',
    accent: '#10b981',
    motif: '🧠',
    bot: { style: 'human', maiaRating: 1500, elo: 1550, moveTimeMs: 600 },
  },
  {
    id: 'knox',
    name: 'Fort Knox',
    title: 'Solid defender',
    rating: 1700,
    bio: 'A brick wall. Trades pieces, avoids weaknesses, and grinds equal endgames. Patience required.',
    accent: '#60a5fa',
    motif: '🛡️',
    bot: { style: 'defensive', elo: 1700, moveTimeMs: 800 },
  },
  {
    id: 'nora',
    name: 'Nora',
    title: 'Human-like · 1900',
    rating: 1900,
    bio: 'Maia at 1900: strong club-to-expert instincts and clean technique, with only rare human slips.',
    accent: '#059669',
    motif: '🧠',
    bot: { style: 'human', maiaRating: 1900, elo: 1900, moveTimeMs: 700 },
  },
  {
    id: 'tess',
    name: 'Tess Tactics',
    title: 'Tactical expert',
    rating: 2050,
    bio: "Sees combinations three moves deep. Leave a loose piece and it's gone in a flash.",
    accent: '#fb7185',
    motif: '🎯',
    bot: { style: 'aggressive', elo: 2050, moveTimeMs: 900 },
  },
  {
    id: 'vera',
    name: 'Vera Vision',
    title: 'Positional master',
    rating: 2250,
    bio: 'Squeezes you slowly — better squares, better pawns, then a won endgame. Strategic to the core.',
    accent: '#a78bfa',
    motif: '👁️',
    bot: { style: 'positional', elo: 2250, moveTimeMs: 1000 },
  },
  {
    id: 'ivan',
    name: 'Iron Ivan',
    title: 'Master',
    rating: 2500,
    bio: "A titled-strength all-rounder with no obvious weaknesses. You'll need your best chess.",
    accent: '#818cf8',
    motif: '🦾',
    bot: { style: 'balanced', elo: 2500, moveTimeMs: 1100 },
  },
  {
    id: 'nadia',
    name: 'Deep Nadia',
    title: 'Grandmaster',
    rating: 2800,
    bio: 'Near the top of the ladder: precise, deep, and ruthless. Mistakes are punished without mercy.',
    accent: '#c084fc',
    motif: '🔮',
    bot: { style: 'balanced', elo: 2800, moveTimeMs: 1200 },
  },
  {
    id: 'stockzilla',
    name: 'Stockzilla',
    title: 'Maximum strength',
    rating: 3190,
    bio: 'Full-strength Stockfish, no handicap. The final boss — beating it is a genuine feat.',
    accent: '#f43f5e',
    motif: '🐲',
    bot: { style: 'balanced', elo: 3190, moveTimeMs: 1500 },
  },
];

export const ROSTER_BY_ID: Record<string, RosterBot> = Object.fromEntries(BOT_ROSTER.map((b) => [b.id, b]));

/**
 * The engine config to actually play a roster bot with. Maia personas need Lc0;
 * when it isn't installed we substitute a Stockfish opponent at the same rating
 * so every rung is always playable.
 */
export function resolveBotConfig(bot: RosterBot, availability: EngineAvailability | null): BotConfig {
  if (bot.bot.style === 'human' && !availability?.lc0) {
    return { style: 'balanced', elo: bot.rating, moveTimeMs: bot.bot.moveTimeMs ?? 600 };
  }
  return bot.bot;
}
