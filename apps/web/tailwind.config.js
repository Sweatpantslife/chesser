/** @type {import('tailwindcss').Config} */
import twColors from 'tailwindcss/colors';

/**
 * Chesser design tokens — "playful night" (dark, default) + "playful day" (light).
 *
 * Themeable colors resolve through CSS variables (RGB triplets) defined in
 * src/index.css: `:root` carries the dark values, `:root[data-theme="light"]`
 * the light ones. Components keep using the same utility classes; the token
 * layer swaps underneath. Steps that are used as *colored surfaces with white
 * text* (brand/accent 500-800, emerald-500+, rose-500+, …) are fixed literals
 * shared by both themes.
 *
 * Every text/background pair used in components is WCAG AA checked
 * (see docs/design-refresh/README.md for the dark table). Light-theme pairs
 * (checked arithmetically, ratios vs panel #ffffff unless noted):
 *   - ink         #241e46 on panel → 15.6:1 (13.6:1 on page #f1eefa)
 *   - neutral-400 #4c4677 on panel → 8.6:1  (muted body text)
 *   - neutral-300 #3a3560 on neutral-800 #ddd8ee → 8.1:1 (chip text)
 *   - white       on brand-600 #7c3aed → 5.7:1 (unchanged)
 *   - brand-300   #6d28d9 on panel → 7.1:1
 *   - gold-400    #854d0e on panel → 6.9:1 (6.0:1 on page)
 *   - emerald-400 #065f46 on panel → 7.7:1
 *   - rose-400    #be123c on panel → 6.3:1
 * neutral-500 stays #7d76a3 in both themes (large text / non-text UI only).
 */

/** Themeable color: an RGB-triplet CSS variable with Tailwind alpha support. */
const v = (name) => `rgb(var(--t-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        board: {
          light: '#ecd9b9',
          dark: '#b07d4f',
        },
        // Chess-side indicators (clock faces, eval bar, "you played white"
        // dots). These mean WHITE/BLACK pieces, so they never re-theme.
        chess: {
          white: '#ece9f7',
          black: '#181530',
        },
        // Page + surface tokens (legacy names kept so existing classes reskin).
        page: v('page'),
        panel: v('panel'),
        panelmute: v('panelmute'),
        ink: v('ink'),
        // Brand violet — primary actions, active nav, focus. 200-400 are the
        // "readable accent on surface" steps and flip per theme; 500-800 are
        // fixed colored surfaces (white text stays AA in both themes).
        brand: {
          200: v('brand-200'),
          300: v('brand-300'),
          400: v('brand-400'),
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
        },
        // Playful pink — highlights, streak-adjacent fun.
        accent: {
          300: v('accent-300'),
          400: v('accent-400'),
          500: '#ec4899',
          600: '#db2777',
        },
        // Reward gold — XP, badges, celebration.
        gold: {
          300: v('gold-300'),
          400: v('gold-400'),
          500: '#f59e0b',
          600: '#d97706',
        },
        // Violet-tinted neutrals. The whole ramp flips in light mode
        // (50↔950, 100↔900, … 500 fixed) so existing AA pairs hold.
        neutral: {
          50: v('neutral-50'),
          100: v('neutral-100'),
          200: v('neutral-200'),
          300: v('neutral-300'),
          400: v('neutral-400'),
          500: '#7d76a3',
          600: v('neutral-600'),
          700: v('neutral-700'),
          800: v('neutral-800'),
          900: v('neutral-900'),
          950: v('neutral-950'),
        },
        // Stock status hues: the text steps (200-400) and the dark-tint chip
        // steps (900/950) flip per theme; 500-800 surfaces stay stock.
        emerald: {
          ...twColors.emerald,
          300: v('emerald-300'),
          400: v('emerald-400'),
          900: v('emerald-900'),
        },
        rose: {
          ...twColors.rose,
          200: v('rose-200'),
          300: v('rose-300'),
          400: v('rose-400'),
          900: v('rose-900'),
        },
        amber: {
          ...twColors.amber,
          200: v('amber-200'),
          300: v('amber-300'),
          950: v('amber-950'),
        },
        orange: {
          ...twColors.orange,
          300: v('orange-300'),
          400: v('orange-400'),
          900: v('orange-900'),
        },
        sky: { ...twColors.sky, 300: v('sky-300') },
        cyan: { ...twColors.cyan, 300: v('cyan-300') },
        blue: { ...twColors.blue, 300: v('blue-300') },
        lime: { ...twColors.lime, 300: v('lime-300') },
      },
      fontFamily: {
        sans: ['Nunito Variable', 'Nunito', 'ui-rounded', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Baloo 2 Variable', 'Baloo 2', 'Nunito Variable', 'ui-rounded', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        soft: '0 2px 6px -2px rgba(8, 6, 20, 0.55), 0 10px 28px -12px rgba(8, 6, 20, 0.5)',
        glow: '0 0 0 1px rgba(139, 92, 246, 0.28), 0 6px 24px -6px rgba(139, 92, 246, 0.45)',
        'glow-gold': '0 0 0 1px rgba(251, 191, 36, 0.3), 0 6px 24px -6px rgba(251, 191, 36, 0.4)',
      },
      borderRadius: {
        blob: '1.25rem',
      },
    },
  },
  plugins: [],
};
