import { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Chess } from 'chess.js';
import type { TablebaseResult } from '@chesser/shared';
import { Board } from '../board/Board';
import { ReviewStats } from '../components/ReviewStats';
import { engine } from '../lib/engine';
import { fetchTablebase, categoryLabel, judgeMove } from '../lib/tablebase';
import { playMoveSound } from '../lib/sound';
import { ENDGAME_DRILLS, ENDGAME_DRILL_IDS, type EndgameDrill } from '../trainers/endgameDrills';
import { useProgress } from '../store/progress';
import { recordReview } from '../lib/gamify';
import { dueLabel } from '../lib/srs';
import { dueDisplayLabel } from '../lib/srsText';
import type { Color } from '../store/game';

type Phase = 'playing' | 'won' | 'held' | 'slipped';

const HOLD_PLIES = 20; // plies to survive before a draw drill counts as held online

/** Men on the board — positions with more than 7 are outside tablebase coverage. */
const pieceCount = (fen: string) => fen.split(' ')[0]!.replace(/[^a-zA-Z]/g, '').length;

/** True when `color` has nothing left but the bare king. */
const bareKing = (game: Chess, color: 'w' | 'b') =>
  game
    .board()
    .flat()
    .filter((p) => p && p.color === color).length === 1;

export function EndgameDrillsPage() {
  const { t } = useTranslation('train');
  const game = useRef(new Chess());
  const gameId = useRef(0);
  // Tablebase data tagged with the exact position it describes — judging a
  // played move must never use a stale snapshot (see EndgamePage).
  const tbFor = useRef<{ fen: string; res: TablebaseResult } | null>(null);
  // Plies of the bundled book line matched so far; -1 once play left the line.
  const pvAt = useRef(0);
  const recorded = useRef(false);

  const [drill, setDrill] = useState<EndgameDrill>(ENDGAME_DRILLS[0]!);
  const [phase, setPhase] = useState<Phase>('playing');
  const [fen, setFen] = useState(game.current.fen());
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [syncKey, setSyncKey] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [tb, setTb] = useState<TablebaseResult | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [hinted, setHinted] = useState(false);
  const [solvedCount, setSolvedCount] = useState(0);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'good' | 'bad' | 'info'; text: string } | null>(null);

  const grade = useProgress((s) => s.grade);
  const dueIds = useProgress((s) => s.dueIds);
  const cards = useProgress((s) => s.cards);

  const youChar = drill.youPlay === 'white' ? 'w' : 'b';
  const yourTurn = phase === 'playing' && !thinking && game.current.turn() === youChar;
  // A "bare defending king" only counts as a win when the defender started with more.
  const defenderStartsWithMaterial = useMemo(() => {
    const defChar = drill.youPlay === 'white' ? 'b' : 'w';
    return !bareKing(new Chess(drill.fen), defChar);
  }, [drill]);

  const sync = () => {
    const hist = game.current.history({ verbose: true });
    const last = hist[hist.length - 1];
    setFen(game.current.fen());
    setLastMove(last ? [last.from, last.to] : undefined);
  };

  // Keep tablebase data in sync with the current position (best-effort).
  useEffect(() => {
    let cancelled = false;
    // Never show an eval that describes a *previous* position — after the
    // defender replies it would read from the wrong side's perspective
    // ("loss, mated in N") until the fresh probe lands.
    if (tbFor.current?.fen !== fen) setTb(null);
    if (pieceCount(fen) > 7 || phase !== 'playing') {
      setTb(null);
      return;
    }
    fetchTablebase(fen).then((r) => {
      if (cancelled) return;
      setTb(r.available ? r : null);
      tbFor.current = r.available ? { fen, res: r } : null;
    });
    return () => {
      cancelled = true;
    };
  }, [fen, phase]);

  const finish = (p: Phase) => {
    setPhase(p);
    if (recorded.current) return;
    recorded.current = true;
    if (p === 'won' || p === 'held') {
      const g = mistakes >= 3 ? 'again' : mistakes >= 1 || hinted ? 'hard' : 'good';
      grade('endgames', drill.id, g);
      recordReview(g !== 'again');
      setSolvedCount((n) => n + 1);
    } else {
      grade('endgames', drill.id, 'again');
      recordReview(false);
    }
  };

  /** Terminal check after any accepted move. Returns true when the drill ended. */
  const settleOutcome = (byPlayer: boolean, promoted: boolean): boolean => {
    const g = game.current;
    if (g.isCheckmate()) {
      // The side that just moved delivered mate. Mating while defending a draw
      // still completes the drill — you did strictly better than the goal.
      finish(byPlayer ? (drill.goal === 'win' ? 'won' : 'held') : 'slipped');
      return true;
    }
    if (g.isStalemate() || g.isInsufficientMaterial() || g.isDraw()) {
      finish(drill.goal === 'draw' ? 'held' : 'slipped');
      return true;
    }
    if (drill.goal === 'win' && byPlayer && promoted) {
      finish('won');
      return true;
    }
    if (drill.goal === 'win' && defenderStartsWithMaterial && bareKing(g, drill.youPlay === 'white' ? 'b' : 'w')) {
      finish('won');
      return true;
    }
    if (drill.goal === 'draw') {
      if (pvAt.current === drill.solution.length || g.history().length >= HOLD_PLIES) {
        finish('held');
        return true;
      }
    }
    return false;
  };

  /** Defender reply: tablebase-best, else the book line, else engine, else any move. */
  const askDefender = async () => {
    if (game.current.isGameOver() || game.current.turn() === youChar || phase !== 'playing') return;
    const id = gameId.current;
    setThinking(true);
    const fenNow = game.current.fen();
    let uci: string | null = null;
    if (pieceCount(fenNow) <= 7) {
      const t = await fetchTablebase(fenNow);
      if (gameId.current !== id) return;
      const best = t.available ? t.moves?.[0] : undefined;
      if (best) uci = best.uci;
    }
    let bookSan: string | null = null;
    if (!uci && pvAt.current >= 0) bookSan = drill.solution[pvAt.current] ?? null;
    if (!uci && !bookSan) {
      try {
        const res = await engine.botMove(fenNow, { style: 'balanced', elo: 3190, moveTimeMs: 500 });
        uci = res.uci;
      } catch {
        /* fall through to any legal move */
      }
      if (gameId.current !== id) return;
    }
    let mv;
    try {
      mv = bookSan
        ? game.current.move(bookSan)
        : uci
          ? game.current.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
          : game.current.move(game.current.moves()[0]!);
    } catch {
      mv = game.current.move(game.current.moves()[0]!);
    }
    if (gameId.current !== id) return;
    if (mv) playMoveSound(mv.san);
    // keep the book-line cursor in step with the defender's actual reply
    if (pvAt.current >= 0 && mv && drill.solution[pvAt.current] === mv.san) pvAt.current += 1;
    else pvAt.current = -1;
    setThinking(false);
    sync();
    settleOutcome(false, false);
  };

  const load = (d: EndgameDrill) => {
    gameId.current += 1;
    game.current = new Chess(d.fen);
    tbFor.current = null;
    pvAt.current = 0;
    recorded.current = false;
    setDrill(d);
    setPhase('playing');
    setThinking(false);
    setTb(null);
    setMistakes(0);
    setHinted(false);
    setFeedback({
      kind: 'info',
      text:
        d.goal === 'win'
          ? t('endgameDrills.introWin', { color: t(`colorsUpper.${d.youPlay}`) })
          : t('endgameDrills.introDraw', { color: t(`colorsUpper.${d.youPlay}`) }),
    });
    setFen(game.current.fen());
    setLastMove(undefined);
  };

  useEffect(() => {
    load(ENDGAME_DRILLS[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dests = useMemo(() => {
    const map = new Map<string, string[]>();
    if (yourTurn) {
      for (const m of game.current.moves({ verbose: true })) {
        const arr = map.get(m.from) ?? [];
        arr.push(m.to);
        map.set(m.from, arr);
      }
    }
    return map;
  }, [fen, yourTurn]);

  const onMove = (from: string, to: string) => {
    if (!yourTurn) return;
    const preFen = game.current.fen();
    let mv;
    try {
      mv = game.current.move({ from, to, promotion: 'q' });
    } catch {
      return;
    }
    const uci = from + to + (mv.promotion ?? '');
    const before = tbFor.current?.fen === preFen && tbFor.current.res.available ? tbFor.current.res : null;
    const verdict = before ? judgeMove(before, uci, drill.goal) : null;

    if (verdict) {
      if (verdict.kind === 'bad') {
        // Take the move back so the drill is always about finding the right plan.
        game.current.undo();
        setMistakes((n) => n + 1);
        const best = before!.moves?.[0];
        setFeedback({
          kind: 'bad',
          text: t('endgameDrills.bestWas', { verdict: verdict.text, san: best?.san ?? '—' }),
        });
        setSyncKey((k) => k + 1);
        return;
      }
      setFeedback({ kind: verdict.kind, text: t('endgameDrills.tbSuffix', { verdict: verdict.text }) });
      if (pvAt.current >= 0 && drill.solution[pvAt.current] === mv.san) pvAt.current += 1;
      else pvAt.current = -1;
    } else if (pvAt.current >= 0) {
      // No tablebase for this position (offline or >7 men) — enforce the book line.
      const expected = drill.solution[pvAt.current];
      if (expected && mv.san !== expected) {
        game.current.undo();
        setMistakes((n) => n + 1);
        setFeedback({
          kind: 'bad',
          text: t('endgameDrills.offlineBook', { san: expected }),
        });
        setSyncKey((k) => k + 1);
        return;
      }
      pvAt.current += 1;
      setFeedback({ kind: 'good', text: t('endgameDrills.bookMove', { san: mv.san }) });
    } else {
      // Off the book line with no tablebase: accept, but say we can't judge it.
      setFeedback({ kind: 'info', text: t('endgameDrills.unverified', { san: mv.san }) });
    }

    playMoveSound(mv.san);
    sync();
    if (settleOutcome(true, !!mv.promotion)) return;
    askDefender();
  };

  const hint = () => {
    if (!yourTurn) return;
    setHinted(true);
    const cur = tbFor.current?.fen === game.current.fen() && tbFor.current.res.available ? tbFor.current.res : null;
    const best = cur?.moves?.[0]?.san ?? (pvAt.current >= 0 ? drill.solution[pvAt.current] : undefined);
    setFeedback(
      best
        ? { kind: 'info', text: cur ? t('endgameDrills.hintTb', { san: best }) : t('endgameDrills.hintBook', { san: best }) }
        : { kind: 'info', text: t('endgameDrills.noHint') },
    );
  };

  const next = () => {
    const i = ENDGAME_DRILLS.findIndex((d) => d.id === drill.id);
    load(ENDGAME_DRILLS[(i + 1) % ENDGAME_DRILLS.length]!);
  };

  const reviewDue = () => {
    const due = dueIds('endgames', ENDGAME_DRILL_IDS);
    if (due.length === 0) {
      setFeedback({ kind: 'info', text: t('endgameDrills.noDue') });
      return;
    }
    const d = ENDGAME_DRILLS.find((x) => x.id === due[0]);
    if (d) load(d);
  };

  const status = useMemo(() => {
    if (phase === 'won') return { text: t('endgameDrills.status.won'), cls: 'text-emerald-300 font-semibold' };
    if (phase === 'held') return { text: t('endgameDrills.status.held'), cls: 'text-emerald-300 font-semibold' };
    if (phase === 'slipped')
      return {
        text: drill.goal === 'win' ? t('endgameDrills.status.slippedWin') : t('endgameDrills.status.slippedDraw'),
        cls: 'text-rose-300 font-semibold',
      };
    if (thinking) return { text: t('endgameDrills.status.thinking'), cls: 'text-neutral-300' };
    if (tb?.available) return { text: categoryLabel(tb.category, tb.dtm), cls: 'text-sky-300' };
    return { text: t('endgameDrills.status.offline'), cls: 'text-neutral-300' };
  }, [phase, thinking, tb, drill.goal, t]);

  const orientation: Color = drill.youPlay;

  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
      {/* drill list */}
      <div className="order-2 space-y-3 lg:order-1">
        <div className="rounded-2xl bg-panel shadow-soft p-3">
          <h3 className="mb-1 text-sm font-semibold text-ink">{t('endgameDrills.title')}</h3>
          <p className="mb-2 text-xs text-neutral-400">{t('endgameDrills.blurb')}</p>
          <ReviewStats deck="endgames" ids={ENDGAME_DRILL_IDS} />
          <button
            onClick={reviewDue}
            className="btn-press mt-3 min-h-11 w-full rounded bg-emerald-700 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 sm:min-h-0"
          >
            {t('buttons.reviewDue')}
          </button>
        </div>
        <div className="scroll-thin max-h-[60vh] space-y-1 overflow-y-auto rounded-2xl bg-panel shadow-soft p-3">
          {ENDGAME_DRILLS.map((d) => {
            const active = d.id === drill.id;
            const cd = dueLabel((cards[`endgames:${d.id}`] ?? { last: 0, due: 0 }) as never);
            return (
              <button
                key={d.id}
                onClick={() => load(d)}
                aria-current={active ? 'true' : undefined}
                className={`flex min-h-11 w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs sm:min-h-0 ${
                  active ? 'bg-brand-600 text-white' : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'
                }`}
              >
                <span className="truncate">{d.name}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className={`text-xs uppercase ${active ? 'text-emerald-100' : 'text-neutral-300'}`}>
                    {t(`endgame.goal.${d.goal}`)}
                  </span>
                  <span className={`text-xs ${cd === 'due' ? (active ? 'text-amber-100' : 'text-gold-300') : active ? 'text-emerald-100' : 'text-neutral-300'}`}>
                    {dueDisplayLabel(cd)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* board */}
      <div className="order-1 space-y-3 lg:order-2">
        <div className="flex min-h-7 flex-wrap items-center gap-2 text-sm">
          <span className="rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-200">{drill.technique}</span>
          <span className={status.cls}>{status.text}</span>
        </div>
        <div className="mx-auto w-full max-w-[540px]">
          <Board
            fen={fen}
            orientation={orientation}
            turnColor={game.current.turn() === 'w' ? 'white' : 'black'}
            movableColor={yourTurn ? drill.youPlay : undefined}
            dests={dests}
            lastMove={lastMove}
            inCheck={game.current.inCheck()}
            onMove={onMove}
            syncKey={syncKey}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => load(drill)}
            className="btn-press min-h-11 rounded bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 sm:min-h-0"
          >
            {t('buttons.restart')}
          </button>
          {phase === 'playing' && (
            <button
              onClick={hint}
              className="btn-press min-h-11 rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600 sm:min-h-0"
            >
              {t('buttons.hint')}
            </button>
          )}
          <button
            onClick={next}
            className="btn-press min-h-11 rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600 sm:min-h-0"
          >
            {t('buttons.nextDrillArrow')}
          </button>
        </div>
      </div>

      {/* lesson */}
      <div className="order-3 space-y-3">
        <div className="rounded-2xl bg-panel shadow-soft p-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-sm">
            <h4 className="font-semibold text-ink">{drill.name}</h4>
            <span className="shrink-0 text-xs text-neutral-400">{t('endgameDrills.doneSession', { count: solvedCount })}</span>
          </div>
          <p className="mb-2 text-xs text-neutral-400">
            <Trans
              t={t}
              i18nKey="endgameDrills.youPlayGoal"
              values={{ color: t(`colors.${drill.youPlay}`), goal: t(`endgameDrills.goalLong.${drill.goal}`) }}
              components={{
                color: <b className="capitalize text-neutral-200" />,
                goal: <b className="text-neutral-200" />,
              }}
            />
          </p>
          {feedback && (
            <p
              role="status"
              aria-live="polite"
              className={`mb-2 text-sm ${
                feedback.kind === 'bad'
                  ? 'text-rose-300'
                  : feedback.kind === 'good'
                    ? 'text-emerald-300'
                    : feedback.kind === 'ok'
                      ? 'text-amber-300'
                      : 'text-neutral-300'
              }`}
            >
              {feedback.text}
            </p>
          )}
          <p className="text-xs leading-snug text-neutral-400">{drill.lesson}</p>
          <p className="mt-2 font-mono text-xs text-neutral-400">
            {tb?.available
              ? t('endgameDrills.verdictTb', {
                  source: tb.source === 'syzygy' ? 'syzygy' : t('endgameDrills.verdictSourceLichess'),
                  category: tb.category,
                  dtz: tb.dtz != null ? ` · dtz ${tb.dtz}` : '',
                })
              : phase === 'playing'
                ? t('endgameDrills.verdictOffline')
                : ''}
          </p>
          {mistakes > 0 && phase === 'playing' && (
            <p className="mt-1 text-xs text-amber-300">{t('endgameDrills.slips', { count: mistakes })}</p>
          )}
          {phase !== 'playing' && (
            <button
              onClick={next}
              className="btn-press mt-3 min-h-11 w-full rounded bg-emerald-700 py-2 text-sm font-semibold text-white hover:bg-emerald-800 sm:min-h-0"
            >
              {t('buttons.nextDrill')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
