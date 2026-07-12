/**
 * One-time "what moved" tour for users who knew the old flat tab layout.
 *
 * A friendly 4-step modal (built on the shared accessible Modal: role=dialog,
 * aria-modal, focus trapped, Escape closes) that maps every old top-level tab
 * to its new hub — including the surprising one, Archive → Profile. Shown
 * exactly once, to EXISTING users only:
 *
 *  - Gate evidence is persisted pre-IA local state ("chesser*" localStorage
 *    keys), evaluated at module load — before the stores' init effects can
 *    write — so it reliably means "used the app before this deploy".
 *  - The Phase-1 interim note used `chesser-ia-tour`; this finished tour uses
 *    a fresh `chesser-ia-tour-v2` flag so pre-IA users who dismissed the
 *    interim note still get the full tour once. The legacy key is still read:
 *    its 'new-user' marker proves a visitor never saw the old layout, and
 *    'dismissed' proves they did.
 *  - Every dismissal (Got it, skip, Escape, backdrop) persists — old URLs
 *    redirect forever, so skipping the tour loses nothing.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../components/Modal';
import { IconClose } from '../components/icons';

/** Phase-1 interim-note flag ('dismissed' = pre-IA user, 'new-user' = not). */
const LEGACY_DISMISS_KEY = 'chesser-ia-tour';
/** This tour's own flag ('dismissed' | 'new-user'). */
const DISMISS_KEY = 'chesser-ia-tour-v2';

/** Old location → new location, per step (line keys under nav:tour.steps). */
const STEPS = [
  { id: 'train', lines: ['a', 'b', 'c'] },
  { id: 'learn', lines: ['a', 'b'] },
  { id: 'profile', lines: ['a', 'b', 'c'] },
  { id: 'play', lines: ['a', 'b'] },
] as const;

/**
 * Decide (and latch) whether this browser should see the tour. Marks brand-new
 * visitors immediately so state written later this session can't reclassify
 * them. Exported for tests.
 */
export function computeTourGate(): boolean {
  try {
    if (localStorage.getItem(DISMISS_KEY)) return false;
    const legacy = localStorage.getItem(LEGACY_DISMISS_KEY);
    if (legacy === 'new-user') {
      // Started fresh on the Phase-1 IA — nothing ever moved for them.
      localStorage.setItem(DISMISS_KEY, 'new-user');
      return false;
    }
    if (legacy === 'dismissed') return true; // pre-IA user; saw only the interim note
    const hasPriorState = Object.keys(localStorage).some(
      (k) => k.startsWith('chesser') && k !== DISMISS_KEY && k !== LEGACY_DISMISS_KEY,
    );
    if (!hasPriorState) {
      localStorage.setItem(DISMISS_KEY, 'new-user');
      localStorage.setItem(LEGACY_DISMISS_KEY, 'new-user');
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Evaluated at module load — before any store init can write — so "already
 * has chesser data" can't mean "this very session just wrote something".
 */
let gateSnapshot = computeTourGate();

/** Test-only: re-evaluate the module-load gate after mutating localStorage. */
export function resetTourGateForTests(): void {
  gateSnapshot = computeTourGate();
}

function shouldShow(): boolean {
  try {
    return gateSnapshot && !localStorage.getItem(DISMISS_KEY);
  } catch {
    return false;
  }
}

export function WhatMovedTour() {
  const { t } = useTranslation('nav');
  const [visible, setVisible] = useState(shouldShow);
  const [step, setStep] = useState(0);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, 'dismissed');
    } catch {
      /* still dismiss for this session */
    }
    setVisible(false);
    // The tour opens itself (no trigger element), so send focus somewhere
    // sensible: the page content. After unmount, so the Modal's own
    // focus-restore can't race it.
    window.setTimeout(() => {
      const main = document.getElementById('main');
      if (main) {
        if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
        main.focus();
      }
    }, 0);
  };

  if (!visible) return null;

  const cur = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  return (
    <Modal onClose={dismiss} labelledBy="ia-tour-title" className="w-full max-w-md">
      <div data-testid="ia-tour" className="rounded-2xl bg-panel p-4 shadow-soft sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 id="ia-tour-title" className="font-display text-lg font-bold text-ink">
            {t('tour.title')}
          </h2>
          <button
            onClick={dismiss}
            aria-label={t('tour.skip')}
            className="btn-press -mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-ink"
          >
            <IconClose size={16} />
          </button>
        </div>
        <p className="mt-1 text-sm text-neutral-300">{t('tour.intro')}</p>

        <div className="mt-4 rounded-2xl bg-neutral-800/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            {t('tour.progress', { step: step + 1, total: STEPS.length })}
          </p>
          <h3 className="mt-1 font-display text-base font-bold text-ink">{t(`tour.steps.${cur.id}.label`)}</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-neutral-200">
            {cur.lines.map((line) => (
              <li key={line}>{t(`tour.steps.${cur.id}.lines.${line}`)}</li>
            ))}
          </ul>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="btn-press min-h-11 rounded-full bg-neutral-800 px-4 py-2 text-sm font-semibold text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
          >
            {t('tour.back')}
          </button>
          <span aria-hidden className="flex items-center gap-1.5">
            {STEPS.map((s, i) => (
              <span key={s.id} className={`h-1.5 w-1.5 rounded-full ${i === step ? 'bg-brand-400' : 'bg-neutral-700'}`} />
            ))}
          </span>
          <button
            onClick={() => (isLast ? dismiss() : setStep((s) => s + 1))}
            className="btn-press min-h-11 rounded-full bg-brand-600 px-5 py-2 text-sm font-bold text-white hover:bg-brand-700"
          >
            {isLast ? t('tour.done') : t('tour.next')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
