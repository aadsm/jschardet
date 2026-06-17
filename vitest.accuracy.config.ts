import { defineConfig } from 'vitest/config';

// Accuracy evaluation against the chardet test corpus. Excluded from the
// default `npm test` run because it clones ~100 MB of fixtures on first
// use and takes much longer than the unit suite. Run with:
//   npm run test:accuracy
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/accuracy.test.ts'],
    testTimeout: 120000,
    chaiConfig: { truncateThreshold: 0 },
    outputTruncateLength: 999,
    printConsoleTrace: true,
    hideSkippedTests: false,
  },
});
