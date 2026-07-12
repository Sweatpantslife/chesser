/**
 * Shared data source for everything built on the game archive: the Archive
 * tab's games list (`pages/ArchivePage`) and the Progress tab's game-insights
 * widgets (`components/GameInsights`). Both render the same normalized list —
 * server-saved games (when signed in) merged with this device's casual games,
 * enriched with any cached review and a detected opening name.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../store/auth';
import { apiListGames, type SavedGame } from './api';
import { listCasualGames } from '../humans/casualHistory';
import {
  applyReview,
  fromCasualGame,
  fromSavedGame,
  peekCachedReview,
  selfNames,
  storedFriendName,
  type ArchiveGame,
} from './archive';
import { detectOpening } from './openings';

/** Session-wide memo of detected openings, keyed by report-cache gameKey. */
const detectedOpenings = new Map<string, { eco: string | null; name: string } | null>();

export interface ArchiveGamesState {
  /** Newest first, reviews applied, openings resolved where detectable. */
  games: ArchiveGame[];
  loading: boolean;
  loadError: boolean;
  retry: () => void;
}

export function useArchiveGames(): ArchiveGamesState {
  const token = useAuth((s) => s.token);
  const username = useAuth((s) => s.username);

  const [saved, setSaved] = useState<SavedGame[] | null>(token ? null : []);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [openings, setOpenings] = useState<Record<string, { eco: string | null; name: string } | null>>({});
  const [casualGames] = useState(() => listCasualGames());

  useEffect(() => {
    if (!token) {
      setSaved([]);
      return;
    }
    let cancelled = false;
    setSaved(null);
    setLoadError(false);
    apiListGames(token)
      .then((r) => {
        if (!cancelled) setSaved(r.games);
      })
      .catch(() => {
        if (!cancelled) {
          setSaved([]);
          setLoadError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, retryNonce]);

  const loading = token != null && saved === null;

  // Normalize both sources into ArchiveGames (newest first), enriched with any
  // cached review (accuracy / opening / player side) — read without touching
  // the report cache's LRU order.
  const games = useMemo(() => {
    const self = selfNames(username, storedFriendName());
    const fromLibrary = (saved ?? []).map((g) => {
      const norm = fromSavedGame(g, self);
      return norm.gameKey ? applyReview(norm, peekCachedReview(norm.gameKey)) : norm;
    });
    const fromCasual = casualGames.map((r, i) => fromCasualGame(r, i, self));
    return [...fromLibrary, ...fromCasual].sort((a, b) => b.playedAt - a.playedAt);
  }, [saved, username, casualGames]);

  // Name the openings of games whose review didn't already carry one.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, { eco: string | null; name: string } | null> = {};
      let any = false;
      for (const g of games) {
        if (g.opening || !g.gameKey || g.sans.length === 0) continue;
        let hit = detectedOpenings.get(g.gameKey);
        if (hit === undefined) {
          const info = await detectOpening(g.sans).catch(() => null);
          if (cancelled) return;
          hit = info ? { eco: info.eco, name: info.name } : null;
          detectedOpenings.set(g.gameKey, hit);
        }
        next[g.gameKey] = hit;
        any = true;
      }
      if (!cancelled && any) setOpenings(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [games]);

  const resolvedGames = useMemo(
    () => games.map((g) => (!g.opening && g.gameKey && openings[g.gameKey] ? { ...g, opening: openings[g.gameKey]! } : g)),
    [games, openings],
  );

  return { games: resolvedGames, loading, loadError, retry: () => setRetryNonce((n) => n + 1) };
}

/**
 * Reference time for the archive's period filters. Kept in state (not
 * Date.now() inside consumers' memos) so a tab left open for days refreshes
 * its '7d'/'30d' cutoffs when the user comes back to it.
 */
export function useVisibleNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, []);
  return now;
}
