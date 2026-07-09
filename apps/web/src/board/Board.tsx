import { memo, useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { useSettings } from '../store/settings';
import type { Color } from '../store/game';

export interface BoardProps {
  fen: string;
  orientation: Color;
  turnColor: Color;
  movableColor: Color | 'both' | undefined;
  dests: Map<string, string[]>;
  lastMove: [string, string] | undefined;
  inCheck: boolean;
  onMove: (from: string, to: string) => void;
  /** Allow premoves (play-vs-bot). Gated by the user's setting. */
  premove?: boolean;
  /** Auto-drawn shapes (e.g. engine best-move arrows). */
  shapes?: DrawShape[];
}

const NO_SHAPES: DrawShape[] = [];

// Users who ask the OS for reduced motion get an instant board.
const REDUCED_MOTION =
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const Board = memo(function Board(props: BoardProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);
  const boardTheme = useSettings((s) => s.boardTheme);
  const pieceSet = useSettings((s) => s.pieceSet);
  const premoveSetting = useSettings((s) => s.premove);
  const premoveOn = !!props.premove && premoveSetting;
  const shapes = props.shapes ?? NO_SHAPES;

  // Chessground holds the `events.after` callback until the next `set()`,
  // which only happens when the sync effect below re-runs. Route the callback
  // through refs so it always sees the latest props — otherwise consumers
  // whose `onMove` closes over changing state (e.g. the endgame trainer's
  // tablebase snapshot) get a handler that's several renders stale.
  const onMoveRef = useRef(props.onMove);
  const buildConfigRef = useRef<() => Config>(() => ({}));

  const buildConfig = (): Config => ({
    fen: props.fen,
    orientation: props.orientation,
    turnColor: props.turnColor,
    lastMove: props.lastMove as Key[] | undefined,
    check: props.inCheck ? props.turnColor : undefined,
    coordinates: true,
    highlight: { lastMove: true, check: true },
    animation: { enabled: !REDUCED_MOTION, duration: 180 },
    draggable: { showGhost: true },
    premovable: { enabled: premoveOn, showDests: true, castle: true },
    // Right-click-drag draws user arrows/circles; engine arrows come in as autoShapes.
    drawable: { enabled: true, visible: true, defaultSnapToValidMove: true, eraseOnClick: false, autoShapes: shapes },
    movable: {
      free: false,
      color: props.movableColor,
      dests: props.dests as Map<Key, Key[]>,
      showDests: true,
      events: {
        after: (orig: Key, dest: Key) => {
          onMoveRef.current(orig, dest);
          // Chessground moves the piece optimistically. If the consumer
          // accepted the move its props change and the sync effect re-applies
          // the authoritative position; if it REJECTED it (same fen, same
          // lastMove — e.g. "not the line" in the openings drill) no prop
          // changes, the memoized component never re-syncs, and the board
          // would stay desynced from the app state. Re-assert the current
          // authoritative config on the next frame whenever the rendered
          // pieces disagree with it. Pawns sitting on the last rank are left
          // alone: they're legitimately parked there awaiting a promotion
          // dialog. Two frames give React time to commit an accepted move's
          // state before we compare, so normal moves never flicker.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const api = apiRef.current;
              if (!api) return;
              const moved = api.state.pieces.get(dest);
              if (moved?.role === 'pawn' && (dest[1] === '1' || dest[1] === '8')) return;
              const cfg = buildConfigRef.current();
              if (cfg.fen && cfg.fen.split(' ')[0] !== api.getFen()) api.set(cfg);
            }),
          );
        },
      },
    },
  });

  // Keep the callback refs on the latest render (runs after every commit).
  useEffect(() => {
    onMoveRef.current = props.onMove;
    buildConfigRef.current = buildConfig;
  });

  // mount once
  useEffect(() => {
    if (!elRef.current) return;
    apiRef.current = Chessground(elRef.current, buildConfig());
    return () => {
      apiRef.current?.destroy();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Chessground caches the board's bounding rect and only invalidates it on
  // scroll/resize. Layout shifts that move the board without resizing it
  // (clocks appearing when a timed game starts, the header settling after the
  // engine connects on mobile) leave the cached rect stale, so the first
  // tap/click hit-tests against the old position and selects the wrong
  // square. Drop the cache right before chessground handles any pointer or
  // touch interaction; it lazily recomputes from the live layout.
  const refreshBounds = () => apiRef.current?.state.dom.bounds.clear();

  // A queued premove can be cancelled with Escape; also clear it if premoves
  // get disabled while one is queued so its highlight doesn't linger.
  useEffect(() => {
    if (!premoveOn) {
      apiRef.current?.cancelPremove();
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') apiRef.current?.cancelPremove();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [premoveOn]);

  // keep the board in sync with store-driven props
  useEffect(() => {
    apiRef.current?.set(buildConfig());
    // After the position updates to our turn, fire a queued premove if legal.
    if (premoveOn) apiRef.current?.playPremove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fen, props.orientation, props.turnColor, props.movableColor, props.lastMove, props.inCheck, props.dests, premoveOn]);

  // engine/auto arrows update independently of position changes
  useEffect(() => {
    apiRef.current?.setAutoShapes(shapes);
  }, [shapes]);

  return (
    <div
      className={`board-wrap board-${boardTheme} pieces-${pieceSet}`}
      onPointerDownCapture={refreshBounds}
      onTouchStartCapture={refreshBounds}
    >
      <div ref={elRef} className="cg-wrap" />
    </div>
  );
});
