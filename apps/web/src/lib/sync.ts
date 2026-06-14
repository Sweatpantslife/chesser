import { apiGetProgress, apiPutProgress } from './api';
import { useProgress } from '../store/progress';
import { useRepertoire } from '../store/repertoire';

export type SyncState = 'off' | 'syncing' | 'synced' | 'error';

let pushTimer: ReturnType<typeof setTimeout> | null = null;
const unsubs: Array<() => void> = [];

/** The full synced snapshot: SRS progress + custom repertoires. */
function gather() {
  return {
    progress: useProgress.getState().exportState(),
    repertoires: useRepertoire.getState().exportRepertoires(),
  };
}

function apply(remote: unknown): void {
  if (!remote || typeof remote !== 'object') return;
  const r = remote as Record<string, unknown>;
  if ('progress' in r || 'repertoires' in r) {
    useProgress.getState().importMerge(r.progress);
    useRepertoire.getState().importMerge(r.repertoires);
  } else {
    useProgress.getState().importMerge(r); // legacy: bare progress blob
  }
}

/** Pull the server's data, merge it locally, then push the union back. */
export async function pullAndMerge(token: string): Promise<void> {
  const { data } = await apiGetProgress(token);
  apply(data);
  await apiPutProgress(token, gather());
}

/** Push local state to the server (debounced) whenever progress or reps change. */
export function startSync(token: string, onState: (s: SyncState) => void): void {
  stopSync();
  const schedule = () => {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      onState('syncing');
      try {
        await apiPutProgress(token, gather());
        onState('synced');
      } catch {
        onState('error');
      }
    }, 1500);
  };
  unsubs.push(useProgress.subscribe(schedule));
  unsubs.push(useRepertoire.subscribe(schedule));
}

export function stopSync(): void {
  while (unsubs.length) unsubs.pop()!();
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}
