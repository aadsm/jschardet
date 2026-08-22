// Keeps the README's advertised bundle size honest.
//
// The size a consumer downloads is the one number in the README table that
// does not come from a benchmark run: dist/ is committed, so it is a
// deterministic function of the repo. That makes it checkable rather than
// remembered, and it has been wrong before — the 4.0 RC advertised 1,043 KiB
// where the committed bundle measured 1,045.
//
// Two links make this a check on the source and not just on a file:
// CI's "Check dist files match source" step fails when rebuilding would
// change dist/, and this test fails when the README disagrees with dist/.
// Together: README ≡ dist ≡ src.
//
// The tolerance is deliberate. Every source change moves the bundle by some
// bytes, and at 1 KiB granularity an exact match would fail constantly and
// train people to bump the number without reading it. 1% (~10 KiB here)
// still catches the drift that matters — a model payload growing, a
// dependency creeping in — while ignoring routine churn. The smaller
// authoring slip is handled at the other end: `npm run benchmark:bundle`
// prints a ready-to-paste README row so the number is never hand-rounded.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { measureBundle, toKiB } from './benchmark/bundle.js';

const abs = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const TOLERANCE = 0.01;

describe('README bundle size', () => {
  const { minified, gzipped } = measureBundle(abs('../dist/jschardet.min.js'));
  const readme = readFileSync(abs('../README.md'), 'utf8');

  it('quotes a min / gzip pair for jschardet 4', () => {
    expect(readme).toMatch(/\| Bundle size \(min \/ gzip\) \| \*\*[\d,]+ \/ [\d,]+ KiB\*\*/);
  });

  it.each([
    ['minified', 1, minified],
    ['gzipped', 2, gzipped],
  ])('is within 1%% of the committed bundle (%s)', (_what, group, actualBytes) => {
    const row = readme.match(
      /\| Bundle size \(min \/ gzip\) \| \*\*([\d,]+) \/ ([\d,]+) KiB\*\*/,
    );
    const documented = Number(row![group].replace(/,/g, ''));
    const actual = toKiB(actualBytes);
    const drift = Math.abs(documented - actual) / actual;

    // Surface the paste-ready values, so a legitimate change is a copy job.
    expect(
      drift <= TOLERANCE,
      `README says ${documented} KiB, dist/jschardet.min.js measures ${actual} KiB ` +
        `(${(drift * 100).toFixed(1)}% off). Run \`npm run benchmark:bundle\` and paste ` +
        `the README row it prints.`,
    ).toBe(true);
  });
});
