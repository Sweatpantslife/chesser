/** @type {import('tailwindcss').Config} */

/**
 * Chesser design tokens — "playful night" identity.
 *
 * The app is dark-first (color-scheme: dark). Every text/background pair used
 * in components is WCAG AA checked (see docs/design-refresh/README.md):
 *   - ink         #f2eefe on panel #1e1a35 → 14.7:1
 *   - neutral-400 #a49cc8 on panel         → 6.5:1  (muted body text)
 *   - neutral-300 #c8c2e0 on neutral-800   → 8.7:1  (chip text)
 *   - white       on brand-600 #7c3aed     → 5.7:1  (primary CTA)
 *   - white       on accent-600 #db2777    → 4.6:1  (pink CTA)
 *   - gold-400    #fbbf24 on panel         → 10:1   (reward text)
 *   - emerald-400 #34d399 on panel         → 8.7:1  (success text)
 * neutral-500 is reserved for large text / non-text UI only (≈4:1).
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        board: {
          light: '#ecd9b9',
          dark: '#b07d4f',
        },
        // Page + surface tokens (legacy names kept so existing classes reskin).
        page: '#141126',
        panel: '#1e1a35',
        panelmute: '#181530',
        ink: '#f2eefe',
        // Brand violet — primary actions, active nav, focus.
        brand: {
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
        },
        // Playful pink — highlights, streak-adjacent fun.
        accent: {
          300: '#f9a8d4',
          400: '#f472b6',
          500: '#ec4899',
          600: '#db2777',
        },
        // Reward gold — XP, badges, celebration.
        gold: {
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
        // Violet-tinted neutrals: same lightness steps as stock Tailwind
        // neutral (so existing AA pairs hold) but hued to the brand.
        neutral: {
          50: '#f7f5fd',
          100: '#ece9f7',
          200: '#ddd8ee',
          300: '#c8c2e0',
          400: '#a49cc8',
          500: '#7d76a3',
          600: '#4c4677',
          700: '#3a3560',
          800: '#282345',
          900: '#181530',
          950: '#0f0d1d',
        },
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
