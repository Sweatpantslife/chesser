import { useState, type FormEvent } from 'react';
import { useAuth } from '../store/auth';
import { apiDeleteAccount, clearLocalData } from '../lib/trustApi';
import { Modal } from './Modal';

/**
 * The right-to-erasure flow: an explicit, typed confirmation ("DELETE")
 * before anything happens, then server-side erasure (trust/routes.ts),
 * then a local wipe of every chesser-* localStorage key and a reload into a
 * clean, signed-out app. alertdialog + no backdrop-close: a stray click must
 * not dismiss a destructive confirmation mid-thought.
 */
export function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const token = useAuth((s) => s.token);
  const username = useAuth((s) => s.username);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const armed = confirm === 'DELETE';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!armed || !token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiDeleteAccount(token);
      // Server side is gone; now stop syncing, drop the session state and
      // wipe every local trace, then reload into a fresh signed-out app.
      await useAuth.getState().logout();
      clearLocalData();
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the account — try again.');
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      labelledBy="delete-account-title"
      role="alertdialog"
      closeOnBackdrop={false}
      className="w-full max-w-sm rounded-2xl bg-panel p-4 shadow-soft"
    >
      <h3 id="delete-account-title" className="font-display text-base font-semibold text-rose-300">
        Delete this account?
      </h3>
      <p className="mt-2 text-sm text-neutral-300">
        This permanently erases <strong className="text-ink">{username}</strong> from Chesser&apos;s servers: your
        sign-in, synced progress, saved games, sharing settings, leaderboard entries and friends. Your data in this
        browser is cleared too. <strong>There is no undo.</strong>
      </p>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <div>
          <label htmlFor="delete-confirm" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Type DELETE to confirm
          </label>
          <input
            id="delete-confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-ink outline-none focus:ring-1 focus:ring-rose-400"
          />
        </div>
        {error && (
          <p role="alert" className="text-xs text-rose-300">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-press flex-1 rounded-full bg-neutral-700 py-2 text-sm font-semibold text-neutral-200 hover:bg-neutral-600 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!armed || busy}
            className="btn-press flex-1 rounded-full bg-rose-600 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {busy ? 'Deleting…' : 'Delete forever'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
