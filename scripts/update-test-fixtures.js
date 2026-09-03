#!/usr/bin/env node
//
// Pulls the small set of fixture files used by browser-eligible tests
// (koi8t, cjk_gating, mime_type) out of the chardet test-data repo and
// copies them into tests/fixtures/<subdir>/. Run automatically by
// scripts/update-chardet.js after each pin change, or manually:
//
//   npm run update-test-fixtures             (ref derived from the pin)
//   npm run update-test-fixtures -- 7.6.0     (explicit test-data ref)
//
// The full corpus used by accuracy.test.ts is still cloned on demand
// into tests/data/ at runtime; this script is for the committed subset
// that test files import via `?uint8array`.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TEST_DATA_REF_FILE,
  cloneTestData,
  getTestDataRef,
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

  // postprocess.test.ts — niche-Latin demotion stands down on sparse but
  // real distinguishing-byte evidence (chardet's _SPARSE_EVIDENCE_CASES).
  { src: 'iso-8859-14-cy/culturax_mC4_78730.txt',
    dst: 'sparse_evidence/welsh_iso8859_14.txt' },
  { src: 'hp-roman8-fr/historic_c8503b2f176c.txt',
    dst: 'sparse_evidence/french_hproman8.txt' },
  { src: 'hp-roman8-en/historic_090eae0374e5.txt',
    dst: 'sparse_evidence/english_hproman8.txt' },
  { src: 'iso-8859-10-fi/culturax_00002.txt',
    dst: 'sparse_evidence/kven_iso8859_10.txt' },

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
  const ref = process.argv[2] ?? getTestDataRef();
  const tmpClone = fs.mkdtempSync(path.join(_root, '.tmp-fixtures-'));
  try {
    cloneTestData(tmpClone, ref === 'main' ? null : ref, _root);

    // Clear only the subdirectories the manifest owns — tests/fixtures/
    // also holds committed fixtures from other sources (GitHub-issue
    // samples) that this script must not touch.
    const ownedDirs = new Set(FIXTURES.map(({ dst }) => dst.split('/')[0]));
    for (const dir of ownedDirs) {
      fs.rmSync(path.join(_fixturesDir, dir), { recursive: true, force: true });
    }

    for (const { src, dst } of FIXTURES) {
      const srcPath = path.join(tmpClone, src);
      const dstPath = path.join(_fixturesDir, dst);
      if (!fs.existsSync(srcPath)) {
        throw new Error(`Source file missing in test-data ref ${ref}: ${src}`);
      }
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
      const size = fs.statSync(dstPath).size;
      console.log(`  ${dst}  (${size} B)`);
    }

    fs.writeFileSync(
      path.join(_fixturesDir, TEST_DATA_REF_FILE),
      ref + '\n',
    );
    console.log(`\nWrote ${FIXTURES.length} fixtures from test-data@${ref}`);
  } finally {
    fs.rmSync(tmpClone, { recursive: true, force: true });
  }
}

main();
