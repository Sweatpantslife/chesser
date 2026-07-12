/**
 * Accessible disclosure section (shared standard for collapsible surfaces:
 * Play-hub analysis sections, Home week recap, Profile stat tiles, …).
 *
 * Contract (per the IA brief):
 *   - trigger is a real <button> with aria-expanded / aria-controls
 *   - Enter/Space toggle (native button behaviour)
 *   - Escape anywhere inside the open region closes it and returns focus
 *     to the trigger
 *   - trigger target is ≥44px tall
 *
 * Content is only mounted while open, so heavy panels (network-backed
 * drawers, charts) stay cheap until the user asks for them. Panels that
 * gate their own work (e.g. via an `active` fetch-gate prop) can instead
 * pass children as a function — `(open) => …` stays mounted across
 * open/close and receives the open state.
 */
import { useId, useRef, useState, type ReactNode } from 'react';

export function Disclosure({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** Optional one-line description under the title (always visible). */
  hint?: string;
  defaultOpen?: boolean;
  children: ReactNode | ((open: boolean) => ReactNode);
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <section
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return;
        // A child that already consumed this Escape (dropdown, combobox,
        // dialog…) wins — don't also collapse the disclosure.
        if (e.defaultPrevented) return;
        e.preventDefault();
        e.stopPropagation(); // this surface consumes the Escape
        setOpen(false);
        trigger.current?.focus();
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="btn-press flex min-h-11 w-full items-center justify-between gap-2 rounded-2xl bg-panel px-4 py-2.5 text-left shadow-soft hover:bg-neutral-800"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">{title}</span>
          {hint && <span className="block truncate text-xs text-neutral-400">{hint}</span>}
        </span>
        <span aria-hidden className={`shrink-0 text-neutral-400 transition-transform ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>
      <div id={panelId} hidden={!open} className="mt-2 space-y-3">
        {typeof children === 'function' ? children(open) : open && children}
      </div>
    </section>
  );
}
