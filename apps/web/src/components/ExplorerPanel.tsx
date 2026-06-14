import { useEffect, useState } from 'react';
import type { ExplorerDb, ExplorerResult } from '@chesser/shared';
import { apiExplorer } from '../lib/api';
import { useGame } from '../store/game';

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function WdlBar({ white, draws, black, total }: { white: number; draws: number; black: number; total: number }) {
  const p = (n: number) => (total ? (n / total) * 100 : 0);
  return (
    <div className="flex h-3.5 w-full overflow-hidden rounded-sm text-[9px] font-medium leading-[14px]">
      <div className="bg-neutral-200 text-center text-neutral-800" style={{ width: `${p(white)}%` }}>
        {p(white) > 12 ? `${Math.round(p(white))}%` : ''}
      </div>
      <div className="bg-neutral-500 text-center text-neutral-900" style={{ width: `${p(draws)}%` }} />
      <div className="bg-neutral-800 text-center text-neutral-200" style={{ width: `${p(black)}%` }}>
        {p(black) > 12 ? `${Math.round(p(black))}%` : ''}
      </div>
    </div>
  );
}

export function ExplorerPanel() {
  const fen = useGame((s) => s.fen);
  const mode = useGame((s) => s.mode);
  const exploreMove = useGame((s) => s.exploreMove);
  const [db, setDb] = useState<ExplorerDb>('masters');
  const [data, setData] = useState<ExplorerResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiExplorer(fen, db).then((r) => {
      if (!cancelled) {
        setData(r);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fen, db]);

  return (
    <div className="rounded-lg bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Opening explorer</h3>
        <div className="flex gap-1 text-xs">
          {(['masters', 'lichess'] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDb(d)}
              className={`rounded px-1.5 py-0.5 capitalize ${db === d ? 'bg-emerald-600 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'}`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <p className="text-xs text-neutral-500">{loading ? 'loading…' : ''}</p>
      ) : !data.available ? (
        <p className="text-xs text-neutral-500">
          Explorer unavailable here. Allowlist <code className="text-neutral-300">explorer.lichess.ovh</code> to enable it.
        </p>
      ) : (data.moves?.length ?? 0) === 0 ? (
        <p className="text-xs text-neutral-500">No games in this database from here.</p>
      ) : (
        <div className="space-y-1">
          {data.moves!.map((m) => (
            <button
              key={m.uci}
              disabled={mode !== 'analysis'}
              onClick={() => exploreMove(m.uci)}
              className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-neutral-700 disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span className="w-10 shrink-0 font-mono text-sm text-neutral-200">{m.san}</span>
              <span className="w-10 shrink-0 text-right text-[11px] text-neutral-400">{fmtCount(m.total)}</span>
              <span className="min-w-0 flex-1">
                <WdlBar white={m.white} draws={m.draws} black={m.black} total={m.total} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
