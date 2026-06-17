import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';
import { uint8arrayPlugin } from './scripts/lib/uint8array-plugin.js';
import { bundleRedirectPlugin } from './scripts/lib/bundle-redirect-plugin.js';

// Runs the chardet-API detector tests against dist/chardet.esm.js in
// headless Chromium. detector.test.ts is the only browser-eligible file
// whose imports (detect, UniversalDetector, EncodingEra) are all
// re-exported from src/chardet.ts and therefore present on the bundle.
const abs = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [
    bundleRedirectPlugin({
      srcDir: abs('./src'),
      bundle: abs('./dist/chardet.esm.js'),
    }),
    uint8arrayPlugin(),
  ],
  test: {
    globals: true,
    include: ['tests/detector.test.ts'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
});
