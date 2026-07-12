import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Chess } from 'chess.js';
import type { DrawShape } from 'chessground/draw';
import { Board } from '../board/Board';
import { EvalBar } from '../components/EvalBar';
import { AnalysisPanel } from '../components/AnalysisPanel';
import { MoveList } from '../components/MoveList';
import { PlayPanel } from '../components/PlayPanel';
import { GameActions } from '../components/GameActions';
import { Controls } from '../components/Controls';
import { Clock } from '../components/Clock';
import { ExplorerPanel } from '../components/ExplorerPanel';
import { OpeningName } from '../components/OpeningName';
import { ReviewPanel } from '../components/ReviewPanel';
import { PromotionDialog } from '../components/PromotionDialog';
import { GameOverModal } from '../components/GameOverModal';
import { AnalysisCoach } from '../components/AnalysisCoach';
import { Disclosure } from '../components/Disclosure';
import { LibraryDialog } from '../components/LibraryDialog';
import { BotAvatar } from '../components/BotAvatar';
import { nextLadderIndex } from '../components/LadderPanel';
import { useLadder } from '../store/ladder';
import { BOT_ROSTER, resolveBotConfig } from '../data/botRoster';
import { ReviewSummary } from '../components/analysis/ReviewSummary';
import { MistakeReviewPanel, MISTAKE_CLASSES } from '../components/analysis/MistakeReviewPanel';
import { MoveDetailPanel } from '../components/analysis/MoveDetailPanel';
import { CoachSummaryCard } from '../components/analysis/AiCoach';
import { buildGameSummaryFacts, buildMoveFacts } from '../lib/coachApi';
import type { Classification } from '../lib/analytics/types';
import { engine } from '../lib/engine';
import { CLASSIFICATION_META } from '../lib/coach';
import { goToMainlinePly } from '../lib/mainlineNav';
import { translateGameStatus } from '../lib/gameStatusText';
import { annotatedPgn } from '../lib/analytics/pgnExport';
import { useGame, type Color } from '../store/game';
import { useAnalysisReport } from '../store/analysisReport';
import { useSettings } from '../store/settings';
import { ThinkingDots } from '../components/icons';

// Brushes for the top engine lines, best → worst.
const ARROW_BRUSHES = ['green', 'blue', 'yellow', 'red'];

function ClockRow({ side }: { side: Color }) {
  const clock = useGame((s) => s.clock);
  const liveTurn = useGame((s) => s.liveTurn);
  const flagged = useGame((s) => s.flagged);
  const isGameOver = useGame((s) => s.isGameOver);
  if (!clock) return null;
  const ms = side === 'white' ? clock.whiteMs : clock.blackMs;
  return <Clock ms={ms} active={liveTurn === side && !isGameOver} flagged={flagged === side} />;
}

function StatusLine() {
  const { t } = useTranslation('play');
  const status = useGame((s) => s.status);
  const thinking = useGame((s) => s.thinking);
  const mode = useGame((s) => s.mode);
  const isGameOver = useGame((s) => s.isGameOver);
  return (
    <div className="flex h-7 items-center gap-2 text-sm">
      <span className={isGameOver ? 'font-display font-semibold text-gold-400' : 'text-neutral-300'}>
        {translateGameStatus(status)}
      </span>
      {thinking && (
        <span className="flex items-center gap-1.5 text-brand-300">
          {t('status.thinking')}
          <ThinkingDots />
        </span>
      )}
      {mode === 'analysis' && !isGameOver && <span className="text-neutral-400">{t('status.analysisBoard')}</span>}
    </div>
  );
}

function BoardArea() {
  const fen = useGame((s) => s.fen);
  const orientation = useGame((s) => s.orientation);
  const turnColor = useGame((s) => s.turnColor);
  const movableColor = useGame((s) => s.movableColor);
  const dests = useGame((s) => s.dests);
  const lastMove = useGame((s) => s.lastMove);
  const inCheck = useGame((s) => s.inCheck);
  const evalScore = useGame((s) => s.evalScore);
  const analysisOn = useGame((s) => s.analysisOn);
  const analysisLines = useGame((s) => s.analysisLines);
  const userMove = useGame((s) => s.userMove);
  const mode = useGame((s) => s.mode);
  const isGameOver = useGame((s) => s.isGameOver);
  const coachActive = useGame((s) => s.coachActive);
  const moveReviews = useGame((s) => s.moveReviews);
  const currentId = useGame((s) => s.currentId);
  const arrowsOn = useSettings((s) => s.arrows);
  const reviewArrow = useAnalysisReport((s) => s.arrow);

  const topSide: Color = orientation === 'white' ? 'black' : 'white';

  // Engine best-move arrows (analysis board only, so play isn't spoiled), plus
  // a coloured circle on the played move's square during a coach walkthrough
  // and the review panel's "best move you should have played" arrow.
  const shapes = useMemo<DrawShape[]>(() => {
    const out: DrawShape[] = [];
    const review = coachActive ? moveReviews[currentId] : undefined;
    if (review) {
      out.push({
        orig: review.uci.slice(2, 4) as DrawShape['orig'],
        brush: CLASSIFICATION_META[review.classification].brush,
      });
    }
    if (mode === 'analysis' && analysisOn && arrowsOn) {
      for (let i = 0; i < analysisLines.length; i++) {
        const uci = analysisLines[i]!.pvUci[0];
        if (!uci) continue;
        out.push({
          orig: uci.slice(0, 2) as DrawShape['orig'],
          dest: uci.slice(2, 4) as DrawShape['dest'],
          brush: ARROW_BRUSHES[i] ?? 'blue',
          modifiers: { lineWidth: i === 0 ? 12 : Math.max(6, 11 - i * 2) },
        });
      }
    }
    if (reviewArrow && mode === 'analysis') {
      out.push({
        orig: reviewArrow.from as DrawShape['orig'],
        dest: reviewArrow.to as DrawShape['dest'],
        brush: 'green',
        modifiers: { lineWidth: 12 },
      });
    }
    return out;
  }, [analysisLines, analysisOn, arrowsOn, mode, coachActive, moveReviews, currentId, reviewArrow]);

  return (
    <div className="mx-auto w-full max-w-[560px]">
      <div className="mb-2 flex justify-end">
        <ClockRow side={topSide} />
      </div>
      <div className="flex gap-2">
        {/* Never show a live eval while a game is being played — that's cheating. */}
        {analysisOn && (mode === 'analysis' || isGameOver) && <EvalBar score={evalScore} orientation={orientation} />}
        <div className="relative flex-1">
          <Board
            fen={fen}
            orientation={orientation}
            turnColor={turnColor}
            movableColor={movableColor}
            dests={dests}
            lastMove={lastMove}
            inCheck={inCheck}
            onMove={userMove}
            premove={mode === 'play'}
            shapes={shapes}
          />
          <PromotionDialog />
        </div>
      </div>
      <div className="mt-2 flex justify-end">
        <ClockRow side={orientation} />
      </div>
    </div>
  );
}

/**
 * The game-report rail: summary, mistake list and per-move detail, fed by the
 * analysis-report store. Renders nothing until a report exists for the
 * current game (fresh review or cache hit) on the analysis board.
 */
function ReportSection() {
  const report = useAnalysisReport((s) => s.report);
  const reportGameNo = useAnalysisReport((s) => s.gameNo);
  const gameNo = useGame((s) => s.gameNo);
  const mode = useGame((s) => s.mode);
  const viewPly = useGame((s) => s.viewPly);
  const currentId = useGame((s) => s.currentId);
  const reviewing = useGame((s) => s.reviewing);
  const aiCoach = useSettings((s) => s.aiCoach);
  // Class filter for the mistake list, shared with the summary's count cells.
  const [mistakeFilter, setMistakeFilter] = useState<ReadonlySet<Classification>>(() => new Set(MISTAKE_CLASSES));
  if (mode !== 'analysis' || !report || reportGameNo !== gameNo) return null;

  // Stable references — safe as effect deps downstream. Ply jumps resolve via
  // mainline node ids (goToMainlinePly) so they land right even while a PV
  // variation is being explored.
  const setArrow = useAnalysisReport.getState().setArrow;

  // The move that led to the viewed position (null on the root / a variation).
  const currentMove = report.moves.find((m) => m.nodeId === currentId) ?? null;

  // AI Coach facts — engine-truth payloads built read-only from the report.
  // Null when the toggle is off; the components then render rule-based text.
  const moveFacts = aiCoach && currentMove ? buildMoveFacts(currentMove, report) : null;
  const summaryFacts = aiCoach && !reviewing ? buildGameSummaryFacts(report) : null;

  // Play the engine PV as an explorable variation from the move's position.
  const playVariation = (sans: string[], fromPly: number) => {
    goToMainlinePly(fromPly - 1);
    for (const san of sans) {
      const st = useGame.getState();
      let mv;
      try {
        mv = new Chess(st.fen).move(san);
      } catch {
        break;
      }
      if (!mv) break;
      st.exploreMove(mv.from + mv.to + (mv.promotion ?? ''));
    }
    // The variation moves are structural, so the store just cleared its legacy
    // review fields (graph/table/walkthrough) — restore them from the report;
    // the mainline is unchanged, so the review is still valid.
    useAnalysisReport.getState().tryHydrateFromCache();
  };

  // Play the position out against the engine, from before the chosen move.
  const practice = (ply: number) => {
    const row = report.moves[ply - 1];
    if (!row) return;
    const st = useGame.getState();
    // The last-used bot may need an engine that isn't installed (e.g. Maia's
    // 'human' style on a Stockfish-only server) — the bot would then silently
    // never move. Fall back to an installed style from the server's catalogue.
    let bot = st.botConfig;
    if (st.styles.length > 0 && !st.styles.some((s) => s.id === bot.style)) {
      bot = { ...bot, style: st.styles.some((s) => s.id === 'balanced') ? 'balanced' : st.styles[0]!.id };
    }
    st.newGame({
      mode: 'play',
      playerColor: row.side,
      bot,
      startFen: row.fenBefore,
      opponent: null,
    });
  };

  const exportPgn = () => {
    const s = useGame.getState();
    const last = report.moves[report.moves.length - 1];
    // The review hook stamps meta.result null; fall back to the mate on the
    // board, then to the finished-game summary (resignation, flag, draw).
    const sum = s.gameSummary && s.gameSummary.gameNo === s.gameNo ? s.gameSummary : null;
    const summaryResult = sum
      ? sum.outcome === 'draw'
        ? '1/2-1/2'
        : (sum.outcome === 'win') === (sum.playerColor === 'white')
          ? '1-0'
          : '0-1'
      : null;
    const result =
      report.meta.result ?? (last?.isMate ? (last.side === 'white' ? '1-0' : '0-1') : summaryResult ?? '*');
    const pc = report.meta.playerColor;
    const opp = s.opponent?.name ?? 'Chesser bot';
    const pgn = annotatedPgn(report, {
      white: pc === 'white' ? 'You' : pc === 'black' ? opp : 'White',
      black: pc === 'black' ? 'You' : pc === 'white' ? opp : 'Black',
      result,
    });
    const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chesser-annotated.pgn';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <ReviewSummary
        report={report}
        reviewing={reviewing}
        onSelectPly={goToMainlinePly}
        onFilterClass={(cls) => setMistakeFilter(new Set([cls]))}
        onExportPgn={exportPgn}
      />
      <CoachSummaryCard facts={summaryFacts} />
      <MistakeReviewPanel
        moves={report.moves}
        viewPly={viewPly}
        onSelectPly={goToMainlinePly}
        onPractice={practice}
        activeClasses={mistakeFilter}
        onActiveClassesChange={setMistakeFilter}
      />
      <MoveDetailPanel
        move={currentMove}
        onShowArrow={setArrow}
        onPlayVariation={playVariation}
        onPractice={practice}
        onSelectPly={goToMainlinePly}
        maxPly={report.moves.length}
        aiFacts={moveFacts}
      />
    </>
  );
}

/**
 * The Bots hero: the current ladder rung and the screen's single accent CTA
 * ("Play now"), shown above the fold. Hidden while a bot game is actually in
 * progress — the board and in-game actions are the screen then, and a stray
 * "Play now" would destroy the live game.
 */
function PlayHero() {
  const { t } = useTranslation(['play', 'bots']);
  const availability = useGame((s) => s.availability);
  const newGame = useGame((s) => s.newGame);
  const mode = useGame((s) => s.mode);
  const isGameOver = useGame((s) => s.isGameOver);
  const defeated = useLadder((s) => s.defeated);

  if (mode === 'play' && !isGameOver) return null;

  const cleared = Object.keys(defeated).length;
  const nextIndex = nextLadderIndex(defeated);
  const complete = nextIndex === -1;
  const bot = complete ? BOT_ROSTER[BOT_ROSTER.length - 1]! : BOT_ROSTER[nextIndex]!;

  const start = () => {
    newGame({
      mode: 'play',
      playerColor: 'white',
      bot: resolveBotConfig(bot, availability),
      opponent: { id: bot.id, name: bot.name, rating: bot.rating, accent: bot.accent, motif: bot.motif },
    });
  };

  return (
    <section className="rounded-2xl bg-panel p-4 shadow-soft">
      <div className="flex flex-wrap items-center gap-4">
        <BotAvatar name={bot.name} accent={bot.accent} motif={bot.motif} size={56} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-base font-semibold text-ink">
            {complete ? t('hero.ladderComplete') : t('hero.nextRung', { name: bot.name, rating: bot.rating })}
          </p>
          <p className="text-xs text-neutral-400">{t('hero.cleared', { cleared, total: BOT_ROSTER.length })}</p>
        </div>
        <button
          onClick={start}
          className="btn-press min-h-11 rounded-full bg-gradient-to-br from-brand-600 to-brand-700 px-6 py-2.5 text-sm font-bold text-white shadow-glow"
        >
          {t('hero.playNow')} ▶
        </button>
      </div>
    </section>
  );
}

/** Archive's entire presence in Play: a plain link card to the Profile hub. */
function GameHistoryLink() {
  const { t } = useTranslation('play');
  return (
    <Link
      to="/profile/archive"
      className="btn-press flex min-h-11 items-center justify-between gap-3 rounded-2xl bg-panel p-4 shadow-soft hover:bg-neutral-800"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{t('history.title')}</span>
        <span className="block text-xs text-neutral-400">{t('history.hint')}</span>
      </span>
      <span aria-hidden className="shrink-0 text-neutral-400">
        →
      </span>
    </Link>
  );
}

/** PGN paste + game library (saved / lichess / chess.com imports / FEN). */
function PgnImportSection() {
  const { t } = useTranslation('play');
  const loadPgn = useGame((s) => s.loadPgn);
  const [pgn, setPgn] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  return (
    <div className="rounded-2xl bg-panel p-4 shadow-soft">
      <p className="mb-2 text-xs text-neutral-400">{t('analysisPage.pgnHint')}</p>
      <textarea
        value={pgn}
        onChange={(e) => {
          setPgn(e.target.value);
          setInvalid(false);
        }}
        rows={6}
        placeholder={'[Event "..."]\n\n1. e4 e5 2. Nf3 Nc6 ...'}
        aria-label={t('analysisPage.pasteAria')}
        className="w-full rounded-xl bg-neutral-900 p-2 font-mono text-xs text-ink outline-none"
      />
      {invalid && (
        <p role="status" className="mt-1 text-xs text-amber-300">
          {t('analysisPage.invalid')}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button
          onClick={() => setLibOpen(true)}
          className="btn-press min-h-11 rounded-full bg-neutral-700 px-4 py-1.5 text-sm font-semibold text-neutral-200 hover:bg-neutral-600 sm:min-h-9"
        >
          {t('analysisPage.openLibrary')}
        </button>
        <button
          onClick={() => {
            if (loadPgn(pgn.trim())) {
              setPgn('');
              setInvalid(false);
            } else setInvalid(true);
          }}
          disabled={!pgn.trim()}
          className="btn-press min-h-11 rounded-full bg-neutral-700 px-4 py-1.5 text-sm font-semibold text-neutral-200 hover:bg-neutral-600 disabled:opacity-50 sm:min-h-9"
        >
          {t('analysisPage.load')}
        </button>
      </div>
      {libOpen && <LibraryDialog onClose={() => setLibOpen(false)} />}
    </div>
  );
}

/** The analysis page's tool rail: disclosure sections per the IA brief. */
function AnalysisRail() {
  const { t } = useTranslation('play');
  return (
    <>
      <AnalysisCoach />
      <OpeningName />
      <Disclosure title={t('analysisPage.sections.engine')} defaultOpen>
        <AnalysisPanel />
      </Disclosure>
      <Disclosure title={t('analysisPage.sections.review')} defaultOpen>
        <ReviewPanel />
        <ReportSection />
      </Disclosure>
      <MoveList />
      <Disclosure title={t('analysisPage.sections.pgn')}>
        <PgnImportSection />
      </Disclosure>
      {/* Opening-explorer drawer slot. The panel is the Learn team's shared
          component — do NOT fork or restyle it here. Contract form: the panel
          stays mounted, `active` gates its fetches to while the drawer is
          open, and `embedded` suppresses its internal heading/landmark — the
          disclosure trigger is the drawer's one accessible name. */}
      <Disclosure title={t('analysisPage.sections.explorer')}>
        {(open) => <ExplorerPanel active={open} variant="embedded" />}
      </Disclosure>
    </>
  );
}

export function PlayPage({ section = 'bots' }: { section?: 'bots' | 'analysis' }) {
  const { t } = useTranslation('play');

  // Own the single analysis stream while this page is mounted.
  useEffect(() => {
    useGame.getState()._refreshAnalysis();
    return () => engine.stopAnalysis();
  }, []);

  // Opening the analysis page adopts a finished game onto the analysis board
  // (the "Review this game" / replay-from-archive handoff target). A live
  // game is never disturbed — enterAnalysis no-ops on it.
  useEffect(() => {
    if (section === 'analysis') useGame.getState().enterAnalysis();
  }, [section]);

  // NOTE: finished games are scored by the store itself (_recordFinishedGame,
  // guarded by scoredGameNo) — never from page effects, which re-ran on every
  // remount and double-recorded ratings/XP when revisiting this tab.

  // Drive the chess clocks in real time (no-op unless a timed game is live).
  useEffect(() => {
    let last = performance.now();
    const iv = window.setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      useGame.getState()._tick(dt);
    }, 100);
    return () => window.clearInterval(iv);
  }, []);

  // Keyboard navigation through the move list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      const s = useGame.getState();
      if (e.key === 'ArrowLeft') s.stepView(-1);
      else if (e.key === 'ArrowRight') s.stepView(1);
      else if (e.key === 'Home') s.goToPly(0);
      else if (e.key === 'End') s.goToPly(s.history.length);
      else if (e.key === 'f' || e.key === 'F') s.flip();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (section === 'analysis') {
    return (
      <div className="mx-auto w-full max-w-[1200px] space-y-4">
        <h1 className="font-display text-xl font-bold text-ink">{t('analysisPage.title')}</h1>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            <StatusLine />
            <BoardArea />
            <GameActions />
            <Controls />
          </div>
          <div className="space-y-3">
            <AnalysisRail />
          </div>
        </div>
        <GameOverModal />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-4">
      <h1 className="font-display text-xl font-bold text-ink">{t('hero.title')}</h1>
      <PlayHero />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
        {/* The ladder list + custom game setup scroll below the fold. */}
        <div className="order-2 space-y-3 lg:order-1">
          <PlayPanel />
          <GameHistoryLink />
        </div>
        <div className="order-1 space-y-3 lg:order-2">
          <StatusLine />
          <BoardArea />
          <GameActions />
          <Controls />
        </div>
        <div className="order-3 space-y-3">
          <OpeningName />
          <MoveList />
        </div>
      </div>
      <GameOverModal />
    </div>
  );
}
