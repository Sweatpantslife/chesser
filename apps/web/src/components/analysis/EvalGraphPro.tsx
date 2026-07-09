/**
 * EvalGraphPro — the report-layer advantage graph. Props-only (no store
 * imports): PlayPage/ReviewPanel wire report.moves + phases + viewPly in.
 *
 * White's win chance (White POV, 0–100) is drawn as a light area rising from
 * the bottom edge against a dark background (Black's share), around a 50%
 * midline. Adds phase bands, classification marker dots, an optional
 * critical-moment tick layer, hover tooltip, click / arrow-key ply jumps and
 * a compact `sparkline` mode. Renders null for fewer than 2 points.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CLASSIFICATION_META } from '../../lib/coach';
import { formatScore } from '../../lib/format';
import type {
  Classification,
  CriticalMoment,
  EvalPoint,
  MoveDetail,
  PhaseName,
  PhaseStats,
} from '../../lib/analytics/types';

export interface EvalGraphProProps {
  /** report.moves in mainline order. */
  moves: MoveDetail[];
  /** Phase spans for background shading + labels. */
  phases: PhaseStats[];
  /** Current ply (0 = start position). */
  viewPly: number;
  /** Click / arrow-key jump. */
  onSelectPly(ply: number): void;
  /** Graph height in px; defaults to 96 (40 in sparkline mode). */
  height?: number;
  /** Compact win-chance mode: area + midline + cursor only. */
  sparkline?: boolean;
  /** Optional subtle vertical ticks at the report's critical moments. */
  criticalMoments?: CriticalMoment[];
}

/** One graph point: White's win% after `ply` (ply 0 = start position). */
export interface GraphPoint {
  ply: number;
  /** 0–100 White POV, clamped — mate evals sit on the edges. */
  win: number;
}

const clampWin = (w: number) => Math.max(0, Math.min(100, w));

/**
 * Rows → dense point series [before move 1, after move 1, …, after move N].
 * Mirrors the store's evalGraph layout; a 1-move game yields 2 points.
 */
export function buildGraphPoints(moves: MoveDetail[]): GraphPoint[] {
  const first = moves[0];
  if (!first) return [];
  const points: GraphPoint[] = [{ ply: 0, win: clampWin(first.winBefore) }];
  for (const m of moves) {
    // A delivered mate ends the game at the mover's winning edge, whatever a
    // stale eval says — best-tier by definition, never a dip in the curve.
    // Seam: consolidate with checkmateWinner() from lib/coach.ts once fix/coach-trainers lands.
    const win = m.isMate ? (m.side === 'white' ? 100 : 0) : clampWin(m.winAfter);
    points.push({ ply: m.ply, win });
  }
  return points;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** SVG path data for the win% line and its filled area (empty if < 2 points). */
export function buildWinPaths(points: GraphPoint[], width: number, height: number): { line: string; area: string } {
  if (points.length < 2 || width <= 0 || height <= 0) return { line: '', area: '' };
  const n = points.length - 1;
  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${round2((i / n) * width)},${round2(((100 - p.win) / 100) * height)}`)
    .join(' ');
  const area = `${line} L${round2(width)},${round2(height)} L0,${round2(height)} Z`;
  return { line, area };
}

/** Hex twins of CLASSIFICATION_META's marker hues, for SVG fills. */
const MARKER_FILL: Partial<Record<Classification, string>> = {
  brilliant: '#22d3ee',
  great: '#60a5fa',
  miss: '#fb7185',
  mistake: '#fb923c',
  blunder: '#f43f5e',
};

/** Marker-dot fill for a move, or null when the move gets no dot. */
export function markerFill(move: MoveDetail): string | null {
  if (move.isMate) {
    // The mating move is best-tier — never draw a bad-move dot on it.
    // Seam: consolidate with checkmateWinner() from lib/coach.ts once fix/coach-trainers lands.
    return move.classification === 'brilliant' || move.classification === 'great'
      ? MARKER_FILL[move.classification]!
      : null;
  }
  return MARKER_FILL[move.classification] ?? null;
}

const PHASE_TINT: Record<PhaseName, string> = {
  opening: 'rgba(129, 140, 248, 0.06)',
  middlegame: 'rgba(52, 211, 153, 0.05)',
  endgame: 'rgba(251, 191, 36, 0.06)',
};
const PHASE_LABEL: Record<PhaseName, string> = { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' };

const moveLabel = (ply: number) => `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '…'}`;

const evalString = (ev: EvalPoint | null): string | null => {
  if (!ev) return null;
  return formatScore(ev.mate !== undefined ? { kind: 'mate', value: ev.mate } : { kind: 'cp', value: ev.cp ?? 0 });
};

export function EvalGraphPro({
  moves,
  phases,
  viewPly,
  onSelectPly,
  height,
  sparkline = false,
  criticalMoments,
}: EvalGraphProProps): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverPly, setHoverPly] = useState<number | null>(null);
  const points = useMemo(() => buildGraphPoints(moves), [moves]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return; // jsdom
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (points.length < 2) return null;

  const h = height ?? (sparkline ? 40 : 96);
  const w = width > 0 ? width : 320; // fallback until measured (and in jsdom)
  const n = points.length - 1;
  const xOf = (ply: number) => (ply / n) * w;
  const yOf = (win: number) => ((100 - win) / 100) * h;
  const { line, area } = buildWinPaths(points, w, h);
  const cursorPly = Math.max(0, Math.min(n, viewPly));

  const plyFromEvent = (e: React.MouseEvent): number | null => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return null;
    const frac = (e.clientX - r.left) / r.width;
    return Math.max(0, Math.min(n, Math.round(frac * n)));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onSelectPly(Math.max(0, cursorPly - 1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onSelectPly(Math.min(n, cursorPly + 1));
    }
  };

  const bands = sparkline
    ? []
    : phases
        .filter((p) => p.endPly >= p.startPly && p.startPly <= n)
        .map((p) => {
          const x0 = xOf(Math.max(0, p.startPly - 1));
          const x1 = xOf(Math.min(n, p.endPly));
          return { phase: p.phase, x0, width: x1 - x0 };
        });

  const hovered = !sparkline && hoverPly !== null && hoverPly >= 1 ? moves[hoverPly - 1] ?? null : null;
  const hoveredEval = hovered ? hovered.evalText ?? evalString(hovered.evalAfter) : null;

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Advantage graph — click or use arrow keys to jump to a move"
      aria-valuemin={0}
      aria-valuemax={n}
      aria-valuenow={cursorPly}
      title={sparkline ? 'Click to jump to a move' : undefined}
      onClick={(e) => {
        const ply = plyFromEvent(e);
        if (ply !== null) onSelectPly(ply);
      }}
      onMouseMove={sparkline ? undefined : (e) => setHoverPly(plyFromEvent(e))}
      onMouseLeave={sparkline ? undefined : () => setHoverPly(null)}
      onKeyDown={onKeyDown}
      className="relative w-full cursor-pointer select-none rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400/60"
    >
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height={h} className="block rounded">
        {/* Black's share: the dark background above the white area. */}
        <rect x={0} y={0} width={w} height={h} fill="#141821" />
        {bands.map((b) => (
          <rect key={b.phase} x={b.x0} y={0} width={b.width} height={h} fill={PHASE_TINT[b.phase]} />
        ))}
        {/* White's share of the win chance. */}
        <path d={area} fill="#d8dce4" fillOpacity={0.92} />
        <path d={line} fill="none" stroke="#f4f6f9" strokeWidth={1.25} strokeLinejoin="round" />
        <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke="#3a4150" strokeWidth={1} opacity={0.9} />
        {!sparkline &&
          (criticalMoments ?? [])
            .filter((c) => c.ply >= 1 && c.ply <= n)
            .map((c) => (
              <line
                key={`crit-${c.ply}`}
                data-critical-ply={c.ply}
                x1={xOf(c.ply)}
                y1={0}
                x2={xOf(c.ply)}
                y2={h}
                stroke="rgba(244, 63, 94, 0.3)"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
            ))}
        {bands.map((b, i) => (
          <g key={`edge-${b.phase}`}>
            {i > 0 && <line x1={b.x0} y1={0} x2={b.x0} y2={h} stroke="#4b5563" strokeWidth={1} opacity={0.5} strokeDasharray="3 3" />}
            {b.width >= 56 && (
              <text x={b.x0 + 4} y={10} fontSize={8} fill="#6b7280" style={{ letterSpacing: '0.08em' }}>
                {PHASE_LABEL[b.phase]}
              </text>
            )}
          </g>
        ))}
        {!sparkline &&
          moves.map((m, i) => {
            const fill = markerFill(m);
            if (!fill) return null;
            return (
              <circle
                key={`dot-${i}`}
                data-ply={i + 1}
                data-classification={m.classification}
                cx={Math.max(4, Math.min(w - 4, xOf(i + 1)))}
                cy={yOf(points[i + 1]!.win)}
                r={3}
                fill={fill}
                stroke="#10131a"
                strokeWidth={1}
              />
            );
          })}
        {hoverPly !== null && !sparkline && (
          <g>
            <line x1={xOf(hoverPly)} y1={0} x2={xOf(hoverPly)} y2={h} stroke="#e7e2d6" strokeWidth={1} opacity={0.35} />
            <circle cx={xOf(hoverPly)} cy={yOf(points[hoverPly]!.win)} r={2.5} fill="none" stroke="#e7e2d6" strokeWidth={1} opacity={0.7} />
          </g>
        )}
        <line x1={xOf(cursorPly)} y1={0} x2={xOf(cursorPly)} y2={h} stroke="#34d399" strokeWidth={1.5} />
        <circle cx={xOf(cursorPly)} cy={yOf(points[cursorPly]!.win)} r={2.5} fill="#34d399" />
      </svg>
      {hovered && hoverPly !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-neutral-700 bg-neutral-900/95 px-2 py-1 text-[11px] leading-tight shadow-lg"
          style={{ left: `${Math.max(10, Math.min(90, (hoverPly / n) * 100))}%` }}
        >
          <div className="font-semibold text-ink">
            {moveLabel(hovered.ply)} {hovered.san}
            {hovered.glyph && <span className={`ml-1 ${CLASSIFICATION_META[hovered.classification].text}`}>{hovered.glyph}</span>}
          </div>
          <div className="text-neutral-400">
            {hoveredEval !== null && <span className="mr-1 font-mono">{hoveredEval}</span>}
            {Math.round(points[hoverPly]!.win)}% White
          </div>
        </div>
      )}
    </div>
  );
}
