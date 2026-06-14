import { useEffect, useRef } from 'react';
import { useGame } from '../store/game';

const GLYPH: Record<string, { mark: string; cls: string }> = {
  blunder: { mark: '??', cls: 'text-rose-400' },
  mistake: { mark: '?', cls: 'text-orange-400' },
  inaccuracy: { mark: '?!', cls: 'text-amber-300' },
};

export function MoveList() {
  const { history, viewPly, goToPly } = useGame();
  const annotations = useGame((s) => s.annotations);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [viewPly]);

  const rows: { no: number; white?: { san: string; ply: number }; black?: { san: string; ply: number } }[] = [];
  history.forEach((m, i) => {
    const row = Math.floor(i / 2);
    rows[row] ??= { no: row + 1 };
    if (i % 2 === 0) rows[row]!.white = { san: m.san, ply: i + 1 };
    else rows[row]!.black = { san: m.san, ply: i + 1 };
  });

  const cell = (move: { san: string; ply: number } | undefined) => {
    if (!move) return <span />;
    const g = GLYPH[annotations[move.ply] ?? ''];
    return (
      <button
        data-current={viewPly === move.ply}
        onClick={() => goToPly(move.ply)}
        className={`rounded px-1.5 py-0.5 text-left font-mono text-sm ${
          viewPly === move.ply ? 'bg-emerald-600 text-white' : 'text-neutral-200 hover:bg-neutral-700'
        }`}
      >
        {move.san}
        {g && <span className={`ml-0.5 ${viewPly === move.ply ? 'text-white' : g.cls}`}>{g.mark}</span>}
      </button>
    );
  };

  return (
    <div ref={scrollRef} className="scroll-thin max-h-56 overflow-y-auto rounded-lg bg-panelmute p-1">
      {rows.length === 0 ? (
        <p className="p-2 text-xs text-neutral-500">No moves yet.</p>
      ) : (
        <div className="grid grid-cols-[2rem_1fr_1fr] items-center gap-x-1 gap-y-0.5">
          {rows.map((r) => (
            <div key={r.no} className="contents">
              <span className="pl-1 text-right text-xs text-neutral-500">{r.no}.</span>
              {cell(r.white)}
              {cell(r.black)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
