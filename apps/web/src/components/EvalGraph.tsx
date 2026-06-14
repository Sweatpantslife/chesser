import { useRef } from 'react';
import { useGame } from '../store/game';

/** A win-probability sparkline over the reviewed game. Click to jump to a ply. */
export function EvalGraph() {
  const data = useGame((s) => s.evalGraph);
  const viewPly = useGame((s) => s.viewPly);
  const goToPly = useGame((s) => s.goToPly);
  const ref = useRef<HTMLDivElement>(null);

  if (data.length < 2) return null;
  const W = data.length - 1;
  const line = data.map((w, i) => `${i},${100 - w}`).join(' ');
  const area = `0,100 ${line} ${W},100`;

  const onClick = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const frac = (e.clientX - r.left) / r.width;
    goToPly(Math.max(0, Math.min(W, Math.round(frac * W))));
  };

  return (
    <div ref={ref} onClick={onClick} className="cursor-pointer" title="Click to jump to a move">
      <svg viewBox={`0 0 ${W} 100`} preserveAspectRatio="none" className="h-12 w-full rounded">
        <rect x={0} y={0} width={W} height={50} fill="#20242e" />
        <rect x={0} y={50} width={W} height={50} fill="#10131a" />
        <polygon points={area} fill="#34d39922" />
        <line x1={0} y1={50} x2={W} y2={50} stroke="#3a4150" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
        <polyline points={line} fill="none" stroke="#34d399" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
        <line x1={viewPly} y1={0} x2={viewPly} y2={100} stroke="#e7e2d6" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
