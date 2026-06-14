import { memo, useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
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
}

export const Board = memo(function Board(props: BoardProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);
  const boardTheme = useSettings((s) => s.boardTheme);
  const premoveSetting = useSettings((s) => s.premove);
  const premoveOn = !!props.premove && premoveSetting;

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
    movable: {
      free: false,
      color: props.movableColor,
      dests: props.dests as Map<Key, Key[]>,
      showDests: true,
      events: {
        after: (orig: Key, dest: Key) => props.onMove(orig, dest),
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
  }, [props.fen, props.orientation, props.turnColor, props.movableColor, props.lastMove, props.inCheck, props.dests, premoveOn]);

  return (
    <div className={`board-wrap board-${boardTheme}`}>
      <div ref={elRef} className="cg-wrap" />
    </div>
  );
});
