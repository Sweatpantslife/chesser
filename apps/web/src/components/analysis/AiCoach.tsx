/**
 * AI Coach UI — natural-language prose worded by an LLM from the engine's
 * verified analysis (POST /api/coach/explain via lib/coachApi).
 *
 * Every surface here degrades silently: when the server has no LLM key, the
 * request fails, or the toggle is off, the existing rule-based text renders
 * exactly as before — no error states, no toasts. AI-generated text is always
 * labeled with the "AI Coach" badge and its disclaimer.
 *
 *  • AiMoveExplanation — the move-detail paragraph plus an "Explain this"
 *    button; clicking asks the coach and swaps in the prose on success.
 *  • AiNarrative       — renders `fallback` immediately and auto-upgrades to
 *    the coach's wording when it arrives (weakness cards).
 *  • CoachSummaryCard  — self-contained "Coach's summary" panel for a
 *    reviewed game; renders nothing until prose arrives.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CoachExplainFacts, CoachGameSummaryFacts, CoachMoveFacts } from '@chesser/shared';
import { explainWithCoach, serverCoachConfigured, skillLevelFromRating } from '../../lib/coachApi';
import { useRatings } from '../../store/ratings';
import { useByok } from '../../store/byok';
import { ThinkingDots } from '../icons';

/** One-line nudge shown in place of AI actions when no key is available.
 *  Kept as the canonical English for external callers; rendering inside this
 *  file goes through i18n (`analysis:ai.noKeyHint` mirrors this string). */
export const NO_KEY_HINT = 'Add an AI key in Settings to unlock richer coaching.';

/**
 * Is an LLM reachable for the coach? true when the user configured their own
 * key (BYOK — instant, purely local knowledge), otherwise the answer of a
 * one-shot /api/coach/status probe (self-hoster env key). `null` while the
 * probe is still in flight — callers should render nothing extra yet.
 */
export function useCoachAvailable(): boolean | null {
  const hasUserKey = useByok((s) => s.apiKey !== '');
  const [serverKey, setServerKey] = useState<boolean | null>(null);
  useEffect(() => {
    if (hasUserKey) return;
    let live = true;
    void serverCoachConfigured().then((ok) => {
      if (live) setServerKey(ok);
    });
    return () => {
      live = false;
    };
  }, [hasUserKey]);
  return hasUserKey ? true : serverKey;
}

export function AiCoachBadge(): JSX.Element {
  const { t } = useTranslation('analysis');
  return (
    <span
      title={t('ai.disclaimer')}
      className="inline-flex shrink-0 items-center rounded-full bg-brand-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-brand-300"
    >
      {t('ai.badge')}
    </span>
  );
}

/** The coach's level-of-language hint, from the player's vs-bot rating. */
function useSkillLevel() {
  return useRatings((s) => skillLevelFromRating(Math.round(s.categories.bots.glicko.rating)));
}

// ---------------------------------------------------------------------------
// Per-move: fallback text + "Explain this" button
// ---------------------------------------------------------------------------

type FetchPhase = 'idle' | 'loading' | 'done' | 'unavailable';

export function AiMoveExplanation({ facts, fallback }: { facts: CoachMoveFacts | null; fallback: string }): JSX.Element {
  const { t } = useTranslation('analysis');
  const level = useSkillLevel();
  const available = useCoachAvailable();
  const [phase, setPhase] = useState<FetchPhase>('idle');
  const [text, setText] = useState<string | null>(null);
  const factsKey = facts ? `${facts.fen}:${facts.san}:${facts.classification}` : null;
  const latestKey = useRef(factsKey);
  latestKey.current = factsKey;

  // New move viewed → back to the plain rule-based text.
  useEffect(() => {
    setPhase('idle');
    setText(null);
  }, [factsKey]);

  const explain = () => {
    if (!facts || phase === 'loading') return;
    setPhase('loading');
    const key = factsKey;
    void explainWithCoach(facts, level).then((prose) => {
      // Ignore stale resolutions after the user moved on.
      if (latestKey.current !== key) return;
      if (prose) {
        setText(prose);
        setPhase('done');
      } else {
        // Keyless / offline / rate-limited: keep the rule-based text, no error.
        setPhase('unavailable');
      }
    });
  };

  return (
    <div>
      <p className="text-sm leading-snug text-neutral-200">
        {text ?? fallback}
        {text && (
          <span className="ml-1.5 inline-flex align-middle">
            <AiCoachBadge />
          </span>
        )}
      </p>
      {text && <p className="mt-0.5 text-[10px] text-neutral-400">{t('ai.disclaimer')}</p>}
      {facts && phase === 'idle' && available === true && (
        <button
          onClick={explain}
          data-testid="explain-this"
          title={t('ai.explainTitle')}
          className="btn-press mt-1.5 rounded-lg bg-neutral-700 px-2 py-1 text-xs font-semibold text-neutral-100 hover:bg-neutral-600"
        >
          {t('ai.explainThis')}
        </button>
      )}
      {facts && available === false && <p className="mt-1 text-[10px] text-neutral-400">{t('ai.noKeyHint')}</p>}
      {phase === 'loading' && (
        <span className="mt-1.5 flex items-center gap-1.5 text-xs text-brand-300">
          {t('ai.thinking')}
          <ThinkingDots />
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auto-upgrading narrative (weakness cards)
// ---------------------------------------------------------------------------

/** Renders `fallback` immediately; swaps in the coach's wording if it arrives. */
export function AiNarrative({
  facts,
  fallback,
  className = 'text-sm leading-relaxed text-neutral-300',
}: {
  facts: CoachExplainFacts | null;
  fallback: string;
  className?: string;
}): JSX.Element {
  const { t } = useTranslation('analysis');
  const level = useSkillLevel();
  const [text, setText] = useState<string | null>(null);
  const factsKey = facts ? JSON.stringify(facts) : null;

  useEffect(() => {
    setText(null);
    if (!factsKey || !facts) return;
    let live = true;
    void explainWithCoach(facts, level).then((prose) => {
      if (live && prose) setText(prose);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factsKey, level]);

  return (
    <div>
      <p className={className}>
        {text ?? fallback}
        {text && (
          <span className="ml-1.5 inline-flex align-middle">
            <AiCoachBadge />
          </span>
        )}
      </p>
      {text && <p className="mt-0.5 text-[10px] text-neutral-400">{t('ai.disclaimer')}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Whole-game summary card
// ---------------------------------------------------------------------------

/** "Coach's summary" panel — hidden entirely until the coach's prose arrives. */
export function CoachSummaryCard({ facts }: { facts: CoachGameSummaryFacts | null }): JSX.Element | null {
  const { t } = useTranslation('analysis');
  const level = useSkillLevel();
  const [text, setText] = useState<string | null>(null);
  const factsKey = facts ? JSON.stringify(facts) : null;

  useEffect(() => {
    setText(null);
    if (!factsKey || !facts) return;
    let live = true;
    void explainWithCoach(facts, level).then((prose) => {
      if (live && prose) setText(prose);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factsKey, level]);

  if (!text) return null;
  return (
    <div className="rounded-2xl bg-panel p-3 shadow-soft" data-testid="coach-summary">
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="font-display text-sm font-semibold text-ink">{t('ai.summaryTitle')}</h3>
        <AiCoachBadge />
      </div>
      <p className="text-sm leading-snug text-neutral-200">{text}</p>
      <p className="mt-1 text-[10px] text-neutral-400">{t('ai.disclaimer')}</p>
    </div>
  );
}
