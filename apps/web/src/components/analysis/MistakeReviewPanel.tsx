/**
 * MistakeReviewPanel — the mistake-review workflow list. Props-only (no store
 * imports): PlayPage wires report.moves + viewPly + the jump/practice
 * callbacks in.
 *
 * Lists every inaccuracy / mistake / blunder / missed win with the win% it
 * cost, the engine's better move (short PV snippet) and the punishing reply.
 * Class chips and a per-player toggle filter the list; the worst mistakes sort
 * first (toggleable to game order). A row jumps the board to its position;
 * "Practice" plays the position out against the engine. Arrow keys walk the
 * list. Clean games get a friendly empty state.
 */
import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { CLASSIFICATION_META } from '../../lib/coach';
import { CLASSIFICATION_GLYPH } from '../../lib/analytics/types';
import type { Classification, MoveDetail, Side } from '../../lib/analytics/types';

export interface MistakeReviewPanelProps {
  /** Full report.moves; the panel filters to the bad ones itself. */
  moves: MoveDetail[];
  viewPly: number;
  onSelectPly(ply: number): void;
  onPractice(ply: number): void;
  /**
   * Controlled class filter (ReviewSummary's count cells drive it via
   * PlayPage); omit both to let the panel manage its own chips.
   */
  activeClasses?: ReadonlySet<Classification>;
  onActiveClassesChange?(next: ReadonlySet<Classification>): void;
}

export type MistakeClass = Extract<Classification, 'inaccuracy' | 'mistake' | 'blunder' | 'miss'>;
export type SideFilter = Side | 'both';
export type SortOrder = 'severity' | 'ply';

/** Chip display order (mildest → worst, like the summary table). */
export const MISTAKE_CLASSES: readonly MistakeClass[] = ['inaccuracy', 'mistake', 'blunder', 'miss'];

const MISTAKE_SET: ReadonlySet<Classification> = new Set<Classification>(MISTAKE_CLASSES);

function isMistakeClass(cls: Classification): cls is MistakeClass {
  return MISTAKE_SET.has(cls);
}

/** Sort rank for the list, larger = worse; 0 for non-mistake grades. */
export function severityRank(cls: Classification): number {
  switch (cls) {
    case 'blunder':
      return 4;
    case 'miss':
      return 3;
    case 'mistake':
      return 2;
    case 'inaccuracy':
      return 1;
    default:
      return 0;
  }
}

/**
 * True when the row belongs in the mistake list. A delivered mate is best-tier
 * by definition — never listed as a mistake, whatever a stale grade says.
 * Seam: consolidate with checkmateWinner() from lib/coach.ts once fix/coach-trainers lands.
 */
export function isMistakeRow(m: MoveDetail): boolean {
  return !m.isMate && isMistakeClass(m.classification);
}

/** Mover-POV win% the move cost (White win% is inverted for Black), ≥ 0, rounded. */
export function winLost(m: MoveDetail): number {
  const before = m.side === 'white' ? m.winBefore : 100 - m.winBefore;
  const after = m.side === 'white' ? m.winAfter : 100 - m.winAfter;
  return Math.max(0, Math.round(before - after));
}

/**
 * The panel's row model: mistakes matching the class + side filters, sorted
 * worst-first (severity rank, then ply) or in game order.
 */
export function mistakeRows(
  moves: MoveDetail[],
  classes: ReadonlySet<Classification>,
  side: SideFilter = 'both',
  order: SortOrder = 'severity',
): MoveDetail[] {
  const rows = moves.filter(
    (m) => isMistakeRow(m) && classes.has(m.classification) && (side === 'both' || m.side === side),
  );
  return order === 'ply'
    ? rows.sort((a, b) => a.ply - b.ply)
    : rows.sort((a, b) => severityRank(b.classification) - severityRank(a.classification) || a.ply - b.ply);
}

/** Per-class tally for the filter chips (respects the side toggle). */
export function mistakeCounts(moves: MoveDetail[], side: SideFilter = 'both'): Record<MistakeClass, number> {
  const counts: Record<MistakeClass, number> = { inaccuracy: 0, mistake: 0, blunder: 0, miss: 0 };
  for (const m of moves) {
    if (!isMistakeRow(m) || (side !== 'both' && m.side !== side)) continue;
    if (isMistakeClass(m.classification)) counts[m.classification] += 1;
  }
  return counts;
}

/**
 * First clause of the coach explanation for the compact row, cut at the first
 * sentence end, em dash or colon ("This leaves the knight hanging — Rxd5 just
 * takes it." → "This leaves the knight hanging").
 */
export function shortCause(explanation: string): string {
  const sentence = explanation.split(/[.!?](?:\s|$)/, 1)[0] ?? explanation;
  const clause = sentence.split(/\s+[—–]\s+|\s*[:;]\s+/, 1)[0] ?? sentence;
  return clause.trim();
}

/** Up to `max` SANs of the engine's better line from before the move. */
export function pvSnippet(m: MoveDetail, max = 4): string[] {
  return m.pv.slice(0, Math.max(0, max));
}

const moveLabel = (ply: number) => `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '…'}`;

export function MistakeReviewPanel({
  moves,
  viewPly,
  onSelectPly,
  onPractice,
  activeClasses,
  onActiveClassesChange,
}: MistakeReviewPanelProps): JSX.Element {
  const [ownActive, setOwnActive] = useState<ReadonlySet<Classification>>(MISTAKE_SET);
  const active = activeClasses ?? ownActive;
  const setActive = onActiveClassesChange ?? setOwnActive;
  const [side, setSide] = useState<SideFilter>('both');
  const [order, setOrder] = useState<SortOrder>('severity');
  const listRef = useRef<HTMLUListElement>(null);

  const total = useMemo(() => moves.filter(isMistakeRow).length, [moves]);
  const counts = useMemo(() => mistakeCounts(moves, side), [moves, side]);
  const rows = useMemo(() => mistakeRows(moves, active, side, order), [moves, active, side, order]);

  const toggleClass = (cls: Classification) => {
    const next = new Set(active);
    if (!next.delete(cls)) next.add(cls);
    setActive(next);
  };

  // Roving arrow-key navigation between the rows' jump buttons.
  const onListKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const jumps = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-jump]') ?? []);
    if (jumps.length === 0) return;
    const i = jumps.findIndex((b) => b === document.activeElement);
    const next = e.key === 'ArrowDown' ? Math.min(i + 1, jumps.length - 1) : Math.max(i - 1, 0);
    jumps[next]?.focus();
    e.preventDefault();
  };

  return (
    <div className="rounded-2xl bg-panel p-3 shadow-soft">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-ink">
          Mistakes
          {total > 0 && <span className="ml-1.5 text-xs font-normal text-neutral-400">{total}</span>}
        </h3>
        {total > 1 && (
          <button
            data-sort
            onClick={() => setOrder((o) => (o === 'severity' ? 'ply' : 'severity'))}
            title="Toggle list order"
            className="btn-press rounded-lg px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
          >
            {order === 'severity' ? 'Worst first' : 'Game order'}
          </button>
        )}
      </div>

      {total === 0 ? (
        <p className="mt-2 text-xs text-neutral-400">No mistakes — clean game!</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {MISTAKE_CLASSES.map((cls) => {
              const on = active.has(cls);
              const meta = CLASSIFICATION_META[cls];
              return (
                <button
                  key={cls}
                  data-chip={cls}
                  aria-pressed={on}
                  disabled={counts[cls] === 0}
                  onClick={() => toggleClass(cls)}
                  title={`${meta.label} — click to ${on ? 'hide' : 'show'}`}
                  className={`btn-press rounded-full px-2 py-0.5 text-xs font-semibold ring-1 disabled:opacity-40 ${
                    on ? `${meta.bg} ${meta.text} ${meta.ring}` : 'bg-neutral-800 text-neutral-400 ring-neutral-700 hover:text-neutral-300'
                  }`}
                >
                  {CLASSIFICATION_GLYPH[cls]} {counts[cls]}
                </button>
              );
            })}
            <div className="ml-auto flex overflow-hidden rounded-lg ring-1 ring-neutral-700">
              {(['both', 'white', 'black'] as const).map((s) => (
                <button
                  key={s}
                  data-side={s}
                  aria-pressed={side === s}
                  onClick={() => setSide(s)}
                  className={`px-1.5 py-0.5 text-[11px] capitalize ${side === s ? 'bg-neutral-700 text-ink' : 'text-neutral-400 hover:text-neutral-300'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="mt-2 text-xs text-neutral-400">No moves match the current filters.</p>
          ) : (
            <ul ref={listRef} onKeyDown={onListKeyDown} aria-label="Mistakes in this game" className="mt-2 space-y-1">
              {rows.map((m) => {
                const meta = CLASSIFICATION_META[m.classification];
                const current = m.ply === viewPly;
                const lost = winLost(m);
                const cause = shortCause(m.explanation);
                const line = pvSnippet(m).join(' ');
                return (
                  <li
                    key={m.ply}
                    data-row-ply={m.ply}
                    data-current={current || undefined}
                    className={`rounded-lg px-2 py-1.5 ${current ? 'bg-brand-500/15 ring-1 ring-brand-400/40' : 'hover:bg-neutral-800/60'}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <button
                        data-jump={m.ply}
                        onClick={() => onSelectPly(m.ply)}
                        title="Jump to position"
                        className="flex min-w-0 flex-1 items-baseline gap-1.5 rounded text-left"
                      >
                        <span className={`w-6 shrink-0 text-center text-xs font-bold ${meta.text}`}>
                          {CLASSIFICATION_GLYPH[m.classification]}
                        </span>
                        <span className="whitespace-nowrap font-mono text-sm text-neutral-200">
                          {moveLabel(m.ply)} {m.san}
                        </span>
                        {lost > 0 && <span className="text-[11px] font-semibold text-rose-300">−{lost}%</span>}
                      </button>
                      <button
                        data-practice={m.ply}
                        onClick={() => onPractice(m.ply)}
                        title="Practice vs engine from this position"
                        className="btn-press shrink-0 rounded-lg bg-neutral-700 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-100 hover:bg-neutral-600"
                      >
                        Practice
                      </button>
                    </div>
                    {cause && <p className="mt-0.5 truncate pl-8 text-[11px] leading-tight text-neutral-400">{cause}</p>}
                    {m.bestMoveSan && (
                      <p className="mt-0.5 truncate pl-8 text-[11px] leading-tight text-neutral-400">
                        Best <span className="font-mono text-emerald-300">{line || m.bestMoveSan}</span>
                        {m.bestReplySan && (
                          // The reply refutes the PLAYED move, not the best line — name the move.
                          <>
                            {' '}· {m.san} is punished by <span className="font-mono text-rose-300">{m.bestReplySan}</span>
                          </>
                        )}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
