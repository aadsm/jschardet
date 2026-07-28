#!/usr/bin/env node
// Copies the flattened declarations produced by dts-bundle-generator over
// tsc's own build/index.d.ts, so both entry points are described by the same
// self-contained file:
//
//   build/index.js   → build/index.d.ts     (ESM)
//   build/index.cjs  → build/index.d.cts    (CommonJS)
//
// This exists as a script only because `cp` in an npm script isn't portable to
// Windows.
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const build = join(dirname(dirname(fileURLToPath(import.meta.url))), 'build');
copyFileSync(join(build, 'index.d.cts'), join(build, 'index.d.ts'));
console.log('build/index.d.cts → build/index.d.ts');
