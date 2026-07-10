import type { CSSProperties, SVGProps } from 'react';

/**
 * Hand-authored SVG identity: logo, nav/action icon set, empty-state
 * illustrations and celebratory bits. Everything uses currentColor (or the
 * design-token CSS variables) so the art stays theme-aware, and rounded
 * caps/joins to match the brand's soft look.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...rest,
  };
}

/** Brand mark: a bouncy knight in a squircle, gradient-filled. */
export function LogoMark({ size = 28, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" {...rest}>
      <defs>
        <linearGradient id="chsr-logo-g" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#db2777" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="29" height="29" rx="9" fill="url(#chsr-logo-g)" />
      {/* rounded knight silhouette */}
      <path
        d="M11.2 24.5h10.1c.5 0 .8-.5.6-1-.5-1-1.4-1.6-1.4-3.1 0-2.4 2-3.6 2-7.1 0-4.2-3.2-7-7.3-7-.6 0-1 .6-.7 1.1l.6 1.1c.2.4 0 .8-.4 1-2.3.8-4.6 2.6-5.6 5-.2.5 0 1 .4 1.3l1.6 1c.4.3 1 .2 1.3-.2l1-1.2c.3-.4 1-.4 1.2.1.5 1 .2 2.3-.8 3.4-1.3 1.4-2.9 2.4-3.3 4.4-.1.6.2 1.2.7 1.2z"
        fill="#fff"
      />
      <circle cx="13.4" cy="10.6" r="1" fill="#5b21b6" />
    </svg>
  );
}

/** Wordmark: rounded display type, rendered as text so it stays crisp. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-display text-xl font-bold leading-none tracking-tight ${className}`}>
      Chesser
      <span className="text-accent-400">.</span>
    </span>
  );
}

// — Nav icons —

export function IconPlay(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.8l5 3.2-5 3.2z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconLearn(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 4.5L3 8.5l9 4 9-4z" />
      <path d="M7 10.7v4.8c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4.8" />
      <path d="M21 8.5v5" />
    </svg>
  );
}

export function IconFriends(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="8.5" cy="9" r="3.2" />
      <path d="M2.8 19c.7-2.8 3-4.5 5.7-4.5s5 1.7 5.7 4.5" />
      <circle cx="16.8" cy="10" r="2.6" />
      <path d="M15.5 14.7c2.7-.4 5 1.2 5.7 3.8" />
    </svg>
  );
}

export function IconOpenings(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 6.5C10.5 5 8.4 4.3 5.5 4.3c-.8 0-1.5.1-2.5.3v13.6c1-.2 1.7-.3 2.5-.3 2.9 0 5 .8 6.5 2.3 1.5-1.5 3.6-2.3 6.5-2.3.8 0 1.5.1 2.5.3V4.6c-1-.2-1.7-.3-2.5-.3-2.9 0-5 .7-6.5 2.2z" />
      <path d="M12 6.5v13.7" />
    </svg>
  );
}

export function IconTactics(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M13.5 3L5.5 13.5h5L10 21l8.5-10.5h-5z" />
    </svg>
  );
}

export function IconEndgame(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6 21V4" />
      <path d="M6 5c2.5-1.6 4.8-1.6 7 0s4.5 1.6 6.5.3V14c-2 1.3-4.3 1.3-6.5-.3s-4.5-1.6-7 0" />
    </svg>
  );
}

export function IconTrain(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M7 8v8M17 8v8M4 10v4M20 10v4" />
      <path d="M7 12h10" />
    </svg>
  );
}

export function IconCoach(p: IconProps) {
  // A whistle — the coach's tool of trade.
  return (
    <svg {...base(p)}>
      <circle cx="9" cy="14" r="5" />
      <path d="M12.5 10.5 20 6v4l-6 2.5" />
      <circle cx="9" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconCoords(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M4 12h16M12 4v16" />
      <rect x="12" y="4" width="4" height="4" fill="currentColor" stroke="none" opacity="0.55" />
      <rect x="8" y="12" width="4" height="4" fill="currentColor" stroke="none" opacity="0.55" />
    </svg>
  );
}

export function IconStats(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 20h16" />
      <path d="M6.5 16.5v-4M12 16.5V7.5M17.5 16.5v-7" />
      <circle cx="17.5" cy="6" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconProfile(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20c1-3.4 4-5.3 7.5-5.3s6.5 1.9 7.5 5.3" />
    </svg>
  );
}

// — UI icons —

export function IconGear(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8l1.2 2.5 2.7-.6 1.7 2.2 2.6 1-.3 2.7 1.9 2-1.9 2 .3 2.7-2.6 1-1.7 2.2-2.7-.6L12 21.2l-1.2-2.3-2.7.6-1.7-2.2-2.6-1 .3-2.7-1.9-2 1.9-2-.3-2.7 2.6-1 1.7-2.2 2.7.6z" />
    </svg>
  );
}

export function IconSoundOn(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z" fill="currentColor" stroke="none" />
      <path d="M15.5 9c1.4 1.7 1.4 4.3 0 6M18.5 6.5c2.7 3.2 2.7 7.8 0 11" />
    </svg>
  );
}

export function IconSoundOff(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z" fill="currentColor" stroke="none" />
      <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />
    </svg>
  );
}

export function IconClose(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function IconStar(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path
        d="M12 3.2l2.4 5 5.4.7-4 3.8 1 5.4L12 15.5l-4.8 2.6 1-5.4-4-3.8 5.4-.7z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

export function IconTrophy(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 4h8v6a4 4 0 01-8 0z" />
      <path d="M8 5.5H4.5c0 3 1.5 4.8 3.5 5M16 5.5h3.5c0 3-1.5 4.8-3.5 5" />
      <path d="M12 14v3M8.5 20h7M10 17h4" />
    </svg>
  );
}

export function IconSparkles(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z" fill="currentColor" stroke="none" />
      <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="currentColor" stroke="none" opacity="0.7" />
      <path d="M5 16l.6 1.6 1.6.6-1.6.6L5 20.4l-.6-1.6-1.6-.6 1.6-.6z" fill="currentColor" stroke="none" opacity="0.7" />
    </svg>
  );
}

export function IconBolt(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M13.5 3L5.5 13.5h5L10 21l8.5-10.5h-5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconHeart(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0112 7a4.3 4.3 0 017.5 3c0 5.4-7.5 10-7.5 10z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconArrowRight(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconDownload(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 4v10M8 10.5l4 4 4-4" />
      <path d="M5 19h14" />
    </svg>
  );
}

export function IconCrown(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 8l4 3.5L12 5l4 6.5L20 8l-1.5 10h-13z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Streak flame — pass `lit` for the gold/pink live version. Animation comes
 *  from the .flame-flicker class (collapsed under prefers-reduced-motion). */
export function StreakFlame({ size = 20, lit = true, animate = false, ...rest }: IconProps & { lit?: boolean; animate?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...rest}>
      <g className={animate ? 'flame-flicker' : undefined}>
        <path
          d="M12 2.5c.6 3-0.6 4.6-2.2 6.3C8 10.7 6.5 12.6 6.5 15a5.5 5.5 0 0011 0c0-1.6-.6-3-1.4-4.2-.4-.6-1.2-.5-1.5.1-.3.5-.6 1-.9 1.3-.6-1.6-.4-3.1.2-4.9.5-1.6-.2-3.4-1.9-4.8z"
          fill={lit ? '#fbbf24' : 'currentColor'}
          opacity={lit ? 1 : 0.45}
        />
        {lit && (
          <path
            d="M12 12.5c.3 1.4-.3 2.2-1 3-1 1-1.5 1.7-1.5 2.7a2.9 2.9 0 105.8 0c0-1.3-.6-2.3-1.3-3.2-.6-.9-1.4-1.6-2-2.5z"
            fill="#f472b6"
          />
        )}
      </g>
    </svg>
  );
}

// — Empty-state illustrations (bigger, decorative, theme-aware) —

function artProps(w: number, h: number, rest: SVGProps<SVGSVGElement>): SVGProps<SVGSVGElement> {
  return { width: w, height: h, viewBox: '0 0 160 120', fill: 'none', 'aria-hidden': true, ...rest };
}

/** Sleepy pawn on an empty board — "no games / history yet". */
export function EmptyBoardArt({ width = 160, height = 120, ...rest }: SVGProps<SVGSVGElement> & { width?: number; height?: number }) {
  return (
    <svg {...artProps(width as number, height as number, rest)}>
      {/* floating board */}
      <rect x="34" y="78" width="92" height="18" rx="6" fill="var(--c-brand-600)" opacity="0.35" />
      <g opacity="0.9">
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={42 + i * 20} y={70} width="10" height="10" rx="2" fill={i % 2 ? 'var(--c-brand-400)' : 'var(--c-panel)'} stroke="var(--c-brand-400)" strokeWidth="1.5" />
        ))}
      </g>
      {/* dozing pawn */}
      <g>
        <circle cx="80" cy="38" r="11" fill="var(--c-brand-400)" />
        <path d="M70 56c0-6 4.5-10 10-10s10 4 10 10l3 12H67z" fill="var(--c-brand-400)" />
        <rect x="63" y="66" width="34" height="8" rx="4" fill="var(--c-brand-600)" />
        {/* closed eyes */}
        <path d="M75 38q2.5 2 5 0M84 38q2.5 2 5 0" stroke="var(--c-page)" strokeWidth="2" strokeLinecap="round" />
      </g>
      {/* zzz + sparkles */}
      <g fill="var(--c-gold-400)">
        <path d="M100 22h8l-8 8h8" stroke="var(--c-gold-400)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <circle cx="46" cy="30" r="2.4" />
        <circle cx="120" cy="52" r="2" />
        <path d="M52 14l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z" />
      </g>
    </svg>
  );
}

/** Puzzle piece with sparkles — "no puzzles solved yet". */
export function EmptyPuzzleArt({ width = 160, height = 120, ...rest }: SVGProps<SVGSVGElement> & { width?: number; height?: number }) {
  return (
    <svg {...artProps(width as number, height as number, rest)}>
      <path
        d="M60 40h14a8 8 0 1116 0h10a6 6 0 016 6v10a8 8 0 100 16v10a6 6 0 01-6 6H60a6 6 0 01-6-6V72a8 8 0 100-16V46a6 6 0 016-6z"
        fill="var(--c-brand-500)"
        opacity="0.9"
      />
      <circle cx="88" cy="64" r="4" fill="var(--c-page)" opacity="0.5" />
      <g fill="var(--c-accent-400)">
        <path d="M40 24l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" />
        <circle cx="122" cy="34" r="2.6" />
      </g>
      <g fill="var(--c-gold-400)">
        <path d="M118 88l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z" />
        <circle cx="36" cy="92" r="2.2" />
      </g>
    </svg>
  );
}

/** Sprouting chart — "your progress will grow here". */
export function EmptyStatsArt({ width = 160, height = 120, ...rest }: SVGProps<SVGSVGElement> & { width?: number; height?: number }) {
  return (
    <svg {...artProps(width as number, height as number, rest)}>
      <path d="M30 96h100" stroke="var(--c-muted)" strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />
      <rect x="42" y="76" width="14" height="20" rx="4" fill="var(--c-brand-500)" opacity="0.55" />
      <rect x="64" y="64" width="14" height="32" rx="4" fill="var(--c-brand-500)" opacity="0.75" />
      <rect x="86" y="50" width="14" height="46" rx="4" fill="var(--c-brand-500)" />
      {/* sprout on the tallest bar */}
      <path d="M93 48c0-8 5-12 11-13-1 7-4 11-11 13z" fill="var(--c-mint-400)" />
      <path d="M93 48c-1-6-5-9-10-10 1 6 4 9 10 10z" fill="var(--c-mint-400)" opacity="0.7" />
      <g fill="var(--c-gold-400)">
        <path d="M120 30l1.4 3.6 3.6 1.4-3.6 1.4-1.4 3.6-1.4-3.6-3.6-1.4 3.6-1.4z" />
        <circle cx="38" cy="40" r="2.4" />
      </g>
    </svg>
  );
}

/** Tiny inline three-dot "thinking" loader (pairs with .loading-dot CSS). */
export function ThinkingDots({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} style={style} aria-hidden="true">
      <span className="loading-dot inline-block h-1.5 w-1.5 rounded-full bg-current" />
      <span className="loading-dot inline-block h-1.5 w-1.5 rounded-full bg-current" />
      <span className="loading-dot inline-block h-1.5 w-1.5 rounded-full bg-current" />
    </span>
  );
}
