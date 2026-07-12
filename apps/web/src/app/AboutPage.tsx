/**
 * Profile → About (`#/profile/about`): the odds-and-ends drawer of the IA —
 * settings entry (the dialog itself stays a global overlay), install (PWA),
 * engine/connection status (mirrored from the desktop sidebar footer for
 * mobile users), the legal pages, and credits.
 */
import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { EngineBadges, StatusDot } from './PrimaryNav';
import { InstallButton } from '../components/InstallButton';
import { SlikkCredit } from '../components/SlikkCredit';
import { IconGear } from '../components/icons';
import { playSound } from '../lib/sound';

const SettingsDialog = lazy(() => import('../components/SettingsDialog').then((m) => ({ default: m.SettingsDialog })));

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-panel p-4 shadow-soft">
      <div>
        <h3 className="font-semibold text-ink">{title}</h3>
        {hint && <p className="text-xs text-neutral-400">{hint}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2.5">{children}</div>
    </div>
  );
}

export function AboutPage() {
  const { t } = useTranslation('nav');
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <div className="mx-auto w-full max-w-[760px] space-y-3">
      <h1 className="font-display text-xl font-bold text-ink">{t('sections.about.label')}</h1>
      <Row title={t('settings')} hint={t('about.settingsHint')}>
        <button
          onClick={() => {
            playSound('uiClick');
            setSettingsOpen(true);
          }}
          className="btn-press flex min-h-11 items-center gap-1.5 rounded-full bg-neutral-800 px-4 py-1.5 text-sm font-semibold text-neutral-300 hover:bg-neutral-700 hover:text-ink sm:min-h-9"
        >
          <IconGear size={16} className="text-neutral-400" />
          {t('about.openSettings')}
        </button>
      </Row>
      <Row title={t('about.install')} hint={t('about.installHint')}>
        <InstallButton />
      </Row>
      <Row title={t('about.engines')} hint={t('about.enginesHint')}>
        <EngineBadges />
        <StatusDot />
      </Row>
      <Row title={t('about.legal')}>
        <Link
          to="/profile/about/privacy"
          className="text-sm font-semibold text-brand-300 underline decoration-brand-300/50 underline-offset-2 hover:text-brand-200"
        >
          {t('footer.privacy')}
        </Link>
        <Link
          to="/profile/about/terms"
          className="text-sm font-semibold text-brand-300 underline decoration-brand-300/50 underline-offset-2 hover:text-brand-200"
        >
          {t('footer.terms')}
        </Link>
      </Row>
      <Row title={t('about.credits')}>
        <SlikkCredit />
      </Row>
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
