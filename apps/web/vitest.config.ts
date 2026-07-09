import { defineConfig } from 'vitest/config';

// Pure lib tests run in node; component tests opt into jsdom per-file with a
// leading `// @vitest-environment jsdom` comment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
