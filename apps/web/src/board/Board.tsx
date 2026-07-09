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
  /**
   * Bump to force a re-sync with chessground even when no other prop changed.
   * Needed to snap back a rejected move: chessground has already moved the
   * piece internally, but the rejecting page's state (fen/lastMove/dests) is
   * unchanged, so no other dependency of the sync effect fires.
   */
  syncKey?: number;
}

const NO_SHAPES: DrawShape[] = [];

export const Board = memo(function Board(props: BoardProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);
  // chessground only receives a new `after` callback when the sync effect
  // below re-sets the config, and that effect deliberately doesn't depend on
  // props.onMove — so route the event through a ref to always call the latest
  // closure (pages capture state like tablebase data in onMove).
  const onMoveRef = useRef(props.onMove);
  useEffect(() => {
    onMoveRef.current = props.onMove;
  });
  const boardTheme = useSettings((s) => s.boardTheme);
  const pieceSet = useSettings((s) => s.pieceSet);
  const premoveSetting = useSettings((s) => s.premove);
  const premoveOn = !!props.premove && premoveSetting;
  const shapes = props.shapes ?? NO_SHAPES;

  const buildConfig = (): Config => ({
    fen: props.fen,
    orientation: props.orientation,
    turnColor: props.turnColor,
    lastMove: props.lastMove as Key[] | undefined,
    check: props.inCheck ? props.turnColor : undefined,
    coordinates: true,
    highlight: { lastMove: true, check: true },
    animation: { enabled: true, duration: 180 },
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
        after: (orig: Key, dest: Key) => onMoveRef.current(orig, dest),
      },
    },
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

  // keep the board in sync with store-driven props
  useEffect(() => {
    apiRef.current?.set(buildConfig());
    // After the position updates to our turn, fire a queued premove if legal.
    if (premoveOn) apiRef.current?.playPremove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fen, props.orientation, props.turnColor, props.movableColor, props.lastMove, props.inCheck, props.dests, premoveOn, props.syncKey]);

  // engine/auto arrows update independently of position changes
  useEffect(() => {
    apiRef.current?.setAutoShapes(shapes);
  }, [shapes]);

  return (
    <div className={`board-wrap board-${boardTheme} pieces-${pieceSet}`}>
      <div ref={elRef} className="cg-wrap" />
    </div>
  );
});
