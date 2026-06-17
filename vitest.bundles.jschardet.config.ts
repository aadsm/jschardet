import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';
import { uint8arrayPlugin } from './scripts/lib/uint8array-plugin.js';
import { bundleRedirectPlugin } from './scripts/lib/bundle-redirect-plugin.js';

// Runs the public-API tests against dist/jschardet.esm.js (and
// dist/jschardet.js for the global build smoke test) in headless
// Chromium. Any src/* import is redirected to the ESM bundle so tests
// exercise the built artefact, not unbundled source.
const abs = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [
    bundleRedirectPlugin({
      srcDir: abs('./src'),
      bundle: abs('./dist/jschardet.esm.js'),
    }),
    uint8arrayPlugin(),
  ],
  test: {
    globals: true,
    include: ['tests/jschardet.test.ts', 'tests/jschardet.global.test.ts'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
});
