import { useState, type FormEvent } from 'react';
import { useAuth } from '../store/auth';
import type { SyncState } from '../lib/sync';

const SYNC_LABEL: Record<SyncState, { dot: string; text: string }> = {
  off: { dot: 'bg-neutral-500', text: 'not syncing' },
  syncing: { dot: 'bg-amber-400 animate-pulse', text: 'syncing…' },
  synced: { dot: 'bg-emerald-400', text: 'synced' },
  error: { dot: 'bg-rose-400', text: 'sync error' },
};

function AuthForm({ onClose }: { onClose: () => void }) {
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
      <div className="flex gap-1 rounded bg-panelmute p-1 text-sm">
        {(['login', 'register'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded px-2 py-1 capitalize ${mode === m ? 'bg-emerald-600 text-white' : 'text-neutral-300'}`}
          >
            {m === 'login' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>
      <p className="text-xs text-neutral-400">Sync your opening and tactics progress across devices.</p>
      <input
        className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-ink outline-none focus:ring-1 focus:ring-emerald-500"
        placeholder="username"
        autoComplete="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        type="password"
        className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-ink outline-none focus:ring-1 focus:ring-emerald-500"
        placeholder="password"
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="text-xs text-rose-300">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
    </form>
  );
}

function AccountInfo({ onClose }: { onClose: () => void }) {
  const { username, sync, logout } = useAuth();
  const s = SYNC_LABEL[sync];
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-500">Signed in as</div>
        <div className="text-lg font-semibold text-ink">{username}</div>
      </div>
      <div className="flex items-center gap-2 text-sm text-neutral-300">
        <span className={`h-2 w-2 rounded-full ${s.dot}`} />
        Progress {s.text}
      </div>
      <button
        onClick={async () => {
          await logout();
          onClose();
        }}
        className="w-full rounded bg-neutral-700 py-2 text-sm text-neutral-200 hover:bg-neutral-600"
      >
        Sign out
      </button>
    </div>
  );
}

export function AccountButton() {
  const { username, sync } = useAuth();
  const [open, setOpen] = useState(false);
  const dot = SYNC_LABEL[sync].dot;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
      >
        {username ? (
          <>
            <span className={`h-2 w-2 rounded-full ${dot}`} />
            {username}
          </>
        ) : (
          'Sign in'
        )}
      </button>
      {open && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-xs rounded-xl bg-panel p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {username ? <AccountInfo onClose={() => setOpen(false)} /> : <AuthForm onClose={() => setOpen(false)} />}
          </div>
        </div>
      )}
    </>
  );
}
