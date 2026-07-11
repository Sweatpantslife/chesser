import { createElement, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings, PIECE_SETS, type BoardTheme, type PieceSet, type ThemePref } from '../store/settings';
import { SUPPORTED_LANGUAGES, languageDisplayName, setLanguage } from '../i18n';
import { loadAllPieceSets } from '../styles/pieceSets';
import { playSound } from '../lib/sound';
import { Modal } from './Modal';
import { ByokSettings } from './ByokSettings';

const THEMES: { id: BoardTheme; swatch: string }[] = [
  { id: 'brown', swatch: '#b58863' },
  { id: 'blue', swatch: '#8ca2ad' },
  { id: 'green', swatch: '#86a666' },
  { id: 'gray', swatch: '#9b9b9b' },
  { id: 'candy', swatch: '#bda2e8' },
  { id: 'mint', swatch: '#82c9a0' },
];

function Toggle({ on, onChange, label }: { on: boolean; onChange: (b: boolean) => void; label: string }) {
  // Track colour is a non-text state indicator: brand-500 keeps ≥3:1 against
  // the panel bg, so it can carry the on-state alone.
  return (
    <label className="flex cursor-pointer items-center justify-between py-1.5 text-sm text-neutral-200">
      {label}
      <button
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => {
          playSound('uiClick');
          onChange(!on);
        }}
        className={`relative h-5 w-9 rounded-full transition-colors ${on ? 'bg-brand-500' : 'bg-neutral-500'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-4' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

/** A king swatch rendered with the given piece set's CSS. The generated set
 *  CSS targets the chessground `piece` *element* (`.pieces-<id> piece.king.white`),
 *  so the swatch must be a real <piece> element — a class on a span never matches. */
function PieceSwatch({ set }: { set: PieceSet }) {
  return (
    <span className={`pieces-${set} block h-7 w-7`} aria-hidden="true">
      {createElement('piece', { className: 'king white piece-preview block h-full w-full' })}
    </span>
  );
}

// Labels live in the `settings` namespace under `appearance.<id>`.
const APP_THEMES: ThemePref[] = ['light', 'dark', 'system'];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation('settings');
  const { sound, premove, arrows, aiCoach, boardTheme, pieceSet, ratingMeter, theme, setSound, setPremove, setArrows, setAiCoach, setBoardTheme, setPieceSet, setRatingMeter, setTheme } =
    useSettings();
  // The user's ACTIVE choice, not resolvedLanguage — the latter reports the
  // English fallback until the chosen locale's lazy chunks finish loading,
  // which would briefly highlight the wrong language button.
  const activeLanguage = i18n.language || i18n.resolvedLanguage;

  // Load every set's CSS so the previews below render.
  useEffect(() => loadAllPieceSets(), []);

  return (
    <Modal
      onClose={onClose}
      labelledBy="settings-title"
      className="scroll-thin pop-in max-h-[85vh] w-full max-w-xs overflow-y-auto rounded-2xl bg-panel p-4 shadow-soft"
    >
        <h3 id="settings-title" className="mb-2 font-display text-sm font-semibold text-ink">{t('title')}</h3>

        <div className="mb-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{t('appearance.label')}</div>
          <div className="flex gap-1" role="group" aria-label={t('appearance.themeGroupAria')}>
            {APP_THEMES.map((pref) => (
              <button
                key={pref}
                onClick={() => {
                  playSound('uiClick');
                  setTheme(pref);
                }}
                aria-pressed={theme === pref}
                className={`btn-press flex-1 rounded-full px-2 py-1 text-xs font-semibold ${
                  theme === pref ? 'bg-brand-600 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                }`}
              >
                {t(`appearance.${pref}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{t('language.label')}</div>
          <div className="flex flex-wrap gap-1" role="group" aria-label={t('language.label')}>
            {SUPPORTED_LANGUAGES.map((code) => (
              <button
                key={code}
                // Each name is written in its own language ("English", "Español").
                lang={code}
                onClick={() => {
                  playSound('uiClick');
                  void setLanguage(code);
                }}
                aria-pressed={activeLanguage === code}
                className={`btn-press flex-1 rounded-full px-2 py-1 text-xs font-semibold ${
                  activeLanguage === code
                    ? 'bg-brand-600 text-white'
                    : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                }`}
              >
                {languageDisplayName(code)}
              </button>
            ))}
          </div>
        </div>

        <Toggle on={sound} onChange={setSound} label={t('toggles.sounds')} />
        <Toggle on={premove} onChange={setPremove} label={t('toggles.premoves')} />
        <Toggle on={arrows} onChange={setArrows} label={t('toggles.arrows')} />
        <Toggle on={aiCoach} onChange={setAiCoach} label={t('toggles.aiCoach')} />
        <p className="-mt-1 mb-1 text-xs text-neutral-400">{t('aiCoachNote')}</p>

        <ByokSettings />

        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{t('rating.label')}</div>
          <div className="flex gap-1">
            {([
              // Elo and Glicko-2 are proper names — not translated.
              { id: 'elo', label: 'Elo' },
              { id: 'glicko', label: 'Glicko-2' },
            ] as const).map((m) => (
              <button
                key={m.id}
                onClick={() => setRatingMeter(m.id)}
                aria-pressed={ratingMeter === m.id}
                className={`btn-press flex-1 rounded-full px-2 py-1 text-xs font-semibold ${
                  ratingMeter === m.id ? 'bg-brand-600 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-neutral-400">{t('rating.note')}</p>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{t('boardTheme.label')}</div>
          <div className="flex flex-wrap gap-2">
            {THEMES.map((bt) => (
              <button
                key={bt.id}
                onClick={() => {
                  playSound('uiClick');
                  setBoardTheme(bt.id);
                }}
                aria-label={t('boardTheme.aria', { name: t(`boardTheme.names.${bt.id}`) })}
                aria-pressed={boardTheme === bt.id}
                className={`btn-press h-8 w-8 rounded-lg ring-2 ${boardTheme === bt.id ? 'ring-brand-400' : 'ring-transparent'}`}
                style={{ background: bt.swatch }}
                title={t(`boardTheme.names.${bt.id}`)}
              />
            ))}
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{t('pieces.label')}</div>
          <div className="grid grid-cols-3 gap-2">
            {PIECE_SETS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  playSound('uiClick');
                  setPieceSet(p.id);
                }}
                title={p.label}
                aria-pressed={pieceSet === p.id}
                className={`btn-press flex flex-col items-center gap-1 rounded-xl p-1.5 ring-2 ${
                  pieceSet === p.id ? 'bg-neutral-700 ring-brand-400' : 'ring-transparent hover:bg-neutral-800'
                }`}
              >
                <PieceSwatch set={p.id} />
                <span className="max-w-full truncate text-xs text-neutral-300">{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Legal pages are hash-routed; onClose keeps the dialog from
            covering the page it just navigated to. */}
        <p className="mt-3 text-center text-xs text-neutral-400">
          <a
            href="#/privacy"
            onClick={onClose}
            className="underline decoration-neutral-600 underline-offset-2 hover:text-neutral-200"
          >
            {t('links.privacy')}
          </a>
          <span aria-hidden="true"> · </span>
          <a
            href="#/terms"
            onClick={onClose}
            className="underline decoration-neutral-600 underline-offset-2 hover:text-neutral-200"
          >
            {t('links.terms')}
          </a>
        </p>

        <button
          onClick={onClose}
          className="btn-press mt-3 w-full rounded-full bg-neutral-700 py-1.5 text-sm font-semibold text-neutral-200 hover:bg-neutral-600"
        >
          {t('done')}
        </button>
    </Modal>
  );
}
