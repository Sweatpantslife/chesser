import { useEffect, useMemo, useRef, useState } from 'react';
import { CoordinateBoard, isLightSquare, type PieceMap } from '../components/CoordinateBoard';
import { useCoordinate, type CoordMode, type CoordSide } from '../store/coordinate';

const DURATION = 30;
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const rand = (n: number) => Math.floor(Math.random() * n);
const randomSquare = () => `${FILES[rand(8)]}${rand(8) + 1}`;

type Phase = 'idle' | 'running' | 'over';
type SideOpt = CoordSide | 'random';

const MODE_LABEL: Record<CoordMode, string> = {
  find: 'Find square',
  name: 'Name square',
  color: 'Square colour',
  knight: "Knight's tour",
};

const MODE_BLURB: Record<CoordMode, string> = {
  find: 'Click the named square as fast as you can.',
  name: 'Name the highlighted square.',
  color: 'Is the highlighted square light or dark?',
  knight: 'Click every square the knight can jump to.',
};

function distinctSquares(target: string, n: number): string[] {
  const set = new Set([target]);
  while (set.size < n) set.add(randomSquare());
  return [...set].sort(() => Math.random() - 0.5);
}

const KNIGHT_DELTAS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

function knightTargets(sq: string): string[] {
  const f = FILES.indexOf(sq[0]!);
  const r = Number(sq[1]) - 1;
  const out: string[] = [];
  for (const [df, dr] of KNIGHT_DELTAS) {
    const nf = f + df!;
    const nr = r + dr!;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) out.push(`${FILES[nf]}${nr + 1}`);
  }
  return out;
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
  const [target, setTarget] = useState(''); // the square in play (find / name / color), or knight start square
  const [options, setOptions] = useState<string[]>([]);
  const [knightLeft, setKnightLeft] = useState<string[]>([]); // remaining knight targets (for display)
  const [knightMarks, setKnightMarks] = useState<Record<string, 'ok'>>({});
  const [flash, setFlash] = useState<{ square: string; kind: 'ok' | 'bad' } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Synchronous source of truth for the knight drill, so rapid clicks can't race.
  const knightRef = useRef<{ all: string[]; found: Set<string> }>({ all: [], found: new Set() });

  const bestByMode = useCoordinate((s) => s.bestByMode);
  const record = useCoordinate((s) => s.record);
  const best = bestByMode[mode] ?? 0;

  const nextChallenge = () => {
    if (mode === 'knight') {
      const sq = randomSquare();
      const all = knightTargets(sq);
      knightRef.current = { all, found: new Set() };
      setTarget(sq);
      setKnightLeft(all);
      setKnightMarks({});
      setOptions([]);
      return;
    }
    const sq = randomSquare();
    setTarget(sq);
    setOptions(mode === 'name' ? distinctSquares(sq, 4) : []);
    setKnightLeft([]);
    setKnightMarks({});
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

  const flashThen = (square: string, kind: 'ok' | 'bad', after?: () => void, ms = kind === 'ok' ? 200 : 350) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash({ square, kind });
    flashTimer.current = setTimeout(() => {
      setFlash(null);
      after?.();
    }, ms);
  };

  // Square-pick answers (find / knight modes).
  const onPick = (square: string) => {
    if (phase !== 'running') return;
    if (mode === 'find') {
      if (square === target) {
        setScore((n) => n + 1);
        flashThen(target, 'ok', nextChallenge);
      } else {
        flashThen(square, 'bad');
      }
    } else if (mode === 'knight') {
      if (square === target) return; // clicking the knight itself is a no-op
      const { all, found } = knightRef.current;
      if (!all.includes(square)) {
        flashThen(square, 'bad');
        return;
      }
      if (found.has(square)) return; // already found
      found.add(square); // ref mutation is synchronous — no click race
      setScore((n) => n + 1);
      setKnightMarks((m) => ({ ...m, [square]: 'ok' }));
      setKnightLeft(all.filter((s) => !found.has(s)));
      if (found.size === all.length) setTimeout(nextChallenge, 250); // whole set found → new knight
    }
  };

  // Name-the-square answers (button per option).
  const answerName = (square: string) => {
    if (phase !== 'running') return;
    if (square === target) {
      setScore((n) => n + 1);
      flashThen(target, 'ok', nextChallenge);
    } else {
      flashThen(square, 'bad');
    }
  };

  // Square-colour answers.
  const answerColor = (light: boolean) => {
    if (phase !== 'running') return;
    if (light === isLightSquare(target)) {
      setScore((n) => n + 1);
      flashThen(target, 'ok', nextChallenge);
    } else {
      flashThen(target, 'bad');
    }
  };

  const running = phase === 'running';

  const knightPieces: PieceMap | undefined = useMemo(
    () => (mode === 'knight' && target ? { [target]: { glyph: '♞', white: true } } : undefined),
    [mode, target],
  );

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
          {running && mode === 'color' && <span className="text-neutral-400">Is the ringed square light or dark?</span>}
          {running && mode === 'knight' && (
            <span className="text-neutral-400">
              Click every knight move — <span className="text-emerald-400">{knightLeft.length} left</span>
            </span>
          )}
          {!running && <span className="text-neutral-500">Board vision: a 30-second sprint.</span>}
        </div>

        <div className="relative mx-auto w-full max-w-[520px]">
          <CoordinateBoard
            orientation={orientation}
            showCoords={showCoords}
            showPieces={showPieces}
            pieces={knightPieces}
            highlight={running && (mode === 'name' || mode === 'color' || mode === 'knight') ? target : null}
            marks={mode === 'knight' ? knightMarks : undefined}
            flash={flash}
            onPick={running && (mode === 'find' || mode === 'knight') ? onPick : undefined}
            disabled={!running || mode === 'name' || mode === 'color'}
          />
          {!running && (
            <div className="absolute inset-0 flex items-center justify-center rounded bg-black/55">
              {phase === 'idle' ? (
                <button
                  onClick={start}
                  className="rounded bg-emerald-600 px-5 py-2.5 font-semibold text-white hover:bg-emerald-500"
                >
                  Start
                </button>
              ) : (
                <div className="text-center">
                  <div className="text-xs uppercase tracking-wide text-neutral-300">Time!</div>
                  <div className="my-1 text-5xl font-bold text-emerald-400">{score}</div>
                  {score >= best && score > 0 && <div className="mb-1 text-xs text-amber-300">🏆 New best!</div>}
                  <button
                    onClick={start}
                    className="mt-2 rounded bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500"
                  >
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
                onClick={() => answerName(o)}
                className="rounded bg-neutral-700 py-2 font-mono text-base text-neutral-100 hover:bg-neutral-600"
              >
                {o}
              </button>
            ))}
          </div>
        )}

        {running && mode === 'color' && (
          <div className="mx-auto grid max-w-[360px] grid-cols-2 gap-2">
            <button
              onClick={() => answerColor(true)}
              className="rounded border border-neutral-600 bg-[#f0d9b5] py-3 text-base font-semibold text-neutral-900 hover:brightness-95"
            >
              Light
            </button>
            <button
              onClick={() => answerColor(false)}
              className="rounded border border-neutral-600 bg-[#b58863] py-3 text-base font-semibold text-white hover:brightness-95"
            >
              Dark
            </button>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="rounded-lg bg-panel p-4 text-center">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Time</div>
          <div className={`font-mono text-3xl ${timeLeft <= 5 && running ? 'text-rose-400' : 'text-ink'}`}>
            0:{String(timeLeft).padStart(2, '0')}
          </div>
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
          <div className="mt-1 text-[11px] text-neutral-500">best for “{MODE_LABEL[mode]}”</div>
        </div>

        <div className="rounded-lg bg-panel p-3 text-sm">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Mode</div>
          <div className="mb-3 grid grid-cols-2 gap-1">
            {(['find', 'name', 'color', 'knight'] as const).map((m) => (
              <button
                key={m}
                disabled={running}
                onClick={() => setMode(m)}
                className={`rounded px-2 py-1 text-xs disabled:opacity-50 ${
                  mode === m ? 'bg-emerald-600 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                }`}
              >
                {MODE_LABEL[m]}
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
          {mode !== 'knight' && (
            <label className="flex cursor-pointer items-center justify-between py-1 text-neutral-300">
              <span className="text-xs">Show pieces</span>
              <input type="checkbox" checked={showPieces} disabled={running} onChange={(e) => setShowPieces(e.target.checked)} />
            </label>
          )}
        </div>

        <p className="px-1 text-xs leading-snug text-neutral-500">{MODE_BLURB[mode]}</p>
      </div>
    </div>
  );
}
