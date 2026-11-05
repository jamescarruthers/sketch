import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Under Playwright a saved file must not reload the page mid-test: the state a test built up goes with it.
  server: { port: 5173, watch: process.env.E2E ? null : undefined },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
  // Named up front: found late, it makes the dev server reload the page mid-session.
  optimizeDeps: { include: ['opentype.js'] },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // The canvas palette reads src/ui/tokens.css as text; Vitest would otherwise stub every stylesheet to "".
    css: { include: [/tokens\.css/] },
  },
});
