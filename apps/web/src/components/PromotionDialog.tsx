import { useTranslation } from 'react-i18next';
import { useGame } from '../store/game';
import { Modal } from './Modal';

const GLYPHS: Record<'white' | 'black', Record<'q' | 'r' | 'b' | 'n', string>> = {
  white: { q: '♕', r: '♖', b: '♗', n: '♘' },
  black: { q: '♛', r: '♜', b: '♝', n: '♞' },
};

export function PromotionDialog() {
  const { t } = useTranslation('game');
  const { pendingPromotion, turnColor, finalizePromotion, cancelPromotion } = useGame();
  if (!pendingPromotion) return null;
  const glyphs = GLYPHS[turnColor];

  return (
    <Modal
      // Escape / backdrop click cancel the pending promotion move.
      onClose={cancelPromotion}
      label={t('promotion.chooseTitle')}
      overlayClassName="absolute inset-0 z-20 flex items-center justify-center bg-black/60"
      className="flex gap-2 rounded-xl bg-panel p-3 shadow-2xl"
    >
      {(['q', 'r', 'b', 'n'] as const).map((p) => (
        <button
          key={p}
          onClick={() => finalizePromotion(p)}
          aria-label={t('promotion.promoteTo', { piece: t(`promotion.pieces.${p}`) })}
          className="flex h-16 w-16 items-center justify-center rounded-lg bg-neutral-700 text-5xl leading-none text-neutral-50 hover:bg-emerald-700"
        >
          {glyphs[p]}
        </button>
      ))}
    </Modal>
  );
}
