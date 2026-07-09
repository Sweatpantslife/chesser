import { useMemo } from 'react';
import { useSettings, type BoardTheme } from '../store/settings';
import type { CoordSide } from '../store/coordinate';

const THEME_COLORS: Record<BoardTheme, { light: string; dark: string }> = {
  brown: { light: '#f0d9b5', dark: '#b58863' },
  blue: { light: '#e3e7ee', dark: '#8ca2ad' },
  green: { light: '#ebecd0', dark: '#86a666' },
  gray: { light: '#d9d9d9', dark: '#9b9b9b' },
  candy: { light: '#f2ecfb', dark: '#bda2e8' },
  mint: { light: '#eaf6ee', dark: '#82c9a0' },
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
// Unicode glyphs for piece context. Used for the "show pieces" demo and for the
// blindfold trainer's reveal (via piecesFromFen).
const GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const BACK = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

export type PieceMap = Record<string, { glyph: string; white: boolean }>;

function initialPieces(): PieceMap {
  const map: PieceMap = {};
  FILES.forEach((f, i) => {
    map[`${f}8`] = { glyph: GLYPH[BACK[i]!]!, white: false };
    map[`${f}7`] = { glyph: GLYPH.p!, white: false };
    map[`${f}2`] = { glyph: GLYPH.p!, white: true };
    map[`${f}1`] = { glyph: GLYPH[BACK[i]!]!, white: true };
  });
  return map;
}

/** Turn a FEN's piece-placement field into a square→glyph map for display.
 *  Tolerates malformed/empty input — unknown pieces and out-of-range files are
 *  skipped rather than throwing. */
export function piecesFromFen(fen: string): PieceMap {
  const map: PieceMap = {};
  const placement = fen.split(' ')[0];
  if (!placement) return map;
  const rows = placement.split('/');
  for (let r = 0; r < 8 && r < rows.length; r++) {
    const row = rows[r]!;
    let file = 0;
    for (const ch of row) {
      if (file >= 8) break;
      if (/\d/.test(ch)) {
        file += Number(ch);
      } else {
        const glyph = GLYPH[ch.toLowerCase()];
        if (glyph) map[`${FILES[file]}${8 - r}`] = { glyph, white: ch === ch.toUpperCase() };
        file += 1;
      }
    }
  }
  return map;
}

/** Is a square light? (a1 is dark.) */
export function isLightSquare(square: string): boolean {
  const fileIdx = FILES.indexOf(square[0]!);
  const rankIdx = Number(square[1]) - 1;
  return (fileIdx + rankIdx) % 2 === 1;
}

export interface CoordinateBoardProps {
  orientation: CoordSide;
  showCoords: boolean;
  showPieces: boolean;
  /** Explicit pieces to draw (overrides the showPieces initial-position demo). */
  pieces?: PieceMap;
  /** Square to highlight (used by "name the square" mode and the knight drill). */
  highlight?: string | null;
  /** Persistent per-square overlays (e.g. solved knight targets). */
  marks?: Record<string, 'ok' | 'bad' | 'hint'>;
  /** Per-square feedback flash. */
  flash?: { square: string; kind: 'ok' | 'bad' } | null;
  onPick?: (square: string) => void;
  disabled?: boolean;
}

const MARK_BG: Record<'ok' | 'bad' | 'hint', string> = {
  ok: 'bg-emerald-500/45',
  bad: 'bg-rose-500/45',
  hint: 'bg-amber-400/35',
};

export function CoordinateBoard({
  orientation,
  showCoords,
  showPieces,
  pieces,
  highlight,
  marks,
  flash,
  onPick,
  disabled,
}: CoordinateBoardProps) {
  const boardTheme = useSettings((s) => s.boardTheme);
  const colors = THEME_COLORS[boardTheme];
  const drawn = useMemo(() => pieces ?? (showPieces ? initialPieces() : {}), [pieces, showPieces]);
  const white = orientation === 'white';

  const cells = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const fileIdx = white ? c : 7 - c;
      const rankIdx = white ? 7 - r : r;
      const square = `${FILES[fileIdx]}${rankIdx + 1}`;
      const isLight = (fileIdx + rankIdx) % 2 === 1;
      const isFlash = flash?.square === square;
      const isTarget = highlight === square;
      const mark = marks?.[square];
      const piece = drawn[square];
      cells.push(
        <button
          key={square}
          disabled={disabled}
          aria-label={square}
          onClick={() => onPick?.(square)}
          className="relative flex aspect-square items-center justify-center"
          style={{ background: isLight ? colors.light : colors.dark, cursor: disabled ? 'default' : 'pointer' }}
        >
          {isTarget && <span className="absolute inset-0 ring-4 ring-inset ring-emerald-500/80" />}
          {mark && !isFlash && <span className={`absolute inset-0 ${MARK_BG[mark]}`} />}
          {isFlash && (
            <span className={`absolute inset-0 ${flash!.kind === 'ok' ? 'bg-emerald-500/60' : 'bg-rose-500/60'}`} />
          )}
          {piece && (
            <span
              className="pointer-events-none select-none text-[5vw] leading-none sm:text-[26px]"
              style={
                piece.white
                  ? { color: '#f7f7f7', textShadow: '0 0 1px #000, 0 1px 1px rgba(0,0,0,.5)' }
                  : { color: '#1a1a1a' }
              }
            >
              {piece.glyph}
            </span>
          )}
          {showCoords && c === 0 && (
            <span
              className="pointer-events-none absolute left-0.5 top-0 text-[9px] font-semibold opacity-70"
              style={{ color: isLight ? colors.dark : colors.light }}
            >
              {rankIdx + 1}
            </span>
          )}
          {showCoords && r === 7 && (
            <span
              className="pointer-events-none absolute bottom-0 right-0.5 text-[9px] font-semibold opacity-70"
              style={{ color: isLight ? colors.dark : colors.light }}
            >
              {FILES[fileIdx]}
            </span>
          )}
        </button>,
      );
    }
  }

  return <div className="grid w-full grid-cols-8 overflow-hidden rounded">{cells}</div>;
}
