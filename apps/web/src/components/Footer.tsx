import { useTranslation } from 'react-i18next';

/**
 * App footer: quiet, single-line, and deliberately minimal so it composes
 * cleanly with whatever the header/nav does. The legal pages are hash-routed
 * (#/privacy, #/terms) — plain anchors keep them keyboard- and
 * middle-click-friendly, and App's hashchange listener does the navigation.
 */
export function Footer() {
  const { t } = useTranslation('nav');
  return (
    <footer className="border-t border-neutral-800/60 px-4 py-3">
      {/* neutral-400, not 500: this is small text, and 400 is the AA-checked
          muted-body step in both themes (see tailwind.config.js). */}
      <p className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-xs text-neutral-400">
        <span>{t('footer.tagline')}</span>
        <span aria-hidden="true">·</span>
        <a href="#/privacy" className="underline decoration-neutral-600 underline-offset-2 hover:text-neutral-300">
          {t('footer.privacy')}
        </a>
        <span aria-hidden="true">·</span>
        <a href="#/terms" className="underline decoration-neutral-600 underline-offset-2 hover:text-neutral-300">
          {t('footer.terms')}
        </a>
      </p>
    </footer>
  );
}
