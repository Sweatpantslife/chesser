import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { now, todayStr } from '../lib/clock';
import { questsForDay, questValueAfter, type Activity, type QuestDef } from '../lib/quests';

/**
 * Daily-quest state: today's slate progress (rebuilt each day) plus lifetime
 * counters that feed the quest achievements. The slate itself is never stored —
 * it's a pure function of the day key (lib/quests.ts questsForDay), so only
 * progress numbers need persistence/sync.
 *
 * All mutation flows through `applyActivity`, which lib/gamify.ts calls from
 * the record* wrappers; components only read (and call `rollover` on mount so
 * a session that spans midnight refreshes its slate).
 */

export interface QuestsData {
  /** Day the current progress/done maps belong to ('' before first use). */
  day: string;
  /** questId → progress value (today's slate only). */
  progress: Record<string, number>;
  /** questId → epoch ms completed (today's slate only). */
  done: Record<string, number>;
  /** Today's all-quests-done bonus already paid. */
  bonusPaid: boolean;
  /** Lifetime quests completed (achievements). */
  totalCompleted: number;
  /** Lifetime days where the whole slate was finished (achievements). */
  daysAllDone: number;
}

export interface ApplyActivityResult {
  /** Quests this activity just completed (in slate order). */
  completed: QuestDef[];
  /** True when this call finished the last open quest of the day (bonus due). */
  allDone: boolean;
}

interface QuestsState extends QuestsData {
  /** Reset the daily maps when the clock has rolled to a new day. */
  rollover(): void;
  /** Today's slate (pure, from the day key). */
  todaysQuests(): QuestDef[];
  /** Advance today's quests with one activity. */
  applyActivity(a: Activity): ApplyActivityResult;

  exportState(): QuestsData;
  importMerge(remote: unknown): void;
  reset(): void;
}

const initialData = (): QuestsData => ({
  day: '',
  progress: {},
  done: {},
  bonusPaid: false,
  totalCompleted: 0,
  daysAllDone: 0,
});

const pick = (s: QuestsData): QuestsData => ({
  day: s.day,
  progress: s.progress,
  done: s.done,
  bonusPaid: s.bonusPaid,
  totalCompleted: s.totalCompleted,
  daysAllDone: s.daysAllDone,
});

export const useQuests = create<QuestsState>()(
  persist(
    (set, get) => ({
      ...initialData(),

      rollover() {
        const d = todayStr();
        if (get().day === d) return;
        set({ day: d, progress: {}, done: {}, bonusPaid: false });
      },

      todaysQuests() {
        return questsForDay(get().day || todayStr());
      },

      applyActivity(a) {
        get().rollover();
        const s = get();
        const slate = questsForDay(s.day);
        const progress = { ...s.progress };
        const done = { ...s.done };
        const completed: QuestDef[] = [];
        let totalCompleted = s.totalCompleted;
        for (const q of slate) {
          if (q.id in done) continue;
          const prev = progress[q.id] ?? 0;
          const next = questValueAfter(q, prev, a);
          if (next === prev) continue;
          progress[q.id] = next;
          if (next >= q.target) {
            done[q.id] = now();
            completed.push(q);
            totalCompleted += 1;
          }
        }
        let { bonusPaid, daysAllDone } = s;
        let allDone = false;
        if (!bonusPaid && slate.every((q) => q.id in done)) {
          bonusPaid = true;
          daysAllDone += 1;
          allDone = true;
        }
        set({ progress, done, bonusPaid, totalCompleted, daysAllDone });
        return { completed, allDone };
      },

      exportState() {
        return pick(get());
      },

      importMerge(remote) {
        if (!remote || typeof remote !== 'object') return;
        const r = remote as Partial<QuestsData>;
        const local = pick(get());
        const next: QuestsData = {
          ...local,
          // Lifetime counters are monotonic — max survives replays from either side.
          totalCompleted: Math.max(local.totalCompleted, typeof r.totalCompleted === 'number' ? r.totalCompleted : 0),
          daysAllDone: Math.max(local.daysAllDone, typeof r.daysAllDone === 'number' ? r.daysAllDone : 0),
        };
        const remoteDay = typeof r.day === 'string' ? r.day : '';
        const remoteProgress = r.progress && typeof r.progress === 'object' ? r.progress : {};
        const remoteDone = r.done && typeof r.done === 'object' ? r.done : {};
        if (remoteDay > local.day) {
          // The other device is already on a later day — its slate wins wholesale.
          next.day = remoteDay;
          next.progress = { ...remoteProgress };
          next.done = { ...remoteDone };
          next.bonusPaid = r.bonusPaid === true;
        } else if (remoteDay === local.day && remoteDay !== '') {
          // Same day on both sides: per-quest max progress, union of completions.
          const progress = { ...local.progress };
          for (const [id, v] of Object.entries(remoteProgress)) {
            if (typeof v === 'number') progress[id] = Math.max(progress[id] ?? 0, v);
          }
          const done = { ...local.done };
          for (const [id, ts] of Object.entries(remoteDone)) {
            if (typeof ts !== 'number') continue;
            done[id] = id in done ? Math.min(done[id]!, ts) : ts;
          }
          next.progress = progress;
          next.done = done;
          next.bonusPaid = local.bonusPaid || r.bonusPaid === true;
        }
        set(next);
      },

      reset() {
        set(initialData());
      },
    }),
    { name: 'chesser-quests' },
  ),
);
