import { useEffect, useRef, useState } from 'react';
import type { ExplorerDb, ExplorerResult } from '@chesser/shared';
import { createExplorerFeed, type ExplorerFilters } from './explorerApi';

export interface ExplorerState {
  /** Stats for the current position, or null while the first fetch is pending. */
  result: ExplorerResult | null;
  loading: boolean;
}

/** How many top/recent games the explorer panels request. */
export const EXPLORER_GAMES = 5;

/**
 * Debounced, LRU-cached opening-explorer stats for a position. Cached
 * positions resolve synchronously (no flicker when stepping back through a
 * line); new positions keep the previous stats on screen, dimmed, while the
 * debounce + fetch runs.
 *
 * `active` (default true) gates the feed: while false the hook performs no
 * network activity at all — pending debounced fetches are cancelled — and on
 * a false→true transition the current position is fed immediately. This is
 * what lets a collapsed drawer keep the explorer mounted for free.
 */
export function useExplorer(fen: string, db: ExplorerDb, filters: ExplorerFilters, active = true): ExplorerState {
  const [state, setState] = useState<ExplorerState>({ result: null, loading: true });
  // The feed instance lives for the lifetime of the component; updates for
  // positions the user has already left are dropped inside the feed itself.
  const feedRef = useRef<ReturnType<typeof createExplorerFeed> | null>(null);
  if (feedRef.current === null) {
    feedRef.current = createExplorerFeed((u) => {
      setState((prev) => ({
        // Keep showing the previous position's stats (dimmed via `loading`)
        // instead of blanking the panel on every move.
        result: u.result ?? prev.result,
        loading: u.loading,
      }));
    }, { games: EXPLORER_GAMES });
  }

  const speedsKey = [...filters.speeds].sort().join(',');
  useEffect(() => {
    if (!active) {
      // Cancel any pending debounce so a fetch can't fire after deactivation.
      // The feed stays usable: the next set() (on reactivation) re-arms it.
      feedRef.current!.dispose();
      return;
    }
    feedRef.current!.set(fen, db, { speeds: filters.speeds, minRating: filters.minRating });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, fen, db, speedsKey, filters.minRating]);

  useEffect(() => () => feedRef.current?.dispose(), []);

  return state;
}
