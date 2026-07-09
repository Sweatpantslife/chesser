import { useEffect, useMemo, useState } from 'react';
import { STARTING_FEN } from '@chesser/shared';
import { mainlineOf, useGame, type Color } from '../store/game';
import { detectOpening, type OpeningInfo } from '../lib/openings';
import { CLASSIFICATION_META, type Classification } from '../lib/coach';
import { BotAvatar } from './BotAvatar';

const opposite = (c: Color): Color => (c === 'white' ? 'black' : 'white');

/** A coloured accuracy bar (0–100), green→amber→rose by quality. */
function AccuracyBar({ value }: { value: number | null }) {
  const v = value ?? 0;
  const hue = value == null ? 'bg-neutral-600' : v >= 85 ? 'bg-emerald-500' : v >= 65 ? 'bg-lime-500' : v >= 45 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
      <div className={`h-full rounded-full transition-[width] ${hue}`} style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
    </div>
  );
}

/** Grade chips shown for the player's own moves (only the notable ones). */
const CHIP_ORDER: Classification[] = ['brilliant', 'great', 'best', 'inaccuracy', 'mistake', 'blunder', 'miss'];

export function GameOverModal() {
  const summary = useGame((s) => s.gameSummary);
  const dismissed = useGame((s) => s.modalDismissed);
  const gameNo = useGame((s) => s.gameNo);
  const reviewing = useGame((s) => s.reviewing);
  const progress = useGame((s) => s.reviewProgress);
  const reviewStats = useGame((s) => s.reviewStats);
  const reviewGameNo = useGame((s) => s.reviewGameNo);
  const moveReviews = useGame((s) => s.moveReviews);
  const connected = useGame((s) => s.connected);
  const tree = useGame((s) => s.tree);
  const rootId = useGame((s) => s.rootId);
  const startFen = useGame((s) => s.startFen);

  const show = !!summary && !dismissed && summary.gameNo === gameNo;

  // Auto-run a background review the first time the modal opens for this game.
  useEffect(() => {
    if (!show) return;
    const st = useGame.getState();
    if (connected && st.reviewGameNo !== st.gameNo && !st.reviewing) void st.reviewGame();
  }, [show, connected]);

  // Detect the opening for the headline stat.
  const [opening, setOpening] = useState<OpeningInfo | null>(null);
  useEffect(() => {
    if (!show || startFen !== STARTING_FEN) {
      setOpening(null);
      return;
    }
    let cancelled = false;
    const sans = mainlineOf(tree, rootId).map((n) => n.san);
    detectOpening(sans).then((r) => !cancelled && setOpening(r));
    return () => {
      cancelled = true;
    };
  }, [show, tree, rootId, startFen]);

  const reviewReady = !!summary && reviewGameNo === summary.gameNo && !!reviewStats;

  // Tally the player's own move grades.
  const chips = useMemo(() => {
    if (!summary) return [];
    const counts = {} as Record<Classification, number>;
    for (const r of Object.values(moveReviews)) {
      if (r.side !== summary.playerColor) continue;
      counts[r.classification] = (counts[r.classification] ?? 0) + 1;
    }
    return CHIP_ORDER.filter((c) => counts[c] > 0).map((c) => ({ cls: c, n: counts[c]! }));
  }, [moveReviews, summary]);

  if (!show || !summary) return null;

  const oppColor = opposite(summary.playerColor);
  const youAcc = reviewReady ? reviewStats![summary.playerColor].accuracy : null;
  const oppAcc = reviewReady ? reviewStats![oppColor].accuracy : null;

  const won = summary.outcome === 'win';
  const lost = summary.outcome === 'loss';
  const headline = won ? 'Victory' : lost ? 'Defeat' : 'Draw';
  const headEmoji = won ? '🏆' : lost ? '🙁' : '🤝';
  const headTone = won ? 'text-emerald-300' : lost ? 'text-rose-300' : 'text-neutral-200';

  const deltaStr = `${summary.ratingDelta >= 0 ? '+' : '−'}${Math.abs(summary.ratingDelta)}`;
  const deltaTone = summary.ratingDelta > 0 ? 'text-emerald-300' : summary.ratingDelta < 0 ? 'text-rose-300' : 'text-neutral-400';

  const close = () => useGame.getState().dismissModal();

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={close}>
      <div
        className="scroll-thin max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-panel p-5 shadow-2xl ring-1 ring-white/5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* headline */}
        <div className="mb-4 text-center">
          <div className="text-3xl">{headEmoji}</div>
          <h2 className={`mt-1 text-2xl font-bold ${headTone}`}>{headline}</h2>
          <p className="mt-0.5 text-sm text-neutral-400">{summary.statusText}</p>
        </div>

        {/* opponent + rating */}
        <div className="mb-4 flex items-center justify-between rounded-xl bg-neutral-800/50 p-3">
          <div className="flex items-center gap-2.5">
            {summary.opponent && <BotAvatar name={summary.opponent.name} accent={summary.opponent.accent} motif={summary.opponent.motif} size={40} />}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">{summary.opponent?.name ?? 'Opponent'}</div>
              <div className="text-xs text-neutral-500">
                You played <span className="capitalize text-neutral-300">{summary.playerColor}</span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">{summary.category === 'blitz' ? 'Blitz' : 'Bots'} rating</div>
            <div className="flex items-baseline justify-end gap-1.5">
              <span className="text-lg font-bold text-ink">{summary.ratingAfter}</span>
              {summary.rated ? (
                <span className={`text-sm font-semibold ${deltaTone}`}>{deltaStr}</span>
              ) : (
                <span className="text-xs font-semibold text-neutral-500">unrated</span>
              )}
            </div>
          </div>
        </div>

        {/* accuracy */}
        <div className="mb-4 space-y-2.5 rounded-xl bg-neutral-800/40 p-3">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-neutral-500">
            <span>Accuracy</span>
            {!reviewReady && (
              <span className="text-neutral-500">{connected ? (reviewing ? `analysing ${progress}%` : 'analysing…') : 'engine offline'}</span>
            )}
          </div>
          {(['you', 'opp'] as const).map((who) => {
            const acc = who === 'you' ? youAcc : oppAcc;
            const label = who === 'you' ? 'You' : (summary.opponent?.name ?? 'Opponent');
            return (
              <div key={who}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="truncate text-neutral-300">{label}</span>
                  <span className={`font-semibold tabular-nums ${acc == null ? 'text-neutral-600' : 'text-emerald-300'}`}>
                    {acc == null ? '—' : `${acc}%`}
                  </span>
                </div>
                <AccuracyBar value={acc} />
              </div>
            );
          })}
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {chips.map(({ cls, n }) => {
                const m = CLASSIFICATION_META[cls];
                return (
                  <span key={cls} className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${m.bg} ${m.text} ring-1 ${m.ring}`}>
                    {n} {m.label.toLowerCase()}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* small facts */}
        <div className="mb-5 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-neutral-800/40 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Moves</div>
            <div className="font-semibold text-neutral-200">{summary.moves}</div>
          </div>
          <div className="rounded-lg bg-neutral-800/40 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Opening</div>
            <div className="truncate font-semibold text-neutral-200" title={opening?.name}>
              {opening?.name ?? '—'}
            </div>
          </div>
        </div>

        {/* actions */}
        <div className="space-y-2">
          <button
            onClick={() => void useGame.getState().analyzeFinishedGame()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            🔍 Analyze game
            <span className="text-xs font-normal text-indigo-200">· move-by-move walkthrough</span>
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => useGame.getState().rematch()}
              className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              ↻ Rematch
            </button>
            <button onClick={close} className="flex-1 rounded-lg bg-neutral-700 py-2.5 text-sm font-semibold text-neutral-200 hover:bg-neutral-600">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
