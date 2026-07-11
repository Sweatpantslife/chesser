/**
 * Human-vs-human hub: pass-and-play on one device, or an online game with a
 * friend via a shareable link/code. Both are unrated (casual) by design —
 * there is no matchmaking pool, so playing people you know needs no liquidity.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FriendColor } from '@chesser/shared';
import { useLocaleFormat } from '../i18n/format';
import type { TimeControl } from '../store/game';
import { LocalGame, type LocalGameConfig } from './LocalGame';
import { OnlineGame } from './OnlineGame';
import type { FriendIntent } from './friendClient';
import { listCasualGames } from './casualHistory';
import { FriendsPanel } from './FriendsPanel';
import { neutralBtn, primaryBtn, reasonText, TimeControlPicker } from './bits';

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

const inputCls =
  'w-full rounded-lg bg-panelmute px-2.5 py-1.5 text-sm text-ink placeholder-neutral-500 outline-none focus:ring-2 focus:ring-brand-500';
const labelCls = 'text-xs font-medium uppercase tracking-wide text-neutral-400';

export function HumansPage({ active = true }: { active?: boolean }) {
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
  return <Menu start={setScreen} active={active} />;
}

function Menu({ start, active }: { start: (s: Screen) => void; active: boolean }) {
  const { t } = useTranslation('friends');
  const fmt = useLocaleFormat();
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
        white: whiteName.trim() || t('colors.white'),
        black: blackName.trim() || t('colors.black'),
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
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-ink">{t('menu.title')}</h2>
          <p className="text-sm text-neutral-400">{t('menu.subtitle')}</p>
        </div>
        {/* Generated avatar crew (docs/design-refresh/README.md) — pure vibes. */}
        <div className="hidden items-center sm:flex" aria-hidden="true">
          {['owl', 'fox', 'robot', 'dragon', 'royal', 'panda'].map((a, i) => (
            <img
              key={a}
              src={`/img/avatars/${a}.svg`}
              alt=""
              loading="lazy"
              className={`h-9 w-9 rounded-full ring-2 ring-page ${i > 0 ? '-ml-2' : ''}`}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Pass & play */}
        <section className="space-y-3 rounded-2xl bg-panel p-4 shadow-soft" data-testid="card-local">
          <div>
            <h3 className="font-semibold text-ink">{t('local.title')}</h3>
            <p className="text-xs text-neutral-400">{t('local.hint')}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className={labelCls}>{t('colors.white')}</span>
              <input className={inputCls} placeholder={t('colors.white')} value={whiteName} onChange={(e) => setWhiteName(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className={labelCls}>{t('colors.black')}</span>
              <input className={inputCls} placeholder={t('colors.black')} value={blackName} onChange={(e) => setBlackName(e.target.value)} />
            </label>
          </div>
          <div className="space-y-1">
            <span className={labelCls}>{t('timeControl.label')}</span>
            <TimeControlPicker value={localTc} onChange={setLocalTc} />
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input type="checkbox" checked={autoFlip} onChange={(e) => setAutoFlip(e.target.checked)} className="accent-brand-500" />
            {t('local.autoFlip')}
          </label>
          <button className={`${primaryBtn} w-full`} onClick={startLocal} data-testid="start-local">
            {t('local.start')}
          </button>
        </section>

        {/* Friend link */}
        <section className="space-y-3 rounded-2xl bg-panel p-4 shadow-soft" data-testid="card-online">
          <div>
            <h3 className="font-semibold text-ink">{t('online.title')}</h3>
            <p className="text-xs text-neutral-400">{t('online.hint')}</p>
          </div>
          <label className="block space-y-1">
            <span className={labelCls}>{t('online.nameLabel')}</span>
            <input
              className={inputCls}
              placeholder={t('online.namePlaceholder')}
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              data-testid="online-name"
            />
          </label>
          <div className="space-y-1">
            <span className={labelCls}>{t('timeControl.label')}</span>
            <TimeControlPicker value={onlineTc} onChange={setOnlineTc} />
          </div>
          <div className="space-y-1">
            <span className={labelCls}>{t('challenge.youPlay')}</span>
            <div className="flex gap-1 rounded-lg bg-panelmute p-1">
              {(['white', 'random', 'black'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setMyColor(c)}
                  data-testid={`color-${c}`}
                  className={`btn-press flex-1 rounded-full px-2 py-1 text-xs font-semibold capitalize ${
                    myColor === c ? 'bg-brand-600 text-white' : 'text-neutral-300 hover:bg-neutral-800'
                  }`}
                >
                  {c === 'random' ? t('colors.pickRandom') : c === 'white' ? t('colors.pickWhite') : t('colors.pickBlack')}
                </button>
              ))}
            </div>
          </div>
          <button className={`${primaryBtn} w-full`} onClick={createOnline} data-testid="create-online">
            {t('online.create')}
          </button>
          <div className="flex items-center gap-2 pt-1">
            <input
              className={inputCls}
              placeholder={t('online.codePlaceholder')}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && joinOnline()}
              data-testid="join-code"
            />
            <button className={neutralBtn} onClick={joinOnline} disabled={!joinCode.trim()} data-testid="join-online">
              {t('online.join')}
            </button>
          </div>
        </section>
      </div>

      {/* Account-based friends: requests, challenges and the activity feed.
          Accepting (or having accepted) a challenge drops straight into an
          ordinary friend-link online game via the same start() path. */}
      <FriendsPanel
        active={active}
        onJoinGame={(code, name) => start({ kind: 'online', intent: { kind: 'join', code, name } })}
      />

      {recent.length > 0 && (
        <section className="rounded-2xl bg-panel p-4 shadow-soft">
          <h3 className="mb-2 font-display text-sm font-semibold text-ink">{t('recent.title')}</h3>
          <ul className="space-y-1 text-sm text-neutral-400">
            {recent.map((g, i) => (
              <li key={`${g.at}-${i}`} className="flex flex-wrap items-center gap-x-2">
                <span className="text-neutral-400">{fmt.date(g.at)}</span>
                <span className="text-neutral-300">{t('recent.vs', { white: g.white, black: g.black })}</span>
                <span>{g.winner === 'draw' ? '½–½' : g.winner === 'white' ? '1–0' : '0–1'}</span>
                <span className="text-neutral-400">
                  · {reasonText(t, g.reason)} · {g.mode === 'local' ? t('recent.modeLocal') : t('recent.modeOnline')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
