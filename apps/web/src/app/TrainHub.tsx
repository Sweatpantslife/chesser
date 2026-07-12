/**
 * Train hub landing (`#/train`): the "Coach & Plan" strip on top (coach is a
 * disclosure — it has no route of its own; `#/coach` redirects here), then a
 * card grid of the six training surfaces. Cards are real links, so every old
 * top-level trainer tab is reachable in two taps (Train → card).
 */
import { lazy, Suspense, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconBolt,
  IconCoach,
  IconCoords,
  IconEndgame,
  IconSparkles,
  IconTactics,
  IconTrain,
  IconCrown,
} from '../components/icons';
import { playSound } from '../lib/sound';

const CoachPage = lazy(() => import('../pages/CoachPage').then((m) => ({ default: m.CoachPage })));

/** label/hint i18n sources: nav:sections.* (new) with train:tabs.* reused where unchanged. */
const CARDS = [
  { id: 'tactics', to: '/train/tactics', icon: IconTactics },
  { id: 'endgames', to: '/train/endgames', icon: IconEndgame },
  { id: 'vision', to: '/train/vision', icon: IconTrain },
  { id: 'checkmates', to: '/train/checkmates', icon: IconCrown },
  { id: 'antiBlunder', to: '/train/anti-blunder', icon: IconBolt },
  { id: 'coordinates', to: '/train/coordinates', icon: IconCoords },
] as const;

export function TrainHub() {
  const { t } = useTranslation('nav');
  const navigate = useNavigate();
  const [coachOpen, setCoachOpen] = useState(false);
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-4">
      {/* Coach & Plan strip */}
      <section className="rounded-2xl bg-panel p-4 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-ink">{t('coachStrip.title')}</h2>
            <p className="text-xs text-neutral-400">{t('coachStrip.hint')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                playSound('uiClick');
                setCoachOpen((o) => !o);
              }}
              aria-expanded={coachOpen}
              aria-controls="train-coach"
              className={`btn-press flex min-h-11 items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold sm:min-h-9 ${
                coachOpen ? 'bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-glow' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-ink'
              }`}
            >
              <IconCoach size={16} className={coachOpen ? 'text-white/85' : 'text-neutral-400'} />
              {t('coachStrip.coachToggle')}
              <span aria-hidden="true">{coachOpen ? '▴' : '▾'}</span>
            </button>
            <Link
              to="/train/plan"
              onClick={() => playSound('uiClick')}
              className="btn-press flex min-h-11 items-center gap-1.5 rounded-full bg-neutral-800 px-4 py-1.5 text-sm font-semibold text-neutral-300 hover:bg-neutral-700 hover:text-ink sm:min-h-9"
            >
              <IconSparkles size={16} className="text-neutral-400" />
              {t('coachStrip.planLink')}
            </Link>
          </div>
        </div>
        <div id="train-coach" hidden={!coachOpen} className="mt-4">
          {coachOpen && (
            <Suspense fallback={null}>
              <CoachPage goPlay={() => navigate('/play')} />
            </Suspense>
          )}
        </div>
      </section>

      {/* Trainer cards */}
      <ul className="grid list-none grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <li key={card.id}>
              <Link
                to={card.to}
                onClick={() => playSound('uiClick')}
                data-testid={`train-card-${card.id}`}
                className="btn-press group flex min-h-20 items-center gap-3.5 rounded-2xl bg-panel p-4 shadow-soft hover:bg-panelmute"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 text-white">
                  <Icon size={22} />
                </span>
                <span>
                  <span className="block font-display text-base font-bold text-ink">{t(`sections.${card.id}.label`)}</span>
                  <span className="block text-xs text-neutral-400">{t(`sections.${card.id}.hint`)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
