#!/usr/bin/env node
//
// Pulls the small set of fixture files used by browser-eligible tests
// (koi8t, cjk_gating, mime_type) out of the chardet test-data repo and
// copies them into tests/fixtures/<subdir>/. Run manually whenever the
// pinned ref bumps:
//
//   npm run update-test-fixtures
//
// The full corpus used by accuracy.test.ts is still cloned on demand
// into tests/data/ at runtime; this script is for the committed subset
// that test files import via `?uint8array`.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TEST_DATA_REF,
  TEST_DATA_REF_FILE,
  cloneTestData,
} from './lib/test-data.js';

const _root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const _fixturesDir = path.join(_root, 'tests', 'fixtures');

// Manifest: source path inside the test-data repo → destination path
// under tests/fixtures/. Keep destination names purpose-driven so the
// importing test files read clearly.
const FIXTURES = [
  // koi8t.test.ts
  { src: 'koi8-t-tg/culturax_mC4_74865.txt',
    dst: 'koi8t/tajik.txt' },
  { src: 'koi8-r-ru/_chromium_KOI8-R_with_no_encoding_specified.html',
    dst: 'koi8t/russian.html' },

  // cjk_gating.test.ts
  { src: 'macroman-de/culturax_mC4_83756.txt',
    dst: 'cjk_gating/macroman_de.txt' },

  // mime_type.test.ts — magic-number samples from None-None/
  { src: 'None-None/sample-1.gif',  dst: 'mime_type/sample-1.gif' },
  { src: 'None-None/sample-1.jpg',  dst: 'mime_type/sample-1.jpg' },
  { src: 'None-None/sample-1.mp4',  dst: 'mime_type/sample-1.mp4' },
  { src: 'None-None/sample-1.png',  dst: 'mime_type/sample-1.png' },
  { src: 'None-None/sample-1.webp', dst: 'mime_type/sample-1.webp' },
  { src: 'None-None/sample-1.xlsx', dst: 'mime_type/sample-1.xlsx' },
  { src: 'None-None/sample-2.png',  dst: 'mime_type/sample-2.png' },
  { src: 'None-None/sample-3.png',  dst: 'mime_type/sample-3.png' },
];

function main() {
  const tmpClone = fs.mkdtempSync(path.join(_root, '.tmp-fixtures-'));
  try {
    cloneTestData(tmpClone, TEST_DATA_REF, _root);

    fs.rmSync(_fixturesDir, { recursive: true, force: true });
    fs.mkdirSync(_fixturesDir, { recursive: true });

    for (const { src, dst } of FIXTURES) {
      const srcPath = path.join(tmpClone, src);
      const dstPath = path.join(_fixturesDir, dst);
      if (!fs.existsSync(srcPath)) {
        throw new Error(`Source file missing in test-data ref ${TEST_DATA_REF}: ${src}`);
      }
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
      const size = fs.statSync(dstPath).size;
      console.log(`  ${dst}  (${size} B)`);
    }

    fs.writeFileSync(
      path.join(_fixturesDir, TEST_DATA_REF_FILE),
      TEST_DATA_REF + '\n',
    );
    console.log(`\nWrote ${FIXTURES.length} fixtures from test-data@${TEST_DATA_REF}`);
  } finally {
    fs.rmSync(tmpClone, { recursive: true, force: true });
  }
}

main();
