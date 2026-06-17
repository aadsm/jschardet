#!/usr/bin/env node
// Memory benchmark: jschardet 3 vs jschardet 4 vs chardet 7.
//
// Reports peak RSS (process high-water mark since start, via
// getrusage(RUSAGE_SELF).ru_maxrss — process.resourceUsage().maxRSS in
// Node, resource.getrusage().ru_maxrss in Python) at three sample
// points per detector, each measured in a fresh subprocess:
//   - baseline: corpus loaded, detector NOT yet imported
//   - after import: detector module imported, no detect() called yet
//   - after corpus: detect() called over every file in the corpus
//
// Two derived figures appear in the table:
//   - Import delta = after-import peak - baseline peak
//   - Peak delta   = after-corpus peak - baseline peak
//
// Methodology mirrors chardet/scripts/benchmark_memory.py but reports
// RSS only (no tracemalloc) so numbers are directly comparable across
// Node and Python — Node has no tracemalloc equivalent.
//
// Usage:
//   node tests/benchmark/memory.js

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ensureBuild } from '../../scripts/lib/build.js';
import { ensureTestData } from '../../scripts/lib/test-data.js';
import { ensureChardet7, chardet7Label, chardet7SrcDir } from '../../scripts/lib/chardet.js';
import { ensureJschardetV3 } from './lib/jschardet-v3.js';
import { systemInfoFooter } from './lib/system-info.js';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const dataDir = join(root, 'tests', 'data');
const buildEntry = join(root, 'build', 'index.js');
const v3Entry = join(root, 'tests', 'bench-deps', 'jschardet-3', 'node_modules', 'jschardet');
const nodeWorker = join(root, 'tests', 'benchmark', 'lib', 'memory-worker.js');
const pyWorker = join(root, 'tests', 'benchmark', 'lib', 'memory-worker-chardet7.py');
const RUNS = 5;

ensureBuild(root);
ensureTestData(dataDir, join(root, 'tests'));
ensureJschardetV3(root);
ensureChardet7(root);

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measureNode(which, entry) {
  const samples = [];
  for (let i = 0; i < RUNS; i++) {
    const { stdout, stderr, status } = spawnSync(
      process.execPath, [nodeWorker, which, entry, dataDir],
      { encoding: 'utf8' },
    );
    if (status !== 0) { process.stderr.write(stderr); process.exit(1); }
    samples.push(JSON.parse(stdout.trim()));
  }
  return aggregate(samples);
}

function measurePython() {
  const samples = [];
  for (let i = 0; i < RUNS; i++) {
    const { stdout, stderr, status } = spawnSync(
      'python3', [pyWorker, dataDir],
      { encoding: 'utf8', env: { ...process.env, PYTHONPATH: chardet7SrcDir(root) } },
    );
    if (status !== 0) { process.stderr.write(stderr); process.exit(1); }
    samples.push(JSON.parse(stdout.trim()));
  }
  return aggregate(samples);
}

function aggregate(samples) {
  return {
    baseline: median(samples.map(s => s.baseline.rss)),
    afterImport: median(samples.map(s => s.afterImport.rss)),
    afterDetect: median(samples.map(s => s.afterDetect.rss)),
  };
}

function fmtBytes(n) {
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + ' MiB';
  if (n >= 1 << 10) return (n / (1 << 10)).toFixed(1) + ' KiB';
  return n + ' B';
}

function printResults(results) {
  const HEADERS = ['Detector', 'Baseline RSS', 'Import delta', 'Peak delta', 'Final RSS'];
  const rows = results.map(({ label, result: r }) => [
    label,
    fmtBytes(r.baseline),
    fmtBytes(r.afterImport - r.baseline),
    fmtBytes(r.afterDetect - r.baseline),
    fmtBytes(r.afterDetect),
  ]);
  const widths = HEADERS.map((_, ci) =>
    Math.max(...[HEADERS, ...rows].map(r => r[ci].length))
  );
  const fmtRow = (cells) => '| ' + cells.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |';
  const sep = '+-' + widths.map(w => '-'.repeat(w)).join('-+-') + '-+';
  const labels = results.map(r => r.label).join(' vs ');
  console.log(`
Memory benchmark: ${labels}
(median of ${RUNS} runs; peak RSS via getrusage)

${sep}
${fmtRow(HEADERS)}
${sep}
${rows.map(fmtRow).join('\n')}
${sep}

${systemInfoFooter()}`);
}

const _require = createRequire(import.meta.url);
const v3label = `jschardet ${_require(join(v3Entry, 'package.json')).version}`;
const v4label = `jschardet ${JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version}`;
const c7label = chardet7Label(root);

const benchmarks = [
  { label: v3label, run: () => measureNode('v3', v3Entry) },
  { label: v4label, run: () => measureNode('v4', buildEntry) },
  { label: c7label, run: measurePython },
];

process.stderr.write(`Measuring memory (${RUNS} runs each)...\n`);
const results = benchmarks.map(({ label, run }) => {
  process.stderr.write(`  ${label}...\n`);
  return { label, result: run() };
});

printResults(results);
