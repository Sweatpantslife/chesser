import { useState } from 'react';
import { acknowledgeStorageNotice, hasAcknowledgedStorageNotice } from '../lib/consent';

/**
 * First-run storage notice: one quiet, dismissible banner telling the user
 * Chesser keeps their progress in this browser (localStorage) and linking the
 * privacy policy. Shown once per device — the acknowledgement is persisted by
 * lib/consent.ts. Deliberately NOT a modal: it never blocks play, it is not a
 * cookie wall, and there is nothing to opt out of (no tracking exists).
 */
export function ConsentNotice() {
  const [visible, setVisible] = useState(() => !hasAcknowledgedStorageNotice());
  if (!visible) return null;

  const dismiss = () => {
    acknowledgeStorageNotice();
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label="Data storage notice"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-700/60 bg-panel/95 p-3 shadow-soft backdrop-blur"
    >
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:flex-nowrap sm:justify-between">
        <p className="text-xs leading-relaxed text-neutral-300 sm:text-sm">
          Chesser saves your progress and settings in this browser — nothing leaves your device unless you create an
          account to sync. No ads, no tracking.{' '}
          <a
            href="#/privacy"
            className="font-semibold text-brand-300 underline decoration-brand-300/50 underline-offset-2 hover:text-brand-200"
          >
            Privacy Policy
          </a>
        </p>
        <button
          onClick={dismiss}
          className="btn-press shrink-0 rounded-full bg-brand-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-brand-700"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
