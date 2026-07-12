import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chess } from 'chess.js';
import type { ExplorerMove } from '@chesser/shared';
import { STARTING_FEN } from '@chesser/shared';
import { Board } from '../board/Board';
import { OpeningExplorer } from '../components/OpeningExplorer';
import { playMoveSound } from '../lib/sound';
import { sanLineToUci } from '../lib/uci';
import { useRepertoire } from '../store/repertoire';
import type { Color } from '../store/game';

interface LineMove {
  san: string;
  from: string;
  to: string;
  fen: string; // position AFTER the move
}

/**
 * Standalone opening explorer: a free board from the standard start position
 * with live continuation stats alongside. Click a stat row (or move a piece)
 * to walk into a line; step back and branch anywhere. The line is linear —
 * branching from an earlier position replaces what came after it, exactly
 * like the Lichess explorer.
 */
export function ExplorerPage({ goAnalyze }: { goAnalyze?: (search: string) => void }) {
  const { t } = useTranslation(['explorer', 'openings']);
  const [line, setLine] = useState<LineMove[]>([]);
  const [ply, setPly] = useState(0); // how many moves of `line` are on the board
  const [orientation, setOrientation] = useState<Color>('white');

  const fen = ply === 0 ? STARTING_FEN : line[ply - 1]!.fen;
  const chess = useMemo(() => new Chess(fen), [fen]);
  const turnColor: Color = chess.turn() === 'w' ? 'white' : 'black';
  const lastMove = ply > 0 ? ([line[ply - 1]!.from, line[ply - 1]!.to] as [string, string]) : undefined;

  const dests = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const m of chess.moves({ verbose: true })) {
      const arr = map.get(m.from) ?? [];
      arr.push(m.to);
      map.set(m.from, arr);
    }
    return map;
  }, [chess]);

  /** Play a move from the viewed position, truncating any tail beyond it. */
  const play = (from: string, to: string, promotion?: string) => {
    const probe = new Chess(fen);
    let mv;
    try {
      mv = probe.move({ from, to, promotion: promotion ?? 'q' });
    } catch {
      return;
    }
    playMoveSound(mv.san);
    setLine((l) => [...l.slice(0, ply), { san: mv.san, from: mv.from, to: mv.to, fen: probe.fen() }]);
    setPly((p) => p + 1);
  };

  const playExplorerMove = (m: ExplorerMove) => {
    play(m.uci.slice(0, 2), m.uci.slice(2, 4), m.uci.length > 4 ? m.uci[4] : undefined);
  };

  // Keyboard navigation, matching the Play page's bindings.
  const plyRef = useRef({ ply, len: line.length });
  plyRef.current = { ply, len: line.length };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const { ply: p, len } = plyRef.current;
      if (e.key === 'ArrowLeft') setPly(Math.max(0, p - 1));
      else if (e.key === 'ArrowRight') setPly(Math.min(len, p + 1));
      else if (e.key === 'Home') setPly(0);
      else if (e.key === 'End') setPly(len);
      else if (e.key === 'f' || e.key === 'F') setOrientation((o) => (o === 'white' ? 'black' : 'white'));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pathSan = useMemo(() => line.slice(0, ply).map((m) => m.san), [line, ply]);

  // Hand the explored line to the analysis board on the Play tab as a
  // shareable one-shot deep link (`?moves=` per the analyze-handoff
  // contract): the /play/analysis route parses, loads and consumes the
  // params — no direct game-store call here. The line always starts from
  // the standard start position, so the `moves` form always applies.
  const analyze = () => {
    if (pathSan.length === 0 || !goAnalyze) return;
    const ucis = sanLineToUci(pathSan);
    if (!ucis || ucis.length === 0) return;
    goAnalyze(`?${new URLSearchParams({ moves: ucis.join(',') }).toString()}`);
  };

  // Save-to-repertoire: the explored line always starts from the standard
  // start position, so any row can become a repertoire line (same mechanics
  // as the analysis board's explorer panel).
  const user = useRepertoire((s) => s.user);
  const addLine = useRepertoire((s) => s.addLine);
  const createRepertoire = useRepertoire((s) => s.createRepertoire);
  const [target, setTarget] = useState('');
  useEffect(() => {
    if (!target && user[0]) setTarget(user[0].id);
  }, [user, target]);

  const saveMove = (m: ExplorerMove) => {
    const moves = [...pathSan, m.san];
    let repId = user.some((r) => r.id === target) ? target : '';
    if (!repId) repId = createRepertoire(t('openings:myRepertoire'));
    let name = '';
    for (let i = 0; i < moves.length; i++) name += (i % 2 === 0 ? `${i / 2 + 1}.` : '') + moves[i] + ' ';
    addLine(repId, { name: name.trim(), side: turnColor, moves });
    setTarget(repId);
  };

  const btn =
    'btn-press min-h-11 min-w-11 rounded-full bg-neutral-800 px-3 py-1.5 text-sm font-semibold text-neutral-200 hover:bg-neutral-700 disabled:opacity-50 sm:min-h-0 sm:min-w-0';

  return (
    <div className="mx-auto grid w-full max-w-[1100px] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-3">
        <div className="mx-auto w-full max-w-[560px]">
          <Board
            fen={fen}
            orientation={orientation}
            turnColor={turnColor}
            movableColor="both"
            dests={dests}
            lastMove={lastMove}
            inCheck={chess.inCheck()}
            onMove={play}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button className={btn} onClick={() => setPly(0)} disabled={ply === 0} title={t('page.firstTitle')} aria-label={t('page.first')}>
            ⏮
          </button>
          <button
            className={btn}
            onClick={() => setPly((p) => Math.max(0, p - 1))}
            disabled={ply === 0}
            title={t('page.previousTitle')}
            aria-label={t('page.previous')}
          >
            ◀
          </button>
          <button
            className={btn}
            onClick={() => setPly((p) => Math.min(line.length, p + 1))}
            disabled={ply === line.length}
            title={t('page.nextTitle')}
            aria-label={t('page.next')}
          >
            ▶
          </button>
          <button
            className={btn}
            onClick={() => setPly(line.length)}
            disabled={ply === line.length}
            title={t('page.lastTitle')}
            aria-label={t('page.last')}
          >
            ⏭
          </button>
          <div className="mx-1 h-5 w-px bg-neutral-700" />
          <button className={btn} onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} title={t('page.flipTitle')}>
            {t('page.flip')}
          </button>
          <button
            className={btn}
            onClick={() => {
              setLine([]);
              setPly(0);
            }}
            disabled={line.length === 0}
            title={t('page.resetTitle')}
          >
            {t('page.reset')}
          </button>
          {goAnalyze && (
            // The explore view's primary CTA — the screen's one accent element.
            <button
              className="btn-press min-h-11 rounded-full bg-gradient-to-br from-brand-600 to-brand-700 px-4 py-1.5 text-sm font-bold text-white hover:from-brand-500 hover:to-brand-600 disabled:opacity-50"
              onClick={analyze}
              disabled={pathSan.length === 0}
              title={t('page.analyseTitle')}
            >
              {t('page.analyse')}
            </button>
          )}
        </div>

        <div className="rounded-2xl bg-panel p-3 shadow-soft">
          <h3 className="mb-1.5 text-sm font-semibold text-ink">{t('page.lineTitle')}</h3>
          {line.length === 0 ? (
            <p className="text-xs text-neutral-400">{t('page.lineEmpty')}</p>
          ) : (
            <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm" aria-label={t('page.movesAria')}>
              <li>
                <button
                  onClick={() => setPly(0)}
                  aria-current={ply === 0 ? 'step' : undefined}
                  className={`rounded px-1.5 py-0.5 font-mono text-xs ${ply === 0 ? 'bg-brand-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}
                >
                  {t('page.start')}
                </button>
              </li>
              {line.map((m, i) => (
                <li key={`${i}-${m.san}`} className="flex items-center gap-1">
                  {i % 2 === 0 && <span className="text-xs text-neutral-400">{i / 2 + 1}.</span>}
                  <button
                    onClick={() => setPly(i + 1)}
                    aria-current={ply === i + 1 ? 'step' : undefined}
                    className={`rounded px-1.5 py-0.5 font-mono ${
                      ply === i + 1 ? 'bg-brand-600 text-white' : 'text-neutral-200 hover:bg-neutral-800'
                    }`}
                  >
                    {m.san}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <OpeningExplorer fen={fen} pathSan={pathSan} onPlayMove={playExplorerMove} onSaveToRepertoire={saveMove}>
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
        </OpeningExplorer>
      </div>
    </div>
  );
}
