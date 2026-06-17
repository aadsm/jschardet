#!/usr/bin/env node
// Compare our port and upstream Python chardet on the same input bytes.
// Use to answer "is this a port issue or upstream behaviour?" when
// triaging a bug report or reproducing a single-file detection question.
//
// Usage:
//   node scripts/compare-with-chardet.js <file> [<file>...]
//   node scripts/compare-with-chardet.js --top 8 <file>
//
// Both sides run from-source: our port via build/chardet.js and upstream
// chardet via PYTHONPATH=chardet/src against the submodule. No pip install
// needed; _version.py is generated on first run if absent.
//
// Auto-runs `npm run build` if build/index.js is missing.
//
// See also: scripts/diagnose-file.js for port-only ranking.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ensureBuild } from './lib/build.js';
import { ensureChardet7, chardet7SrcDir } from './lib/chardet.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const buildEntry = join(root, 'build/chardet.js');
const chardetSrc = chardet7SrcDir(root);

// Encoding-name aliases between our port and upstream chardet that don't
// indicate a real divergence — only a display-name choice. Currently just
// cp1250: upstream's _COMPAT_NAMES maps cp1251–cp1255 to Windows-125X but
// missed cp1250, so upstream returns "cp1250" while our port returns
// "Windows-1250". Add new entries here if more naming-only mismatches turn up.
const NAME_ALIASES = {
  cp1250: 'Windows-1250',
};

const args = process.argv.slice(2);
let topN = 5;
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--top') topN = parseInt(args[++i], 10);
  else if (args[i] === '-h' || args[i] === '--help') {
    process.stderr.write('usage: node scripts/compare-with-chardet.js [--top N] <file> [<file>...]\n');
    process.exit(0);
  } else files.push(args[i]);
}
if (files.length === 0) {
  process.stderr.write('usage: node scripts/compare-with-chardet.js [--top N] <file> [<file>...]\n');
  process.exit(2);
}

ensureBuild(root);
ensureChardet7(root);

const { detectAll, EncodingEra } = await import(buildEntry);

const upstreamPy = `
import json, sys, chardet
data = open(sys.argv[1], 'rb').read()
print(json.dumps(chardet.detect_all(data, ignore_threshold=True)))
`;

function upstreamDetectAll(filePath) {
  const r = spawnSync('python3', ['-c', upstreamPy, filePath], {
    encoding: 'utf-8',
    env: { ...process.env, PYTHONPATH: chardetSrc },
  });
  if (r.status !== 0) throw new Error(`upstream chardet failed on ${filePath}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function fmt(r) {
  if (!r) return '—';
  return `${r.encoding}/${r.language ?? '-'} ${r.confidence.toFixed(4)}`;
}

for (const f of files) {
  const bytes = readFileSync(f);
  console.log(`\n=== ${f}  (${bytes.length} bytes) ===\n`);

  const ours = detectAll(bytes, { encodingEra: EncodingEra.ALL, ignoreThreshold: true });
  const theirs = upstreamDetectAll(f);

  const W = 32;
  console.log(`${pad('rank', 5)}${pad('port (ts)', W)}${pad('upstream (py)', W)}match`);
  console.log(`${pad('----', 5)}${pad('---------', W)}${pad('-------------', W)}-----`);
  const sameEncoding = (a, b) =>
    a === b || NAME_ALIASES[a] === b || NAME_ALIASES[b] === a;
  for (let i = 0; i < topN; i++) {
    const o = ours[i], t = theirs[i];
    let match = 'DIFF';
    if (o && t && sameEncoding(o.encoding, t.encoding)
        && (o.language ?? null) === (t.language ?? null)
        && Math.abs(o.confidence - t.confidence) < 1e-10) {
      match = o.encoding === t.encoding ? 'OK' : 'OK*';
    }
    console.log(`${pad(i + 1, 5)}${pad(fmt(o), W)}${pad(fmt(t), W)}${match}`);
  }

  const oursEnc = new Set(ours.map(r => r.encoding));
  const theirsEnc = new Set(theirs.map(r => r.encoding));
  const aliasMatch = (set, name) => set.has(name) || set.has(NAME_ALIASES[name])
    || [...set].some(x => NAME_ALIASES[x] === name);
  const onlyOurs = [...oursEnc].filter(x => !aliasMatch(theirsEnc, x));
  const onlyTheirs = [...theirsEnc].filter(x => !aliasMatch(oursEnc, x));
  if (onlyOurs.length || onlyTheirs.length) {
    console.log('\nMembership differences:');
    if (onlyOurs.length) console.log(`  only in port:     ${onlyOurs.join(', ')}`);
    if (onlyTheirs.length) console.log(`  only in upstream: ${onlyTheirs.join(', ')}`);
  }
}
