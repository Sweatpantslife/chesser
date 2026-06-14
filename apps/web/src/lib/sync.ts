import { apiGetProgress, apiPutProgress } from './api';
import { useProgress } from '../store/progress';
import { useRepertoire } from '../store/repertoire';
import { useMistakes } from '../store/mistakes';
import { useCoordinate } from '../store/coordinate';
import { useCustomPuzzles } from '../store/customPuzzles';
import { usePuzzleRating } from '../store/puzzleRating';
import { useLadder } from '../store/ladder';

export type SyncState = 'off' | 'syncing' | 'synced' | 'error';

let pushTimer: ReturnType<typeof setTimeout> | null = null;
const unsubs: Array<() => void> = [];

/** The full synced snapshot: SRS progress + repertoires + puzzles + rating. */
function gather() {
  return {
    progress: useProgress.getState().exportState(),
    repertoires: useRepertoire.getState().exportRepertoires(),
    mistakes: useMistakes.getState().exportMistakes(),
    coordinate: useCoordinate.getState().exportState(),
    customPuzzles: useCustomPuzzles.getState().exportPuzzles(),
    puzzleRating: usePuzzleRating.getState().exportState(),
    ladder: useLadder.getState().exportState(),
  };
}

function apply(remote: unknown): void {
  if (!remote || typeof remote !== 'object') return;
  const r = remote as Record<string, unknown>;
  if (
    'progress' in r ||
    'repertoires' in r ||
    'mistakes' in r ||
    'coordinate' in r ||
    'customPuzzles' in r ||
    'puzzleRating' in r ||
    'ladder' in r
  ) {
    useProgress.getState().importMerge(r.progress);
    useRepertoire.getState().importMerge(r.repertoires);
    useMistakes.getState().importMerge(r.mistakes);
    useCoordinate.getState().importMerge(r.coordinate);
    useCustomPuzzles.getState().importMerge(r.customPuzzles);
    usePuzzleRating.getState().importMerge(r.puzzleRating);
    useLadder.getState().importMerge(r.ladder);
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
  unsubs.push(useMistakes.subscribe(schedule));
  unsubs.push(useCoordinate.subscribe(schedule));
  unsubs.push(useCustomPuzzles.subscribe(schedule));
  unsubs.push(usePuzzleRating.subscribe(schedule));
  unsubs.push(useLadder.subscribe(schedule));
}

export function stopSync(): void {
  while (unsubs.length) unsubs.pop()!();
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}
