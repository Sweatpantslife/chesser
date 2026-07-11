/**
 * i18n bootstrap (i18next + react-i18next).
 *
 * Design:
 *  - English is the source language and the fallback; its chrome strings are
 *    bundled EAGERLY into the entry chunk (a few KB — the same strings used to
 *    live inline in the components), so the first paint never flashes raw keys.
 *  - Every other locale is a LAZY chunk: `i18next-resources-to-backend` turns
 *    each `src/locales/<lng>/<ns>.json` into a dynamic `import()`, which Vite
 *    code-splits per file. Non-active locales cost the initial bundle nothing.
 *  - Adding a language = adding a `src/locales/<code>/` directory with the
 *    same JSON files as `en/`. The `import.meta.glob` below discovers it, the
 *    Settings language switcher lists it (named in its own language via
 *    `Intl.DisplayNames`), and the key-parity test enforces its completeness.
 *  - The user's explicit choice persists in localStorage (LANGUAGE_STORAGE_KEY,
 *    written only by setLanguage — plain detection never writes). Settings are
 *    otherwise local-only in this app (store/settings is not part of the
 *    account sync snapshot), so language deliberately isn't synced either.
 */
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import resourcesToBackend from 'i18next-resources-to-backend';

export const FALLBACK_LANGUAGE = 'en';

/** localStorage key for the user's explicit language choice ("chesser-" prefix
 *  keeps it inside the app's documented local-data namespace, so the
 *  delete-account local wipe and the privacy policy's claims still hold). */
export const LANGUAGE_STORAGE_KEY = 'chesser-lang';

/** Namespaces, one per surface. Phase 1 covers the app chrome; later phases
 *  add per-surface namespaces (game, tactics, coach, …) as they are extracted. */
export const NAMESPACES = ['account', 'common', 'gamify', 'legal', 'nav', 'settings'] as const;

// Locale directories present at build time. `import.meta.glob` without `eager`
// only records the matching paths — nothing is imported until requested.
const localeDirs = import.meta.glob('../locales/*/common.json');

/** Language codes with a `src/locales/<code>/` directory (includes 'en'). */
export const SUPPORTED_LANGUAGES: readonly string[] = Object.keys(localeDirs)
  .map((path) => path.split('/').at(-2))
  .filter((code): code is string => typeof code === 'string')
  .sort();

// English resources, bundled eagerly (see module comment).
const enModules = import.meta.glob('../locales/en/*.json', { eager: true }) as Record<
  string,
  { default: Record<string, unknown> }
>;
const enResources: Record<string, Record<string, unknown>> = {};
for (const [path, mod] of Object.entries(enModules)) {
  const ns = path.split('/').at(-1)?.replace(/\.json$/, '');
  if (ns) enResources[ns] = mod.default;
}

/** Map a BCP-47 tag to a supported language code (exact, then base subtag). */
function matchSupported(tag: string): string | undefined {
  const lower = tag.toLowerCase();
  const exact = SUPPORTED_LANGUAGES.find((l) => l.toLowerCase() === lower);
  if (exact) return exact;
  const base = lower.split('-')[0];
  if (!base) return undefined;
  return SUPPORTED_LANGUAGES.find((l) => l.toLowerCase() === base);
}

/** Initial language: explicit stored choice, else browser locale, else 'en'. */
export function detectLanguage(): string {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored) {
      const match = matchSupported(stored);
      if (match) return match;
    }
  } catch {
    // localStorage unavailable (privacy mode) — fall through to the navigator.
  }
  if (typeof navigator !== 'undefined') {
    for (const tag of [...(navigator.languages ?? []), navigator.language]) {
      if (tag) {
        const match = matchSupported(tag);
        if (match) return match;
      }
    }
  }
  return FALLBACK_LANGUAGE;
}

/** A language's name in that language ("English", "Español"), for the switcher. */
export function languageDisplayName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    if (name) return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    // Unknown/invalid code — fall through to the raw code.
  }
  return code;
}

/** Switch the UI language and persist the explicit choice. */
export function setLanguage(lng: string): Promise<unknown> {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch {
    // Not persistable — still switch for this session.
  }
  return i18next.changeLanguage(lng);
}

void i18next
  // Any non-bundled locale/namespace resolves through a dynamic import that
  // Vite turns into one lazy chunk per locale JSON file.
  .use(resourcesToBackend((lng: string, ns: string) => import(`../locales/${lng}/${ns}.json`)))
  .use(initReactI18next)
  .init({
    lng: detectLanguage(),
    fallbackLng: FALLBACK_LANGUAGE,
    ns: [...NAMESPACES],
    defaultNS: 'common',
    // Bundled English + backend for everything else.
    resources: { en: enResources },
    partialBundledLanguages: true,
    // Synchronous init: bundled English is in the store before the first
    // render. A detected non-English locale streams in and re-renders.
    initAsync: false,
    // React already escapes interpolated values.
    interpolation: { escapeValue: false },
    returnNull: false,
    // No Suspense: until a lazy locale lands, t() serves the English fallback.
    react: { useSuspense: false },
  });

// Keep <html lang> honest for screen readers, hyphenation and font selection.
// (Registered after init — the init-time languageChanged fired before this —
// so mirror the current value once, then follow changes.)
if (typeof document !== 'undefined') {
  i18next.on('languageChanged', (lng) => {
    document.documentElement.lang = lng;
  });
  document.documentElement.lang = i18next.language || FALLBACK_LANGUAGE;
}

export default i18next;
