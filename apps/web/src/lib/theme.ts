/**
 * Theme runtime — resolves the user's theme preference (light / dark / system)
 * to a concrete theme and stamps it on <html data-theme="…">, which is what
 * the token layer in index.css keys off.
 *
 * First paint is handled by the tiny inline script in index.html (it reads the
 * persisted settings straight out of localStorage so there is no flash of the
 * wrong theme); this module takes over once the app boots: the settings store
 * calls applyTheme() on rehydrate and on every setTheme(), and while the
 * preference is 'system' we follow live prefers-color-scheme changes.
 *
 * Everything is guarded for non-DOM environments (node test runner).
 */

export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** PWA chrome colors — keep in sync with --t-page in index.css. */
const THEME_COLOR: Record<ResolvedTheme, string> = {
  dark: '#141126',
  light: '#f1eefa',
};

const MEDIA_LIGHT = '(prefers-color-scheme: light)';

function systemPrefersLight(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(MEDIA_LIGHT).matches
    : false;
}

/** Pure preference → concrete theme ('system' falls back to dark when unknown). */
export function resolveTheme(pref: ThemePref, prefersLight: boolean = systemPrefersLight()): ResolvedTheme {
  if (pref === 'system') return prefersLight ? 'light' : 'dark';
  return pref;
}

function stamp(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[resolved]);
}

let systemListener: ((e: MediaQueryListEvent) => void) | null = null;
let systemMql: MediaQueryList | null = null;

/**
 * Apply a theme preference to the document. While the preference is 'system',
 * a single prefers-color-scheme listener keeps the document in sync live.
 */
export function applyTheme(pref: ThemePref): void {
  stamp(resolveTheme(pref));

  // (Re)wire the live system listener only when needed.
  if (systemMql && systemListener) {
    systemMql.removeEventListener('change', systemListener);
    systemMql = null;
    systemListener = null;
  }
  if (pref === 'system' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    systemMql = window.matchMedia(MEDIA_LIGHT);
    systemListener = (e) => stamp(e.matches ? 'light' : 'dark');
    systemMql.addEventListener('change', systemListener);
  }
}
