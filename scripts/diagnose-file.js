#!/usr/bin/env node
// Diagnostic helper: print all candidate scores for a single file.
//
// Usage:
//   npm run build        # one-time, before first run or after src/ changes
//   node scripts/diagnose-file.js <path-to-file>
//
// Prints one line per candidate: confidence  encoding  language. Scores include
// sub-threshold candidates (ignoreThreshold: true) so the full ranking is
// visible. Mirrors the snippet in docs/known-test-failures.md, which is the
// canonical investigation tool for any single-file detection question.

import { readFileSync } from 'node:fs';
import { detectAll, EncodingEra } from '../build/chardet.js';

const path = process.argv[2];
if (!path) {
  process.stderr.write('usage: node scripts/diagnose-file.js <path-to-file>\n');
  process.exit(2);
}

const data = readFileSync(path);
const results = detectAll(data, {
  encodingEra: EncodingEra.ALL,
  ignoreThreshold: true,
});

for (const r of results) {
  process.stdout.write(
    `${r.confidence.toFixed(6)}  ${r.encoding ?? '(null)'}  ${r.language ?? ''}\n`,
  );
}
