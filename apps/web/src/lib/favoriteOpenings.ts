import { apiListGames } from './api';
import { listCasualGames } from '../humans/casualHistory';
import { applyReview, fromCasualGame, fromSavedGame, peekCachedReview, selfNames, storedFriendName, type ArchiveGame } from './archive';
import { openingCounts } from './archiveStats';
import { detectOpening } from './openings';
import type { FavoriteOpening } from './socialApi';

/**
 * Compute the player's most-played openings for the shared profile card,
 * reusing the Archive pipeline read-only: saved account games + local casual
 * games, openings from cached reviews or the offline ECO book. Returns the
 * top `limit` as the compact display shape the social API stores.
 */
export async function computeFavoriteOpenings(token: string | null, username: string | null, limit = 5): Promise<FavoriteOpening[]> {
  const self = selfNames(username, storedFriendName());
  let games: ArchiveGame[] = [];
  if (token) {
    try {
      const { games: saved } = await apiListGames(token);
      games = saved.map((g) => {
        const norm = fromSavedGame(g, self);
        return norm.gameKey ? applyReview(norm, peekCachedReview(norm.gameKey)) : norm;
      });
    } catch {
      // Offline / expired session — fall through with casual games only.
    }
  }
  games = games.concat(listCasualGames().map((r, i) => fromCasualGame(r, i, self)));

  // Name openings the reviews didn't already carry (offline ECO lookup).
  const resolved = await Promise.all(
    games.map(async (g) => {
      if (g.opening || g.sans.length === 0) return g;
      const info = await detectOpening(g.sans).catch(() => null);
      return info ? { ...g, opening: { eco: info.eco, name: info.name } } : g;
    }),
  );

  return openingCounts(resolved, limit).map((o) => ({ name: o.name, eco: o.eco, games: o.games, wins: o.wins }));
}
