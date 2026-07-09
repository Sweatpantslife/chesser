import { useEffect } from 'react';
import { mainlineOf, useGame } from '../store/game';
import { CLASSIFICATION_META, IMPORTANT } from '../lib/coach';

const DWELL_MS = 1600; // how long auto-play lingers on an ordinary move

const ctrl =
  'flex h-8 w-9 items-center justify-center rounded text-sm text-neutral-200 bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 disabled:hover:bg-neutral-700';
const ctrlPrimary =
  'flex h-8 w-12 items-center justify-center rounded text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:hover:bg-emerald-700';

const moveLabel = (ply: number) => `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '…'}`;

/**
 * The move-by-move "coach" shown on the analysis board after a game. Auto-plays
 * through the line, pausing on every notable move (brilliancies and errors) so
 * the player can take in the explanation, and offering full manual control.
 */
export function AnalysisCoach() {
  const coachActive = useGame((s) => s.coachActive);
  const coachPlaying = useGame((s) => s.coachPlaying);
  const currentId = useGame((s) => s.currentId);
  const viewPly = useGame((s) => s.viewPly);
  const moveReviews = useGame((s) => s.moveReviews);
  const reviewing = useGame((s) => s.reviewing);
  const progress = useGame((s) => s.reviewProgress);
  const tree = useGame((s) => s.tree);
  const rootId = useGame((s) => s.rootId);

  const len = mainlineOf(tree, rootId).length;

  // Auto-advance, halting on the last move and on any important move landed on.
  useEffect(() => {
    if (!coachActive || !coachPlaying || reviewing) return;
    if (viewPly >= len) {
      useGame.getState().setCoachPlaying(false);
      return;
    }
    const t = window.setTimeout(() => {
      useGame.getState().stepView(1);
      // Re-read the store: stepView() replaced the state object, so a snapshot
      // taken before it would still hold the previous currentId and pause one
      // move AFTER each notable move instead of on it.
      const s = useGame.getState();
      const rev = s.moveReviews[s.currentId];
      if (rev && IMPORTANT.has(rev.classification)) s.setCoachPlaying(false);
    }, DWELL_MS);
    return () => window.clearTimeout(t);
  }, [coachActive, coachPlaying, reviewing, viewPly, len]);

  if (!coachActive) return null;

  const review = moveReviews[currentId];
  const meta = review ? CLASSIFICATION_META[review.classification] : null;
  const atStart = viewPly === 0;
  const atEnd = viewPly >= len;

  const nav = (fn: (s: ReturnType<typeof useGame.getState>) => void) => {
    const s = useGame.getState();
    s.setCoachPlaying(false);
    fn(s);
  };

  return (
    <div className="rounded-lg bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        {/* ReviewPanel is also titled "Game review" and can be stacked with this
            panel during a walkthrough — keep the two titles distinct. */}
        <h3 className="text-sm font-semibold text-ink">Coach</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-400">
            {Math.min(viewPly, len)} / {len}
          </span>
          <button
            onClick={() => useGame.getState().stopCoach()}
            title="Exit walkthrough"
            aria-label="Exit walkthrough"
            className="rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
          >
            ✕
          </button>
        </div>
      </div>

      {reviewing ? (
        <div className="space-y-2 py-2">
          <p className="text-xs text-neutral-400">Analysing the game… {progress}%</p>
          <div className="h-1.5 w-full overflow-hidden rounded bg-neutral-800">
            <div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : atStart ? (
        <p className="py-3 text-sm text-neutral-400">Starting position. Press ▶ to walk through the game move by move.</p>
      ) : review && meta ? (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2.5">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg font-bold ${meta.bg} ${meta.text} ring-1 ${meta.ring}`}>
              {meta.icon}
            </span>
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-sm text-neutral-300">
                  {moveLabel(review.ply)} {review.san}
                </span>
                <span className={`text-sm font-semibold ${meta.text}`}>{meta.label}</span>
              </div>
              <div className="text-xs text-neutral-400">
                eval <span className="font-mono text-neutral-300">{review.evalText}</span>
              </div>
            </div>
          </div>

          <p className="text-sm leading-snug text-neutral-200">{review.explanation}</p>

          {review.bestSan && review.bestSan !== review.san && (
            <div className="rounded-md bg-neutral-800/60 px-2.5 py-1.5 text-xs text-neutral-300">
              Engine's choice: <span className="font-mono font-semibold text-emerald-300">{review.bestSan}</span>
            </div>
          )}
        </div>
      ) : (
        <p className="py-3 text-sm text-neutral-400">No grade for this move.</p>
      )}

      {/* transport controls */}
      <div className="mt-3 flex items-center justify-center gap-1">
        <button onClick={() => nav((s) => s.goToPly(0))} disabled={atStart} className={ctrl} title="Start" aria-label="Go to start">
          ⏮
        </button>
        <button onClick={() => nav((s) => s.stepView(-1))} disabled={atStart} className={ctrl} title="Previous" aria-label="Previous move">
          ◀
        </button>
        <button
          onClick={() => useGame.getState().setCoachPlaying(!coachPlaying)}
          disabled={atEnd && !coachPlaying}
          className={ctrlPrimary}
          title={coachPlaying ? 'Pause' : 'Play'}
          aria-label={coachPlaying ? 'Pause' : 'Play'}
        >
          {coachPlaying ? '⏸' : '▶'}
        </button>
        <button onClick={() => nav((s) => s.stepView(1))} disabled={atEnd} className={ctrl} title="Next" aria-label="Next move">
          ▶
        </button>
        <button onClick={() => nav((s) => s.goToPly(len))} disabled={atEnd} className={ctrl} title="End" aria-label="Go to end">
          ⏭
        </button>
      </div>
    </div>
  );
}
