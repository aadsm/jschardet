// Builds the browser-consumable bundles into dist/. Each entry produces
// both an unminified and a minified file:
//
//   dist/jschardet.esm.js     dist/jschardet.esm.min.js   — ESM, public jschardet API
//   dist/jschardet.js         dist/jschardet.min.js       — IIFE, attaches `jschardet` to window
//   dist/chardet.esm.js       dist/chardet.esm.min.js     — ESM, lower-level chardet API
//
// Sizes are dominated by the embedded base64 model payloads in
// src/models/*.bin.js. Wrappers ship zlib-compressed payloads (Z_FIXED) and
// run a first-party DEFLATE decoder at first readBytes() call. Node consumers
// use node:zlib (src/runtime/decompress.js); the swap-decompress plugin below
// redirects that import to the browser-side JS decoder for these bundles.
// We ship the unminified build alongside the minified one to keep debugging
// readable.

import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => resolve(repoRoot, 'src', p);
const out = (p) => resolve(repoRoot, 'dist', p);

// Redirect every import that resolves to src/runtime/decompress.js to the
// browser-side TS decoder. The .bin.js wrappers import '../runtime/decompress.js';
// under Node that resolves to the node:zlib shim, but for these browser bundles
// we don't want node:zlib in the output.
const swapDecompress = {
  name: 'swap-decompress',
  setup(b) {
    b.onResolve({ filter: /(^|\/)decompress\.js$/ }, (args) => {
      if (!args.importer || !/[\\/]runtime[\\/]decompress\.js$/.test(
        resolve(args.resolveDir, args.path),
      )) {
        return null;
      }
      return { path: resolve(repoRoot, 'src/runtime/decompress.browser.ts') };
    });
  },
};

const shared = {
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
  plugins: [swapDecompress],
};

// IIFE footer: src/index.ts has both named exports (detect, detectAll,
// enableDebug) and a default export. With globalName: 'jschardet' esbuild
// produces `var jschardet = { detect, detectAll, enableDebug, default: {...} }`.
// The footer collapses that so consumers can call `jschardet.detect(...)`
// directly — matching the documented browser usage.
const iifeFooter = 'jschardet = jschardet.default ? Object.assign(jschardet.default, jschardet) : jschardet;';

const targets = [
  { entry: 'index.ts',   format: 'esm',  base: 'jschardet.esm' },
  { entry: 'index.ts',   format: 'iife', base: 'jschardet',     globalName: 'jschardet', footer: iifeFooter },
  { entry: 'chardet.ts', format: 'esm',  base: 'chardet.esm' },
];

for (const t of targets) {
  for (const minify of [false, true]) {
    const suffix = minify ? '.min.js' : '.js';
    await esbuild.build({
      ...shared,
      entryPoints: [src(t.entry)],
      format: t.format,
      outfile: out(`${t.base}${suffix}`),
      minify,
      ...(t.globalName ? { globalName: t.globalName } : {}),
      ...(t.footer ? { footer: { js: t.footer } } : {}),
    });
  }
}
