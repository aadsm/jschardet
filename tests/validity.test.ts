// Port of chardet/tests/test_validity.py.

import { EncodingEra } from '../src/enums.js';
import { filterByValidity } from '../src/pipeline/validity.js';
import { getCandidates } from '../src/registry.js';

function encode(text: string, label: string): Uint8Array {
  // Python uses str.encode(label) for arbitrary codecs. JS only has
  // TextEncoder for utf-8, so for the legacy fixtures we hand-encode the
  // bytes that Python produces.
  if (label === 'utf-8') return new TextEncoder().encode(text);
  if (label === 'latin-1') {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
    return out;
  }
  throw new Error(`unsupported test encoding: ${label}`);
}

test('utf-8 text is valid under utf-8', () => {
  const data = encode('Héllo wörld', 'utf-8');
  const candidates = getCandidates(EncodingEra.ALL);
  const valid = filterByValidity(data, candidates);
  const names = new Set(valid.map(e => e.name));
  expect(names.has('utf-8')).toBe(true);
});

test('latin-1 text is valid under iso8859-1', () => {
  const data = encode('Héllo', 'latin-1');
  const candidates = getCandidates(EncodingEra.ALL);
  const valid = filterByValidity(data, candidates);
  const names = new Set(valid.map(e => e.name));
  expect(names.has('iso8859-1')).toBe(true);
});

test('shift_jis text is valid under shift_jis_2004', () => {
  // "こんにちは" encoded as Shift_JIS bytes (Python: "こんにちは".encode("shift_jis")).
  const data = new Uint8Array([0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd]);
  const candidates = getCandidates(EncodingEra.ALL);
  const valid = filterByValidity(data, candidates);
  const names = new Set(valid.map(e => e.name));
  expect(names.has('shift_jis_2004')).toBe(true);
});

test('eliminates impossible encodings', () => {
  // "Привет" encoded as windows-1251 bytes (Python: "Привет".encode("windows-1251")).
  const data = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
  const candidates = getCandidates(EncodingEra.ALL);
  const valid = filterByValidity(data, candidates);
  expect(valid.length).toBeLessThan(candidates.length);
});

test('empty input returns all', () => {
  const candidates = getCandidates(EncodingEra.MODERN_WEB);
  const valid = filterByValidity(new Uint8Array(0), candidates);
  expect(valid.length).toBe(candidates.length);
});

test('eliminates utf-8 from candidates on invalid utf-8 bytes', () => {
  const data = new Uint8Array([0xc3, 0x28]); // bad continuation
  const candidates = getCandidates(EncodingEra.ALL);
  const valid = filterByValidity(data, candidates);
  const names = new Set(valid.map(e => e.name));
  expect(names.has('utf-8')).toBe(false);
});

test('all eliminated returns empty', () => {
  const data = new Uint8Array([0xff, 0xfe]); // invalid utf-8
  const utf8Only = getCandidates(EncodingEra.ALL).filter(e => e.name === 'utf-8');
  expect(utf8Only.length).toBe(1);
  const valid = filterByValidity(data, utf8Only);
  expect(valid.length).toBe(0);
});

test('returns array', () => {
  const candidates = getCandidates(EncodingEra.MODERN_WEB);
  const valid = filterByValidity(new TextEncoder().encode('Hello'), candidates);
  expect(Array.isArray(valid)).toBe(true);
});

test('rejects windows-125x SBCS on undefined C1 bytes (matches Python, not WHATWG pass-through)', () => {
  // Regression: Python's cp1250 codec rejects 0x81 / 0x83 / 0x88 / 0x90 / 0x98
  // as undefined positions, but WHATWG's windows-1250 decoder maps them
  // through to U+0081 etc. under fatal: true. The validity filter used to
  // route windows-125x through TextDecoder, so files with undefined C1 bytes
  // (e.g. johab-encoded Korean) kept cp1250 as a candidate and outscored
  // their true encoding statistically. SBCS_UNDEFINED_BYTES is now consulted
  // first and matches Python's strict behaviour.
  const data = new Uint8Array([0x48, 0x69, 0x81]); // "Hi" + cp1250 undefined byte
  const candidates = getCandidates(EncodingEra.ALL).filter(e => e.name === 'cp1250');
  expect(candidates.length).toBe(1);
  const valid = filterByValidity(data, candidates);
  expect(valid.length).toBe(0);
});

test('rejects SBCS without WHATWG label when bytes hit the undefined-byte set', () => {
  // 0xAA is undefined under koi8-t and cp424, but defined under cp864 and cp1256.
  // Without the undefined-byte table, koi8-t and cp424 would slip through validity since they
  // have no WHATWG label, and would then outscore cp864 statistically.
  const data = new Uint8Array([0x23, 0xa5, 0xaa, 0xae, 0xcf, 0xab]);
  const candidates = getCandidates(EncodingEra.ALL).filter(e =>
    ['koi8-t', 'cp424', 'cp864', 'cp1256'].includes(e.name),
  );
  expect(candidates.length).toBe(4);
  const names = new Set(filterByValidity(data, candidates).map(e => e.name));
  expect(names.has('koi8-t')).toBe(false);
  expect(names.has('cp424')).toBe(false);
  expect(names.has('cp864')).toBe(true);
  expect(names.has('cp1256')).toBe(true);
});
