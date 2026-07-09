import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Clock } from '../components/Clock';
import type { Color } from '../store/game';
import { cap } from './chessUtil';

export const btn = 'rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50';
export const neutralBtn = `${btn} bg-neutral-700 text-neutral-200 hover:bg-neutral-600`;
export const primaryBtn = `${btn} bg-emerald-700 text-white hover:bg-emerald-800`;
export const dangerBtn = `${btn} bg-rose-600 text-white hover:bg-rose-500`;

/** One player's row above/below the board: name, optional presence, clock. */
export function PlayerBar({
  side,
  name,
  active,
  connected,
  clockMs,
  flagged,
}: {
  side: Color;
  name: string;
  active: boolean;
  /** Presence for online games; undefined hides the indicator. */
  connected?: boolean;
  clockMs: number | null;
  flagged: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2" data-testid={`player-${side}`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className={`h-3 w-3 shrink-0 rounded-sm border border-neutral-600 ${side === 'white' ? 'bg-neutral-100' : 'bg-neutral-900'}`} />
        <span className={`truncate text-sm ${active ? 'font-semibold text-ink' : 'text-neutral-400'}`}>{name}</span>
        {connected !== undefined && (
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-400'}`}
            title={connected ? 'connected' : 'disconnected'}
            data-testid={`presence-${side}`}
          />
        )}
      </div>
      {clockMs !== null && <Clock ms={clockMs} active={active} flagged={flagged} />}
    </div>
  );
}

interface ReplayPosition {
  fen: string;
  lastMove: [string, string] | undefined;
}

export interface Replay {
  /** Position being viewed, or null when following the live game. */
  view: ReplayPosition | null;
  /** Viewed ply (0 = start). Equals sans.length when live. */
  viewPly: number;
  atLive: boolean;
  goTo(ply: number): void;
  step(delta: number): void;
  goLive(): void;
}

/**
 * Click-to-navigate replay over a growing SAN list. Positions are rebuilt from
 * the move history (never from a bare FEN), so they are always consistent.
 * While the user is browsing, new live moves keep arriving without yanking the
 * view; landing on the final ply snaps back to "live".
 */
export function useReplay(sans: string[]): Replay {
  const positions = useMemo<ReplayPosition[]>(() => {
    const c = new Chess();
    const out: ReplayPosition[] = [{ fen: c.fen(), lastMove: undefined }];
    for (const san of sans) {
      let mv;
      try {
        mv = c.move(san);
      } catch {
        break;
      }
      out.push({ fen: mv.after, lastMove: [mv.from, mv.to] });
    }
    return out;
  }, [sans]);

  const [ply, setPly] = useState<number | null>(null); // null = live
  const viewPly = ply === null ? sans.length : Math.min(ply, sans.length);
  const atLive = ply === null || viewPly >= sans.length;
  const goTo = (p: number) => setPly(p >= sans.length ? null : Math.max(0, p));
  return {
    view: atLive ? null : (positions[viewPly] ?? null),
    viewPly,
    atLive,
    goTo,
    step: (d: number) => goTo(viewPly + d),
    goLive: () => setPly(null),
  };
}

/** Numbered SAN move list with click-to-navigate. */
export function HumanMoveList({ sans, replay }: { sans: string[]; replay?: Replay }) {
  const endRef = useRef<HTMLDivElement>(null);
  const atLive = replay?.atLive ?? true;
  useEffect(() => {
    if (atLive) endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [sans.length, atLive]);
  if (sans.length === 0) {
    return (
      <p className="text-sm text-neutral-400" data-testid="human-movelist">
        No moves yet.
      </p>
    );
  }
  const selected = replay && !replay.atLive ? replay.viewPly : sans.length;
  const cell = (san: string | undefined, ply: number) =>
    san === undefined ? (
      <span />
    ) : (
      <button
        onClick={() => replay?.goTo(ply)}
        className={`rounded px-1 text-left ${ply === selected ? 'bg-emerald-700/60 text-white' : 'text-neutral-200 hover:bg-neutral-800'}`}
      >
        {san}
      </button>
    );
  const rows: { n: number; w?: string; b?: string }[] = [];
  for (let i = 0; i < sans.length; i += 2) rows.push({ n: i / 2 + 1, w: sans[i], b: sans[i + 1] });
  return (
    <div className="space-y-2">
      <div className="max-h-64 overflow-y-auto rounded-lg bg-panel p-2 text-sm" data-testid="human-movelist">
        <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-y-0.5">
          {rows.map((r) => (
            <div key={r.n} className="contents">
              <span className="text-neutral-400">{r.n}.</span>
              {cell(r.w, r.n * 2 - 1)}
              {cell(r.b, r.n * 2)}
            </div>
          ))}
        </div>
        <div ref={endRef} />
      </div>
      {replay && (
        <div className="flex gap-1">
          <button className={`${neutralBtn} flex-1`} onClick={() => replay.goTo(0)} title="Start">
            ⏮
          </button>
          <button className={`${neutralBtn} flex-1`} onClick={() => replay.step(-1)} title="Back">
            ◀
          </button>
          <button className={`${neutralBtn} flex-1`} onClick={() => replay.step(1)} title="Forward">
            ▶
          </button>
          <button
            className={`${replay.atLive ? primaryBtn : neutralBtn} flex-1`}
            onClick={replay.goLive}
            title="Jump to the live position"
          >
            ⏭
          </button>
        </div>
      )}
    </div>
  );
}

/** Copy the game as PGN to the clipboard. */
export function CopyPgnButton({ pgn }: { pgn: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={`${btn} w-full bg-neutral-800 text-neutral-400 hover:bg-neutral-700`}
      data-testid="copy-pgn"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(pgn)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => {});
      }}
    >
      {copied ? '✓ PGN copied' : '⧉ Copy PGN'}
    </button>
  );
}

/** Big end-of-game banner. */
export function ResultBanner({ winner, reason }: { winner: Color | 'draw'; reason: string }) {
  const aborted = reason === 'aborted';
  return (
    <div
      data-testid="result-banner"
      className={`rounded-md px-3 py-2 text-sm font-semibold ${
        winner === 'draw' ? 'bg-neutral-700/60 text-neutral-200' : 'bg-emerald-900/50 text-emerald-300'
      }`}
    >
      {aborted ? 'Game aborted' : winner === 'draw' ? 'Draw' : `${cap(winner)} wins`}
      {!aborted && <span className="ml-1 font-normal opacity-80">· {reason}</span>}
    </div>
  );
}
