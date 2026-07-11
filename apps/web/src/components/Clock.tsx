function format(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s >= 20) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  }
  return s.toFixed(1);
}

export function Clock({ ms, active, flagged }: { ms: number; active: boolean; flagged: boolean }) {
  const low = ms < 20_000 && !flagged;
  return (
    <div
      className={`rounded-md px-3 py-1.5 text-right font-mono text-2xl tabular-nums transition-colors ${
        flagged
          ? 'bg-rose-900/50 text-rose-300'
          : active
            ? 'bg-neutral-100 text-neutral-900'
            : 'bg-panelmute text-neutral-400'
      } ${low ? 'text-rose-400' : ''}`}
    >
      {flagged ? '0:00' : format(ms)}
    </div>
  );
}
