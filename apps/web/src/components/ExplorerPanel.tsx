import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExplorerMove } from '@chesser/shared';
import { STARTING_FEN } from '@chesser/shared';
import { OpeningExplorer } from './OpeningExplorer';
import { useGame } from '../store/game';
import { useRepertoire } from '../store/repertoire';

export interface ExplorerPanelProps {
  /** Fetch gate for the collapsible drawer. Default true.
   *  false = render (or stay mounted) without ANY network activity;
   *  flipping to true fetches the CURRENT store position immediately. */
  active?: boolean;
  /** Chrome density. Default 'full' (today's render, verbatim).
   *  'embedded': suppress the internal <section aria-label> + h3 title and
   *  the bg-panel/padding wrapper — the drawer supplies the heading and
   *  surface. Stats, filters, save UI unchanged. */
  variant?: 'full' | 'embedded';
}

/**
 * The opening explorer wired to the analysis board (Play page): rows play
 * moves onto the board via the game store, and — in analysis mode, from the
 * standard start — each row can also be saved into a repertoire.
 */
export function ExplorerPanel({ active = true, variant = 'full' }: ExplorerPanelProps = {}) {
  const { t } = useTranslation('explorer');
  const fen = useGame((s) => s.fen);
  const mode = useGame((s) => s.mode);
  const history = useGame((s) => s.history);
  const viewPly = useGame((s) => s.viewPly);
  const startFen = useGame((s) => s.startFen);
  const turnColor = useGame((s) => s.turnColor);
  const exploreMove = useGame((s) => s.exploreMove);

  const user = useRepertoire((s) => s.user);
  const addLine = useRepertoire((s) => s.addLine);
  const createRepertoire = useRepertoire((s) => s.createRepertoire);

  const [target, setTarget] = useState<string>('');
  const [added, setAdded] = useState<string | null>(null);

  useEffect(() => {
    if (!target && user[0]) setTarget(user[0].id);
  }, [user, target]);

  const pathSan = useMemo(() => history.slice(0, viewPly).map((h) => h.san), [history, viewPly]);
  const fromStart = startFen === STARTING_FEN;
  const canSave = mode === 'analysis' && fromStart; // repertoire lines start from the initial position

  const saveMove = (m: ExplorerMove) => {
    const moves = [...pathSan, m.san];
    let repId = target || user.find((r) => r.id === target)?.id || '';
    if (!repId) repId = createRepertoire(t('openings:myRepertoire'));
    let name = '';
    for (let i = 0; i < moves.length; i++) name += (i % 2 === 0 ? `${i / 2 + 1}.` : '') + moves[i] + ' ';
    addLine(repId, { name: name.trim(), side: turnColor, moves });
    setTarget(repId);
    setAdded(m.uci);
    setTimeout(() => setAdded((a) => (a === m.uci ? null : a)), 1200);
  };

  return (
    <OpeningExplorer
      fen={fen}
      pathSan={fromStart ? pathSan : null}
      active={active}
      variant={variant}
      onPlayMove={mode === 'analysis' ? (m) => exploreMove(m.uci) : undefined}
      moveAction={
        canSave
          ? (m) => (
              <button
                onClick={() => saveMove(m)}
                title={t('save.saveTitle')}
                aria-label={t('save.saveAria', { san: m.san })}
                className={`shrink-0 rounded px-1.5 py-1 text-xs ${added === m.uci ? 'text-emerald-400' : 'text-neutral-400 hover:bg-neutral-700 hover:text-emerald-300'}`}
              >
                {added === m.uci ? '✓' : '＋'}
              </button>
            )
          : undefined
      }
    >
      {canSave && (
        <div className="mb-2 flex items-center gap-1 text-xs text-neutral-400">
          <span className="shrink-0">{t('save.addTo')}</span>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label={t('save.targetAria')}
            className="min-w-0 flex-1 rounded bg-neutral-800 px-1 py-0.5 text-xs text-ink outline-none"
          >
            {user.length === 0 && <option value="">{t('save.newRepOption')}</option>}
            {user.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </OpeningExplorer>
  );
}
