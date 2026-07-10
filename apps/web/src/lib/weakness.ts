/**
 * Weakness detection — pure aggregation over game-review analytics reports.
 *
 * The coach feature turns finished game reviews ({@link AnalysisReport}) into
 * a ranked "your weaknesses" profile in two pure steps:
 *
 *  1. {@link digestReport}: one report → one compact {@link GameDigest} — the
 *     player's accuracy, per-phase numbers and every serious mistake tagged
 *     with the weakness buckets it evidences (hung a piece, missed a mate,
 *     missed a fork, …). Tags are verified on the board via the existing
 *     heuristic motif classifier (lib/motifs) run on the engine's best line —
 *     the same classifier the puzzle service uses, so "what you missed" and
 *     "which puzzles train it" speak the same language.
 *  2. {@link buildWeaknessProfile}: many digests → ranked weaknesses with
 *     concrete examples from the player's OWN games, per-phase eval loss,
 *     colour/opening tendencies and a recent-vs-earlier trend.
 *
 * Everything here is deterministic given its inputs (no Date.now, no stores,
 * no engine) so the aggregation is unit-testable with fixture reports.
 * Persistence lives in store/coach.ts; presentation in pages/CoachPage.tsx.
 */
import { Chess } from 'chess.js';
import type { AnalysisReport, MoveDetail, PhaseName, Side } from './analytics/types';
import { classifyMotifs, type Motif } from './motifs';

// ---------------------------------------------------------------------------
// Weakness catalogue
// ---------------------------------------------------------------------------

/** The recurring-pattern buckets the coach can diagnose and train. */
export const WEAKNESS_KINDS = [
  'hangingPieces',
  'missedMates',
  'missedForks',
  'missedTactics',
  'openingMistakes',
  'endgameMistakes',
] as const;

export type WeaknessKind = (typeof WEAKNESS_KINDS)[number];

export interface WeaknessMeta {
  kind: WeaknessKind;
  label: string;
  /** Small emoji marker for cards/toasts (matches the app's badge style). */
  icon: string;
  /** What the pattern means, in plain language. */
  summary: string;
  /** One encouraging, concrete tip. */
  advice: string;
  /** Lichess puzzle theme tags that train this weakness (ANY-of match). */
  puzzleThemes: string[];
}

export const WEAKNESS_META: Record<WeaknessKind, WeaknessMeta> = {
  hangingPieces: {
    kind: 'hangingPieces',
    label: 'Hanging pieces',
    icon: '🫳',
    summary: 'Moves that left a piece where it could simply be captured.',
    advice:
      'Before you commit to a move, do one last scan: "what can my opponent take?" That single habit removes most of these losses.',
    puzzleThemes: ['hangingPiece'],
  },
  missedMates: {
    kind: 'missedMates',
    label: 'Missed checkmates',
    icon: '♛',
    summary: 'Positions where a forced mate was available but a slower move was played.',
    advice:
      'When the enemy king looks airy, pause and hunt checks first — forcing moves are free to calculate because the replies are limited.',
    puzzleThemes: ['mateIn1', 'mateIn2', 'mateIn3', 'backRankMate'],
  },
  missedForks: {
    kind: 'missedForks',
    label: 'Missed forks',
    icon: '🔱',
    summary: 'Chances to attack two pieces at once that went unplayed.',
    advice:
      'Knights and pawns are the usual culprits — each time a knight can jump forward, check whether the landing square eyes two targets.',
    puzzleThemes: ['fork'],
  },
  missedTactics: {
    kind: 'missedTactics',
    label: 'Missed tactics',
    icon: '⚡',
    summary: 'Winning shots — captures, pins, skewers, discovered attacks — that slipped by.',
    advice:
      'Loose pieces and lined-up pieces are tactical fuel. Scan for undefended targets and pieces sharing a line before settling for a quiet move.',
    puzzleThemes: ['pin', 'skewer', 'discoveredAttack', 'hangingPiece'],
  },
  openingMistakes: {
    kind: 'openingMistakes',
    label: 'Opening slips',
    icon: '📖',
    summary: 'Eval given away in the first phase, right out of (or just after) theory.',
    advice:
      'You don\'t need more memorised lines — develop toward the centre, castle early, and don\'t move the same piece twice without a reason.',
    puzzleThemes: ['opening'],
  },
  endgameMistakes: {
    kind: 'endgameMistakes',
    label: 'Endgame conversion',
    icon: '🏁',
    summary: 'Advantages that shrank or slipped away once the board emptied.',
    advice:
      'In simple positions, king activity and passed pawns decide games. Slow down — endgames reward one careful check more than fast instinct.',
    puzzleThemes: ['endgame'],
  },
};

// ---------------------------------------------------------------------------
// Digest shapes
// ---------------------------------------------------------------------------

export type GameResult = 'win' | 'loss' | 'draw' | 'unknown';

/** One serious mistake by the player, tagged with the weaknesses it shows. */
export interface PlayerMistake {
  ply: number;
  san: string;
  /** Move-list label — "14." for White, "14…" for Black. */
  moveLabel: string;
  /** Position BEFORE the move (the moment the better option existed). */
  fenBefore: string;
  bestSan: string | null;
  bestUci: string | null;
  /** Mover-POV win% given away by the move (≥ 0). */
  winDrop: number;
  severity: 'blunder' | 'miss' | 'mistake';
  phase: PhaseName;
  kinds: WeaknessKind[];
}

/** Per-phase accuracy/ACPL for the PLAYER's side only. */
export interface PhaseDigest {
  accuracy: number;
  acpl: number;
  moves: number;
}

/** A compact, persistable summary of one reviewed game (player's POV). */
export interface GameDigest {
  gameKey: string;
  createdAt: number;
  playerColor: Side;
  result: GameResult;
  accuracy: number;
  acpl: number;
  moves: number;
  openingEco: string | null;
  openingName: string | null;
  phases: Record<PhaseName, PhaseDigest>;
  mistakes: PlayerMistake[];
}

// ---------------------------------------------------------------------------
// Report → digest
// ---------------------------------------------------------------------------

const povWin = (whiteWin: number, side: Side) => (side === 'white' ? whiteWin : 100 - whiteWin);

/** "N." for a White move, "N…" for a Black move (matches the move list). */
const moveLabelOf = (ply: number) => `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '…'}`;

function resultFor(result: string | null, color: Side): GameResult {
  if (result === '1/2-1/2') return 'draw';
  if (result === '1-0') return color === 'white' ? 'win' : 'loss';
  if (result === '0-1') return color === 'black' ? 'win' : 'loss';
  return 'unknown';
}

/** Severities the profile counts as evidence, with their ranking weight. */
const SEVERITY_WEIGHT: Record<PlayerMistake['severity'], number> = {
  blunder: 3,
  miss: 2.5,
  mistake: 1.5,
};

/** Win% the move must give away before a capture-refutation reads as "hung a piece". */
const HANGING_MIN_DROP = 15;
/** Win% threshold for the generic "missed a tactic" bucket. */
const MISSED_TACTIC_MIN_DROP = 20;
/** Digests keep at most this many mistakes (worst first) per game. */
const MAX_MISTAKES_PER_GAME = 12;

/**
 * The engine's best line from `fenBefore`, as UCI — classifyMotifs input.
 * The PV is stored as SAN, so replay it with chess.js; a row with no PV falls
 * back to just the best move. Returns [] when nothing replays.
 */
function bestLineUci(move: MoveDetail): string[] {
  if (move.pv.length > 0) {
    try {
      const chess = new Chess(move.fenBefore);
      const ucis: string[] = [];
      for (const san of move.pv) {
        const m = chess.move(san);
        ucis.push(m.from + m.to + (m.promotion ?? ''));
      }
      if (ucis.length > 0) return ucis;
    } catch {
      // fall through to the single best move
    }
  }
  return move.bestMoveUci ? [move.bestMoveUci] : [];
}

/** Motifs that mean "the best line delivered mate". */
const MATE_MOTIFS: ReadonlySet<Motif> = new Set(['mateIn1', 'mateIn2', 'mateIn3', 'mate', 'backRank']);

/**
 * Tag one bad move with the weakness buckets it evidences. Tactical claims
 * come from the motif classifier run on the engine's best line (what the
 * player MISSED); "hung a piece" comes from the engine's refutation being an
 * immediate capture. Phase buckets stack on top, so an endgame blunder that
 * hangs a rook counts toward both.
 */
export function tagMistake(move: MoveDetail, phase: PhaseName, winDrop: number): WeaknessKind[] {
  const kinds = new Set<WeaknessKind>();

  const missed = classifyMotifs(move.fenBefore, bestLineUci(move));
  if (missed.some((m) => MATE_MOTIFS.has(m))) kinds.add('missedMates');
  if (missed.includes('fork')) kinds.add('missedForks');

  // Hung a piece: the refutation is an immediate capture — strongest when it
  // takes the piece that just moved (destination squares match).
  const replyCaptures = move.bestReplySan?.includes('x') ?? false;
  const capturesMovedPiece = !!move.bestReplyUci && move.bestReplyUci.slice(2, 4) === move.uci.slice(2, 4);
  if (replyCaptures && (capturesMovedPiece || winDrop >= HANGING_MIN_DROP)) kinds.add('hangingPieces');

  // Generic missed shot: a big drop where the skipped best move was itself
  // forcing (capture or check) but no named motif matched.
  if (
    kinds.size === 0 &&
    winDrop >= MISSED_TACTIC_MIN_DROP &&
    move.bestMoveSan !== null &&
    /[x+#]/.test(move.bestMoveSan)
  ) {
    kinds.add('missedTactics');
  }

  if (phase === 'opening') kinds.add('openingMistakes');
  if (phase === 'endgame') kinds.add('endgameMistakes');

  return WEAKNESS_KINDS.filter((k) => kinds.has(k));
}

/**
 * Compress one review into a {@link GameDigest} for the player's side.
 * Returns null for reports without a known player colour (analysis-board
 * sessions review both sides — there is no "you" to profile).
 */
export function digestReport(report: AnalysisReport): GameDigest | null {
  const color = report.meta.playerColor;
  if (!color) return null;

  const summary = color === 'white' ? report.white : report.black;

  const phases = { opening: emptyPhase(), middlegame: emptyPhase(), endgame: emptyPhase() };
  const phaseOf = (ply: number): PhaseName => {
    for (const p of report.phases) if (ply >= p.startPly && ply <= p.endPly) return p.phase;
    return 'middlegame';
  };
  for (const p of report.phases) {
    const side = color === 'white' ? p.white : p.black;
    phases[p.phase] = { accuracy: side.accuracy, acpl: side.acpl, moves: side.moves };
  }

  const mistakes: PlayerMistake[] = [];
  for (const move of report.moves) {
    if (move.side !== color) continue;
    if (move.classification !== 'blunder' && move.classification !== 'mistake' && move.classification !== 'miss') continue;
    const winDrop = Math.max(0, povWin(move.winBefore, color) - povWin(move.winAfter, color));
    const phase = phaseOf(move.ply);
    mistakes.push({
      ply: move.ply,
      san: move.san,
      moveLabel: moveLabelOf(move.ply),
      fenBefore: move.fenBefore,
      bestSan: move.bestMoveSan,
      bestUci: move.bestMoveUci,
      winDrop: Math.round(winDrop * 10) / 10,
      severity: move.classification,
      phase,
      kinds: tagMistake(move, phase, winDrop),
    });
  }
  mistakes.sort((a, b) => SEVERITY_WEIGHT[b.severity] * b.winDrop - SEVERITY_WEIGHT[a.severity] * a.winDrop);

  return {
    gameKey: report.gameKey,
    createdAt: report.createdAt,
    playerColor: color,
    result: resultFor(report.meta.result, color),
    accuracy: summary.accuracy,
    acpl: summary.acpl,
    moves: summary.moves,
    openingEco: report.opening.eco,
    openingName: report.opening.name,
    phases,
    mistakes: mistakes.slice(0, MAX_MISTAKES_PER_GAME),
  };
}

const emptyPhase = (): PhaseDigest => ({ accuracy: 100, acpl: 0, moves: 0 });

// ---------------------------------------------------------------------------
// Digests → profile
// ---------------------------------------------------------------------------

/** A profile example: a mistake plus which game it came from. */
export interface WeaknessExample extends PlayerMistake {
  gameKey: string;
  gameCreatedAt: number;
  playerColor: Side;
  openingName: string | null;
  result: GameResult;
}

export interface WeaknessEntry {
  kind: WeaknessKind;
  meta: WeaknessMeta;
  /** Occurrences across the profiled games. */
  count: number;
  /** Games in which it occurred at least once. */
  games: number;
  /** Severity-weighted occurrences per game — the ranking key. */
  score: number;
  /** Worst recent occurrences, most instructive first. */
  examples: WeaknessExample[];
  /**
   * Recent-vs-earlier rate change (occurrences/game): negative = improving.
   * Null until both halves have ≥ {@link TREND_MIN_GAMES} games.
   */
  trend: number | null;
}

export interface ColorTendency {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Move-weighted mean accuracy, one decimal. */
  accuracy: number;
}

export interface OpeningTendency {
  name: string;
  eco: string | null;
  games: number;
  wins: number;
  losses: number;
  accuracy: number;
}

export interface PhaseTendency {
  phase: PhaseName;
  accuracy: number;
  acpl: number;
  moves: number;
}

export interface WeaknessProfile {
  /** Games actually aggregated (≤ {@link PROFILE_MAX_GAMES}, newest first). */
  games: number;
  /** Move-weighted mean accuracy across profiled games. */
  accuracy: number;
  /** Ranked, recurring weaknesses (count ≥ {@link RECURRENCE_MIN}). */
  weaknesses: WeaknessEntry[];
  /** Player-side accuracy per phase, worst phase first in `worstPhase`. */
  phases: PhaseTendency[];
  worstPhase: PhaseName | null;
  colors: Record<Side, ColorTendency>;
  /** Openings seen ≥ 2 times, lowest accuracy first. */
  openings: OpeningTendency[];
}

/** The profile looks at this many most-recent reviewed games. */
export const PROFILE_MAX_GAMES = 30;
/** A pattern must occur this often before the coach calls it a weakness. */
export const RECURRENCE_MIN = 2;
/** Games needed in EACH half before a trend is voiced. */
export const TREND_MIN_GAMES = 3;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Aggregate digests into the ranked profile. Deterministic: ordering ties
 * break on the WEAKNESS_KINDS catalogue order.
 */
export function buildWeaknessProfile(allDigests: GameDigest[]): WeaknessProfile {
  const digests = [...allDigests].sort((a, b) => b.createdAt - a.createdAt).slice(0, PROFILE_MAX_GAMES);

  // — Weakness buckets —
  const entries: WeaknessEntry[] = [];
  for (const kind of WEAKNESS_KINDS) {
    let count = 0;
    let weighted = 0;
    let games = 0;
    const examples: WeaknessExample[] = [];
    const half = Math.floor(digests.length / 2);
    let recent = 0;
    let earlier = 0;
    digests.forEach((d, i) => {
      let inGame = 0;
      for (const m of d.mistakes) {
        if (!m.kinds.includes(kind)) continue;
        count++;
        inGame++;
        weighted += SEVERITY_WEIGHT[m.severity];
        examples.push({
          ...m,
          gameKey: d.gameKey,
          gameCreatedAt: d.createdAt,
          playerColor: d.playerColor,
          openingName: d.openingName,
          result: d.result,
        });
      }
      if (inGame > 0) games++;
      if (i < half) recent += inGame;
      else earlier += inGame;
    });
    if (count < RECURRENCE_MIN) continue;
    examples.sort(
      (a, b) =>
        SEVERITY_WEIGHT[b.severity] * b.winDrop - SEVERITY_WEIGHT[a.severity] * a.winDrop ||
        b.gameCreatedAt - a.gameCreatedAt,
    );
    const half2 = digests.length - Math.floor(digests.length / 2);
    const trend =
      Math.floor(digests.length / 2) >= TREND_MIN_GAMES && half2 >= TREND_MIN_GAMES
        ? round1(recent / Math.floor(digests.length / 2) - earlier / half2)
        : null;
    entries.push({
      kind,
      meta: WEAKNESS_META[kind],
      count,
      games,
      score: round1(weighted / Math.max(1, digests.length)),
      examples: examples.slice(0, 3),
      trend,
    });
  }
  entries.sort((a, b) => b.score - a.score || b.count - a.count);

  // — Phases (player side, move-weighted) —
  const phases: PhaseTendency[] = (['opening', 'middlegame', 'endgame'] as const).map((phase) => {
    let moves = 0;
    let accSum = 0;
    let acplSum = 0;
    for (const d of digests) {
      const p = d.phases[phase];
      moves += p.moves;
      accSum += p.accuracy * p.moves;
      acplSum += p.acpl * p.moves;
    }
    return {
      phase,
      accuracy: moves > 0 ? round1(accSum / moves) : 100,
      acpl: moves > 0 ? Math.round(acplSum / moves) : 0,
      moves,
    };
  });
  const played = phases.filter((p) => p.moves >= 10);
  const worstPhase =
    played.length > 0 ? played.reduce((worst, p) => (p.accuracy < worst.accuracy ? p : worst)).phase : null;

  // — Colours —
  const colors: Record<Side, ColorTendency> = {
    white: { games: 0, wins: 0, losses: 0, draws: 0, accuracy: 0 },
    black: { games: 0, wins: 0, losses: 0, draws: 0, accuracy: 0 },
  };
  const colorMoves: Record<Side, number> = { white: 0, black: 0 };
  const colorAcc: Record<Side, number> = { white: 0, black: 0 };
  for (const d of digests) {
    const c = colors[d.playerColor];
    c.games++;
    if (d.result === 'win') c.wins++;
    else if (d.result === 'loss') c.losses++;
    else if (d.result === 'draw') c.draws++;
    colorMoves[d.playerColor] += d.moves;
    colorAcc[d.playerColor] += d.accuracy * d.moves;
  }
  for (const side of ['white', 'black'] as const) {
    colors[side].accuracy = colorMoves[side] > 0 ? round1(colorAcc[side] / colorMoves[side]) : 0;
  }

  // — Openings (≥ 2 games under the same name) —
  const byOpening = new Map<string, { eco: string | null; games: number; wins: number; losses: number; moves: number; acc: number }>();
  for (const d of digests) {
    if (!d.openingName) continue;
    const o = byOpening.get(d.openingName) ?? { eco: d.openingEco, games: 0, wins: 0, losses: 0, moves: 0, acc: 0 };
    o.games++;
    if (d.result === 'win') o.wins++;
    else if (d.result === 'loss') o.losses++;
    o.moves += d.moves;
    o.acc += d.accuracy * d.moves;
    byOpening.set(d.openingName, o);
  }
  const openings: OpeningTendency[] = [...byOpening.entries()]
    .filter(([, o]) => o.games >= 2)
    .map(([name, o]) => ({
      name,
      eco: o.eco,
      games: o.games,
      wins: o.wins,
      losses: o.losses,
      accuracy: o.moves > 0 ? round1(o.acc / o.moves) : 0,
    }))
    .sort((a, b) => a.accuracy - b.accuracy);

  const totalMoves = digests.reduce((n, d) => n + d.moves, 0);
  const accuracy = totalMoves > 0 ? round1(digests.reduce((n, d) => n + d.accuracy * d.moves, 0) / totalMoves) : 0;

  return { games: digests.length, accuracy, weaknesses: entries, phases, worstPhase, colors, openings };
}

// ---------------------------------------------------------------------------
// Plain-language insights
// ---------------------------------------------------------------------------

/** One-line, human description of an example ("14. Qxb7? in your Sicilian Defense game — Nc6 was waiting"). */
export function describeExample(ex: WeaknessExample): string {
  const where = ex.openingName ? `your ${ex.openingName} game` : `a game as ${ex.playerColor === 'white' ? 'White' : 'Black'}`;
  const better = ex.bestSan ? ` — ${ex.bestSan} was the move` : '';
  return `${ex.moveLabel} ${ex.san} in ${where} gave away ${Math.round(ex.winDrop)}% of your winning chances${better}.`;
}

/**
 * The coach's paragraph for one weakness: what keeps happening (with real
 * numbers), a concrete example from the player's own games, then the tip.
 * Encouraging by construction — it names the fix, not just the fault.
 */
export function insightFor(entry: WeaknessEntry, profile: WeaknessProfile): string {
  const meta = entry.meta;
  const freq =
    entry.games === 1
      ? `showed up ${entry.count === 1 ? 'once' : `${entry.count} times`} in one of your last ${profile.games} games`
      : `showed up ${entry.count} times across ${entry.games} of your last ${profile.games} games`;
  const example = entry.examples[0] ? ` For example: ${describeExample(entry.examples[0])}` : '';
  const trend =
    entry.trend !== null && entry.trend <= -0.5
      ? ' The good news: it is already happening less in your recent games — keep going.'
      : ` ${meta.advice}`;
  return `${meta.label} ${freq}. ${meta.summary}${example}${trend}`;
}
