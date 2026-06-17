#!/usr/bin/env node
// Microbenchmark for the model-payload decompression step.
//
// Compares the Node path (node:zlib.inflateSync) against the first-party
// browser DEFLATE decoder (src/runtime/decompress.browser.ts) on the three
// real model payloads.  Browser bundles run the JS decoder; this script lets
// us measure that path under Node, which is a reasonable proxy for browser
// engines on the same data.
//
// Usage:
//   node scripts/bench-decompress.js
//
// Each path is timed against each of the three .bin payloads and against the
// total cost of decompressing all three back-to-back (the first-call cost a
// real consumer pays the first time `detect()` is invoked).
import { performance } from 'node:perf_hooks';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync, deflateSync, constants as zlibConstants } from 'node:zlib';
import { buildSync } from 'esbuild';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const browserDecoderPath = join(root, 'src', 'runtime', 'decompress.browser.ts');
const FILES = ['models', 'idf', 'confusion'];

// Bundle the browser decoder so we can call it from Node. Same trick as the
// build-time round-trip check in scripts/generate-model-bins.js.
async function loadBrowserDecompress() {
  const tempPath = join(tmpdir(), `bench-decoder-${process.pid}-${Date.now()}.mjs`);
  buildSync({
    entryPoints: [browserDecoderPath],
    bundle: true,
    format: 'esm',
    outfile: tempPath,
    platform: 'neutral',
    logLevel: 'silent',
  });
  try {
    const mod = await import(pathToFileURL(tempPath).href);
    return mod.decompress;
  } finally {
    try { unlinkSync(tempPath); } catch { /* ignore */ }
  }
}

function decompressNode(bytes) {
  const buf = inflateSync(bytes);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

// Recompresses raw bytes with the same options as scripts/generate-model-bins.js
// so the benchmark feeds the decoders bytes identical to those embedded in the
// shipped wrappers.
function compress(bytes) {
  return deflateSync(bytes, {
    level: 9,
    strategy: zlibConstants.Z_FIXED,
    windowBits: 15,
    memLevel: 8,
  });
}

async function loadPayload(name) {
  const wrapper = await import(pathToFileURL(join(root, 'src', 'models', `${name}.bin.js`)).href);
  const decoded = wrapper.readBytes();
  const payload = compress(decoded);
  return { decoded, payload };
}

function bench(fn, runs = 9) {
  for (let i = 0; i < 2; i++) fn();
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return {
    median: samples[Math.floor(samples.length / 2)],
    min: samples[0],
    max: samples[samples.length - 1],
  };
}

function fmt(ms) {
  return ms.toFixed(2).padStart(7);
}

const decompressJS = await loadBrowserDecompress();

const data = {};
for (const f of FILES) data[f] = await loadPayload(f);

console.log('Payload sizes (compressed → raw):');
for (const f of FILES) {
  const c = data[f].payload.length.toLocaleString();
  const r = data[f].decoded.length.toLocaleString();
  console.log(`  ${f.padEnd(9)} ${c.padStart(12)} → ${r.padStart(14)} bytes`);
}
console.log();

console.log('Decompression time per file (ms):');
console.log('file      | path        | median  |  min    |  max');
console.log('----------+-------------+---------+---------+--------');
for (const f of FILES) {
  const n = bench(() => decompressNode(data[f].payload));
  const j = bench(() => decompressJS(data[f].payload));
  console.log(`${f.padEnd(9)} | node:zlib   | ${fmt(n.median)} | ${fmt(n.min)} | ${fmt(n.max)}`);
  console.log(`${f.padEnd(9)} | js-decoder  | ${fmt(j.median)} | ${fmt(j.min)} | ${fmt(j.max)}`);
}
console.log();

const totalNode = bench(() => { for (const f of FILES) decompressNode(data[f].payload); }, 5);
const totalJS = bench(() => { for (const f of FILES) decompressJS(data[f].payload); }, 5);

console.log('First-call cost across all 3 wrappers (one-time per process/page):');
console.log(`  node:zlib:  median ${fmt(totalNode.median)} ms  (min ${fmt(totalNode.min)}, max ${fmt(totalNode.max)})`);
console.log(`  js-decoder: median ${fmt(totalJS.median)} ms  (min ${fmt(totalJS.min)}, max ${fmt(totalJS.max)})`);
console.log(`  ratio js / node: ${(totalJS.median / totalNode.median).toFixed(1)}×`);
console.log();
console.log(`Node ${process.version} on ${process.platform}/${process.arch}`);
