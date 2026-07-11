import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useGame, type MoveNode } from '../store/game';
import { CLASSIFICATION_META } from '../lib/coach';

const GLYPH: Record<string, { mark: string; cls: string }> = {
  blunder: { mark: '??', cls: 'text-rose-400' },
  mistake: { mark: '?', cls: 'text-orange-400' },
  inaccuracy: { mark: '?!', cls: 'text-amber-300' },
};

const num = (ply: number) => `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '. ' : '… '}`;

/** Is `id` on the main line (root → tip via children[0])? */
function isMainline(tree: Record<string, MoveNode>, rootId: string, id: string): boolean {
  let n = tree[rootId];
  while (n && n.children[0]) {
    if (n.children[0] === id) return true;
    n = tree[n.children[0]];
  }
  return false;
}

export function MoveList() {
  const { t } = useTranslation('game');
  const tree = useGame((s) => s.tree);
  const rootId = useGame((s) => s.rootId);
  const currentId = useGame((s) => s.currentId);
  const annotations = useGame((s) => s.annotations);
  const moveReviews = useGame((s) => s.moveReviews);
  const goToNode = useGame((s) => s.goToNode);
  const promote = useGame((s) => s.promote);
  const deleteVariation = useGame((s) => s.deleteVariation);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the active move visible by scrolling ONLY the list itself — never
  // scrollIntoView(), which also scrolls every scrollable ancestor (including
  // the document), yanking the whole page down on each move whenever this
  // panel sits below the fold while stepping through a review.
  useEffect(() => {
    const list = scrollRef.current;
    const active = list?.querySelector<HTMLElement>('[data-current="true"]');
    if (!list || !active) return;
    const listRect = list.getBoundingClientRect();
    const rect = active.getBoundingClientRect();
    if (rect.top < listRect.top) list.scrollTop += rect.top - listRect.top;
    else if (rect.bottom > listRect.bottom) list.scrollTop += rect.bottom - listRect.bottom;
  }, [currentId, tree]);

  const Move = ({ node, withNumber }: { node: MoveNode; withNumber: boolean }) => {
    const isWhite = node.ply % 2 === 1;
    // Prefer the rich grade (shows !! / ! / × too); fall back to the basic glyph.
    const cls = moveReviews[node.id]?.classification;
    const meta = cls ? CLASSIFICATION_META[cls] : null;
    const mark = meta?.glyph || GLYPH[annotations[node.id] ?? '']?.mark;
    const markCls = meta?.text ?? GLYPH[annotations[node.id] ?? '']?.cls;
    const current = currentId === node.id;
    return (
      <button
        data-current={current}
        aria-current={current ? 'step' : undefined}
        onClick={() => goToNode(node.id)}
        className={`rounded px-1 py-0.5 font-mono text-sm ${
          current ? 'bg-emerald-700 text-white' : 'text-neutral-200 hover:bg-neutral-700'
        }`}
      >
        {(withNumber || isWhite) && <span className={current ? 'text-emerald-100' : 'text-neutral-400'}>{num(node.ply)}</span>}
        {node.san}
        {mark && <span className={`ml-0.5 ${current ? 'text-white' : markCls}`}>{mark}</span>}
      </button>
    );
  };

  // Render the continuation after `from` along the main line, with any
  // variations inlined right after the move they replace.
  const Continuation = ({ from }: { from: MoveNode }): ReactNode => {
    const out: ReactNode[] = [];
    let parent = from;
    let afterBranch = false; // a black move needs its number after a variation block
    while (parent.children[0]) {
      const main = tree[parent.children[0]];
      if (!main) break;
      out.push(<Move key={main.id} node={main} withNumber={afterBranch} />);
      afterBranch = false;
      const sibs = parent.children.slice(1);
      for (const sid of sibs) {
        out.push(<Variation key={`v-${sid}`} startId={sid} />);
        afterBranch = true;
      }
      parent = main;
    }
    return <>{out}</>;
  };

  const Variation = ({ startId }: { startId: string }): ReactNode => {
    const v = tree[startId];
    if (!v) return null;
    return (
      <span role="group" aria-label={t('moveList.variation')} className="my-0.5 block rounded border-l-2 border-neutral-700 pl-2 text-neutral-400">
        <span className="text-neutral-400">(</span>
        <Move node={v} withNumber />
        <Continuation from={v} />
        <span className="text-neutral-400">)</span>
      </span>
    );
  };

  const hasMoves = !!tree[rootId]?.children.length;
  const onVariation = currentId !== rootId && !isMainline(tree, rootId, currentId);

  return (
    <div className="rounded-lg bg-panelmute p-1">
      {onVariation && (
        <div className="mb-1 flex items-center justify-end gap-1 px-1">
          <button
            onClick={() => promote(currentId)}
            title={t('moveList.promoteTitle')}
            className="min-h-11 rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-600 sm:min-h-0"
          >
            ⤴ {t('moveList.promote')}
          </button>
          <button
            onClick={() => deleteVariation(currentId)}
            title={t('moveList.deleteTitle')}
            className="min-h-11 rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-rose-900/60 hover:text-rose-200 sm:min-h-0"
          >
            🗑 {t('moveList.delete')}
          </button>
        </div>
      )}
      <div ref={scrollRef} role="region" aria-label={t('moveList.moves')} className="scroll-thin max-h-56 overflow-y-auto px-1 leading-7">
        {!hasMoves ? (
          <p className="p-2 text-xs text-neutral-400">{t('moveList.empty')}</p>
        ) : (
          <Continuation from={tree[rootId]!} />
        )}
      </div>
    </div>
  );
}
