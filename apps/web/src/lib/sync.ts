import { apiGetProgress, apiPutProgress } from './api';
import { useProgress } from '../store/progress';
import { useRepertoire } from '../store/repertoire';
import { useMistakes } from '../store/mistakes';
import { useCoordinate } from '../store/coordinate';
import { useCustomPuzzles } from '../store/customPuzzles';
import { useRatings } from '../store/ratings';
import { useGamify } from '../store/gamify';
import { useStreak } from '../store/streak';
import { useQuests } from '../store/quests';
import { useAchievements } from '../store/achievements';
import { useLadder } from '../store/ladder';
import { useLessons } from '../store/lessons';

export type SyncState = 'off' | 'syncing' | 'synced' | 'error';

let pushTimer: ReturnType<typeof setTimeout> | null = null;
const unsubs: Array<() => void> = [];

/** The full synced snapshot: SRS progress + repertoires + puzzles + ratings + gamification. */
function gather() {
  return {
    progress: useProgress.getState().exportState(),
    repertoires: useRepertoire.getState().exportRepertoires(),
    repertoirePicks: useRepertoire.getState().exportPicks(),
    mistakes: useMistakes.getState().exportMistakes(),
    coordinate: useCoordinate.getState().exportState(),
    customPuzzles: useCustomPuzzles.getState().exportPuzzles(),
    ratings: useRatings.getState().exportState(),
    gamify: useGamify.getState().exportState(),
    streak: useStreak.getState().exportState(),
    quests: useQuests.getState().exportState(),
    achievements: useAchievements.getState().exportState(),
    ladder: useLadder.getState().exportState(),
    lessons: useLessons.getState().exportState(),
    // Back-compat: keep emitting the old single puzzle rating so an older client
    // syncing the same account still gets a usable value.
    puzzleRating: useRatings.getState().legacyPuzzleExport(),
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
    'ratings' in r ||
    'puzzleRating' in r ||
    'ladder' in r ||
    'lessons' in r
  ) {
    useProgress.getState().importMerge(r.progress);
    useRepertoire.getState().importMerge(r.repertoires);
    useRepertoire.getState().importPicks(r.repertoirePicks);
    useMistakes.getState().importMerge(r.mistakes);
    useCoordinate.getState().importMerge(r.coordinate);
    useCustomPuzzles.getState().importMerge(r.customPuzzles);
    useRatings.getState().importMerge(r.ratings);
    if (!('ratings' in r) && 'puzzleRating' in r) useRatings.getState().importLegacyPuzzle(r.puzzleRating);
    useGamify.getState().importMerge(r.gamify);
    useStreak.getState().importMerge(r.streak);
    useQuests.getState().importMerge(r.quests);
    useAchievements.getState().importMerge(r.achievements);
    useLadder.getState().importMerge(r.ladder);
    useLessons.getState().importMerge(r.lessons);
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
  unsubs.push(useRatings.subscribe(schedule));
  unsubs.push(useGamify.subscribe(schedule));
  unsubs.push(useStreak.subscribe(schedule));
  unsubs.push(useQuests.subscribe(schedule));
  unsubs.push(useAchievements.subscribe(schedule));
  unsubs.push(useLadder.subscribe(schedule));
  unsubs.push(useLessons.subscribe(schedule));
}

export function stopSync(): void {
  while (unsubs.length) unsubs.pop()!();
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}
