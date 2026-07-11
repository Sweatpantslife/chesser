/**
 * Client for the trust & privacy endpoints (apps/server/src/trust/routes.ts):
 * data export, account deletion and abuse reports. Kept separate from
 * lib/api.ts so the trust layer stays self-contained, mirroring socialApi.ts.
 */

async function jsonOrThrow(res: Response): Promise<any> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Everything the server stores for the signed-in account, as one document. */
export function apiExportAccount(token: string): Promise<Record<string, unknown>> {
  return fetch('/api/account/export', { headers: authHeaders(token) }).then(jsonOrThrow);
}

/** Trigger a browser download of the export as a pretty-printed JSON file. */
export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Right to erasure — requires the literal confirmation the dialog collects. */
export function apiDeleteAccount(token: string): Promise<{ ok: boolean }> {
  return fetch('/api/account', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ confirm: 'DELETE' }),
  }).then(jsonOrThrow);
}

/**
 * After the server erased the account: clear every bit of local Chesser state
 * (all `chesser-*` localStorage keys — progress, settings, auth token, BYOK
 * key, consent) so the device is as clean as the server.
 */
export function clearLocalData(): void {
  const doomed: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('chesser-')) doomed.push(key);
  }
  for (const key of doomed) localStorage.removeItem(key);
}

// --- abuse reports ------------------------------------------------------------

export const REPORT_REASONS: { id: string; label: string }[] = [
  { id: 'inappropriate-name', label: 'Inappropriate name' },
  { id: 'impersonation', label: 'Impersonation' },
  { id: 'harassment', label: 'Harassment' },
  { id: 'cheating', label: 'Cheating' },
  { id: 'other', label: 'Something else' },
];

export function apiReportProfile(
  token: string,
  username: string,
  reason: string,
  details?: string,
): Promise<{ ok: boolean; duplicate?: boolean }> {
  return fetch('/api/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ username, reason, ...(details ? { details } : {}) }),
  }).then(jsonOrThrow);
}
