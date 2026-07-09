import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  children: ReactNode;
  /** Called on Escape and (when closeOnBackdrop, the default) backdrop click. Omit to disable both. */
  onClose?: () => void;
  /** id of the visible title element (preferred over `label`). */
  labelledBy?: string;
  /** Accessible name for dialogs without a visible title element. */
  label?: string;
  role?: 'dialog' | 'alertdialog';
  /** Set false for dialogs that must not close on a stray backdrop click. */
  closeOnBackdrop?: boolean;
  /** Backdrop classes — defaults to the app's standard fixed overlay. */
  overlayClassName?: string;
  /** Panel classes — passed through unchanged so each dialog keeps its look. */
  className?: string;
}

/**
 * Shared accessible modal: role=dialog + aria-modal, focus moves in on open,
 * Tab/Shift+Tab are trapped, Escape closes, and focus returns to the trigger
 * element on close. Purely presentational classes are supplied by callers.
 */
export function Modal({
  children,
  onClose,
  labelledBy,
  label,
  role = 'dialog',
  closeOnBackdrop = true,
  overlayClassName = 'fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4',
  className = '',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // On open: remember the trigger, move focus inside. On close: restore it.
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    return () => {
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      if (onClose) {
        e.stopPropagation();
        onClose();
      }
      return;
    }
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={overlayClassName} onClick={closeOnBackdrop && onClose ? onClose : undefined} onKeyDown={onKeyDown}>
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={label}
        tabIndex={-1}
        className={className}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
