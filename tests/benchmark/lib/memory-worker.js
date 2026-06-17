// Worker for memory.js. Spawned in a fresh subprocess per measurement.
// Samples peak RSS (process-wide high-water mark since start, via
// process.resourceUsage().maxRSS) at three points: before import, after
// import, after running detect() over the full corpus. Output is a
// single JSON line on stdout.
//
// maxRSS maps to getrusage(RUSAGE_SELF).ru_maxrss — same syscall the
// chardet 7 Python worker reads — so Node and Python numbers measure
// the same thing.
// Usage: node tests/benchmark/lib/memory-worker.js <v3|v4> <entry-path> <data-dir>
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const [, , which, entry, dataDir] = process.argv;
const _require = createRequire(import.meta.url);

function snapshot() {
  return { rss: process.resourceUsage().maxRSS * 1024 };
}

// Pre-load the corpus BEFORE we import the detector, so corpus bytes are
// counted in the baseline rather than charged to the detector.
const files = [];
for (const name of readdirSync(dataDir).sort()) {
  const sub = join(dataDir, name);
  if (!statSync(sub).isDirectory() || name.lastIndexOf('-') === -1) continue;
  for (const fname of readdirSync(sub).sort()) {
    const fp = join(sub, fname);
    if (statSync(fp).isFile()) files.push(fp);
  }
}
const corpus = files.map(fp => {
  const buf = readFileSync(fp);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
});

const baseline = snapshot();

let detect;
if (which === 'v3') {
  const lib = _require(entry);
  detect = (bytes) =>
    lib.detect(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
} else {
  const mod = await import(new URL('file://' + entry).href);
  detect = mod.detect;
}

const afterImport = snapshot();

for (const bytes of corpus) detect(bytes);

const afterDetect = snapshot();

process.stdout.write(JSON.stringify({ baseline, afterImport, afterDetect }) + '\n');
