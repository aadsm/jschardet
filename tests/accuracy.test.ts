// Accuracy evaluation against the chardet test corpus.
//
// Excluded from the default `npm test` run via vitest.config.ts.
// Run with: npm run test:accuracy

import * as fs from 'fs';
import * as path from 'path';
import { detect } from '../src/chardet.js';
import { UniversalDetector } from '../src/detector.js';
import { EncodingEra } from '../src/enums.js';
import { isLanguageEquivalent } from '../src/evaluation.js';
import { REGISTRY, lookupEncoding } from '../src/registry.js';
import { collectTestFiles, getDataDir, isAcceptable, normalizeLanguage } from './utils.js';
import { _shutdown } from './helpers/codecs.js';

// ---------------------------------------------------------------------------
// Known accuracy failures — marked so CI stays green but gaps are tracked.
// ---------------------------------------------------------------------------

// Failures the port expects but upstream does not. Each entry is a
// documented behavioral divergence, never an inherited one — keep the
// inherited blocks below identical to chardet's test_accuracy.py.
const _DIVERGENT_FAILURES: readonly string[] = [
  // Python resolves these via the markup decode-safety promotion, which cannot
  // fire under WHATWG (its shift_jis decoder already accepts CP932
  // extensions) — see _MARKUP_SUPERSET_PROMOTIONS in src/pipeline/orchestrator.ts.
  // Both are declared-Shift_JIS pages using CP932-only bytes: Python promotes
  // to CP932, the port keeps SHIFT_JIS (a decode-equivalent name under WHATWG).
  'cp932-ja/y-moto.com.xml',
  'cp932-ja/hardsoft.at.webry.info.xml',
];

const _KNOWN_FAILURES: ReadonlySet<string> = new Set([
  // Inherited verbatim from the Python known-failures list.
  'cp437-en/culturax_00001.txt',
  'cp500-es/culturax_mC4_87070.txt',
  'cp850-en/culturax_00001.txt',
  'cp850-fi/culturax_00001.txt',
  'cp850-ms/culturax_00000.txt',
  'cp858-en/culturax_00000.txt',
  'cp858-ms/culturax_00000.txt',
  'iso-8859-15-en/culturax_00002.txt',
  ..._DIVERGENT_FAILURES,
]);

const _KNOWN_ERA_FILTERED_FAILURES: ReadonlySet<string> = new Set([
  // Inherited verbatim from the Python era-filtered list.
  'cp500-es/culturax_mC4_87070.txt',
  'cp850-fi/culturax_00001.txt',
  'iso-8859-2-hu/torokorszag.blogspot.com.xml',
  'macroman-da/culturax_mC4_83469.txt',
  ..._DIVERGENT_FAILURES,
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _encodingEra(enc: string | null): number {
  if (enc === null) return EncodingEra.ALL;
  const canonical = lookupEncoding(enc);
  if (canonical !== null) return REGISTRY[canonical].era;
  return EncodingEra.ALL;
}

// ---------------------------------------------------------------------------
// Test data — collected synchronously at module load so test.each can use it.
// On first run this triggers a shallow clone (~100 MB); subsequent runs use
// the cached tests/data/ directory.
// ---------------------------------------------------------------------------

const _testFiles = collectTestFiles(getDataDir());

// Build test.each rows: [testId, enc, lang, fp]
const _rows = _testFiles.map(([enc, lang, fp]): [string, string | null, string | null, string] => {
  const name = path.basename(fp);
  const dir = path.basename(path.dirname(fp));
  return [`${dir}/${name}`, enc, lang, fp];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// The equivalence fallback may spawn the Python codec oracle.
afterAll(async () => {
  await _shutdown();
});

describe('detect', () => {
  test.each(_rows)('%s', async (testId, enc, lang, fp) => {
    const isKnown = _KNOWN_FAILURES.has(testId);
    const data = fs.readFileSync(fp);
    const result = detect(data, { encodingEra: EncodingEra.ALL, preferSuperset: true });
    const detected = result.encoding;

    const check = async (): Promise<void> => {
      if (enc === null) {
        expect(detected).toBeNull();
      } else {
        expect(await isAcceptable(data, enc, detected)).toBe(true);
      }
    };

    if (isKnown) {
      // xfail: we expect this to throw; if it passes, that's an xpass (report it).
      let threw = false;
      try {
        await check();
      } catch {
        threw = true;
      }
      if (!threw) {
        process.stdout.write(
          `  XPASS: ${testId} passed — remove from _KNOWN_FAILURES\n`,
        );
      }
    } else {
      await check();

      // Language: warn only, never fail.
      if (enc !== null && lang !== null) {
        const detectedLang = normalizeLanguage(result.language);
        if (detectedLang === null || !isLanguageEquivalent(lang.toLowerCase(), detectedLang)) {
          process.stdout.write(
            `  LANG MISMATCH: expected=${lang}, got=${detectedLang} ` +
            `(encoding=${enc}, file=${path.basename(fp)})\n`,
          );
        }
      }
    }
  });
});

describe('detect_era_filtered', () => {
  test.each(_rows)('%s', async (testId, enc, lang, fp) => {
    const isKnown = _KNOWN_ERA_FILTERED_FAILURES.has(testId);
    const era = _encodingEra(enc);
    const data = fs.readFileSync(fp);
    const result = detect(data, { encodingEra: era, preferSuperset: true });
    const detected = result.encoding;

    const check = async (): Promise<void> => {
      if (enc === null) {
        expect(detected).toBeNull();
      } else {
        expect(await isAcceptable(data, enc, detected)).toBe(true);
      }
    };

    if (isKnown) {
      let threw = false;
      try {
        await check();
      } catch {
        threw = true;
      }
      if (!threw) {
        process.stdout.write(
          `  XPASS: ${testId} passed — remove from _KNOWN_ERA_FILTERED_FAILURES\n`,
        );
      }
    } else {
      await check();
    }
  });
});

describe('detect_streaming_parity', () => {
  test.each(_rows)('%s', (testId, enc, lang, fp) => {
    const data = fs.readFileSync(fp);
    const direct = detect(data, { encodingEra: EncodingEra.ALL });

    const detector = new UniversalDetector();
    detector.feed(data);
    const streaming = detector.close();

    expect(streaming).toEqual(direct);
  });
});
