/**
 * Client for the AI coach's "engine-truth + LLM-words" layer.
 *
 * Everything here is READ-ONLY over the existing analytics outputs: the
 * builders compress an {@link AnalysisReport} row / summary / weakness entry
 * into the compact facts payloads defined in @chesser/shared, and
 * {@link explainWithCoach} sends them for wording. The helper memoizes per
 * payload (and dedupes in-flight calls) so navigating back to a move never
 * re-asks, and it NEVER throws:
 *
 *   • BYOK key configured (store/byok) → the user's own provider is called
 *     directly from the browser, falling back to the server's stateless
 *     pass-through when CORS blocks the direct call (lib/byokCoach);
 *   • otherwise → POST /api/coach/explain using the operator's env key
 *     (self-hosters). A { configured: false } reply short-circuits every
 *     later env-key call this session (the server has no key — stop asking);
 *   • network/HTTP/provider errors → resolves null (and is retryable).
 *
 * A null result means "use the existing rule-based text" — the calling UI
 * must degrade silently, no error states.
 */
import type {
  CoachExplainFacts,
  CoachExplainResponse,
  CoachGamePhase,
  CoachGameSummaryFacts,
  CoachMoveFacts,
  CoachSkillLevel,
  CoachWeaknessFacts,
} from '@chesser/shared';
import { formatScore } from './format';
import type { AnalysisReport, EvalPoint, MoveDetail, Side } from './analytics/types';
import { describeExample, type WeaknessEntry, type WeaknessProfile } from './weakness';
import { explainWithUserKey } from './byokCoach';
import { byokConfig } from '../store/byok';

// ---------------------------------------------------------------------------
// Fetch helper with memoization
// ---------------------------------------------------------------------------

const MEMO_MAX = 100;
const memo = new Map<string, Promise<string | null>>();
/** Once the server reports no key, skip the network for the rest of the session. */
let unconfigured = false;
/** Memoized /api/coach/status probe (env-key availability). */
let statusProbe: Promise<boolean> | null = null;

/** Test hook — clears the memo, the "server has no key" latch and the status probe. */
export function _resetCoachApiForTests(): void {
  memo.clear();
  unconfigured = false;
  statusProbe = null;
}

/**
 * Does the SERVER have an operator-configured LLM key (self-hoster env key)?
 * Memoized on success; failures resolve false but stay retryable. Never throws.
 */
export function serverCoachConfigured(): Promise<boolean> {
  if (unconfigured) return Promise.resolve(false);
  if (statusProbe) return statusProbe;
  const probe = (async () => {
    try {
      const res = await fetch('/api/coach/status');
      if (!res.ok) return false;
      const data = (await res.json()) as { configured?: boolean };
      if (data.configured !== true) {
        unconfigured = true;
        return false;
      }
      return true;
    } catch {
      statusProbe = null; // transient — allow a later retry
      return false;
    }
  })();
  statusProbe = probe;
  return probe;
}

/**
 * Ask the AI coach to word the given facts. Resolves the prose, or null when
 * the caller should fall back to its rule-based text. Uses the user's own key
 * (BYOK) when one is configured, else the server's env-key path.
 */
export function explainWithCoach(facts: CoachExplainFacts, level?: CoachSkillLevel): Promise<string | null> {
  const byok = byokConfig();
  if (!byok && unconfigured) return Promise.resolve(null);

  // Fingerprint the route so switching provider/model/key re-asks. The memo is
  // an in-memory session cache — the key never leaves this module.
  const source = byok ? ['byok', byok.provider, byok.model, byok.baseUrl, byok.apiKey] : ['server'];
  const key = JSON.stringify([facts, level ?? null, source]);
  const hit = memo.get(key);
  if (hit) return hit;

  const promise = byok
    ? explainWithUserKey(byok, facts, level)
    : (async (): Promise<string | null> => {
        try {
          const res = await fetch('/api/coach/explain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ facts, level }),
          });
          if (!res.ok) return null; // 4xx/5xx (incl. rate limit / provider failure) → fall back
          const data = (await res.json()) as CoachExplainResponse;
          if (!data.configured) {
            unconfigured = true;
            return null;
          }
          return data.explanation;
        } catch {
          return null;
        }
      })();

  memo.set(key, promise);
  if (memo.size > MEMO_MAX) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  // Transient failures shouldn't be memoized forever — allow a later retry
  // (the "no key" case is latched separately above and stays memo-free).
  void promise.then((text) => {
    if (text === null) memo.delete(key);
  });
  return promise;
}

/** Coarse skill bucket from a rating, for the coach's level-of-language hint. */
export function skillLevelFromRating(rating: number): CoachSkillLevel {
  if (rating < 1200) return 'beginner';
  if (rating < 1800) return 'intermediate';
  return 'advanced';
}

// ---------------------------------------------------------------------------
// Facts builders (pure over the existing analytics shapes)
// ---------------------------------------------------------------------------

const round1 = (n: number) => Math.round(n * 10) / 10;
const povWin = (whiteWin: number, side: Side) => (side === 'white' ? whiteWin : 100 - whiteWin);
const moveLabelOf = (ply: number) => `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '…'}`;

function fmtEval(ev: EvalPoint | null): string | null {
  if (!ev) return null;
  return formatScore(ev.mate !== undefined ? { kind: 'mate', value: ev.mate } : { kind: 'cp', value: ev.cp ?? 0 });
}

function phaseOf(report: AnalysisReport, ply: number): CoachGamePhase {
  for (const p of report.phases) if (ply >= p.startPly && ply <= p.endPly) return p.phase;
  return 'middlegame';
}

/** One reviewed move → move facts. `weaknessThemes` are optional labels from the profile. */
export function buildMoveFacts(move: MoveDetail, report: AnalysisReport, weaknessThemes: string[] = []): CoachMoveFacts {
  const playedIsBest = move.bestMoveUci !== null ? move.bestMoveUci === move.uci : move.bestMoveSan === move.san;
  return {
    kind: 'move',
    fen: move.fenBefore,
    side: move.side,
    moveLabel: moveLabelOf(move.ply),
    san: move.san,
    classification: move.classification,
    evalBefore: fmtEval(move.evalBefore),
    evalAfter: move.evalText ?? fmtEval(move.evalAfter),
    winBefore: round1(povWin(move.winBefore, move.side)),
    winAfter: round1(povWin(move.winAfter, move.side)),
    bestMoveSan: playedIsBest ? null : move.bestMoveSan,
    pv: move.pv.slice(0, 6),
    bestReplySan: move.bestReplySan,
    phase: phaseOf(report, move.ply),
    isCheck: move.isCheck,
    isMate: move.isMate,
    ruleBasedText: move.explanation || null,
    weaknessThemes: weaknessThemes.slice(0, 3),
  };
}

function resultFor(result: string | null, color: Side | null): CoachGameSummaryFacts['result'] {
  if (result === '1/2-1/2') return 'draw';
  if (result === '1-0') return color === 'black' ? 'loss' : 'win';
  if (result === '0-1') return color === 'white' ? 'loss' : 'win';
  return 'unknown';
}

/** Whole review → compact player-POV summary facts. */
export function buildGameSummaryFacts(report: AnalysisReport): CoachGameSummaryFacts {
  const color = report.meta.playerColor;
  const summary = color === 'black' ? report.black : report.white;
  const side: Side = color ?? 'white';
  return {
    kind: 'game_summary',
    playerColor: color,
    result: resultFor(report.meta.result, color),
    accuracy: summary.accuracy,
    acpl: summary.acpl,
    moves: summary.moves,
    counts: Object.fromEntries(Object.entries(summary.counts).filter(([, n]) => n > 0)),
    opening: report.opening.name || report.opening.eco ? { eco: report.opening.eco, name: report.opening.name } : null,
    phases: report.phases
      .filter((p) => p.endPly >= p.startPly && (color === 'black' ? p.black : p.white).moves > 0)
      .map((p) => ({ phase: p.phase, accuracy: (color === 'black' ? p.black : p.white).accuracy })),
    keyMoments: report.criticalMoments.slice(0, 6).map((c) => c.description),
    estimatedRating: report.estimatedPerformanceRating[side] ?? null,
  };
}

/** One ranked weakness entry (+ its profile context) → weakness facts. */
export function buildWeaknessFacts(entry: WeaknessEntry, profile: WeaknessProfile): CoachWeaknessFacts {
  return {
    kind: 'weakness',
    label: entry.meta.label,
    summary: entry.meta.summary,
    advice: entry.meta.advice,
    count: entry.count,
    games: entry.games,
    totalGames: profile.games,
    trend: entry.trend === null ? null : entry.trend <= -0.3 ? 'improving' : entry.trend >= 0.3 ? 'worsening' : 'steady',
    examples: entry.examples.slice(0, 3).map(describeExample),
    accuracy: profile.accuracy,
    worstPhase: profile.worstPhase,
  };
}
