#!/usr/bin/env node
// Accuracy benchmark: jschardet 3 vs jschardet 4 vs chardet 7.
//
// For each detector, computes overall encoding accuracy, language accuracy,
// and per-encoding breakdowns against the chardet test corpus, mirroring the
// methodology of chardet/scripts/compare_detectors.py. Correctness uses the
// same rule as tests/accuracy.test.ts: isCorrect() OR isEquivalentDetection().
// Numbers are raw (no KNOWN_FAILURES filtering) to match chardet's
// docs/rewrite_performance.md methodology.
//
// Usage:
//   node tests/benchmark/accuracy.js
//
// First run: clones the test corpus (~100 MB) and installs jschardet 3.
// Subsequent runs reuse both caches.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { systemInfoFooter } from './lib/system-info.js';
import * as iconv from 'iconv-lite';
import { ensureTestData } from '../../scripts/lib/test-data.js';
import { ensureBuild } from '../../scripts/lib/build.js';
import { ensureChardet7, chardet7Label, chardet7SrcDir } from '../../scripts/lib/chardet.js';
import { ensureJschardetV3 } from './lib/jschardet-v3.js';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const dataDir = join(root, 'tests', 'data');
const v3Entry = join(root, 'tests', 'bench-deps', 'jschardet-3', 'node_modules', 'jschardet');

ensureBuild(root);
ensureTestData(dataDir, join(root, 'tests'));
ensureJschardetV3(root);
ensureChardet7(root);

const { detect: detectV4 } = await import(new URL('file://' + join(root, 'build', 'index.js')).href);
const { isCorrect, isLanguageEquivalent } = await import(
  new URL('file://' + join(root, 'build', 'equivalences.js')).href
);
const { lookupEncoding } = await import(new URL('file://' + join(root, 'build', 'registry.js')).href);
const { ISO_TO_LANGUAGE } = await import(new URL('file://' + join(root, 'build', 'utils.js')).href);

// ---------------------------------------------------------------------------
// Equivalence helpers — JS copies of the small set of helpers in
// tests/utils.ts. Kept short here so this script is plain-JS importable
// without the TS toolchain.
// ---------------------------------------------------------------------------

const _LANG_NAME_TO_ISO = {};
for (const [iso, name] of Object.entries(ISO_TO_LANGUAGE)) _LANG_NAME_TO_ISO[name] = iso;
_LANG_NAME_TO_ISO['scottish gaelic'] = 'gd';

function normalizeLanguage(detected) {
  if (!detected) return null;
  const lowered = String(detected).toLowerCase().replace(/—$/, '');
  return _LANG_NAME_TO_ISO[lowered] ?? lowered;
}

const _EQUIVALENT_SYMBOL_PAIRS = new Set(['¤€', '€¤']);

function _charsEquivalent(a, b) {
  if (a === b) return true;
  if (_EQUIVALENT_SYMBOL_PAIRS.has(a + b)) return true;
  const strip = (s) => s.normalize('NFKD').replace(/\p{M}/gu, '');
  return strip(a) === strip(b);
}

function isEquivalentDetection(data, expected, detected) {
  if (expected === null) return detected === null;
  if (detected === null) return false;
  const normExp = lookupEncoding(expected) ?? expected.toLowerCase();
  const normDet = lookupEncoding(detected) ?? detected.toLowerCase();
  if (normExp === normDet) return true;
  if (!iconv.encodingExists(normExp) || !iconv.encodingExists(normDet)) return false;
  try {
    const buf = Buffer.from(data);
    const textExp = iconv.decode(buf, normExp);
    const textDet = iconv.decode(buf, normDet);
    if (textExp === textDet) return true;
    if (textExp.length !== textDet.length) return false;
    for (let i = 0; i < textExp.length; i++) {
      if (!_charsEquivalent(textExp[i], textDet[i])) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

function loadCorpus() {
  process.stderr.write('Loading corpus into memory...\n');
  const entries = [];
  for (const name of readdirSync(dataDir).sort()) {
    const sub = join(dataDir, name);
    if (!statSync(sub).isDirectory()) continue;
    const dashIdx = name.lastIndexOf('-');
    if (dashIdx === -1) continue;
    const encPart = name.slice(0, dashIdx);
    const langPart = name.slice(dashIdx + 1);
    const expEnc = encPart === 'None' ? null : encPart;
    const expLang = langPart === 'None' ? null : langPart;
    for (const fname of readdirSync(sub).sort()) {
      const fp = join(sub, fname);
      if (!statSync(fp).isFile()) continue;
      const buf = readFileSync(fp);
      const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      entries.push({ expEnc, expLang, fp, bytes });
    }
  }
  process.stderr.write(`Loaded ${entries.length} files.\n\n`);
  return entries;
}

// ---------------------------------------------------------------------------
// Per-detector drivers — each returns an array of {encoding, language}
// in corpus order.
// ---------------------------------------------------------------------------

function detectAllInProcess(detectFn, corpus, toBuffer) {
  detectFn(toBuffer(corpus[0].bytes)); // warm-up
  return corpus.map(({ bytes }) => {
    const r = detectFn(toBuffer(bytes)) ?? {};
    return { encoding: r.encoding ?? null, language: r.language ?? null };
  });
}

function detectAllWithChardet7() {
  const worker = join(root, 'tests', 'benchmark', 'lib', 'accuracy-worker-chardet7.py');
  const { stdout, stderr, status } = spawnSync(
    'python3', [worker, dataDir],
    {
      encoding: 'utf8',
      env: { ...process.env, PYTHONPATH: chardet7SrcDir(root) },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (status !== 0) { process.stderr.write(stderr); process.exit(1); }
  return JSON.parse(stdout.trim());
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function _newBucket() {
  return { total: 0, correct: 0, langTotal: 0, langCorrect: 0 };
}

function scoreDetections(corpus, results) {
  const summary = _newBucket();
  const perEnc = new Map();
  let langReported = 0;
  for (let i = 0; i < corpus.length; i++) {
    const { expEnc, expLang, bytes } = corpus[i];
    const { encoding: detEnc, language: detLang } = results[i];
    const key = expEnc ?? '(binary)';
    if (!perEnc.has(key)) perEnc.set(key, _newBucket());
    const bucket = perEnc.get(key);

    summary.total++;
    bucket.total++;
    if (
      isCorrect(expEnc, detEnc) ||
      (detEnc !== null && isEquivalentDetection(bytes, expEnc, detEnc))
    ) {
      summary.correct++;
      bucket.correct++;
    }

    if (detLang !== null && detLang !== undefined) langReported++;

    // Language: skipped for binary files (expLang === null).
    if (expLang === null) continue;
    summary.langTotal++;
    bucket.langTotal++;
    const normalized = normalizeLanguage(detLang);
    if (normalized !== null && isLanguageEquivalent(expLang.toLowerCase(), normalized)) {
      summary.langCorrect++;
      bucket.langCorrect++;
    }
  }
  // A detector that never returns a language (e.g. jschardet 3) doesn't
  // support language detection — surface that as n/a rather than 0/N.
  summary.supportsLanguage = langReported > 0;
  return { ...summary, perEnc };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function fmtPct(n, d) {
  if (d === 0) return 'n/a';
  return (100 * n / d).toFixed(1) + '%';
}

function renderTable(headers, rows) {
  const widths = headers.map((_, ci) =>
    Math.max(...[headers, ...rows].map(r => r[ci].length))
  );
  const fmtRow = (cells) =>
    '| ' + cells.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |';
  const sep = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';
  return [fmtRow(headers), sep, ...rows.map(fmtRow)].join('\n');
}

function printOverall(results) {
  const headers = ['Detector', 'Correct', 'Accuracy'];
  const rows = results.map(({ label, scores }) => [
    label,
    `${scores.correct}/${scores.total}`,
    fmtPct(scores.correct, scores.total),
  ]);
  console.log('\n## Overall Accuracy\n');
  console.log(renderTable(headers, rows));
}

function printLanguage(results) {
  const headers = ['Detector', 'Correct', 'Accuracy'];
  const rows = results.map(({ label, scores }) => {
    if (!scores.supportsLanguage) return [label, 'n/a', 'n/a'];
    return [
      label,
      `${scores.langCorrect}/${scores.langTotal}`,
      fmtPct(scores.langCorrect, scores.langTotal),
    ];
  });
  console.log('\n## Language Detection Accuracy\n');
  console.log(renderTable(headers, rows));
}

function printPerEncoding(results) {
  // Union of expected-encoding keys across all detectors (identical in
  // practice, but iterate the union defensively).
  const encodings = new Set();
  for (const { scores } of results) {
    for (const k of scores.perEnc.keys()) encodings.add(k);
  }
  const sorted = [...encodings].sort();

  const headers = ['Encoding', 'N', ...results.map(r => r.label)];
  const rows = sorted.map((enc) => {
    const total = results[0].scores.perEnc.get(enc)?.total ?? 0;
    return [
      enc,
      String(total),
      ...results.map(({ scores }) => {
        const b = scores.perEnc.get(enc);
        if (!b || b.total === 0) return 'n/a';
        return `${b.correct}/${b.total} (${fmtPct(b.correct, b.total)})`;
      }),
    ];
  });
  console.log('\n## Per-encoding Accuracy\n');
  console.log(renderTable(headers, rows));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const _require = createRequire(import.meta.url);
const jschardetV3 = _require(v3Entry);
const detectV3 = (buf) => jschardetV3.detect(buf);

const corpus = loadCorpus();

const v3label = `jschardet ${_require(join(v3Entry, 'package.json')).version}`;
const v4label = `jschardet ${JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version}`;
const c7label = chardet7Label(root);

const bytesToBuffer = (bytes) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

process.stderr.write(`Detecting with ${v3label}...\n`);
const r3 = detectAllInProcess(detectV3, corpus, bytesToBuffer);

process.stderr.write(`Detecting with ${v4label}...\n`);
const r4 = detectAllInProcess(detectV4, corpus, (b) => b);

process.stderr.write(`Detecting with ${c7label}...\n`);
const rc7 = detectAllWithChardet7();
if (rc7.length !== corpus.length) {
  process.stderr.write(
    `ERROR: chardet 7 worker returned ${rc7.length} results for ${corpus.length} files\n`,
  );
  process.exit(1);
}

const results = [
  { label: v3label, scores: scoreDetections(corpus, r3) },
  { label: v4label, scores: scoreDetections(corpus, r4) },
  { label: c7label, scores: scoreDetections(corpus, rc7) },
];

console.log(
  `\nAccuracy benchmark: ${results.map(r => r.label).join(' vs ')}\n` +
  `Corpus: ${corpus.length} files (chardet test suite)`,
);
printOverall(results);
printLanguage(results);
printPerEncoding(results);

console.log('\n' + systemInfoFooter());
