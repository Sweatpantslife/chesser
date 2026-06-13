/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        board: {
          light: '#ecd9b9',
          dark: '#b07d4f',
        },
        panel: '#1f2430',
        panelmute: '#171b24',
        ink: '#e7e2d6',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
