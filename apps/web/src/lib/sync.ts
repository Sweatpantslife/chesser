import { apiGetProgress, apiPutProgress } from './api';
import { useProgress } from '../store/progress';

export type SyncState = 'off' | 'syncing' | 'synced' | 'error';

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let unsub: (() => void) | null = null;

/** Pull the server's progress, merge it locally, then push the union back. */
export async function pullAndMerge(token: string): Promise<void> {
  const { data } = await apiGetProgress(token);
  useProgress.getState().importMerge(data);
  await apiPutProgress(token, useProgress.getState().exportState());
}

/** Push local progress to the server (debounced) whenever it changes. */
export function startSync(token: string, onState: (s: SyncState) => void): void {
  stopSync();
  unsub = useProgress.subscribe(() => {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      onState('syncing');
      try {
        await apiPutProgress(token, useProgress.getState().exportState());
        onState('synced');
      } catch {
        onState('error');
      }
    }, 1500);
  });
}

export function stopSync(): void {
  if (unsub) {
    unsub();
    unsub = null;
  }
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}
