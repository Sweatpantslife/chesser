import { useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { CoordinateBoard, piecesFromFen } from '../components/CoordinateBoard';
import { CALC_PUZZLES } from '../trainers/calc';
import { PUZZLES } from '../trainers/tactics';
import { playMoveSound } from '../lib/sound';
import type { CoordSide } from '../store/coordinate';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/** Replay a line of SAN/UCI moves from a FEN and return the resulting FEN. */
function fenAfter(fen: string, line: string[], uci = false): string {
  const g = new Chess(fen);
  for (const m of line) {
    if (uci) g.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    else g.move(m);
  }
  return g.fen();
}

export function VisionPage() {
  const [sub, setSub] = useState<'visualize' | 'blindfold'>('visualize');
  return (
    <div className="space-y-4">
      <div className="mx-auto flex w-full max-w-[1100px] gap-1">
        {(['visualize', 'blindfold'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setSub(m)}
            className={`rounded px-3 py-1.5 text-sm ${
              sub === m ? 'bg-emerald-700 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            {m === 'visualize' ? 'Visualize' : 'Blindfold solve'}
          </button>
        ))}
      </div>
      {sub === 'visualize' ? <Visualize /> : <Blindfold />}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Visualize: see the position, then it's hidden while a line is announced in
 * notation — calculate it in your head and answer a question.
 * ------------------------------------------------------------------------ */
type Stage = 'preview' | 'hidden' | 'question' | 'answered';

function Visualize() {
  const [idx, setIdx] = useState(0);
  const [stage, setStage] = useState<Stage>('preview');
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });

  const puzzle = CALC_PUZZLES[idx]!;
  const finalFen = useMemo(() => fenAfter(puzzle.fen, puzzle.line), [puzzle]);
  const orientation: CoordSide = puzzle.fen.split(' ')[1] === 'b' ? 'black' : 'white';

  const reset = (i: number) => {
    setIdx(i);
    setStage('preview');
    setPicked(null);
  };

  const answer = (choice: number) => {
    if (stage !== 'question') return;
    setPicked(choice);
    setStage('answered');
    const ok = choice === puzzle.answer;
    setScore((s) => ({ correct: s.correct + (ok ? 1 : 0), total: s.total + 1 }));
  };

  const next = () => reset((idx + 1) % CALC_PUZZLES.length);
  const correct = stage === 'answered' && picked === puzzle.answer;
  const showPieces = stage === 'preview' || stage === 'answered';
  const boardFen = stage === 'answered' ? finalFen : puzzle.fen;

  return (
    <div className="mx-auto grid w-full max-w-[1000px] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-3">
        <div className="flex h-7 items-center gap-2 text-sm text-neutral-400">
          <span className="rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-200">{puzzle.theme}</span>
          <span>{puzzle.prompt}</span>
        </div>
        <div className="mx-auto w-full max-w-[480px]">
          <CoordinateBoard
            orientation={orientation}
            showCoords
            showPieces={false}
            pieces={showPieces ? piecesFromFen(boardFen) : undefined}
            disabled
          />
        </div>
        {!showPieces && <p className="text-center text-xs text-neutral-400">Pieces hidden — picture the position.</p>}
      </div>

      <div className="space-y-3">
        <div className="rounded-lg bg-panel p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Visualize</h3>
            <span className="text-xs text-neutral-400">
              {score.correct}/{score.total} this session
            </span>
          </div>

          {stage === 'preview' && (
            <>
              <p className="mb-3 text-xs text-neutral-400">Study the position, then hide it and calculate the line below.</p>
              <button
                onClick={() => setStage('hidden')}
                className="w-full rounded bg-emerald-700 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                Hide pieces & show the line
              </button>
            </>
          )}

          {(stage === 'hidden' || stage === 'question' || stage === 'answered') && (
            <div className="mb-3">
              <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">The line</div>
              <div className="font-mono text-sm text-neutral-200">
                {puzzle.line.map((m, i) => (
                  <span key={i}>
                    {i % 2 === 0 && <span className="text-neutral-400">{i / 2 + 1}.</span>} {m}{' '}
                  </span>
                ))}
              </div>
            </div>
          )}

          {stage === 'hidden' && (
            <button
              onClick={() => setStage('question')}
              className="w-full rounded bg-emerald-700 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              I’ve calculated it →
            </button>
          )}

          {(stage === 'question' || stage === 'answered') && (
            <>
              <p className="mb-2 text-sm text-neutral-200">{puzzle.question}</p>
              <div className="grid grid-cols-2 gap-2">
                {puzzle.choices.map((c, i) => {
                  const isAnswer = i === puzzle.answer;
                  const isPicked = i === picked;
                  let cls = 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600';
                  if (stage === 'answered') {
                    if (isAnswer) cls = 'bg-emerald-700 text-white';
                    else if (isPicked) cls = 'bg-rose-700 text-white';
                    else cls = 'bg-neutral-800 text-neutral-400';
                  }
                  return (
                    <button
                      key={i}
                      disabled={stage === 'answered'}
                      onClick={() => answer(i)}
                      className={`rounded px-2 py-2 text-sm ${cls}`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {stage === 'answered' && (
            <>
              <p className={`mt-3 text-sm ${correct ? 'text-emerald-300' : 'text-rose-300'}`}>
                {correct ? '✓ Correct!' : `Not quite — the answer is “${puzzle.choices[puzzle.answer]}”.`} The board now shows
                the final position.
              </p>
              <button
                onClick={next}
                className="mt-3 w-full rounded bg-emerald-700 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                Next puzzle
              </button>
            </>
          )}
        </div>
        <p className="px-1 text-xs leading-snug text-neutral-400">
          Calculating without moving the pieces is the engine of tactics and endgames. Start short, build up.
        </p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Blindfold solve: the board is empty (coordinates only); the position is given
 * in words. Find the winning move by clicking from-square then to-square.
 * ------------------------------------------------------------------------ */
const PIECE_LETTER: Record<string, string> = { k: 'K', q: 'Q', r: 'R', b: 'B', n: 'N', p: '' };
const PIECE_ORDER = ['k', 'q', 'r', 'b', 'n', 'p'];

function pieceList(fen: string): { white: string; black: string } {
  const rows = fen.split(' ')[0]!.split('/');
  const items: { white: boolean; type: string; sq: string }[] = [];
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r]!) {
      if (/\d/.test(ch)) f += Number(ch);
      else {
        items.push({ white: ch === ch.toUpperCase(), type: ch.toLowerCase(), sq: `${FILES[f]}${8 - r}` });
        f++;
      }
    }
  }
  const fmt = (side: boolean) =>
    items
      .filter((i) => i.white === side)
      .sort((a, b) => PIECE_ORDER.indexOf(a.type) - PIECE_ORDER.indexOf(b.type) || a.sq.localeCompare(b.sq))
      .map((i) => `${PIECE_LETTER[i.type]}${i.sq}`)
      .join(', ');
  return { white: fmt(true), black: fmt(false) };
}

const EASY = PUZZLES.filter((p) => p.difficulty === 'easy');

function Blindfold() {
  // Start from the first puzzle's position — with a bare `new Chess()` the
  // first puzzle was unsolvable: clicking the correct answer tried to play it
  // on the STARTING position (wrong side to move) and chess.js threw.
  const game = useRef(new Chess(EASY[0]?.fen));
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);
  const [peek, setPeek] = useState(false);
  const [flash, setFlash] = useState<{ square: string; kind: 'ok' | 'bad' } | null>(null);
  const [feedback, setFeedback] = useState<string>('Find the winning move — click the piece, then its destination.');
  const [score, setScore] = useState({ correct: 0, total: 0 });

  const puzzle = EASY[idx] ?? EASY[0];
  const desc = useMemo(() => (puzzle ? pieceList(puzzle.fen) : { white: '', black: '' }), [puzzle]);
  const orientation: CoordSide = puzzle?.turn ?? 'white';

  const load = (i: number) => {
    const p = EASY[i];
    if (!p) return;
    game.current = new Chess(p.fen);
    setIdx(i);
    setSelected(null);
    setSolved(false);
    setPeek(false);
    setFlash(null);
    setFeedback('Find the winning move — click the piece, then its destination.');
  };

  if (!puzzle) {
    return <div className="mx-auto max-w-md rounded-lg bg-panel p-4 text-sm text-neutral-400">No easy puzzles available.</div>;
  }

  const onPick = (sq: string) => {
    if (solved) return;
    if (!selected) {
      setSelected(sq);
      return;
    }
    if (sq === selected) {
      setSelected(null);
      return;
    }
    const key = puzzle.solution[0]!;
    if (selected === key.slice(0, 2) && sq === key.slice(2, 4)) {
      const mv = game.current.move({ from: selected, to: sq, promotion: key[4] });
      playMoveSound(mv.san);
      setSolved(true);
      setPeek(true);
      setSelected(null);
      setFlash({ square: sq, kind: 'ok' });
      setScore((s) => ({ correct: s.correct + 1, total: s.total + 1 }));
      setFeedback(`✓ ${mv.san} — well seen! Board revealed.`);
    } else {
      setSelected(null);
      setFlash({ square: sq, kind: 'bad' });
      setTimeout(() => setFlash(null), 350);
      setFeedback('Not the move. Try again, peek, or reveal.');
    }
  };

  const reveal = () => {
    const key = puzzle.solution[0]!;
    game.current = new Chess(puzzle.fen);
    const mv = game.current.move({ from: key.slice(0, 2), to: key.slice(2, 4), promotion: key[4] });
    setSolved(true);
    setPeek(true);
    setScore((s) => ({ ...s, total: s.total + 1 }));
    setFeedback(`The move was ${mv.san}.`);
  };

  const next = () => load((idx + 1) % EASY.length);
  const boardFen = game.current.fen();

  return (
    <div className="mx-auto grid w-full max-w-[1000px] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-3">
        <div className="flex h-7 items-center gap-2 text-sm text-neutral-400">
          <span className="rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-200">Blindfold</span>
          <span>{puzzle.turn === 'white' ? 'White' : 'Black'} to play and win</span>
        </div>
        <div className="mx-auto w-full max-w-[480px]">
          <CoordinateBoard
            orientation={orientation}
            showCoords
            showPieces={false}
            pieces={peek ? piecesFromFen(boardFen) : undefined}
            highlight={selected}
            flash={flash}
            onPick={onPick}
            disabled={solved}
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-lg bg-panel p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Blindfold solve</h3>
            <span className="text-xs text-neutral-400">
              {score.correct}/{score.total} this session
            </span>
          </div>
          <div className="space-y-1 text-sm">
            <div>
              <span className="text-xs uppercase tracking-wide text-neutral-400">White:</span>{' '}
              <span className="font-mono text-neutral-200">{desc.white}</span>
            </div>
            <div>
              <span className="text-xs uppercase tracking-wide text-neutral-400">Black:</span>{' '}
              <span className="font-mono text-neutral-200">{desc.black}</span>
            </div>
          </div>
          <p className="mt-3 text-sm text-neutral-300">{feedback}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {!solved && (
              <>
                <button
                  onClick={() => setPeek((p) => !p)}
                  className="rounded bg-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-600"
                >
                  {peek ? 'Hide pieces' : 'Peek'}
                </button>
                <button
                  onClick={reveal}
                  className="rounded bg-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-600"
                >
                  Reveal
                </button>
              </>
            )}
            <button
              onClick={next}
              className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
            >
              Next puzzle →
            </button>
          </div>
        </div>
        <p className="px-1 text-xs leading-snug text-neutral-400">
          Holding the position in your mind’s eye and finding a move blind is the ultimate board-vision test.
        </p>
      </div>
    </div>
  );
}
