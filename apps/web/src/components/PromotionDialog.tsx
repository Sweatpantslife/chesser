import { useGame } from '../store/game';
import { Modal } from './Modal';

const GLYPHS: Record<'white' | 'black', Record<'q' | 'r' | 'b' | 'n', string>> = {
  white: { q: '♕', r: '♖', b: '♗', n: '♘' },
  black: { q: '♛', r: '♜', b: '♝', n: '♞' },
};

const PIECE_NAME: Record<'q' | 'r' | 'b' | 'n', string> = {
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
};

export function PromotionDialog() {
  const { pendingPromotion, turnColor, finalizePromotion, cancelPromotion } = useGame();
  if (!pendingPromotion) return null;
  const glyphs = GLYPHS[turnColor];

  return (
    <Modal
      // Escape / backdrop click cancel the pending promotion move.
      onClose={cancelPromotion}
      label="Choose promotion piece"
      overlayClassName="absolute inset-0 z-20 flex items-center justify-center bg-black/60"
      className="flex gap-2 rounded-xl bg-panel p-3 shadow-2xl"
    >
      {(['q', 'r', 'b', 'n'] as const).map((p) => (
        <button
          key={p}
          onClick={() => finalizePromotion(p)}
          aria-label={`Promote to ${PIECE_NAME[p]}`}
          className="flex h-16 w-16 items-center justify-center rounded-lg bg-neutral-700 text-5xl leading-none text-neutral-50 hover:bg-emerald-600"
        >
          {glyphs[p]}
        </button>
      ))}
    </Modal>
  );
}
