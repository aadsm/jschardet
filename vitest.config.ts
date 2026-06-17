import { defineConfig } from 'vitest/config';
import { uint8arrayPlugin } from './scripts/lib/uint8array-plugin.js';

// Default config: runs every test on Node. `npm test` uses this. The
// browser run is opt-in via vitest.browser.config.ts (`npm run
// test:browser`).
export default defineConfig({
  plugins: [uint8arrayPlugin()],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      'tests/accuracy.test.ts',
      // Exercises the IIFE browser bundle via a <script> tag; only meaningful
      // under vitest.bundles.jschardet.config.ts.
      'tests/jschardet.global.test.ts',
    ],
    chaiConfig: { truncateThreshold: 0 },
    outputTruncateLength: 999,
    printConsoleTrace: true,
    hideSkippedTests: false,
  },
});
