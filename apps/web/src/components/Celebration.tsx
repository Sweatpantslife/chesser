import { useCallback, useEffect, useRef, useState } from 'react';
import { onGamifyEvent } from '../lib/gamify';

/**
 * Full-screen confetti burst for reward moments (level-ups, achievements,
 * daily-goal streaks, wins). DOM particles animated by the `confetti-burst`
 * CSS keyframe; skipped entirely under prefers-reduced-motion.
 *
 * Mounted once at the app root (listens to gamify events), and imperatively
 * triggerable via `fireConfetti()` for local moments like winning a game.
 */

const COLORS = ['#8b5cf6', '#f472b6', '#fbbf24', '#34d399', '#c4b5fd', '#f9a8d4'];

interface Piece {
  id: number;
  left: number; // vw
  top: number; // vh
  dx: number; // px drift
  dy: number; // px fall
  rot: number; // deg
  dur: number; // s
  delay: number; // s
  color: string;
  shape: 'rect' | 'dot' | 'star';
}

let pieceId = 0;
let fire: ((count?: number) => void) | null = null;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Fire a confetti burst from anywhere (no-op before mount / reduced motion). */
export function fireConfetti(count = 90): void {
  fire?.(count);
}

function makePieces(count: number): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: pieceId++,
      left: 8 + Math.random() * 84,
      top: -6 - Math.random() * 10,
      dx: (Math.random() - 0.5) * 240,
      dy: 380 + Math.random() * 420,
      rot: (Math.random() - 0.5) * 720,
      dur: 1.4 + Math.random() * 1.1,
      delay: Math.random() * 0.25,
      color: COLORS[i % COLORS.length]!,
      shape: (['rect', 'dot', 'star'] as const)[i % 3]!,
    });
  }
  return out;
}

function Star({ color }: { color: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 0.8l1.4 3 3.2.4-2.3 2.2.6 3.2L6 8l-2.9 1.6.6-3.2L1.4 4.2l3.2-.4z" fill={color} />
    </svg>
  );
}

export function Celebration() {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const timeouts = useRef<Set<number>>(new Set());

  const burst = useCallback((count = 90) => {
    if (prefersReducedMotion()) return;
    const fresh = makePieces(count);
    setPieces((cur) => [...cur.slice(-80), ...fresh]);
    const ids = new Set(fresh.map((p) => p.id));
    const to = window.setTimeout(() => {
      setPieces((cur) => cur.filter((p) => !ids.has(p.id)));
      timeouts.current.delete(to);
    }, 3200);
    timeouts.current.add(to);
  }, []);

  useEffect(() => {
    fire = burst;
    const unsub = onGamifyEvent((e) => {
      if (e.kind === 'level-up') burst(120);
      else if (e.kind === 'streak-milestone') burst(90);
      else if (e.kind === 'achievement-unlocked') burst(70);
      else if (e.kind === 'goal') burst(50);
    });
    const tRef = timeouts.current;
    return () => {
      if (fire === burst) fire = null;
      unsub();
      for (const id of tRef) window.clearTimeout(id);
      tRef.clear();
    };
  }, [burst]);

  if (pieces.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece absolute"
          style={{
            left: `${p.left}vw`,
            top: `${p.top}vh`,
            ['--dx' as string]: `${p.dx}px`,
            ['--dy' as string]: `${p.dy}px`,
            ['--rot' as string]: `${p.rot}deg`,
            ['--dur' as string]: `${p.dur}s`,
            ['--delay' as string]: `${p.delay}s`,
          }}
        >
          {p.shape === 'star' ? (
            <Star color={p.color} />
          ) : (
            <span
              className="block"
              style={{
                width: p.shape === 'dot' ? 7 : 5,
                height: p.shape === 'dot' ? 7 : 11,
                borderRadius: p.shape === 'dot' ? 999 : 2,
                background: p.color,
              }}
            />
          )}
        </span>
      ))}
    </div>
  );
}
