import { useEffect, useState } from 'react';
import { apiDeleteGame, apiImport, apiListGames, type ImportedGame, type SavedGame } from '../lib/api';
import { useAuth } from '../store/auth';
import { useGame } from '../store/game';
import { Modal } from './Modal';

type Tab = 'saved' | 'import' | 'pgn' | 'fen';

export function LibraryDialog({ onClose }: { onClose: () => void }) {
  const token = useAuth((s) => s.token);
  const loadPgn = useGame((s) => s.loadPgn);
  const loadFen = useGame((s) => s.loadFen);

  const [tab, setTab] = useState<Tab>(token ? 'saved' : 'import');
  const [saved, setSaved] = useState<SavedGame[]>([]);
  const [site, setSite] = useState<'lichess' | 'chesscom'>('lichess');
  const [user, setUser] = useState('');
  const [imported, setImported] = useState<ImportedGame[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [fen, setFen] = useState('');
  const [pgn, setPgn] = useState('');

  useEffect(() => {
    if (tab === 'saved' && token) apiListGames(token).then((r) => setSaved(r.games)).catch(() => {});
  }, [tab, token]);

  const open = (pgn: string) => {
    if (loadPgn(pgn)) onClose();
    else setMsg('Could not read that game.');
  };

  const runImport = async () => {
    setBusy(true);
    setMsg(null);
    setImported(null);
    const r = await apiImport(site, user.trim(), 15);
    setBusy(false);
    if (!r.available) {
      setMsg(`Import unavailable (${r.reason ?? 'error'}). The ${site} API host must be reachable from the server.`);
      return;
    }
    setImported(r.games ?? []);
    if ((r.games?.length ?? 0) === 0) setMsg('No games found for that username.');
  };

  const tabBtn = (id: Tab, label: string) => (
    <button
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      className={`flex-1 rounded px-2 py-1 text-sm ${tab === id ? 'bg-emerald-600 text-white' : 'text-neutral-300 hover:bg-neutral-700'}`}
    >
      {label}
    </button>
  );

  return (
    <Modal onClose={onClose} label="Game library" className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-panel p-4 shadow-2xl">
        <div className="mb-3 flex gap-1 rounded bg-panelmute p-1">
          {tabBtn('saved', 'My games')}
          {tabBtn('import', 'Import')}
          {tabBtn('pgn', 'Paste')}
          {tabBtn('fen', 'FEN')}
        </div>

        {msg && (
          <p role="status" className="mb-2 text-xs text-amber-300">
            {msg}
          </p>
        )}

        {tab === 'saved' && (
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {!token ? (
              <p className="text-sm text-neutral-400">Sign in to save and revisit your analyzed games.</p>
            ) : saved.length === 0 ? (
              <p className="text-sm text-neutral-400">No saved games yet — use “Save” on the board to add one.</p>
            ) : (
              <ul className="space-y-1">
                {saved.map((g) => (
                  <li key={g.id} className="flex items-center gap-2">
                    <button onClick={() => open(g.pgn)} className="min-w-0 flex-1 rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-700">
                      <span className="text-neutral-200">{g.white}</span> <span className="text-neutral-500">vs</span>{' '}
                      <span className="text-neutral-200">{g.black}</span>
                      <span className="ml-2 text-xs text-neutral-500">{g.result}</span>
                    </button>
                    <button
                      onClick={() => token && apiDeleteGame(token, g.id).then(() => setSaved((s) => s.filter((x) => x.id !== g.id)))}
                      aria-label={`Delete game ${g.white} vs ${g.black}`}
                      className="rounded px-1.5 py-1 text-xs text-neutral-500 hover:text-rose-300"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'import' && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-2 flex gap-2">
              <div className="flex gap-1">
                {(['lichess', 'chesscom'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSite(s)}
                    aria-pressed={site === s}
                    className={`rounded px-2 py-1 text-xs ${site === s ? 'bg-emerald-600 text-white' : 'bg-neutral-700 text-neutral-300'}`}
                  >
                    {s === 'chesscom' ? 'Chess.com' : 'Lichess'}
                  </button>
                ))}
              </div>
              <input
                value={user}
                onChange={(e) => setUser(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && user.trim() && runImport()}
                placeholder="username"
                aria-label={`${site === 'chesscom' ? 'Chess.com' : 'Lichess'} username`}
                className="min-w-0 flex-1 rounded bg-neutral-800 px-2 py-1 text-sm text-ink outline-none"
              />
              <button onClick={runImport} disabled={busy || !user.trim()} className="rounded bg-emerald-600 px-3 py-1 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? '…' : 'Fetch'}
              </button>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              {imported && (
                <ul className="space-y-1">
                  {imported.map((g, i) => (
                    <li key={i}>
                      <button onClick={() => open(g.pgn)} className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-700">
                        <span className="text-neutral-200">{g.white}</span> <span className="text-neutral-500">vs</span>{' '}
                        <span className="text-neutral-200">{g.black}</span>
                        <span className="ml-2 text-xs text-neutral-500">
                          {g.result} {g.date ?? ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {tab === 'pgn' && (
          <div>
            <p className="mb-2 text-xs text-neutral-400">Paste a PGN to review it on the analysis board.</p>
            <textarea
              value={pgn}
              onChange={(e) => {
                setPgn(e.target.value);
                setMsg(null);
              }}
              rows={8}
              placeholder={'[Event "..."]\n\n1. e4 e5 2. Nf3 Nc6 ...'}
              aria-label="PGN text"
              className="w-full rounded bg-neutral-900 p-2 font-mono text-xs text-ink outline-none"
            />
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => (loadPgn(pgn.trim()) ? onClose() : setMsg('Could not read that PGN.'))}
                disabled={!pgn.trim()}
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                Load game
              </button>
            </div>
          </div>
        )}

        {tab === 'fen' && (
          <div>
            <p className="mb-2 text-xs text-neutral-400">Paste a FEN to analyze any position.</p>
            <input
              value={fen}
              onChange={(e) => {
                setFen(e.target.value);
                setMsg(null);
              }}
              placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
              aria-label="FEN position"
              className="w-full rounded bg-neutral-900 px-2 py-1.5 font-mono text-xs text-ink outline-none"
            />
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => (loadFen(fen.trim()) ? onClose() : setMsg('Invalid FEN.'))}
                disabled={!fen.trim()}
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                Analyze
              </button>
            </div>
          </div>
        )}

        <button onClick={onClose} className="mt-3 self-end text-xs text-neutral-500 hover:text-neutral-300">
          close
        </button>
    </Modal>
  );
}
