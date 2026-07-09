/**
 * Human-vs-human hub: pass-and-play on one device, or an online game with a
 * friend via a shareable link/code. Both are unrated (casual) by design —
 * there is no matchmaking pool, so playing people you know needs no liquidity.
 */
import { useEffect, useState } from 'react';
import type { FriendColor } from '@chesser/shared';
import type { TimeControl } from '../store/game';
import { LocalGame, type LocalGameConfig } from './LocalGame';
import { OnlineGame } from './OnlineGame';
import type { FriendIntent } from './friendClient';
import { listCasualGames } from './casualHistory';
import { neutralBtn, primaryBtn } from './bits';

/** Casual-play presets (research: 5+0 / 10+0 / 15+10 cover most demand). */
const TIME_CONTROLS: (TimeControl | null)[] = [
  null, // unlimited
  { label: '3+2', initialMs: 180_000, incrementMs: 2_000 },
  { label: '5+0', initialMs: 300_000, incrementMs: 0 },
  { label: '10+0', initialMs: 600_000, incrementMs: 0 },
  { label: '15+10', initialMs: 900_000, incrementMs: 10_000 },
];

const NAME_KEY = 'chesser.friendName';

type Screen = { kind: 'menu' } | { kind: 'local'; config: LocalGameConfig } | { kind: 'online'; intent: FriendIntent };

/** `#/friend/CODE` → CODE (shareable friend-game links), else null. */
function codeFromHash(): string | null {
  const m = /^#\/friend\/([A-Za-z0-9]{4,10})$/.exec(window.location.hash);
  return m ? m[1]!.toUpperCase() : null;
}

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function TimeControlPicker({ value, onChange }: { value: TimeControl | null; onChange: (tc: TimeControl | null) => void }) {
  return (
    <div className="flex gap-1 rounded-lg bg-panelmute p-1">
      {TIME_CONTROLS.map((tc) => {
        const selected = (tc?.label ?? null) === (value?.label ?? null);
        return (
          <button
            key={tc?.label ?? 'unlimited'}
            onClick={() => onChange(tc)}
            className={`flex-1 rounded px-2 py-1 text-xs font-medium ${
              selected ? 'bg-emerald-600 text-white' : 'text-neutral-300 hover:bg-neutral-800'
            }`}
          >
            {tc?.label ?? '∞'}
          </button>
        );
      })}
    </div>
  );
}

const inputCls =
  'w-full rounded bg-panelmute px-2 py-1.5 text-sm text-ink placeholder-neutral-600 outline-none focus:ring-1 focus:ring-emerald-600';
const labelCls = 'text-xs font-medium uppercase tracking-wide text-neutral-500';

export function HumansPage() {
  const [screen, setScreen] = useState<Screen>(() => {
    const code = codeFromHash();
    return code ? { kind: 'online', intent: { kind: 'join', code, name: loadName() } } : { kind: 'menu' };
  });

  // Opening a friend link while the app is already running jumps into the
  // game. Re-announcing the code of the game we're already in is a no-op.
  useEffect(() => {
    const onHash = () => {
      const code = codeFromHash();
      if (!code) return;
      setScreen((cur) =>
        cur.kind === 'online' && cur.intent.kind === 'join' && cur.intent.code === code
          ? cur
          : { kind: 'online', intent: { kind: 'join', code, name: loadName() } },
      );
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (screen.kind === 'local') {
    return <LocalGame config={screen.config} onExit={() => setScreen({ kind: 'menu' })} />;
  }
  if (screen.kind === 'online') {
    // Keyed by game identity so switching to a different friend link tears the
    // old client/state down and joins the new game cleanly.
    const gameKey = screen.intent.kind === 'join' ? `join-${screen.intent.code}` : 'create';
    return <OnlineGame key={gameKey} intent={screen.intent} onExit={() => setScreen({ kind: 'menu' })} />;
  }
  return <Menu start={setScreen} />;
}

function Menu({ start }: { start: (s: Screen) => void }) {
  // Pass & play setup
  const [whiteName, setWhiteName] = useState('');
  const [blackName, setBlackName] = useState('');
  const [localTc, setLocalTc] = useState<TimeControl | null>(null);
  const [autoFlip, setAutoFlip] = useState(false);

  // Friend game setup
  const [myName, setMyName] = useState(loadName);
  const [onlineTc, setOnlineTc] = useState<TimeControl | null>(null);
  const [myColor, setMyColor] = useState<FriendColor | 'random'>('random');
  const [joinCode, setJoinCode] = useState('');

  const recent = listCasualGames().slice(0, 6);

  const saveName = (name: string) => {
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* ignore */
    }
  };

  const startLocal = () =>
    start({
      kind: 'local',
      config: {
        white: whiteName.trim() || 'White',
        black: blackName.trim() || 'Black',
        timeControl: localTc,
        autoFlip,
      },
    });

  const createOnline = () => {
    saveName(myName.trim());
    start({
      kind: 'online',
      intent: {
        kind: 'create',
        name: myName.trim(),
        timeControl: onlineTc ? { initialMs: onlineTc.initialMs, incrementMs: onlineTc.incrementMs, label: onlineTc.label } : null,
        color: myColor,
      },
    });
  };

  const joinOnline = () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    saveName(myName.trim());
    start({ kind: 'online', intent: { kind: 'join', code, name: myName.trim() } });
  };

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-4">
      <div>
        <h2 className="text-lg font-bold text-ink">Play a human</h2>
        <p className="text-sm text-neutral-500">Casual, unrated games — on this device or online with a friend.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Pass & play */}
        <section className="space-y-3 rounded-lg bg-panel p-4" data-testid="card-local">
          <div>
            <h3 className="font-semibold text-ink">🤝 Pass &amp; play</h3>
            <p className="text-xs text-neutral-500">Two players, one device. Hand it over between moves.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className={labelCls}>White</span>
              <input className={inputCls} placeholder="White" value={whiteName} onChange={(e) => setWhiteName(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>Black</span>
              <input className={inputCls} placeholder="Black" value={blackName} onChange={(e) => setBlackName(e.target.value)} />
            </label>
          </div>
          <div className="space-y-1">
            <span className={labelCls}>Time control</span>
            <TimeControlPicker value={localTc} onChange={setLocalTc} />
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input type="checkbox" checked={autoFlip} onChange={(e) => setAutoFlip(e.target.checked)} className="accent-emerald-600" />
            Auto-flip the board to face the player to move
          </label>
          <button className={`${primaryBtn} w-full`} onClick={startLocal} data-testid="start-local">
            Start pass &amp; play
          </button>
        </section>

        {/* Friend link */}
        <section className="space-y-3 rounded-lg bg-panel p-4" data-testid="card-online">
          <div>
            <h3 className="font-semibold text-ink">🔗 Play a friend online</h3>
            <p className="text-xs text-neutral-500">Create a game and share the link — no account needed.</p>
          </div>
          <label className="block space-y-1">
            <span className={labelCls}>Your name (optional)</span>
            <input
              className={inputCls}
              placeholder="Anonymous"
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              data-testid="online-name"
            />
          </label>
          <div className="space-y-1">
            <span className={labelCls}>Time control</span>
            <TimeControlPicker value={onlineTc} onChange={setOnlineTc} />
          </div>
          <div className="space-y-1">
            <span className={labelCls}>You play</span>
            <div className="flex gap-1 rounded-lg bg-panelmute p-1">
              {(['white', 'random', 'black'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setMyColor(c)}
                  data-testid={`color-${c}`}
                  className={`flex-1 rounded px-2 py-1 text-xs font-medium capitalize ${
                    myColor === c ? 'bg-emerald-600 text-white' : 'text-neutral-300 hover:bg-neutral-800'
                  }`}
                >
                  {c === 'random' ? '⚄ Random' : c === 'white' ? '□ White' : '■ Black'}
                </button>
              ))}
            </div>
          </div>
          <button className={`${primaryBtn} w-full`} onClick={createOnline} data-testid="create-online">
            Create game &amp; get link
          </button>
          <div className="flex items-center gap-2 pt-1">
            <input
              className={inputCls}
              placeholder="Have a code? e.g. QK7DPM"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && joinOnline()}
              data-testid="join-code"
            />
            <button className={neutralBtn} onClick={joinOnline} disabled={!joinCode.trim()} data-testid="join-online">
              Join
            </button>
          </div>
        </section>
      </div>

      {recent.length > 0 && (
        <section className="rounded-lg bg-panel p-4">
          <h3 className="mb-2 text-sm font-semibold text-ink">Recent casual games</h3>
          <ul className="space-y-1 text-sm text-neutral-400">
            {recent.map((g, i) => (
              <li key={`${g.at}-${i}`} className="flex flex-wrap items-center gap-x-2">
                <span className="text-neutral-500">{new Date(g.at).toLocaleDateString()}</span>
                <span className="text-neutral-300">
                  {g.white} vs {g.black}
                </span>
                <span>{g.winner === 'draw' ? '½–½' : g.winner === 'white' ? '1–0' : '0–1'}</span>
                <span className="text-neutral-600">
                  · {g.reason} · {g.mode === 'local' ? 'pass & play' : 'friend link'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
