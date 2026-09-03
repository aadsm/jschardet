#!/usr/bin/env node
// Generates src/pipeline/_byte-decode-tables.ts from Python at pin time, for
// every encoding in chardet's registry: per single byte, the decoded code
// point and Unicode general category.
//
// Computed by Python (codecs + unicodedata, the source of truth) so it never
// drifts from CPython's UCD — the runtime JS engine's Unicode database (ICU)
// can be a version or two behind, which would misclassify the exact
// single-byte encodings these tables exist for (hp-roman8, the EBCDIC pages,
// koi8-t) where TextDecoder has no decoder at all. Emitted as a plain minified
// literal (not zlib-wrapped): the payload is small.
//
// One table, three consumers in confusion.ts:
//   - differingHighBytes reads the code points (cps), high bytes only.
//   - _pairCategories reads the categories (cats).
//   - _letterCaseTable derives its 0/1/2 letter-kind from the categories:
//     chardet's _letter_case_table is a pure function of the general
//     category, verified below to agree byte-for-byte before we rely on it.
//
// cps holds only the high half (0x80..0xFF): the callers that read it
// (differingHighBytes, and the arbitrations that feed _pairCategories) only
// ever ask about high bytes. cats holds all 256, because the letter-case
// derivation classifies neighbour bytes of any value (ASCII letters in the
// Latin families, and only the high bytes in EBCDIC).

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chardetVersion } from './chardet-version.js';
import { chardet7SrcDir, ensureChardet7 } from './lib/chardet.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const decodeTablesPath = join(root, 'src', 'pipeline', '_byte-decode-tables.ts');

// Must match _INT_TO_CATEGORY in src/pipeline/confusion.ts: cats stores each
// byte's category as its index into this list. Cn (unassigned) is last.
const CATEGORY_ORDER = [
  'Lu', 'Ll', 'Lt', 'Lm', 'Lo',
  'Mn', 'Mc', 'Me',
  'Nd', 'Nl', 'No',
  'Pc', 'Pd', 'Ps', 'Pe', 'Pi', 'Pf', 'Po',
  'Sm', 'Sc', 'Sk', 'So',
  'Zs', 'Zl', 'Zp',
  'Cc', 'Cf', 'Cs', 'Co', 'Cn',
];

// Letter-kind derived from a category, mirroring chardet's _letter_case_table:
// 1 = uppercase letter (Lu), 2 = other letter (Ll/Lt/Lm/Lo) or combining mark
// (Mn/Mc/Me, which count as letters), 0 = everything else.
const LETTER_CATS = new Set(['Ll', 'Lt', 'Lm', 'Lo', 'Mn', 'Mc', 'Me']);

const PY = `
import json, sys, unicodedata
from chardet.registry import REGISTRY
from chardet.pipeline.confusion import _letter_case_table

CATEGORY_ORDER = ${JSON.stringify(CATEGORY_ORDER)}
CAT_TO_INT = {c: i for i, c in enumerate(CATEGORY_ORDER)}
LETTER_CATS = ${JSON.stringify([...LETTER_CATS])}
CN = CAT_TO_INT["Cn"]

# Sentinels in the code-point string for bytes with no single decoded
# character. Both are Unicode noncharacters, so a real single-byte decode
# (always a BMP scalar) can never collide with them. differing_high_bytes
# compares these values for byte-equality, so undecodable and
# decoded-but-not-one-char must be distinct.
UNDECODABLE = 0xFFFF   # raised UnicodeDecodeError
NON_SINGLE = 0xFFFE    # decoded to empty or multiple characters

def case_from_cat(cat):
    if cat == "Lu":
        return 1
    if cat in LETTER_CATS:
        return 2
    return 0

names = sorted({enc.name for enc in REGISTRY.values()})

decode_tables = {}
for name in names:
    cps = []
    cats = []
    for b in range(256):
        try:
            ch = bytes([b]).decode(name)
        except Exception:
            cats.append(CN)
            if b >= 0x80:
                cps.append(UNDECODABLE)
            continue
        if len(ch) == 1:
            cat = unicodedata.category(ch)
            cats.append(CAT_TO_INT.get(cat, CN))
            if b >= 0x80:
                cps.append(ord(ch))
        else:
            cats.append(CN)
            if b >= 0x80:
                cps.append(NON_SINGLE)

    # Safety: the letter-case table derived from the categories at runtime
    # must equal chardet's own _letter_case_table byte-for-byte, or the
    # runtime derivation is unsound.
    try:
        expected = list(_letter_case_table(name))
        derived = [case_from_cat(CATEGORY_ORDER[c]) for c in cats]
        if expected != derived:
            sys.stderr.write(
                f"case-table mismatch for {name}: "
                f"first diff at byte {next(i for i in range(256) if expected[i] != derived[i])}\\n"
            )
            sys.exit(2)
    except SystemExit:
        raise
    except Exception:
        pass  # an encoding _letter_case_table cannot build is all-zero either way

    decode_tables[name] = {
        "cps": "".join(chr(c) for c in cps),
        "cats": "".join(chr(c) for c in cats),
    }

json.dump(decode_tables, sys.stdout)
`;

export function generate() {
  ensureChardet7(root);
  const out = execFileSync('python3', ['-c', PY], {
    env: { ...process.env, PYTHONPATH: chardet7SrcDir(root) },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const decodeTables = JSON.parse(out);
  const version = chardetVersion();

  const decodeEntries = Object.entries(decodeTables)
    .map(([enc, { cps, cats }]) =>
      `  ${JSON.stringify(enc)}: {\n` +
      `    cps: ${JSON.stringify(cps)},\n` +
      `    cats: ${JSON.stringify(cats)},\n` +
      `  },`)
    .join('\n');
  writeFileSync(
    decodeTablesPath,
    `// generated by scripts/generate-byte-tables.js — do not edit manually\n` +
    `// chardet ${version}\n` +
    `//\n` +
    `// Per-encoding single-byte decode tables for every encoding in the\n` +
    `// registry, computed by Python's codecs + unicodedata (the source of\n` +
    `// truth):\n` +
    `//   cps  charCodeAt(b - 0x80) = the decoded code point of high byte b\n` +
    `//        (0x80..0xFF), or 0xFFFF when it does not decode, or 0xFFFE when\n` +
    `//        it decodes to zero or more than one character. Low bytes are\n` +
    `//        omitted — no consumer reads a code point below 0x80.\n` +
    `//   cats charCodeAt(b) = the Unicode general category index (into\n` +
    `//        _INT_TO_CATEGORY) of byte b, all 256; 'Cn' (29) for the two\n` +
    `//        sentinel cases.\n` +
    `//\n` +
    `// Backs confusion.ts's differingHighBytes and _pairCategories (which\n` +
    `// arbitrate encoding pairs the confusion maps do not cover) and\n` +
    `// _letterCaseTable (whose 0/1/2 letter-kind is derived from cats).\n` +
    `// Runtime TextDecoder + \\p{...} cannot stand in: several of these\n` +
    `// encodings have no WHATWG decoder, and JS category data drifts from\n` +
    `// CPython's UCD.\n` +
    `export interface ByteDecodeTable {\n` +
    `  readonly cps: string;\n` +
    `  readonly cats: string;\n` +
    `}\n` +
    `export const BYTE_DECODE_TABLES: Readonly<Record<string, ByteDecodeTable>> = Object.freeze({\n` +
    `${decodeEntries}\n` +
    `});\n`,
    'utf8',
  );

  console.log(`Wrote ${Object.keys(decodeTables).length} decode tables`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generate();
}
