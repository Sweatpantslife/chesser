/**
 * Train hub landing (`#/train`): the "Coach & Plan" strip on top (one line of
 * plan progress + coach suggestion with the page's single hero Continue CTA;
 * the full coach view lives on `#/train/plan` — `#/coach` redirects here),
 * then a card grid of the six training surfaces. Cards are real links with a
 * review-due badge and a last-activity line, so every old top-level trainer
 * tab is reachable in two taps (Train → card) and shows its state at a glance.
 */
import { lazy, Suspense, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconBolt,
  IconCoords,
  IconEndgame,
  IconTactics,
  IconTrain,
  IconCrown,
} from '../components/icons';
import { playSound } from '../lib/sound';
import { useReviewSummary } from '../lib/decks';
import { DECK_FOR_CARD, useTrainerLastActivity, type TrainerCardId } from '../lib/trainActivity';

// Lazy: the strip reads the plan store, whose lesson/master-game catalogues
// must stay out of the app-shell chunk (TrainHub itself is eager).
const CoachPlanStrip = lazy(() => import('./CoachPlanStrip'));

/** label/hint i18n sources: nav:sections.* — order is the approved IA order. */
const CARDS: { id: TrainerCardId; to: string; icon: typeof IconTactics }[] = [
  { id: 'tactics', to: '/train/tactics', icon: IconTactics },
  { id: 'endgames', to: '/train/endgames', icon: IconEndgame },
  { id: 'vision', to: '/train/vision', icon: IconTrain },
  { id: 'checkmates', to: '/train/checkmates', icon: IconCrown },
  { id: 'antiBlunder', to: '/train/anti-blunder', icon: IconBolt },
  { id: 'coordinates', to: '/train/coordinates', icon: IconCoords },
];

export function TrainHub() {
  const { t, i18n } = useTranslation('nav');
  const review = useReviewSummary();
  const lastActivity = useTrainerLastActivity();
  const dueByDeck = useMemo(
    () => Object.fromEntries(review.decks.map((d) => [d.deck, d.due])) as Partial<Record<string, number>>,
    [review],
  );
  const rtf = useMemo(
    () => new Intl.RelativeTimeFormat(i18n.language || 'en', { numeric: 'auto' }),
    [i18n.language],
  );
  const lastLabel = (ts: number) => {
    const midnight = (v: number) => {
      const d = new Date(v);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    };
    const days = Math.max(0, Math.round((midnight(Date.now()) - midnight(ts)) / 86_400_000));
    return t('cards.lastActivity', { when: rtf.format(-days, 'day') });
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-4">
      <header>
        <h1 className="font-display text-xl font-bold text-ink">{t('hubs.train.label')}</h1>
        <p className="text-xs text-neutral-400">{t('hubs.train.hint')}</p>
      </header>

      {/* Coach & Plan strip (placeholder keeps the grid from jumping while the lazy chunk lands). */}
      <Suspense fallback={<section aria-hidden="true" className="min-h-11" />}>
        <CoachPlanStrip />
      </Suspense>

      {/* Trainer cards */}
      <ul className="grid list-none grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CARDS.map((card) => {
          const Icon = card.icon;
          const deck = DECK_FOR_CARD[card.id];
          const due = deck ? dueByDeck[deck] ?? 0 : 0;
          const last = lastActivity[card.id];
          return (
            <li key={card.id}>
              <Link
                to={card.to}
                onClick={() => playSound('uiClick')}
                data-testid={`train-card-${card.id}`}
                className="btn-press group flex min-h-20 items-start gap-4 rounded-2xl bg-panel p-4 shadow-soft hover:bg-panelmute"
              >
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-panelmute text-neutral-300 group-hover:text-ink"
                >
                  <Icon size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-display text-base font-bold text-ink">{t(`sections.${card.id}.label`)}</span>
                    {due > 0 && (
                      <span
                        aria-label={t('cards.reviewsDue', { count: due })}
                        className="ml-auto shrink-0 rounded-full bg-amber-950 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-300"
                      >
                        {due}
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-neutral-400">{t(`sections.${card.id}.hint`)}</span>
                  {last !== null && <span className="mt-1 block text-xs text-neutral-400">{lastLabel(last)}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
