# Slikk.Dev — Client Attribution Kit

A drop-in "Developed by **Slikk.Dev**" footer credit for the sites and apps we
build for clients. The wordmark is the real Outfit-800 brand mark converted to
**outlined vector paths**, so it looks identical everywhere with **no font
dependency**.

> **Cardinal rule: never harm the client's site.** Everything here is built for
> that — total style isolation, zero network requests, no JS required, no
> tracking, accessible, and SEO-safe. Pick the file that matches the stack and
> paste it in.

---

## What's in the kit

| File | Use it for |
|------|------------|
| `slikk-credit.html` | **Default.** Paste into any HTML footer. Self-contained (scoped CSS + inline SVG). |
| `SlikkCredit.jsx` | React / Next.js / Remix / Gatsby. Server-component safe. |
| `slikk-credit.webcomponent.js` | **Hostile-CSS sites only.** Shadow-DOM `<slikk-credit>` — bulletproof isolation. |
| `slikk-credit.svg` | Standalone vector asset (`<img>`, CSS background, design tools, native apps). Neutral grey ink. |
| `slikk-credit-on-dark.png` | Raster fallback, **light** ink for **dark** footers (email, native, legacy). Transparent. |
| `slikk-credit-on-light.png` | Raster fallback, **dark** ink for **light** footers. Transparent. |

**Colour behaviour:** in the HTML/React/web-component versions the lettering is
`currentColor` (it adopts the footer's text colour automatically) and the
period is always brand accent `#FF2D6B`. The standalone `.svg` and `.png`
assets have baked-in colours because `<img>`/email/native can't inherit one.

---

## ⚠️ Read first: keep the link `rel="nofollow"`

Every snippet ships with `rel="nofollow noopener noreferrer"`. **Do not remove
`nofollow`.**

A site-wide footer backlink repeated across dozens of client domains — same
anchor, same target — is a classic *link-scheme footprint*. Left "dofollow",
Google will likely auto-discount those links anyway, and at worst flag
slikk.dev for unnatural inbound links. `nofollow` avoids that entirely while we
still get the **referral traffic + brand exposure** (which drives branded
searches — the SEO signal that actually compounds).

> Want real link equity from a client? Ask for **one contextual dofollow link**
> from their About/Tech page or a testimonial. That single editorial link is
> worth far more than N identical footer links — and it doesn't put either site
> at risk.

`noopener noreferrer` is a security requirement for any `target="_blank"` link
(prevents reverse-tabnabbing). Keep it too.

---

## Quick start by stack

> For most web stacks the choice **doesn't matter** — use `slikk-credit.html`
> (or the React component) and you're done; `currentColor` adapts to the
> footer. The stacks where it *genuinely* matters are **email** and **native
> apps** (no HTML/CSS inheritance) — see those sections.

### Plain HTML / static sites / hand-coded
Paste the contents of **`slikk-credit.html`** wherever the footer lives. Done.

### React / Next.js / Remix / Gatsby / Astro (React island)
Copy **`SlikkCredit.jsx`** into the project and render it:

```jsx
import SlikkCredit from './SlikkCredit';

export default function Footer() {
  return (
    <footer>
      {/* …client's footer content… */}
      <SlikkCredit />
    </footer>
  );
}
```

It's a pure presentational component (no hooks, no `'use client'`) so it works
as a **React Server Component** and prerenders to static HTML — zero JS shipped.
Customise with props: `<SlikkCredit text="Built suspiciously fast by" />`.

### Vue / Nuxt
The HTML snippet works as-is inside any `<template>`. Vue's `scoped` styles
won't touch it (the `dsk-` class is already namespaced), but to be tidy put the
`<style>` block from `slikk-credit.html` in a **non-scoped** `<style>` or a
global stylesheet, and the markup in the template.

```vue
<template>
  <!-- paste the <a class="dsk-credit"> … </a> markup here -->
</template>
<style>/* paste the .dsk-credit rules here (note: NOT scoped) */</style>
```

### Svelte / SvelteKit
Svelte scopes component CSS by default, which would strip the `.dsk-credit`
rules. Two options: wrap the rules in `:global(){ … }`, **or** simplest — drop
the whole `slikk-credit.html` block inside `{@html ...}` or just into
`app.html`. For a single footer credit, pasting into `src/app.html` is easiest.

### Astro / 11ty / Hugo / Jekyll (static generators)
Paste `slikk-credit.html` into the footer partial/include
(`Footer.astro`, `footer.njk`, `partials/footer.html`, `_includes/footer.html`).
No build config needed.

### Angular
Add the markup to the footer component template and the CSS to that component's
stylesheet **with `ViewEncapsulation.None`** (or put the rules in
`styles.css`/global styles) so Angular doesn't rewrite the selectors.

### WordPress
- **Block / FSE themes:** Site Editor → Template Parts → *Footer* → add a
  **Custom HTML** block → paste `slikk-credit.html`.
- **Classic themes:** Appearance → Widgets → footer area → **Custom HTML**
  widget, or add to the theme's `footer.php` before `</footer>`.
- **Elementor / Divi / Bricks:** drop an **HTML / Code** element into the
  footer template and paste.

### Shopify (Liquid)
Paste `slikk-credit.html` into `sections/footer.liquid` (or a Custom Liquid
block in the theme editor) before the closing footer tag.

### Webflow / Framer / Squarespace / Wix (no-code)
Add an **Embed / Custom HTML / Code** element to the footer and paste
`slikk-credit.html`. (On plans without code embeds, use an **Image** element
pointing at `slikk-credit.svg`, linked to `https://slikk.dev/` — but you lose
auto colour-adaptation, so pick the on-dark/on-light asset to match.)

### Sites with hostile / aggressive global CSS
If the host nukes everything with `* { … !important }`, heavy resets, or
framework preflight that reaches into embeds, use the **Shadow-DOM** variant for
guaranteed isolation:

```html
<script src="slikk-credit.webcomponent.js" defer></script>
<footer> … <slikk-credit></slikk-credit> </footer>
```

Nothing can leak in or out of a shadow root. (Costs one tiny inline script and
needs JS enabled — that's the trade.)

---

## Where the stack really matters

### Email footers / signatures / transactional email
Email is **not** the web. Rules:
- **No external CSS, no `<style>` reliability, no `currentColor`.** Many clients
  (notably Outlook) also **don't render SVG**.
- ✅ Use a **PNG** (`slikk-credit-on-dark.png` / `-on-light.png`), inline
  `style` attributes, and a table cell. Set an explicit pixel width.

```html
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
  <td style="font:600 13px/1 Arial,sans-serif;color:#6b7280;padding-right:8px;">
    Lovingly over&#8209;engineered by
  </td>
  <td>
    <a href="https://slikk.dev/" target="_blank" rel="nofollow noopener">
      <img src="https://slikk.dev/slikk-credit-on-light.png"
           alt="Slikk.Dev" width="80" style="display:block;border:0;" />
    </a>
  </td>
</tr></table>
```

Host the PNG on a stable URL (e.g. `slikk.dev`) and pick the asset that matches
the email's background. Provide `alt="Slikk.Dev"`.

### Native mobile apps (iOS / Android / React Native / Flutter)
There's no HTML footer, and you should **not** open links in the system browser
abruptly. Use the vector asset + an in-app browser:
- **iOS (SwiftUI):** add `slikk-credit.svg` (or a PDF/asset-catalog vector) and
  open `https://slikk.dev/` with `SFSafariViewController` / `Link`.
- **Android (Compose):** vector drawable from the SVG; open with a
  **Custom Tab** (`androidx.browser`).
- **React Native:** `react-native-svg`'s `SvgXml` with the contents of
  `slikk-credit.svg`; link via `Linking.openURL` or an in-app browser.
- **Flutter:** `flutter_svg` (`SvgPicture.asset`); link via `url_launcher`.

Give the control an accessibility label "Developed by Slikk.Dev". `nofollow`
is irrelevant in apps (no crawl), but keep the link honest.

---

## Writing the credit line

The line before the wordmark is a **signature, not an ad**. It should feel like
a quiet, confident maker's mark — the agency voice ("Ryan Reynolds as CEO of
Apple": audacious but tailored) dialled *down* out of respect for the client's
brand. Get this wrong and a good build looks needy; get it right and it reads
like a flex you didn't have to make.

**Rules**

1. **Short.** 2–5 words. It's a credit, not a headline. If it wraps to two
   lines, it's too long.
2. **It leads into "Slikk.Dev".** The wordmark completes the sentence, so the
   line must read naturally with the name appended and end on (or imply) *by*:
   "Built by **Slikk.Dev**" ✅, not "We made this awesome site" ✗.
3. **One wink, not three.** At most a single clever beat. Two jokes is trying too
   hard; the restraint *is* the flex.
4. **Match the client's register, not just ours.** Dial the wit to the brand —
   a law firm or clinic gets understated; a music label or startup can take
   playful. Use the tiers below as a volume knob.
5. **Never overshadow or over-claim.** It's about *the work*, quietly. No
   superlatives ("the best site ever"), no first-person that could be mistaken
   for the client's own voice, no exclamation marks.
6. **Match the site's language.** On a Hebrew/RTL client site, write the line in
   Hebrew (see below) — don't mix scripts. The wordmark stays Latin either way.
7. **Pick one and keep it.** Choose a single line per client and leave it; don't
   rotate copy randomly across pages.
8. **Mind the punctuation.** Keep the `&#8209;` non-breaking hyphen in
   "over‑engineered" (and similar) so it never breaks across lines.

**Examples by register** (the part before **Slikk.Dev**)

- *Understated* — law, finance, healthcare, corporate, luxury:
  "Site by" · "Designed & built by" · "Crafted by" · "Engineered by"
- *Signature* — our default voice, fits most projects:
  "Lovingly over‑engineered by" · "Built suspiciously fast by" ·
  "Engineered with unreasonable care by" · "Made to load fast and age slowly by"
- *Playful* — startups, creative, music, lifestyle:
  "Built with reckless precision by" · "Obsessively built by" ·
  "Handcrafted pixels by" · "Probably too fast — by"

**Hebrew / RTL** (set `dir="rtl"` on the `<a>`; the Latin wordmark stays LTR):

- *Understated:* "עוצב ופותח על־ידי" (designed & developed by)
- *Signature:* "פותח בקפידה יתרה על־ידי" (developed with excessive care by)
- *Playful:* "נבנה במהירות חשודה על־ידי" (built at suspicious speed by)

**Where to set it:** React → `text` prop. HTML / web component → edit the
`<span class="dsk-credit__text">` / `text=""` attribute.

---

## Customisation

- **Size.** Change `.dsk-credit__mark { height: 15px }`. The wordmark scales
  crisply at any size (it's vector). The text uses `13px`.
- **Colour.** Lettering follows the footer text colour automatically. To pin it,
  set `color` on `.dsk-credit`. The accent dot is locked to `#FF2D6B`.
- **Placement.** It's `display:inline-flex`; wrap it or add margins via the
  `className`/host footer. Never make it `position:fixed` floating over content.

---

## Accessibility

- The link has a descriptive `aria-label`; the SVG is `aria-hidden` (the visible
  text + label already convey it) so screen readers don't double-announce.
- Visible `:focus-visible` ring (keyboard users), AA-contrast default ink.
- Respects `prefers-reduced-motion`. No motion, no autoplay, no layout shift.

---

## Regenerating the wordmark (for future maintainers)

The paths were generated from the **variable Outfit** font instanced at
`wght=800`, with a faux-italic shear and a smaller word-case "Dev" baked into
the path coordinates (so no font, no CSS transforms, are needed at runtime). If
the brand mark changes, re-outline rather than hand-editing path data:

1. Get the Outfit variable `.ttf` (Google Fonts: `ofl/outfit/Outfit[wght].ttf`).
   The `next/font` cache under `.next/static/media/` has it too, but its subset
   instances misreport their weight in OS/2 — pulling the upstream variable font
   and instancing it yourself is more reliable.
2. Use `fonttools` to instance at weight 800
   (`instantiateVariableFont(font, {"wght": 800})`) and draw each glyph through
   `SVGPathPen` + `TransformPen`, matrix `(s, 0, shear·s, -s, penX, 0)`:
   - "Slikk": full size, italic — `s=1`, `shear=0.20`
   - accent dot ".": upright, full size — `s=1`, `shear=0`, fill `#FF2D6B`
   - "Dev": word-case, smaller (the `<small>` ≈ `font-size:smaller`), italic —
     `s=0.83`, `shear=0.20`
   advancing `penX` by each glyph's `hmtx` width × `s`, plus letter-spacing
   `-0.045em` (≈ −45 units × `s`). Join "Slikk" + "Dev" into the `currentColor`
   path; keep the dot as its own accent path.
3. Round coordinates to integers, set `viewBox` to the path bounds (+ a few
   units of padding), and verify by rasterising.

Tuning knobs: shear `0.20` (italic angle), "Dev" scale `0.83`, and
letter-spacing `-0.045em`. Regenerate the `.png` fallbacks too — light ink
`#F0EDE8` for on-dark, dark ink `#374151` for on-light, transparent background.
