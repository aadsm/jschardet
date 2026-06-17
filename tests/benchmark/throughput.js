#!/usr/bin/env node
// Steady-state throughput benchmark: jschardet 3 vs jschardet 4 vs chardet 7.
//
// Measures per-file detection latency (mean, median, p90, p95, files/sec)
// across the chardet test corpus. Per-pass shape matches chardet's
// benchmark_time.py (one warm-up call, then one detect() call per file,
// statistics computed across the per-file distribution). Multi-pass
// aggregation is in-process; chardet upstream isolates each pass in
// a fresh subprocess.
//
// Usage:
//   node tests/benchmark/throughput.js
//
// First run: clones the test corpus (~100 MB) and installs jschardet 3.
// Subsequent runs reuse both caches.
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ensureTestData } from '../../scripts/lib/test-data.js';
import { ensureBuild } from '../../scripts/lib/build.js';
import { ensureChardet7, chardet7Label, chardet7SrcDir } from '../../scripts/lib/chardet.js';
import { ensureJschardetV3 } from './lib/jschardet-v3.js';
import { systemInfoFooter } from './lib/system-info.js';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const buildEntry = join(root, 'build', 'index.js');
const dataDir = join(root, 'tests', 'data');
const v3Entry = join(root, 'tests', 'bench-deps', 'jschardet-3', 'node_modules', 'jschardet');

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

function loadCorpus() {
  process.stderr.write('Loading corpus into memory...\n');
  const files = [];
  for (const name of readdirSync(dataDir).sort()) {
    const sub = join(dataDir, name);
    // corpus dirs are named "{encoding}-{language}" (e.g. "utf-8-arabic"); skip anything else
    if (!statSync(sub).isDirectory() || name.lastIndexOf('-') === -1) continue;
    for (const file of readdirSync(sub).sort()) {
      const fp = join(sub, file);
      if (statSync(fp).isFile()) files.push(fp); // skip any nested dirs
    }
  }
  const corpus = files.map(fp => {
    const buf = readFileSync(fp);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });
  process.stderr.write(`Loaded ${corpus.length} files.\n\n`);
  return corpus;
}

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------

const RUNS = 5;

function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = times.reduce((s, t) => s + t, 0) / n;
  const median = sorted[Math.floor(n / 2)];
  // ~p90 / ~p95: nearest sample by index, no linear interpolation.
  // At n=2517 the difference from true p90 / p95 is well below table
  // precision.
  const q = (p) => sorted[Math.min(Math.floor(p * n), n - 1)];
  return {
    mean, median, p90: q(0.90), p95: q(0.95),
    total: times.reduce((s, t) => s + t, 0),
    filesPerSec: Math.round(n / (times.reduce((s, t) => s + t, 0) / 1000)),
  };
}

// Element-wise median of per-file times across RUNS passes. Mirrors
// chardet's _run_timing_with_median in scripts/compare_detectors.py,
// but in-process: one warm-up before all runs (lazy init only happens
// once per JS context), then RUNS timed passes over the corpus, then
// the per-file median across passes.
function runBenchmark(detectFn, corpus) {
  detectFn(corpus[0]); // warm-up: trigger any lazy initialization
  const allRuns = [];
  for (let r = 0; r < RUNS; r++) {
    const fileTimes = [];
    for (const bytes of corpus) {
      const t0 = performance.now();
      detectFn(bytes);
      fileTimes.push(performance.now() - t0);
    }
    allRuns.push(fileTimes);
  }
  const medianFileTimes = corpus.map((_, j) => {
    const sorted = allRuns.map(run => run[j]).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  });
  return stats(medianFileTimes);
}

function runChardet7Benchmark() {
  const worker = join(root, 'tests', 'benchmark', 'lib', 'throughput-worker-chardet7.py');
  const { stdout, stderr, status } = spawnSync(
    'python3', [worker, dataDir, String(RUNS)],
    { encoding: 'utf8', env: { ...process.env, PYTHONPATH: chardet7SrcDir(root) } },
  );
  if (status !== 0) { process.stderr.write(stderr); process.exit(1); }
  return JSON.parse(stdout.trim());
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printResults(results, fileCount) {
  function fmtMs(ms) { return ms.toFixed(2) + ' ms'; }
  function fmtFs(n) { return String(n) + ' files/s'; }

  const HEADERS = ['Detector', 'Files/s', 'Mean', 'Median', 'p90', 'p95'];
  const rows = results.map(({ label, result: r }) =>
    [label, fmtFs(r.filesPerSec), fmtMs(r.mean), fmtMs(r.median), fmtMs(r.p90), fmtMs(r.p95)]
  );
  const colWidths = HEADERS.map((_, ci) =>
    Math.max(...[HEADERS, ...rows].map(r => r[ci].length))
  );
  const fmtRow = (cells) => '| ' + cells.map((c, i) => c.padEnd(colWidths[i])).join(' | ') + ' |';

  const sep = '+-' + colWidths.map(w => '-'.repeat(w)).join('-+-') + '-+';
  const labels = results.map(r => r.label).join(' vs ');
  console.log(`
Throughput benchmark: ${labels}
Corpus: ${fileCount} files (chardet test suite)
(median of ${RUNS} runs; per-file times aggregated element-wise)

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
ensureTestData(dataDir, join(root, 'tests'));
ensureJschardetV3(root);
ensureChardet7(root);

const { detect: detectV4 } = await import(new URL('file://' + buildEntry).href);

const _require = createRequire(import.meta.url);
const jschardetV3 = _require(v3Entry);
// Buffer wrapping cost is negligible (zero-copy view).
const detectV3 = (bytes) => jschardetV3.detect(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));

const corpus = loadCorpus();

const v3label = `jschardet ${_require(join(v3Entry, 'package.json')).version}`;
const v4label = `jschardet ${JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version}`;
const c7label = chardet7Label(root);

const benchmarks = [
  { label: v3label, run: () => runBenchmark(detectV3, corpus) },
  { label: v4label, run: () => runBenchmark(detectV4, corpus) },
  { label: c7label, run: runChardet7Benchmark },
];

const results = benchmarks.map(({ label, run }) => {
  process.stderr.write(`Benchmarking ${label}...\n`);
  return { label, result: run() };
});

printResults(results, corpus.length);
