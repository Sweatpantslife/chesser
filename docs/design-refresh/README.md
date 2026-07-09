# Chesser design refresh — "playful night"

A full visual/audio identity refresh aimed at making Chesser feel young, modern
and fun for players of every level, while keeping (and improving) the app's
WCAG-AA accessibility baseline.

## Design language

- **Palette** — deep indigo night (`#141126`) with violet-tinted surfaces and
  neutrals, a violet brand accent (`brand-600 #7c3aed`), playful pink
  (`accent-400/600`), reward gold (`gold-400`) and the existing emerald for
  success. Tokens live in `apps/web/tailwind.config.js` (Tailwind theme) and as
  CSS variables in `apps/web/src/index.css` for raw-CSS/JS consumers.
- **Type** — Baloo 2 (display) + Nunito (body), both rounded, both variable
  fonts vendored as latin-subset woff2 (SIL OFL 1.1, licenses alongside the
  files in `apps/web/src/assets/fonts/`).
- **Shape & depth** — pill buttons, `rounded-2xl` cards, soft shadows
  (`shadow-soft`) and brand glows (`shadow-glow`).
- **Motion** — springy pop-ins, hover lifts, press squish, confetti bursts,
  a flickering streak flame and playful loading dots. Every animation and
  transition collapses under `prefers-reduced-motion: reduce` (global rule at
  the bottom of `index.css`); the confetti component additionally skips
  rendering particles entirely.
- **Sound** — a cohesive C-pentatonic synth set in `apps/web/src/lib/sound.ts`
  (Web Audio, zero asset bytes): move/capture/check/checkmate/castle/promotion,
  puzzle solved, wrong move, XP gain, level-up, streak, achievement, lesson
  complete, game start/win/loss/draw and a subtle UI tick. All cues are gated
  on the "Sounds" setting and kept at low gain.

### AA contrast (checked pairs, dark theme — the app ships dark-only)

| Pair | Ratio |
| --- | --- |
| ink `#f2eefe` on panel `#1e1a35` | 14.7:1 |
| neutral-400 `#a49cc8` on panel | 6.5:1 |
| neutral-300 `#c8c2e0` on neutral-800 `#282345` | 8.7:1 |
| white on brand-600 `#7c3aed` | 5.7:1 |
| white on accent-600 `#db2777` | 4.6:1 |
| gold-400 `#fbbf24` on panel | 10.0:1 |
| emerald-400 `#34d399` on panel | 8.7:1 |

`neutral-500` is reserved for large text / non-text UI (≈4:1).

## Asset inventory (source + license)

### Hand-authored (this repo, project license)

- `apps/web/src/components/icons.tsx` — logo mark + wordmark, 10 nav icons,
  UI icons (gear, sound on/off, star, trophy, sparkles, flame, …), streak
  flame, three empty-state illustrations, loading dots. All `currentColor` /
  token-variable driven.
- `apps/web/public/icon.svg` — new PWA/app icon (gradient knight).
- `apps/web/src/index.css` keyframes — confetti, pop-in, flame flicker,
  float, dot bounce, toast spring.
- Sound set — synthesised in code (`src/lib/sound.ts`), no third-party audio.

### Generated with Higgsfield MCP (Recraft V4.1 vector model), then optimized locally

| Asset | File | Weight |
| --- | --- | --- |
| Brand mascot ("Pep" the knight) | `apps/web/src/assets/img/mascot.svg` | 15.2 KB |
| Celebrating mascot | `apps/web/src/assets/img/mascot-cheer.svg` | 29.8 KB |
| Hero/landing artwork (Learn banner) | `apps/web/src/assets/img/hero.webp` (rasterized from generated SVG, 1344×756 q78) | 54.8 KB |
| Background doodle texture | `apps/web/src/assets/img/bg-texture.webp` (420×420 tile, q68) | 2.1 KB |
| Avatar set (owl, royal, robot, dragon, fox, panda) | `apps/web/public/img/avatars/*.svg` | 64.5 KB total |

Generation jobs (job IDs for provenance): mascot `54aac703`, cheer `38796412`,
hero `93b456f6`, texture `8846aae8`, avatars `cd40a65c`, `df4d7005`,
`a2cadabf`, `809742ab`, `311a7a51`, `044cd8d9`. Mascot SVGs had their
solid-white background path removed for transparency (no raster background
removal needed since the model returned vectors).

### Vendored fonts (SIL Open Font License 1.1)

- Baloo 2 variable, latin subset — `src/assets/fonts/baloo-2-latin-wght-normal.woff2` (32.4 KB), via Fontsource.
- Nunito variable, latin subset — `src/assets/fonts/nunito-latin-wght-normal.woff2` (38.2 KB), via Fontsource.
- Licenses: `src/assets/fonts/LICENSE-baloo-2.txt`, `src/assets/fonts/LICENSE-nunito.txt`.

**Total shipped asset weight: ~237 KB** (images ~166 KB + fonts ~71 KB, audio 0 KB).
Screenshots under `docs/design-refresh/img/` are documentation only and not
served by the app.

## Not touched

The post-game analysis/review internals (`AnalysisPanel`, `AnalysisCoach`,
`ReviewPanel`, `EvalBar`, `EvalGraph`, `MoveList`, `ExplorerPanel`,
`OpeningName`, `ReviewStats`) are being rebuilt on `feat/analysis-overhaul`;
they only pick up the global tokens (colors/fonts) and were not edited here.
