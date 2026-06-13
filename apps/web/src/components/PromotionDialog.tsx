import { useGame } from '../store/game';

const GLYPHS: Record<'white' | 'black', Record<'q' | 'r' | 'b' | 'n', string>> = {
  white: { q: '♕', r: '♖', b: '♗', n: '♘' },
  black: { q: '♛', r: '♜', b: '♝', n: '♞' },
};

export function PromotionDialog() {
  const { pendingPromotion, turnColor, finalizePromotion, cancelPromotion } = useGame();
  if (!pendingPromotion) return null;
  const glyphs = GLYPHS[turnColor];

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/60"
      onClick={cancelPromotion}
    >
      <div
        className="flex gap-2 rounded-xl bg-panel p-3 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {(['q', 'r', 'b', 'n'] as const).map((p) => (
          <button
            key={p}
            onClick={() => finalizePromotion(p)}
            className="flex h-16 w-16 items-center justify-center rounded-lg bg-neutral-700 text-5xl leading-none text-neutral-50 hover:bg-emerald-600"
          >
            {glyphs[p]}
          </button>
        ))}
      </div>
    </div>
  );
}
