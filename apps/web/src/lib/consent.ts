/**
 * First-run storage notice — persistence helpers.
 *
 * Chesser is local-first: everything is kept in this browser's localStorage
 * unless the user signs in. The consent notice (components/ConsentNotice.tsx)
 * tells the user exactly that once, and its acknowledgement is itself stored
 * under `chesser-consent` so the notice never nags again on this device.
 *
 * Guarded for non-DOM/blocked-storage environments (private windows that
 * throw on access, the node test runner): if storage is unavailable the
 * notice simply shows again — annoying-but-safe beats crashing.
 */

const KEY = 'chesser-consent';

export function hasAcknowledgedStorageNotice(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return true; // storage unavailable → nothing is persisted → nothing to notify about
  }
}

export function acknowledgeStorageNotice(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ acknowledgedAt: new Date().toISOString() }));
  } catch {
    // Storage unavailable — the notice may show again; never crash over it.
  }
}
