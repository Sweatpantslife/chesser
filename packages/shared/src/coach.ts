/**
 * LLM Coach — the "engine-truth + LLM-words" explain API contract.
 *
 * POST /api/coach/explain takes a structured facts payload derived ENTIRELY
 * from the existing engine analysis (lib/analytics on the web side). The
 * server verbalizes those facts with an LLM; the model is instructed to never
 * invent chess facts that are not present in the payload. When no provider
 * key is configured the endpoint answers `{ configured: false }` (HTTP 200)
 * and the client silently falls back to its rule-based explanation text.
 */

export type CoachSkillLevel = 'beginner' | 'intermediate' | 'advanced';
export type CoachGamePhase = 'opening' | 'middlegame' | 'endgame';

/** One reviewed move, as verified engine facts (all evals pre-formatted). */
export interface CoachMoveFacts {
  kind: 'move';
  /** Position BEFORE the move (FEN). */
  fen: string;
  /** Side that played the move. */
  side: 'white' | 'black';
  /** Move-list label — "14." for White, "14…" for Black. */
  moveLabel: string;
  /** The move that was played (SAN). */
  san: string;
  /** Report classification: blunder | mistake | inaccuracy | miss | good | best | great | brilliant | book. */
  classification: string;
  /** Formatted White-POV eval before/after ("+1.24", "#3"), null when unknown. */
  evalBefore: string | null;
  evalAfter: string | null;
  /** Mover-POV win % (0–100) before/after the move. */
  winBefore: number;
  winAfter: number;
  /** Engine's preferred move when it differs from the played one. */
  bestMoveSan: string | null;
  /** Engine line from the position (SAN), first few plies. */
  pv: string[];
  /** Opponent's best reply to the played move (the threat), if known. */
  bestReplySan: string | null;
  phase: CoachGamePhase;
  isCheck: boolean;
  isMate: boolean;
  /** The app's own template explanation — grounding the model must not contradict. */
  ruleBasedText: string | null;
  /** Player's recurring weakness themes relevant here (labels), if any. */
  weaknessThemes: string[];
}

/** A whole reviewed game, compacted to player-POV headline facts. */
export interface CoachGameSummaryFacts {
  kind: 'game_summary';
  playerColor: 'white' | 'black' | null;
  result: 'win' | 'loss' | 'draw' | 'unknown';
  /** Player-side accuracy (0–100) and average centipawn loss. */
  accuracy: number;
  acpl: number;
  /** Player moves in the game. */
  moves: number;
  /** Player-side classification counts. */
  counts: Record<string, number>;
  opening: { eco: string | null; name: string | null } | null;
  /** Player-side accuracy per phase (empty phases omitted). */
  phases: { phase: CoachGamePhase; accuracy: number }[];
  /** One-line descriptions of the review's key moments (both sides). */
  keyMoments: string[];
  estimatedRating: number | null;
}

/** One ranked entry of the player's weakness profile (lib/weakness). */
export interface CoachWeaknessFacts {
  kind: 'weakness';
  /** Catalogue label, e.g. "Hanging pieces". */
  label: string;
  /** What the pattern means (catalogue prose). */
  summary: string;
  /** The catalogue's concrete tip for fixing it. */
  advice: string;
  /** Occurrences / games containing it / games profiled. */
  count: number;
  games: number;
  totalGames: number;
  trend: 'improving' | 'steady' | 'worsening' | null;
  /** One-line descriptions of real examples from the player's games. */
  examples: string[];
  /** Player's overall accuracy across profiled games. */
  accuracy: number;
  worstPhase: CoachGamePhase | null;
}

export type CoachExplainFacts = CoachMoveFacts | CoachGameSummaryFacts | CoachWeaknessFacts;

export interface CoachExplainRequest {
  facts: CoachExplainFacts;
  /** Optional hint so the coach can pitch its language. Default: intermediate. */
  level?: CoachSkillLevel;
}

export type CoachExplainResponse =
  /** No LLM key configured server-side — client should use its rule-based text. */
  | { configured: false; reason: 'no-key' }
  | { configured: true; explanation: string; model: string; cached: boolean };
