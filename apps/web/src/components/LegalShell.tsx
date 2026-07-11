import type { ReactNode } from 'react';

/**
 * Shared layout for the long-form policy pages (Privacy, Terms): a readable
 * measure, consistent heading rhythm, and theme-token colors so both pages
 * hold WCAG AA in light and dark. Content is plain JSX — no markdown pipeline.
 */

export function LegalShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <article className="mx-auto w-full max-w-[760px]">
      <div className="rounded-2xl bg-panel p-5 shadow-soft sm:p-8">
        <h2 className="font-display text-2xl font-bold text-ink">{title}</h2>
        <p className="mt-1 text-xs text-neutral-400">Last updated: {updated}</p>
        <div className="mt-4 space-y-6">{children}</div>
      </div>
      <p className="mt-4 text-center text-xs text-neutral-400">
        <LegalLink href="#/privacy">Privacy Policy</LegalLink> · <LegalLink href="#/terms">Terms of Service</LegalLink>
      </p>
    </article>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 font-display text-base font-semibold text-ink">{title}</h3>
      <div className="space-y-2 text-sm leading-relaxed text-neutral-300">{children}</div>
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="font-semibold text-brand-300 underline decoration-brand-300/50 underline-offset-2 hover:text-brand-200">
      {children}
    </a>
  );
}
