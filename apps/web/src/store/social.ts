import { create } from 'zustand';
import { useAuth } from './auth';
import { useRatings } from './ratings';
import { getPuzzleRushBest, subscribePuzzleRushBest } from '../lib/rushBest';
import {
  apiGetSocialPrefs,
  apiPutSocialPrefs,
  apiSubmitScore,
  DEFAULT_SOCIAL_PREFS,
  type FavoriteOpening,
  type SocialPrefs,
} from '../lib/socialApi';

/**
 * Share prefs + leaderboard participation. The SERVER is the source of truth
 * for both the prefs and every ranked value — this store is a thin cache plus
 * the submission pump. It reads the ratings/repertoire stores strictly
 * read-only; scores it submits are re-validated server-side against the synced
 * progress blob (see apps/server/src/social/validation.ts), so nothing here is
 * trusted.
 *
 * Not persisted on purpose: prefs are per-account and privacy-sensitive, so
 * they're refetched per session instead of risking a stale copy leaking
 * across sign-ins on a shared device.
 */

interface SocialState {
  prefs: SocialPrefs | null; // null until loaded for the signed-in account
  favoriteOpenings: FavoriteOpening[];
  busy: boolean;
  error: string | null;

  /** Fetch prefs for the signed-in account (no-op when signed out). */
  load(): Promise<void>;
  /** Patch prefs (and optionally the favorite-openings display data). */
  save(patch: Partial<SocialPrefs>, favoriteOpenings?: FavoriteOpening[]): Promise<boolean>;
  /** Push current scores to every board (server validates + dedupes). */
  submitScores(): Promise<void>;
  clear(): void;
}

export const useSocial = create<SocialState>()((set, get) => ({
  prefs: null,
  favoriteOpenings: [],
  busy: false,
  error: null,

  async load() {
    const token = useAuth.getState().token;
    if (!token) return;
    try {
      const { prefs, favoriteOpenings } = await apiGetSocialPrefs(token);
      set({ prefs, favoriteOpenings, error: null });
      if (prefs.leaderboards) void get().submitScores();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Could not load share settings' });
    }
  },

  async save(patch, favoriteOpenings) {
    const token = useAuth.getState().token;
    if (!token) return false;
    // Optimistic: flip the switch immediately; the server's sanitized copy
    // replaces it on success and the previous state returns on failure.
    const prev = get().prefs;
    set({ prefs: { ...(prev ?? DEFAULT_SOCIAL_PREFS), ...patch }, busy: true, error: null });
    try {
      const { prefs } = await apiPutSocialPrefs(token, patch, favoriteOpenings);
      set({ prefs, ...(favoriteOpenings !== undefined ? { favoriteOpenings } : {}) });
      if (prefs.leaderboards) void get().submitScores();
      return true;
    } catch (e) {
      set({ prefs: prev, error: e instanceof Error ? e.message : 'Could not save share settings' });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async submitScores() {
    const token = useAuth.getState().token;
    const prefs = get().prefs;
    if (!token || !prefs?.leaderboards) return;
    const cats = useRatings.getState().categories;
    const submissions: { board: 'puzzles' | 'bots' | 'rush'; value: number }[] = [];
    if (cats.puzzles.played > 0) submissions.push({ board: 'puzzles', value: Math.round(cats.puzzles.elo) });
    if (cats.bots.played > 0) submissions.push({ board: 'bots', value: Math.round(cats.bots.elo) });
    const rush = getPuzzleRushBest();
    if (rush > 0) submissions.push({ board: 'rush', value: rush });
    // Failures are non-fatal: the server may briefly disagree until the next
    // progress sync lands, or rate-limit a rapid improvement — both resolve on
    // the next submit pass.
    await Promise.all(submissions.map((s) => apiSubmitScore(token, s.board, s.value).catch(() => undefined)));
  },

  clear() {
    set({ prefs: null, favoriteOpenings: [], busy: false, error: null });
  },
}));

/** Convenience: prefs with signed-out/unloaded fallback (all private). */
export function prefsOrDefault(prefs: SocialPrefs | null): SocialPrefs {
  return prefs ?? DEFAULT_SOCIAL_PREFS;
}

let wired = false;

/**
 * Wire the submission pump: load prefs when a session appears, clear them when
 * it goes, and push fresh scores (debounced) when the ratings book or the
 * puzzle-rush best moves. Called once from App, alongside initGamify.
 */
export function initSocial(): void {
  if (wired) return;
  wired = true;

  let lastToken: string | null = null;
  const onAuth = (token: string | null) => {
    if (token === lastToken) return;
    lastToken = token;
    if (token) void useSocial.getState().load();
    else useSocial.getState().clear();
  };
  useAuth.subscribe((s) => onAuth(s.token));
  onAuth(useAuth.getState().token);

  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    // Debounced past lib/sync's 1.5s push so the server-side progress blob is
    // (usually) already up to date when the score arrives for cross-checking.
    timer = setTimeout(() => void useSocial.getState().submitScores(), 4_000);
  };
  useRatings.subscribe(schedule);
  subscribePuzzleRushBest(schedule);
}
