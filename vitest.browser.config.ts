import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { uint8arrayPlugin } from './scripts/lib/uint8array-plugin.js';

// Browser-mode config (opt-in via `npm run test:browser`). Runs the
// subset of the suite that doesn't depend on Node-only APIs (the dynamic
// 100 MB corpus clone, the iconv-lite test oracle, the Python codec
// oracle subprocess) inside real headless Chromium via Playwright.
//
// The decompress.js → decompress.browser.ts swap mirrors the esbuild plugin in
// scripts/build-bundles.js: source-mode browser tests must not pull in
// src/runtime/decompress.js's `import 'node:zlib'`.
const browserDecoder = fileURLToPath(new URL('./src/runtime/decompress.browser.ts', import.meta.url));
const nodeDecoderAbs = fileURLToPath(new URL('./src/runtime/decompress.js', import.meta.url));

const swapDecompress = {
  name: 'swap-decompress',
  enforce: 'pre' as const,
  resolveId(source: string, importer: string | undefined) {
    if (!importer) return null;
    if (!/(^|\/)decompress\.js$/.test(source)) return null;
    const importerDir = importer.replace(/[/\\][^/\\]*$/, '');
    const resolved = resolvePath(importerDir, source);
    if (resolved === nodeDecoderAbs) return browserDecoder;
    return null;
  },
};

export default defineConfig({
  plugins: [uint8arrayPlugin(), swapDecompress],
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      // Clones a 100 MB corpus dynamically; Node-only by design.
      'tests/accuracy.test.ts',
      // iconv-lite oracle is Node-only (Buffer); Vite externalizes
      // node:buffer in browser builds, so importing these blows up.
      'tests/equivalences.test.ts',
      'tests/github_issues.test.ts',
      // Spawns python3 as a long-lived codec oracle; no browser equivalent.
      'tests/spec_decode_roundtrip.test.ts',
      // Uses node:fs, node:child_process, node:os — Node-only by design.
      'tests/cli.test.ts',
      // Exercises the IIFE browser bundle via a <script> tag; only meaningful
      // under vitest.bundles.jschardet.config.ts (which builds the bundle first).
      'tests/jschardet.global.test.ts',
    ],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
});
