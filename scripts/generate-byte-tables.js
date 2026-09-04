#!/usr/bin/env node
// Generates src/pipeline/_byte-decode-tables.ts from Python at pin time, for
// every encoding in chardet's registry (plus the codecs the port decodes with
// directly, EXTRA_CODECS below): per single byte, the decoded code point and
// Unicode general category.
//
// Computed by Python (codecs + unicodedata, the source of truth) so it never
// drifts from CPython: TextDecoder has no decoder at all for several of these
// encodings (hp-roman8, the EBCDIC pages, koi8-t), its WHATWG single-byte
// decoders gap-fill positions CPython's strict codecs leave undefined, and
// the runtime JS engine's Unicode database (ICU) can be a version or two
// behind CPython's UCD. Emitted as a plain literal (not zlib-wrapped): the
// payload is small. src/pipeline/byte-decode.ts is the lookup API over it;
// see docs/textdecoder-vs-python.md for the map of the gaps it bridges.
//
// One table, three consumers:
//   - src/decode.ts: a single-byte encoding decodes data iff no byte of it
//     is undefined (the cps sentinel), which is exactly chardet's
//     decodes_without_error / decodes_completely for a stateless codec.
//   - markup.ts: decodes the head as cp037 to read EBCDIC charset
//     declarations.
//   - confusion.ts: differingHighBytes reads the code points (cps),
//     _pairCategories the categories (cats), and _letterCaseTable derives
//     its 0/1/2 letter-kind from the categories — chardet's
//     _letter_case_table is a pure function of the general category,
//     verified below to agree byte-for-byte before we rely on it.
//
// Both cps and cats hold all 256 bytes: cp424 leaves positions below 0x80
// undefined, the EBCDIC pages put letters there, and the letter-case
// derivation classifies neighbour bytes of any value. The low half every
// ASCII-compatible encoding shares is emitted once (ASCII_CPS / ASCII_CATS)
// and concatenated, so the per-encoding literals stay the size of the high
// half. cats stores each category index offset by CAT_BASE so every entry
// is a printable ASCII character rather than a \uXXXX escape.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chardetVersion } from './chardet-version.js';
import { chardet7SrcDir, ensureChardet7 } from './lib/chardet.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const decodeTablesPath = join(root, 'src', 'pipeline', '_byte-decode-tables.ts');

// Codecs the port decodes with by name that are not registry entries of their
// own. chardet's _detect_ebcdic_declaration decodes the head with cp037,
// which the registry files as an alias of cp1140 (the two differ at one
// byte, 0x9F: currency sign vs euro sign), so markup.ts needs cp037's own
// table. A codec listed here that becomes a registry name is an error, so
// the list cannot go stale silently.
const EXTRA_CODECS = ['cp037'];

// The category index each cats entry stores (plus CAT_BASE). Same order as
// the uint8 category mapping in confusion.bin (scripts/confusion_training.py
// upstream), which confusion.ts decodes with the emitted CATEGORY_NAMES.
// Cn (unassigned) is last.
const CATEGORY_ORDER = [
  'Lu', 'Ll', 'Lt', 'Lm', 'Lo',
  'Mn', 'Mc', 'Me',
  'Nd', 'Nl', 'No',
  'Pc', 'Pd', 'Ps', 'Pe', 'Pi', 'Pf', 'Po',
  'Sm', 'Sc', 'Sk', 'So',
  'Zs', 'Zl', 'Zp',
  'Cc', 'Cf', 'Cs', 'Co', 'Cn',
];

// '0'..'M' for the 30 categories: no JSON escaping, no quote or backslash.
const CAT_BASE = 0x30;

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
CAT_BASE = ${CAT_BASE}
EXTRA_CODECS = ${JSON.stringify(EXTRA_CODECS)}
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

infos = {enc.name: enc for enc in REGISTRY.values()}
for name in EXTRA_CODECS:
    if name in infos:
        sys.stderr.write(f"{name} is a registry name now; drop it from EXTRA_CODECS\\n")
        sys.exit(2)

decode_tables = {}
for name in sorted(infos) + EXTRA_CODECS:
    cps = []
    cats = []
    for b in range(256):
        try:
            ch = bytes([b]).decode(name)
        except UnicodeDecodeError:
            cps.append(UNDECODABLE)
            cats.append(CN)
            continue
        if len(ch) == 1:
            cps.append(ord(ch))
            cats.append(CAT_TO_INT.get(unicodedata.category(ch), CN))
        else:
            cps.append(NON_SINGLE)
            cats.append(CN)

    # A single-byte codec, for the validity stage's purposes, is a stateless
    # one where every byte decodes to exactly one character or raises: then
    # "data decodes" is exactly "no byte of data is undefined". The UTF
    # family is flagged is_multibyte=False in the registry but is not that
    # (a lone high byte raises only because it is a partial sequence); the
    # deterministic BOM / UTF-1632 / escape / utf8 stages settle it before
    # validity. ascii is a single-byte codec (0x80..0xFF undefined).
    single_byte = name in EXTRA_CODECS or (
        not infos[name].is_multibyte and not name.startswith("utf-")
    )
    if single_byte:
        if NON_SINGLE in cps:
            sys.stderr.write(f"{name}: a byte decodes to zero or several characters; not single-byte\\n")
            sys.exit(2)
        whole = bytes(range(256)).decode(name, errors="replace")
        per_byte = "".join(bytes([b]).decode(name, errors="replace") for b in range(256))
        if whole != per_byte:
            sys.stderr.write(f"{name}: stateful decode; not single-byte\\n")
            sys.exit(2)

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
        "singleByte": single_byte,
        "cps": "".join(chr(c) for c in cps),
        "cats": "".join(chr(CAT_BASE + c) for c in cats),
    }

json.dump({
    "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
    "tables": decode_tables,
}, sys.stdout)
`;

export function generate() {
  ensureChardet7(root);
  const out = execFileSync('python3', ['-c', PY], {
    env: { ...process.env, PYTHONPATH: chardet7SrcDir(root) },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const { python, tables } = JSON.parse(out);
  const version = chardetVersion();

  // The low half every ASCII-compatible encoding shares, emitted once.
  const asciiCps = tables['ascii'].cps.slice(0, 0x80);
  const asciiCats = tables['ascii'].cats.slice(0, 0x80);
  const half = (s, shared, name) =>
    s.slice(0, 0x80) === shared
      ? `${name} + ${JSON.stringify(s.slice(0x80))}`
      : JSON.stringify(s);

  const decodeEntries = Object.entries(tables)
    .map(([enc, { singleByte, cps, cats }]) =>
      `  ${JSON.stringify(enc)}: {\n` +
      `    singleByte: ${singleByte},\n` +
      `    cps: ${half(cps, asciiCps, 'ASCII_CPS')},\n` +
      `    cats: ${half(cats, asciiCats, 'ASCII_CATS')},\n` +
      `  },`)
    .join('\n');
  writeFileSync(
    decodeTablesPath,
    `// generated by scripts/generate-byte-tables.js — do not edit manually\n` +
    `// chardet ${version}, python ${python}\n` +
    `//\n` +
    `// Per-encoding single-byte decode tables for every encoding in the\n` +
    `// registry (and cp037, which markup.ts decodes with by name), computed by\n` +
    `// Python's codecs + unicodedata (the source of truth). byte-decode.ts is\n` +
    `// the lookup API over them; read it rather than these strings directly.\n` +
    `//   cps        charCodeAt(b) = the decoded code point of byte b, or 0xFFFF\n` +
    `//              when the byte does not decode, or 0xFFFE when it decodes to\n` +
    `//              zero or more than one character (a stateful codec's shift\n` +
    `//              byte).\n` +
    `//   cats       charCodeAt(b) - CAT_BASE = the index into CATEGORY_NAMES of\n` +
    `//              byte b's Unicode general category; 'Cn' for the two\n` +
    `//              sentinel cases.\n` +
    `//   singleByte true for a stateless single-byte codec — every byte decodes\n` +
    `//              to exactly one character or is undefined — so that "data\n` +
    `//              decodes" is exactly "no byte of data is undefined". False\n` +
    `//              for the multi-byte encodings and the UTF family.\n` +
    `// ASCII_CPS / ASCII_CATS are the low half (0x00..0x7F) every\n` +
    `// ASCII-compatible encoding shares.\n` +
    `export interface ByteDecodeTable {\n` +
    `  readonly singleByte: boolean;\n` +
    `  readonly cps: string;\n` +
    `  readonly cats: string;\n` +
    `}\n` +
    `export const CATEGORY_NAMES: readonly string[] = ${JSON.stringify(CATEGORY_ORDER)};\n` +
    `export const CAT_BASE = 0x${CAT_BASE.toString(16)};\n` +
    `const ASCII_CPS = ${JSON.stringify(asciiCps)};\n` +
    `const ASCII_CATS = ${JSON.stringify(asciiCats)};\n` +
    `export const BYTE_DECODE_TABLES: Readonly<Record<string, ByteDecodeTable>> = Object.freeze({\n` +
    `${decodeEntries}\n` +
    `});\n`,
    'utf8',
  );

  console.log(`Wrote ${Object.keys(tables).length} decode tables`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generate();
}
