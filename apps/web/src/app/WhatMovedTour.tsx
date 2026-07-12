/**
 * One-time "what moved" note for users who knew the old 18-tab layout.
 * A dismissible card (not a blocking modal): tells them where the old tabs
 * went. Shown only when the browser already carries Chesser state (an
 * existing user); brand-new visitors never see it. Dismissal persists.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconClose } from '../components/icons';

const DISMISS_KEY = 'chesser-ia-tour';

/**
 * Evaluated at module load — before the stores' init effects can write —
 * so "already has chesser data" reliably means "used the app before this
 * deploy", not "this very session just wrote something".
 */
const isExistingUser = (() => {
  try {
    return Object.keys(localStorage).some((k) => k.startsWith('chesser') && k !== DISMISS_KEY);
  } catch {
    return false;
  }
})();

function shouldShow(): boolean {
  try {
    if (localStorage.getItem(DISMISS_KEY)) return false;
    if (!isExistingUser) {
      // New users start on the new IA — nothing moved for them.
      localStorage.setItem(DISMISS_KEY, 'new-user');
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function WhatMovedTour() {
  const { t } = useTranslation('nav');
  const [visible, setVisible] = useState(shouldShow);
  const dismissRef = useRef<HTMLButtonElement>(null);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, 'dismissed');
    } catch {
      /* still dismiss for this session */
    }
    setVisible(false);
  };

  // Light focus management: focus the dismiss button so keyboard/SR users
  // land on the note; Escape closes it. Not a focus trap — it's not modal.
  useEffect(() => {
    if (!visible) return;
    dismissRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="ia-tour-title"
      data-testid="ia-tour"
      className="fixed bottom-20 left-1/2 z-50 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 rounded-2xl border border-neutral-700/60 bg-panel p-4 shadow-soft lg:bottom-6 lg:left-auto lg:right-6 lg:translate-x-0"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="ia-tour-title" className="font-display text-base font-bold text-ink">
          {t('tour.title')}
        </h2>
        <button
          onClick={dismiss}
          aria-label={t('tour.close')}
          className="btn-press -mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-ink"
        >
          <IconClose size={16} />
        </button>
      </div>
      <p className="mt-1 text-sm text-neutral-300">{t('tour.intro')}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-300">
        <li>{t('tour.train')}</li>
        <li>{t('tour.learn')}</li>
        <li>{t('tour.profile')}</li>
        <li>{t('tour.play')}</li>
      </ul>
      <button
        ref={dismissRef}
        onClick={dismiss}
        className="btn-press mt-3 w-full rounded-full bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700"
      >
        {t('tour.dismiss')}
      </button>
    </div>
  );
}
