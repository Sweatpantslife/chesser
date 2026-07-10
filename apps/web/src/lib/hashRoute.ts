/**
 * Hash-route classification for App's navigation listener — pure so the
 * routing decisions (especially what must NOT navigate) are unit-testable.
 *
 * Kinds:
 *  - 'friend'       — #/friend/CODE, lands on the Friends view.
 *  - 'profile'      — #/profile/NAME, lands on that shared profile.
 *  - 'exit-overlay' — the hash was cleared (Back out of a hash-driven view):
 *                     a shared profile exists only via its hash, so leaving
 *                     the hash leaves the view.
 *  - 'ignore'       — anything else. Crucially this includes in-page anchors
 *                     like the accessibility skip link's #main: those must
 *                     move focus, never navigate views (see App's skip link).
 */

export type HashRoute = { kind: 'friend' } | { kind: 'profile'; user: string } | { kind: 'exit-overlay' } | { kind: 'ignore' };

export function parseHashRoute(hash: string): HashRoute {
  if (hash.startsWith('#/friend/')) return { kind: 'friend' };
  if (hash.startsWith('#/profile/')) {
    try {
      const user = decodeURIComponent(hash.slice('#/profile/'.length));
      if (user) return { kind: 'profile', user };
    } catch {
      // Malformed percent-encoding — treat as no route.
    }
    return { kind: 'ignore' };
  }
  if (hash === '' || hash === '#') return { kind: 'exit-overlay' };
  return { kind: 'ignore' };
}

/** Username from a shared-profile hash (#/profile/NAME), or null. */
export function profileHashUser(hash: string): string | null {
  const route = parseHashRoute(hash);
  return route.kind === 'profile' ? route.user : null;
}
