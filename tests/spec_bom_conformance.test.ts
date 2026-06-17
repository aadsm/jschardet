// Port of chardet/tests/test_spec_bom_conformance.py.
//
// Pins chardet's BOM table and UTF-8/UTF-16 validators to the relevant specs:
//   - Unicode §23.8 / WHATWG Encoding Standard — BOM byte sequences
//   - RFC 3629 — UTF-8 byte structure
//   - RFC 2781 — UTF-16 surrogate pair encoding

import { _BOMS } from '../src/pipeline/bom.js';
import { detectUtf8 } from '../src/pipeline/utf8.js';

// ---------------------------------------------------------------------------
// BOM table pins
// ---------------------------------------------------------------------------

// The exact set of [bytes, canonical_name] pairs chardet must recognise.
// Derived from Unicode §23.8 and the WHATWG decode algorithm.
const EXPECTED_BOM_SET: Array<[Uint8Array, string]> = [
  [new Uint8Array([0xef, 0xbb, 0xbf]),             'utf-8-sig'],
  [new Uint8Array([0xfe, 0xff]),                   'utf-16'],
  [new Uint8Array([0xff, 0xfe]),                   'utf-16'],
  [new Uint8Array([0x00, 0x00, 0xfe, 0xff]),       'utf-32'],
  [new Uint8Array([0xff, 0xfe, 0x00, 0x00]),       'utf-32'],
];

function bomKey(bom: Uint8Array, name: string): string {
  return `${Array.from(bom).map(b => b.toString(16).padStart(2, '0')).join('')}:${name}`;
}

test('bom table matches spec set exactly', () => {
  const actual   = new Set(_BOMS.map(([b, n]) => bomKey(b, n)));
  const expected = new Set(EXPECTED_BOM_SET.map(([b, n]) => bomKey(b, n)));
  const extras   = [...actual].filter(k => !expected.has(k));
  const missing  = [...expected].filter(k => !actual.has(k));
  expect(extras).toEqual([]);
  expect(missing).toEqual([]);
});

test('bom table orders utf32 before utf16', () => {
  const utf16LeKey = bomKey(new Uint8Array([0xff, 0xfe]), 'utf-16');
  const utf32LeKey = bomKey(new Uint8Array([0xff, 0xfe, 0x00, 0x00]), 'utf-32');
  const keys = _BOMS.map(([b, n]) => bomKey(b, n));
  expect(keys.indexOf(utf32LeKey)).toBeLessThan(keys.indexOf(utf16LeKey));
});

// ---------------------------------------------------------------------------
// RFC 3629 — UTF-8 byte-structure pins
// ---------------------------------------------------------------------------

// Each entry: [description, bytes, shouldBeAccepted]
const _UTF8_CASES: Array<[string, Uint8Array, boolean]> = [
  // Valid boundary code points
  ['U+0080 (smallest 2-byte)',                  new TextEncoder().encode(''),     true],
  ['U+07FF (largest 2-byte)',                   new TextEncoder().encode('߿'),     true],
  ['U+0800 (smallest 3-byte)',                  new TextEncoder().encode('ࠀ'),     true],
  ['U+FFFF (largest 3-byte, BMP edge)',         new TextEncoder().encode('￿'),     true],
  ['U+10000 (smallest 4-byte, first supplementary)', new TextEncoder().encode('\u{10000}'), true],
  ['U+10FFFF (largest Unicode code point)',     new TextEncoder().encode('\u{10ffff}'), true],
  // Overlong encodings (forbidden by RFC 3629)
  ['overlong 2-byte encoding of U+0000',        new Uint8Array([0xc0, 0x80]),               false],
  ["overlong 2-byte encoding of '/'",           new Uint8Array([0xc0, 0xaf]),               false],
  ['overlong 3-byte encoding of U+007F',        new Uint8Array([0xe0, 0x80, 0xbf]),         false],
  ['overlong 4-byte encoding of U+FFFF',        new Uint8Array([0xf0, 0x80, 0x80, 0xbf]),   false],
  // Lone surrogates (U+D800-U+DFFF) — forbidden by RFC 3629
  ['lone high surrogate U+D800',                new Uint8Array([0xed, 0xa0, 0x80]),         false],
  ['lone low surrogate U+DFFF',                 new Uint8Array([0xed, 0xbf, 0xbf]),         false],
  // Out of range (above U+10FFFF)
  ['codepoint above U+10FFFF (0xF4 0x90)',      new Uint8Array([0xf4, 0x90, 0x80, 0x80]),   false],
  ['5-byte sequence (not allowed)',             new Uint8Array([0xf8, 0x88, 0x80, 0x80, 0x80]), false],
  // Invalid start bytes
  ['bare continuation byte 0x80',               new Uint8Array([0x80]),                     false],
  ['bare continuation byte 0xBF',               new Uint8Array([0xbf]),                     false],
  ['invalid start byte 0xC0',                   new Uint8Array([0xc0, 0x80]),               false],
  ['invalid start byte 0xC1',                   new Uint8Array([0xc1, 0x80]),               false],
  ['invalid start byte 0xF5',                   new Uint8Array([0xf5, 0x80, 0x80, 0x80]),   false],
  ['invalid start byte 0xFE',                   new Uint8Array([0xfe]),                     false],
  ['invalid start byte 0xFF',                   new Uint8Array([0xff]),                     false],
];

test('utf8 validator matches rfc3629', () => {
  const failures: string[] = [];
  for (const [description, data, shouldAccept] of _UTF8_CASES) {
    const accepted = detectUtf8(data) !== null;
    if (accepted !== shouldAccept) {
      const verdict = accepted ? 'accepted' : 'rejected';
      const want = shouldAccept ? 'accept' : 'reject';
      failures.push(`  ${description}: validator ${verdict} [${Array.from(data).map(b => `0x${b.toString(16).padStart(2,'0')}`).join(', ')}]; expected to ${want}`);
    }
  }
  expect(failures).toEqual([]);
});

// ---------------------------------------------------------------------------
// RFC 2781 — UTF-16 surrogate pair round-trip
// ---------------------------------------------------------------------------

test('utf16 surrogate pair roundtrip rfc2781', () => {
  const codepoints = ['\u{10000}', '\u{1f600}', '\u{10ffff}'];
  for (const cp of codepoints) {
    // UTF-16-LE round-trip
    const le = new TextEncoder().encode(cp);  // UTF-8 first
    // Use TextDecoder for UTF-16 LE/BE round-trip
    const leBytes = new Uint8Array(cp.length > 1 ? 4 : 2);
    const view = new DataView(leBytes.buffer);
    const code = cp.codePointAt(0)!;
    const hi = 0xd800 + ((code - 0x10000) >> 10);
    const lo = 0xdc00 + ((code - 0x10000) & 0x3ff);
    view.setUint16(0, hi, true);
    view.setUint16(2, lo, true);
    const decoded = new TextDecoder('utf-16le').decode(leBytes);
    expect(decoded).toBe(cp);

    // UTF-16-BE round-trip
    const beBytes = new Uint8Array(4);
    const beView = new DataView(beBytes.buffer);
    beView.setUint16(0, hi, false);
    beView.setUint16(2, lo, false);
    const decodedBe = new TextDecoder('utf-16be').decode(beBytes);
    expect(decodedBe).toBe(cp);
  }
});
