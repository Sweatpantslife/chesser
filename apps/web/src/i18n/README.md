# i18n (react-i18next)

## Layout

```
src/i18n/index.ts            i18next bootstrap + language helpers (detect/set/list)
src/i18n/format.ts           Intl number/date helpers + useLocaleFormat() hook
src/i18n/localeParity.test.ts  key-parity test (en vs every other locale)
src/locales/<lng>/<ns>.json  translations, one JSON file per namespace
```

## How loading works

- **English is the source and fallback.** Its JSON files are bundled eagerly
  into the entry chunk (`import.meta.glob(..., { eager: true })`) so the first
  render never shows raw keys — those strings used to live inline in the
  components anyway, so this does not regress the code-splitting work.
- **Every other locale is lazy.** `i18next-resources-to-backend` maps a
  locale+namespace to `import('../locales/<lng>/<ns>.json')`; Vite emits one
  small chunk per file and it is fetched only when that language is active.
- The active language is detected as: explicit choice in
  `localStorage["chesser-lang"]` → first matching `navigator.languages` entry
  (exact tag, then base subtag: `es-MX` → `es`) → `en`. Only the Settings
  switcher (via `setLanguage`) writes the localStorage key.
- `<html lang>` follows the active language automatically.

## Adding a language

1. Copy `src/locales/en/` to `src/locales/<code>/` (BCP-47 code, e.g. `pt-BR`)
   and translate the values. Keep keys, plural suffixes and `{{placeholders}}`.
2. That's it — no code changes. The glob in `src/i18n/index.ts` registers the
   language, the Settings switcher lists it (named via `Intl.DisplayNames`),
   and `localeParity.test.ts` fails CI until the files mirror English exactly.

## Conventions

- **Namespaces by surface**: `common`, `nav`, `settings`, `account`, `legal`,
  `gamify` today; add one per surface as more chrome is extracted (`game`,
  `tactics`, `coach`, …). Register new namespaces in `NAMESPACES`
  (src/i18n/index.ts) and add the JSON to *every* locale directory.
- **Stable, semantic keys** (`settings.language.label`), never English text.
- **Interpolation**: `{{name}}`; **plurals**: `key_one` / `key_other` (+ the
  locale's CLDR categories, `count` drives selection); **rich text**: named
  tags (`<policyLink>…</policyLink>`) rendered with `<Trans components={{...}}>`.
- **Numbers/dates**: use `useLocaleFormat()` (react-friendly `Intl` wrappers)
  or i18next's built-in `{{value, number}}` / `{{when, datetime}}` formats.
  Never hand-concatenate localized numbers.
- **Scope**: app *chrome* only. Content data (lesson prose, master-game
  annotations, opening/endgame descriptions, privacy/ToS body copy) stays
  English by design.
- In components use `useTranslation('<ns>')`; outside React import the
  instance: `import i18n from '../i18n'` and call `i18n.t('ns:key')`.
