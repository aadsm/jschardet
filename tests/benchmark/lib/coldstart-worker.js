// Worker for coldstart.js. Spawned in a fresh subprocess per measurement.
// Usage: node tests/benchmark/lib/coldstart-worker.js <v3|v4> <entry-path>
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const [, , which, entry] = process.argv;
const _require = createRequire(import.meta.url);

let importTime, firstDetectTime;

if (which === 'v3') {
  const t0 = performance.now();
  const lib = _require(entry);
  importTime = performance.now() - t0;

  const t1 = performance.now();
  lib.detect(Buffer.from('Hello, world!'));
  firstDetectTime = performance.now() - t1;
} else {
  const t0 = performance.now();
  const { detect } = await import(new URL('file://' + entry).href);
  importTime = performance.now() - t0;

  const t1 = performance.now();
  detect(new Uint8Array(Buffer.from('Hello, world!')));
  firstDetectTime = performance.now() - t1;
}

process.stdout.write(JSON.stringify({ importTime, firstDetectTime }) + '\n');
