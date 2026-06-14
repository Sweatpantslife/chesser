import { useEffect, useRef, useState } from 'react';
import { CoordinateBoard } from '../components/CoordinateBoard';
import { useCoordinate, type CoordMode, type CoordSide } from '../store/coordinate';

const DURATION = 30;
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const rand = (n: number) => Math.floor(Math.random() * n);
const randomSquare = () => `${FILES[rand(8)]}${rand(8) + 1}`;

type Phase = 'idle' | 'running' | 'over';
type SideOpt = CoordSide | 'random';

function distinctSquares(target: string, n: number): string[] {
  const set = new Set([target]);
  while (set.size < n) set.add(randomSquare());
  return [...set].sort(() => Math.random() - 0.5);
}

export function CoordinatePage() {
  const [mode, setMode] = useState<CoordMode>('find');
  const [sideOpt, setSideOpt] = useState<SideOpt>('white');
  const [showCoords, setShowCoords] = useState(false);
  const [showPieces, setShowPieces] = useState(false);

  const [phase, setPhase] = useState<Phase>('idle');
  const [orientation, setOrientation] = useState<CoordSide>('white');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [score, setScore] = useState(0);
  const [target, setTarget] = useState('');
  const [options, setOptions] = useState<string[]>([]);
  const [flash, setFlash] = useState<{ square: string; kind: 'ok' | 'bad' } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const best = useCoordinate((s) => s.best);
  const record = useCoordinate((s) => s.record);

  const nextChallenge = () => {
    const sq = randomSquare();
    setTarget(sq);
    setOptions(mode === 'name' ? distinctSquares(sq, 4) : []);
  };

  const start = () => {
    setOrientation(sideOpt === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : sideOpt);
    setScore(0);
    setTimeLeft(DURATION);
    setFlash(null);
    setPhase('running');
    nextChallenge();
  };

  const finish = (finalScore: number) => {
    setPhase('over');
    record({
      ts: Date.now(),
      day: new Date().toISOString().slice(0, 10),
      score: finalScore,
      mode,
      side: orientation,
    });
  };

  // countdown
  useEffect(() => {
    if (phase !== 'running') return;
    if (timeLeft <= 0) {
      finish(score);
      return;
    }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, timeLeft]);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const answer = (square: string) => {
    if (phase !== 'running') return;
    if (flashTimer.current) clearTimeout(flashTimer.current);
    if (square === target) {
      setScore((n) => n + 1);
      setFlash({ square: target, kind: 'ok' });
      flashTimer.current = setTimeout(() => {
        setFlash(null);
        nextChallenge();
      }, 200);
    } else {
      setFlash({ square, kind: 'bad' });
      flashTimer.current = setTimeout(() => setFlash(null), 350);
    }
  };

  const running = phase === 'running';

  return (
    <div className="mx-auto grid w-full max-w-[900px] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div className="space-y-3">
        <div className="flex h-8 items-center justify-center gap-2 text-sm">
          {running && mode === 'find' && (
            <>
              <span className="text-neutral-400">Click</span>
              <span className="rounded bg-emerald-600 px-3 py-0.5 font-mono text-lg font-bold text-white">{target}</span>
            </>
          )}
          {running && mode === 'name' && <span className="text-neutral-400">Name the highlighted square</span>}
          {!running && <span className="text-neutral-500">Board vision: a 30-second sprint.</span>}
        </div>

        <div className="relative mx-auto w-full max-w-[520px]">
          <CoordinateBoard
            orientation={orientation}
            showCoords={showCoords}
            showPieces={showPieces}
            highlight={running && mode === 'name' ? target : null}
            flash={flash}
            onPick={running && mode === 'find' ? answer : undefined}
            disabled={!running || mode === 'name'}
          />
          {!running && (
            <div className="absolute inset-0 flex items-center justify-center rounded bg-black/55">
              {phase === 'idle' ? (
                <button onClick={start} className="rounded bg-emerald-600 px-5 py-2.5 font-semibold text-white hover:bg-emerald-500">
                  Start
                </button>
              ) : (
                <div className="text-center">
                  <div className="text-xs uppercase tracking-wide text-neutral-300">Time!</div>
                  <div className="my-1 text-5xl font-bold text-emerald-400">{score}</div>
                  {score >= best && score > 0 && <div className="mb-1 text-xs text-amber-300">🏆 New best!</div>}
                  <button onClick={start} className="mt-2 rounded bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500">
                    Again
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {running && mode === 'name' && (
          <div className="mx-auto grid max-w-[520px] grid-cols-4 gap-2">
            {options.map((o) => (
              <button
                key={o}
                onClick={() => answer(o)}
                className="rounded bg-neutral-700 py-2 font-mono text-base text-neutral-100 hover:bg-neutral-600"
              >
                {o}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="rounded-lg bg-panel p-4 text-center">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Time</div>
          <div className={`font-mono text-3xl ${timeLeft <= 5 && running ? 'text-rose-400' : 'text-ink'}`}>0:{String(timeLeft).padStart(2, '0')}</div>
          <div className="mt-2 flex items-center justify-center gap-6">
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-500">Score</div>
              <div className="text-2xl font-bold text-emerald-400">{score}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-500">Best</div>
              <div className="text-2xl font-bold text-neutral-200">{best}</div>
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-panel p-3 text-sm">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Mode</div>
          <div className="mb-3 flex gap-1">
            {(['find', 'name'] as const).map((m) => (
              <button
                key={m}
                disabled={running}
                onClick={() => setMode(m)}
                className={`flex-1 rounded px-2 py-1 text-xs capitalize disabled:opacity-50 ${
                  mode === m ? 'bg-emerald-600 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                }`}
              >
                {m === 'find' ? 'Find square' : 'Name square'}
              </button>
            ))}
          </div>

          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Side</div>
          <div className="mb-3 flex gap-1">
            {(['white', 'black', 'random'] as const).map((sv) => (
              <button
                key={sv}
                disabled={running}
                onClick={() => setSideOpt(sv)}
                className={`flex-1 rounded px-2 py-1 text-xs capitalize disabled:opacity-50 ${
                  sideOpt === sv ? 'bg-emerald-600 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                }`}
              >
                {sv}
              </button>
            ))}
          </div>

          <label className="flex cursor-pointer items-center justify-between py-1 text-neutral-300">
            <span className="text-xs">Show coordinates</span>
            <input type="checkbox" checked={showCoords} disabled={running} onChange={(e) => setShowCoords(e.target.checked)} />
          </label>
          <label className="flex cursor-pointer items-center justify-between py-1 text-neutral-300">
            <span className="text-xs">Show pieces</span>
            <input type="checkbox" checked={showPieces} disabled={running} onChange={(e) => setShowPieces(e.target.checked)} />
          </label>
        </div>

        <p className="px-1 text-xs leading-snug text-neutral-500">
          Knowing every square by name — without the labels — speeds up calculation and following notation.
        </p>
      </div>
    </div>
  );
}
