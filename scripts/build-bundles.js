// Builds the browser bundles into dist/, plus build/index.cjs:
//
//   dist/jschardet.esm.js     dist/jschardet.esm.min.js   — ESM, public jschardet API
//   dist/jschardet.js         dist/jschardet.min.js       — IIFE, attaches `jschardet` to window
//                                                           (+ a define() call for AMD loaders)
//   dist/chardet.esm.js       dist/chardet.esm.min.js     — ESM, lower-level chardet API
//   build/index.cjs                                       — CommonJS, public jschardet API
//
// dist/ is browser-targeted and build/ is Node-targeted, so build/index.cjs —
// what `require('jschardet')` resolves to — sits with the rest of the Node
// output rather than in dist/.
//
// It is built here rather than by tsc because tsc derives the output extension
// from the input extension: .ts yields .js, and only .cts would yield .cjs. Its
// CommonJS output would therefore mean either renaming the sources or a second
// compile pass into a directory carrying its own "type": "commonjs" — a
// parallel tree of files either way, where esbuild emits a single bundle.
//
// Sizes are dominated by the embedded base64 model payloads in
// src/models/*.bin.js. Wrappers ship zlib-compressed payloads (Z_FIXED) and
// run a first-party DEFLATE decoder at first readBytes() call. Node consumers
// use node:zlib (src/runtime/decompress.js); the swap-decompress plugin below
// redirects that import to the browser-side JS decoder for the browser
// bundles. build/index.cjs is built for Node, so it keeps node:zlib.
// We ship the unminified build alongside the minified one to keep debugging
// readable.

import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => resolve(repoRoot, 'src', p);
const out = (p) => resolve(repoRoot, p);

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
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
};

// src/index.ts has both named exports (detect, detectAll, enableDebug,
// VERSION, chardet) and a default export. With globalName: 'jschardet' esbuild
// produces `var jschardet = { detect, detectAll, ..., default: {...} }`. This
// collapses that so consumers can call `jschardet.detect(...)` directly —
// matching the documented browser usage.
const collapseDefault =
  'jschardet = jschardet.default ? Object.assign(jschardet.default, jschardet) : jschardet;';

// jschardet 3 built this bundle with browserify --standalone, which emits a
// UMD wrapper, so it also registered itself with AMD loaders. That was never a
// documented feature, but consumers rely on it in the wild, and one define()
// call is cheap enough to keep. esbuild's IIFE output already covers the
// documented <script src> case — a top-level `var` in a classic script becomes
// a window property — so only the AMD hand-off has to be added. The CommonJS
// third of a real UMD wrapper is deliberately absent: "type": "module" means
// Node parses this file as ESM and would never reach it. Node consumers get
// build/index.cjs instead.
const iifeFooter = `${collapseDefault}
if (typeof define === "function" && define.amd) define([], function () { return jschardet; });`;

const targets = [
  { entry: 'index.ts',   format: 'esm',  base: 'dist/jschardet.esm' },
  {
    entry: 'index.ts', format: 'iife', base: 'dist/jschardet',
    globalName: 'jschardet', footer: iifeFooter,
  },
  { entry: 'chardet.ts', format: 'esm',  base: 'dist/chardet.esm' },
  // Node CommonJS entry — what the "require" condition in package.json points
  // at. Built for Node so node:zlib stays external and stays used; not
  // minified, since Node consumers get no benefit from it and readable stack
  // traces matter more.
  { entry: 'index.ts', format: 'cjs', base: 'build/index', ext: '.cjs', platform: 'node', minified: false },
];

for (const t of targets) {
  const platform = t.platform ?? 'browser';
  const ext = t.ext ?? '.js';
  for (const minify of t.minified === false ? [false] : [false, true]) {
    const suffix = minify ? `.min${ext}` : ext;
    await esbuild.build({
      ...shared,
      platform,
      plugins: platform === 'browser' ? [swapDecompress] : [],
      entryPoints: [src(t.entry)],
      format: t.format,
      outfile: out(`${t.base}${suffix}`),
      minify,
      ...(t.globalName ? { globalName: t.globalName } : {}),
      ...(t.footer ? { footer: { js: t.footer } } : {}),
    });
  }
}
