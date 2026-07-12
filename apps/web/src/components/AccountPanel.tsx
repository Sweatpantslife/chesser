import { useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useAuth } from '../store/auth';
import type { SyncState } from '../lib/sync';
import { apiExportAccount, downloadJson } from '../lib/trustApi';
import { Modal } from './Modal';
import { DeleteAccountDialog } from './DeleteAccountDialog';
import { IconDownload } from './icons';

// Status text lives in the `account` namespace under `sync.<state>`.
const SYNC_DOT: Record<SyncState, string> = {
  off: 'bg-neutral-500',
  syncing: 'bg-amber-400 animate-pulse',
  synced: 'bg-emerald-400',
  error: 'bg-rose-400',
};

function AuthForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('account');
  const { login, register, busy, error } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = mode === 'login' ? await login(username, password) : await register(username, password);
    if (ok) onClose();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {/* mr-9 keeps the switcher clear of the dialog's absolute 44px close target on phones */}
      <div className="mr-9 flex gap-1 rounded bg-panelmute p-1 text-sm sm:mr-0">
        {(['login', 'register'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`flex-1 rounded px-2 py-1 capitalize ${mode === m ? 'bg-brand-600 text-white' : 'text-neutral-300'}`}
          >
            {m === 'login' ? t('signIn') : t('createAccount')}
          </button>
        ))}
      </div>
      <p className="text-xs text-neutral-400">{t('syncHint')}</p>
      <div>
        <label htmlFor="auth-username" className="sr-only">
          {t('username')}
        </label>
        <input
          id="auth-username"
          className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-ink outline-none focus:ring-1 focus:ring-emerald-500"
          placeholder={t('usernamePlaceholder')}
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="auth-password" className="sr-only">
          {t('password')}
        </label>
        <input
          id="auth-password"
          type="password"
          className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-ink outline-none focus:ring-1 focus:ring-emerald-500"
          placeholder={t('passwordPlaceholder')}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-xs text-rose-300">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded bg-emerald-700 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {busy
          ? mode === 'login'
            ? t('signingIn')
            : t('creatingAccount')
          : mode === 'login'
            ? t('signIn')
            : t('createAccount')}
      </button>
    </form>
  );
}

/** Export/delete — the privacy-policy promises, wired to trust/routes.ts. */
function DataControls({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('account');
  const { token, username } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const exportData = async () => {
    if (!token || exporting) return;
    setExporting(true);
    setExportMsg(null);
    try {
      const data = await apiExportAccount(token);
      downloadJson(data, `chesser-export-${username ?? 'account'}.json`);
      setExportMsg(t('data.exportDone'));
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : t('data.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="border-t border-neutral-800/70 pt-3">
      <div className="mb-1.5 text-xs uppercase tracking-wide text-neutral-400">{t('data.title')}</div>
      <button
        onClick={() => void exportData()}
        disabled={exporting}
        className="flex w-full items-center justify-center gap-1.5 rounded bg-neutral-700 py-2 text-sm text-neutral-200 hover:bg-neutral-600 disabled:opacity-50"
      >
        <IconDownload size={14} />
        {exporting ? t('data.exporting') : t('data.export')}
      </button>
      {exportMsg && (
        <p role="status" className="mt-1.5 text-xs text-neutral-400">
          {exportMsg}
        </p>
      )}
      <button
        onClick={() => setConfirmOpen(true)}
        className="mt-2 w-full rounded bg-rose-900/40 py-2 text-sm font-semibold text-rose-300 hover:bg-rose-900/60"
      >
        {t('data.delete')}
      </button>
      <p className="mt-1.5 text-xs text-neutral-400">
        {/* onClick closes the dialog so the policy page isn't hidden behind it */}
        <Trans
          t={t}
          i18nKey="data.note"
          components={{
            policyLink: (
              <a
                href="#/profile/about/privacy"
                onClick={onClose}
                className="text-brand-300 underline decoration-brand-300/50 underline-offset-2 hover:text-brand-200"
              />
            ),
          }}
        />
      </p>
      {confirmOpen && <DeleteAccountDialog onClose={() => setConfirmOpen(false)} />}
    </div>
  );
}

function AccountInfo({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('account');
  const { username, sync, logout } = useAuth();
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-400">{t('signedInAs')}</div>
        <div className="text-lg font-semibold text-ink">{username}</div>
      </div>
      <div className="flex items-center gap-2 text-sm text-neutral-300">
        <span className={`h-2 w-2 rounded-full ${SYNC_DOT[sync]}`} />
        {t('sync.progress', { state: t(`sync.${sync}`) })}
      </div>
      <button
        onClick={async () => {
          await logout();
          onClose();
        }}
        className="w-full rounded bg-neutral-700 py-2 text-sm text-neutral-200 hover:bg-neutral-600"
      >
        {t('signOut')}
      </button>
      <DataControls onClose={onClose} />
    </div>
  );
}

export function AccountButton() {
  const { t } = useTranslation('account');
  const { username, sync } = useAuth();
  const [open, setOpen] = useState(false);
  const dot = SYNC_DOT[sync];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={username ?? undefined}
        className="flex min-h-11 min-w-0 items-center gap-1.5 rounded bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-700 sm:min-h-0"
      >
        {username ? (
          <>
            <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
            {/* min-w-0 + truncate: long usernames ellipsize instead of pushing
                the header past narrow viewports (the full name is in the panel
                and in the button's tooltip). */}
            <span className="min-w-0 max-w-40 truncate">{username}</span>
          </>
        ) : (
          t('signIn')
        )}
      </button>
      {open && (
        <Modal
          onClose={() => setOpen(false)}
          label={username ? t('accountLabel') : t('signIn')}
          className="relative w-full max-w-xs rounded-xl bg-panel p-4 shadow-2xl"
        >
          {username ? <AccountInfo onClose={() => setOpen(false)} /> : <AuthForm onClose={() => setOpen(false)} />}
          <button
            onClick={() => setOpen(false)}
            aria-label={t('close')}
            className="absolute right-1.5 top-1.5 min-h-11 min-w-11 rounded px-1.5 py-1 text-sm text-neutral-400 hover:text-neutral-200 sm:min-h-0 sm:min-w-0"
          >
            ×
          </button>
        </Modal>
      )}
    </>
  );
}
