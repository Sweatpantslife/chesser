import { useState, type FormEvent } from 'react';
import { useAuth } from '../store/auth';
import { apiReportProfile, REPORT_REASONS } from '../lib/trustApi';
import { Modal } from './Modal';

/**
 * The abuse-report affordance on public profiles: a quiet button that opens a
 * small dialog — pick a reason, add an optional note, submit. Reports are
 * recorded server-side for review (apps/server/src/trust/routes.ts). Filing
 * requires an account (spam control), so signed-out visitors see a sign-in
 * hint instead of a form.
 */
export function ReportProfileButton({ username }: { username: string }) {
  const token = useAuth((s) => s.token);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REPORT_REASONS[0]!.id);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  /** Fresh form on every open — a past submission mustn't stick around. */
  const openDialog = () => {
    setDone(false);
    setError(null);
    setDetails('');
    setReason(REPORT_REASONS[0]!.id);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiReportProfile(token, username, reason, details.trim() || undefined);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the report — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={openDialog}
        className="btn-press rounded-full px-3 py-1 text-xs font-semibold text-neutral-400 underline decoration-neutral-600 underline-offset-2 hover:text-neutral-200"
      >
        Report this profile
      </button>
      {open && (
        <Modal onClose={close} labelledBy="report-profile-title" className="w-full max-w-sm rounded-2xl bg-panel p-4 shadow-soft">
          <h3 id="report-profile-title" className="font-display text-base font-semibold text-ink">
            Report {username}
          </h3>
          {done ? (
            <div className="mt-2 space-y-3">
              <p role="status" className="text-sm text-neutral-300">
                Thanks — your report was recorded and will be reviewed.
              </p>
              <button
                onClick={close}
                className="btn-press w-full rounded-full bg-neutral-700 py-2 text-sm font-semibold text-neutral-200 hover:bg-neutral-600"
              >
                Close
              </button>
            </div>
          ) : !token ? (
            <div className="mt-2 space-y-3">
              <p className="text-sm text-neutral-300">Sign in (top right) to report a profile — reports need an account.</p>
              <button
                onClick={close}
                className="btn-press w-full rounded-full bg-neutral-700 py-2 text-sm font-semibold text-neutral-200 hover:bg-neutral-600"
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-2 space-y-3">
              <fieldset>
                <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  What&apos;s wrong?
                </legend>
                <div className="space-y-1">
                  {REPORT_REASONS.map((r) => (
                    <label key={r.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-neutral-200 hover:bg-neutral-800">
                      <input
                        type="radio"
                        name="report-reason"
                        value={r.id}
                        checked={reason === r.id}
                        onChange={() => setReason(r.id)}
                        className="accent-brand-500"
                      />
                      {r.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div>
                <label htmlFor="report-details" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  Details (optional)
                </label>
                <textarea
                  id="report-details"
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  maxLength={500}
                  rows={3}
                  className="w-full resize-none rounded bg-neutral-800 px-2 py-1.5 text-sm text-ink outline-none focus:ring-1 focus:ring-brand-400"
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
                  onClick={close}
                  disabled={busy}
                  className="btn-press flex-1 rounded-full bg-neutral-700 py-2 text-sm font-semibold text-neutral-200 hover:bg-neutral-600 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="btn-press flex-1 rounded-full bg-brand-600 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {busy ? 'Sending…' : 'Send report'}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
