#!/usr/bin/env node
// Bundle-size benchmark: jschardet 4 vs jschardet 3.
//
// Unlike the other four benchmarks this one is machine-independent: dist/ is
// committed, so the numbers are a deterministic function of the repo. It
// prints no hardware footer for that reason, and it can be re-run off the
// canonical benchmark machine without invalidating the rest of the set.
//
// Measures the committed bundles rather than rebuilding: CI's "Check dist
// files match source" step fails when a rebuild would change dist/, so the
// committed files are already known to match src/.
//
// gzip is node:zlib at its default level 6, which is what nginx/CloudFront
// and friends serve at. Do not cross-check with the `gzip` binary and expect
// a match: GNU gzip 1.12 -6 emits 699,418 bytes where zlib emits 695,114 for
// the same input — 0.6% apart at the same nominal level, because they are
// different deflate implementations. zlib is the reproducible choice (no
// dependency on whichever gzip the machine happens to ship) and the one that
// matches what a browser downloads.
//
// KiB is bytes / 1024 rounded to nearest, the form docs/performance.md and
// the README table use. The "README row" line at the end is meant to be
// pasted rather than re-rounded by hand.
//
// Usage:
//   node tests/benchmark/bundle.js
//
// First run installs jschardet 3 into tests/bench-deps/ (cached afterwards).
//
// tests/bundle-size.test.ts imports measureBundle/toKiB from here, so module
// scope stays pure: no side effects, and nothing pulled in beyond node:fs and
// node:zlib. Installing jschardet 3 (which shells out to npm) and reading its
// version happen in the CLI block at the bottom, behind a dynamic import.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const v3Dir = join(root, 'tests', 'bench-deps', 'jschardet-3', 'node_modules', 'jschardet');

export function measureBundle(path) {
  const bytes = readFileSync(path);
  return { minified: bytes.length, gzipped: gzipSync(bytes).length };
}

export const toKiB = (bytes) => Math.round(bytes / 1024);
const withThousands = (n) => n.toLocaleString('en-US');

function printResults(results) {
  const HEADERS = ['Bundle', 'Minified', 'Gzipped', 'Minified (bytes)', 'Gzipped (bytes)'];
  const rows = results.map(({ label, minified, gzipped }) => [
    label,
    `${withThousands(toKiB(minified))} KiB`,
    `${withThousands(toKiB(gzipped))} KiB`,
    withThousands(minified),
    withThousands(gzipped),
  ]);
  const widths = HEADERS.map((_, ci) =>
    Math.max(...[HEADERS, ...rows].map(r => r[ci].length))
  );
  const fmtRow = (cells) => '| ' + cells.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |';
  const sep = '+-' + widths.map(w => '-'.repeat(w)).join('-+-') + '-+';
  const [v4] = results;
  console.log(`
Bundle size benchmark: ${results.map(r => r.label).join(' vs ')}
(committed dist/, gzip level 6; machine-independent)

${sep}
${fmtRow(HEADERS)}
${sep}
${rows.map(fmtRow).join('\n')}
${sep}

README row: **${withThousands(toKiB(v4.minified))} / ${withThousands(toKiB(v4.gzipped))} KiB**`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { createRequire } = await import('node:module');
  const { ensureJschardetV3 } = await import('./lib/jschardet-v3.js');
  ensureJschardetV3(root);

  const _require = createRequire(import.meta.url);
  const v3label = `jschardet ${_require(join(v3Dir, 'package.json')).version}`;
  const v4label = `jschardet ${JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version}`;

  // Both projects ship the browser IIFE build under the same name; that is the
  // file a <script src> consumer downloads, so it is what the tables quote.
  const targets = [
    { label: v4label, path: join(root, 'dist', 'jschardet.min.js') },
    { label: v3label, path: join(v3Dir, 'dist', 'jschardet.min.js') },
  ];
  printResults(targets.map(({ label, path }) => ({ label, ...measureBundle(path) })));
}
