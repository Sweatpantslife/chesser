import { useId } from 'react';

/** A small offline palette used when an opponent has no explicit accent colour. */
const PALETTE = ['#f59e0b', '#34d399', '#38bdf8', '#a78bfa', '#fb7185', '#22d3ee', '#818cf8', '#facc15'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Multiply an #rrggbb colour towards black (f<1) for a gradient stop. */
function shade(hex: string, f: number): string {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(full, 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export interface BotAvatarProps {
  name: string;
  accent?: string;
  motif?: string;
  size?: number;
  locked?: boolean;
  className?: string;
}

/**
 * A deterministic, fully-offline avatar: a rounded gradient tile (derived from
 * the bot's accent colour or, failing that, its name) badged with the bot's
 * emoji motif or its initials. No network, stable per bot.
 */
export function BotAvatar({ name, accent, motif, size = 44, locked = false, className }: BotAvatarProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const base = accent ?? PALETTE[hash(name) % PALETTE.length]!;
  const dark = shade(base, 0.55);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={name}
      className={`${locked ? 'opacity-50 grayscale' : ''} ${className ?? ''}`}
    >
      <defs>
        <linearGradient id={`grad-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={base} />
          <stop offset="100%" stopColor={dark} />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill={`url(#grad-${uid})`} />
      {motif ? (
        <text x="32" y="34" textAnchor="middle" dominantBaseline="central" fontSize="30">
          {motif}
        </text>
      ) : (
        <text
          x="32"
          y="34"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="24"
          fontWeight="700"
          fill="#ffffff"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {initialsOf(name)}
        </text>
      )}
      {locked && (
        <text x="32" y="35" textAnchor="middle" dominantBaseline="central" fontSize="26">
          🔒
        </text>
      )}
    </svg>
  );
}
