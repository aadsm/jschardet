#!/usr/bin/env node
// Cold start benchmark: jschardet 3 vs jschardet 4 vs chardet 7.
//
// Measures import time and first detect() call time for each library.
// Each measurement runs in a fresh subprocess to avoid module caching.
//
// Usage:
//   node tests/benchmark/coldstart.js
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ensureBuild } from '../../scripts/lib/build.js';
import { ensureChardet7, chardet7Label, chardet7SrcDir } from '../../scripts/lib/chardet.js';
import { ensureJschardetV3 } from './lib/jschardet-v3.js';
import { systemInfoFooter } from './lib/system-info.js';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const buildEntry = join(root, 'build', 'index.js');
const v3Entry = join(root, 'tests', 'bench-deps', 'jschardet-3', 'node_modules', 'jschardet');
const workerScript = join(root, 'tests', 'benchmark', 'lib', 'coldstart-worker.js');
const RUNS = 5;

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

function measureJschardetColdStart(which, entry) {
  const results = [];
  for (let i = 0; i < RUNS; i++) {
    const { stdout, stderr, status } = spawnSync(
      process.execPath, [workerScript, which, entry],
      { encoding: 'utf8' },
    );
    if (status !== 0) { process.stderr.write(stderr); process.exit(1); }
    results.push(JSON.parse(stdout.trim()));
  }
  const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  return {
    importTime: median(results.map(r => r.importTime)),
    firstDetectTime: median(results.map(r => r.firstDetectTime)),
  };
}

function measureChardet7ColdStart() {
  const worker = join(root, 'tests', 'benchmark', 'lib', 'coldstart-worker-chardet7.py');
  const results = [];
  for (let i = 0; i < RUNS; i++) {
    const { stdout, stderr, status } = spawnSync(
      'python3', [worker],
      { encoding: 'utf8', env: { ...process.env, PYTHONPATH: chardet7SrcDir(root) } },
    );
    if (status !== 0) { process.stderr.write(stderr); process.exit(1); }
    results.push(JSON.parse(stdout.trim()));
  }
  const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  return {
    importTime: median(results.map(r => r.importTime)),
    firstDetectTime: median(results.map(r => r.firstDetectTime)),
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printResults(results) {
  function fmtMs(ms) { return ms.toFixed(2) + ' ms'; }

  const HEADERS = ['Detector', 'Import', 'First detect', 'Total'];
  const rows = results.map(({ label, result: r }) =>
    [label, fmtMs(r.importTime), fmtMs(r.firstDetectTime), fmtMs(r.importTime + r.firstDetectTime)]
  );
  const colWidths = HEADERS.map((_, ci) =>
    Math.max(...[HEADERS, ...rows].map(r => r[ci].length))
  );
  const fmtRow = (cells) => '| ' + cells.map((c, i) => c.padEnd(colWidths[i])).join(' | ') + ' |';
  const sep = '+-' + colWidths.map(w => '-'.repeat(w)).join('-+-') + '-+';

  const labels = results.map(r => r.label).join(' vs ');
  console.log(`
Cold start benchmark: ${labels}
(median of ${RUNS} runs)

${sep}
${fmtRow(HEADERS)}
${sep}
${rows.map(fmtRow).join('\n')}
${sep}

${systemInfoFooter()}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

ensureBuild(root);
ensureJschardetV3(root);
ensureChardet7(root);

const _require = createRequire(import.meta.url);
const v3label = `jschardet ${_require(join(v3Entry, 'package.json')).version}`;
const v4label = `jschardet ${JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version}`;
const c7label = chardet7Label(root);

const benchmarks = [
  { label: v3label, run: () => measureJschardetColdStart('v3', v3Entry) },
  { label: v4label, run: () => measureJschardetColdStart('v4', buildEntry) },
  { label: c7label, run: measureChardet7ColdStart },
];

process.stderr.write(`Measuring cold start (${RUNS} runs each)...\n`);
const results = benchmarks.map(({ label, run }) => {
  process.stderr.write(`  ${label}...\n`);
  return { label, result: run() };
});

printResults(results);
