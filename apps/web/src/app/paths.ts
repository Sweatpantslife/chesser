/**
 * Route paths for the 5-hub information architecture (Home · Play · Train ·
 * Learn · Profile), plus the legacy-URL redirect table.
 *
 * The app is hash-routed (react-router HashRouter), so every path here lives
 * after the `#` — e.g. `/train/tactics` is reached as `…/#/train/tactics`.
 *
 * Everything is pure data/functions so the redirect rules — especially what
 * must KEEP working (old share links, emails, bookmarks) — are unit-testable.
 */

/** Legacy view ids (the old flat tab bar + hash-only views) → new hub paths. */
const LEGACY_VIEW_PATHS: Record<string, string> = {
  home: '/',
  play: '/play',
  friends: '/play/friends',
  archive: '/profile/archive', // owner decision: game history lives under Profile
  tactics: '/train/tactics',
  endgame: '/train/endgames',
  'endgame-drills': '/train/endgames/drill',
  train: '/train', // the old umbrella "Train" tab dissolved into hub cards
  // The old Train tab's sub-tabs (`trainTab` state) — never URLs back then,
  // but cheap to honour forever for guessed/bookmarked hashes.
  vision: '/train/vision',
  mates: '/train/checkmates',
  checkmates: '/train/checkmates',
  blunders: '/train/anti-blunder',
  'anti-blunder': '/train/anti-blunder',
  coords: '/train/coordinates',
  coordinates: '/train/coordinates',
  coach: '/train', // coach lives in the Train hub's "Coach & Plan" strip
  plan: '/train/plan',
  learn: '/learn',
  openings: '/learn/openings',
  explorer: '/learn/openings/explore',
  masters: '/learn/masters',
  stats: '/profile/progress',
  leaders: '/profile/leaderboards',
  profile: '/profile',
  privacy: '/profile/about/privacy',
  terms: '/profile/about/terms',
};

/**
 * New path for a legacy view id (HomePage's `go`, StudyPlanPage's targets,
 * DeckTarget views, …). Unknown ids fall back to Home so a stale caller can
 * never produce a dead link.
 */
export function viewPath(view: string): string {
  return LEGACY_VIEW_PATHS[view] ?? '/';
}

/** Where a spaced-repetition deck's "Review now" goes (see lib/decks.ts). */
export function deckPath(target: { view: string; trainTab?: 'mates' | 'blunders' }): string {
  if (target.trainTab === 'mates') return '/train/checkmates';
  if (target.trainTab === 'blunders') return '/train/anti-blunder';
  return viewPath(target.view);
}

/**
 * Legacy hash-URL → new location, or null when the path is not a legacy URL.
 * Covers every pre-IA hash that was ever generated or shared:
 *   - `#/friend/CODE`  (friend-game invite links)   → `/play/friends/CODE`
 *   - `#/privacy` / `#/terms` (footer, settings, consent notice, emails)
 *   - every old flat tab id (`#/tactics`, `#/stats`, …) — these never used to
 *     be URLs, but they're cheap to honour forever.
 * `#/profile/NAME` (shared public profiles) is NOT here: that URL is
 * preserved as-is by the router (see the profile hub's reserved-word guard).
 */
export function legacyRedirect(pathname: string): string | null {
  if (pathname.startsWith('/friend/')) {
    const code = pathname.slice('/friend/'.length);
    // Codes are short alphanumerics; anything else is not a friend link.
    if (/^[A-Za-z0-9]{4,10}$/.test(code)) return `/play/friends/${code}`;
    return null;
  }
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/') return null; // real route, not a legacy alias
  const target = LEGACY_VIEW_PATHS[clean.slice(1)];
  return target ?? null;
}

/**
 * Reserved segments under `/profile/…` that are hub pages, never usernames.
 * `/profile/NAME` keeps rendering shared public profiles (old links must not
 * break), so a username that collides with a hub page can't be deep-linked —
 * profileAliasRedirect sends those segments to the hub page instead.
 */
const PROFILE_SEGMENT_ALIASES: Record<string, string> = {
  // current hub tabs (static routes also match these; kept here so the guard
  // is complete even for case variants like /profile/About)
  overview: '/profile',
  progress: '/profile/progress',
  archive: '/profile/archive',
  leaderboards: '/profile/leaderboards',
  about: '/profile/about',
  // old names that users may guess or have bookmarked
  stats: '/profile/progress',
  leaders: '/profile/leaderboards',
  ranks: '/profile/leaderboards',
  settings: '/profile/about',
  privacy: '/profile/about/privacy',
  terms: '/profile/about/terms',
};

/** Hub-page redirect for a `/profile/:segment` param, or null = a username. */
export function profileAliasRedirect(segment: string): string | null {
  return PROFILE_SEGMENT_ALIASES[segment.toLowerCase()] ?? null;
}
