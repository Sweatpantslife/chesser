import type { Color } from '../store/game';

const GLYPHS: Record<Color, Record<'q' | 'r' | 'b' | 'n', string>> = {
  white: { q: '♕', r: '♖', b: '♗', n: '♘' },
  black: { q: '♛', r: '♜', b: '♝', n: '♞' },
};

/**
 * Standalone promotion picker for the human-vs-human boards (the existing
 * PromotionDialog is bound to the vs-bot game store). Rendered inside the
 * board's relative wrapper.
 */
export function Promotion({
  color,
  onPick,
  onCancel,
}: {
  color: Color;
  onPick: (piece: 'q' | 'r' | 'b' | 'n') => void;
  onCancel: () => void;
}) {
  const glyphs = GLYPHS[color];
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div className="flex gap-2 rounded-xl bg-panel p-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {(['q', 'r', 'b', 'n'] as const).map((p) => (
          <button
            key={p}
            data-testid={`promote-${p}`}
            onClick={() => onPick(p)}
            className="flex h-16 w-16 items-center justify-center rounded-lg bg-neutral-700 text-5xl leading-none text-neutral-50 hover:bg-emerald-600"
          >
            {glyphs[p]}
          </button>
        ))}
      </div>
    </div>
  );
}
