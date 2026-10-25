// src/decode.ts: chardet's decode questions by encoding name. Each picks the
// byte tables for a single-byte codec and the WHATWG decoder otherwise; the
// per-mechanism behaviour is covered in byte-decode.test.ts and
// text-decoder.test.ts, so these pin the routing.

import {
  danglingTailWithAsciiPrefix,
  decodeStrictText,
  decodeText,
  decodesCompletely,
  decodesWithoutError,
} from '../src/decode.js';

function bytes(s: string): Uint8Array {
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

// "mam" + the first byte of a two-byte UTF-8 sequence.
const DANGLING = new Uint8Array([0x6d, 0x61, 0x6d, 0xe1]);

test('decodesWithoutError: single-byte from the tables, multi-byte from TextDecoder', () => {
  expect(decodesWithoutError('cp1252', bytes('caf\xe9'))).toBe(true);
  expect(decodesWithoutError('cp1252', bytes('caf\x81'))).toBe(false);
  expect(decodesWithoutError('hp-roman8', bytes('\xff'))).toBe(false);
  expect(decodesWithoutError('utf-8', DANGLING)).toBe(true); // deferred tail
  expect(decodesWithoutError('utf-8', bytes('\xff'))).toBe(false);
});

test('decodesWithoutError: an encoding with no decoder is kept', () => {
  expect(decodesWithoutError('iso2022_jp_2', bytes('\x1b$B'))).toBe(true);
});

// Expected values are chardet's decodes_without_error on the same bytes
// (CPython 3.11): the UTF encodings with no WHATWG label of their own.
test.each([
  ['utf-8-sig', 'efbbbf636166c3a9', true],
  ['utf-8-sig', 'efbbbf636166e9', true], // truncated tail after the mark
  ['utf-8-sig', 'efbbbf', true],
  ['utf-8-sig', '636166c3a9', true],
  ['utf-8-sig', 'efbbbf6162ff', false],
  ['utf-16', 'fffe68006900', true],
  ['utf-16', 'feff00680069', true],
  ['utf-16', 'fffe00d86100', false], // lone high surrogate
  ['utf-16', 'feffd8000061', false],
  ['utf-16', '68006900', false], // no mark
  ['utf-16', 'fffe680069', true],
  ['utf-16', 'fffe', true],
  ['utf-16', 'fffe680000d8', true], // high surrogate deferred at the end
  ['utf-16', '68', true],
  ['utf-32', 'fffe000068000000', true],
  ['utf-32', '0000feff00000068', true],
  ['utf-32', 'fffe000000001100', false], // above U+10FFFF
  ['utf-32', 'fffe000000d80000', false], // surrogate
  ['utf-32', 'fffe00006800', true],
  ['utf-32', '68000000', false], // no mark
  ['utf-32', 'fffe0000', true],
  ['utf-32', 'fffe00', true],
  ['utf-32', 'fffe0001', false],
  ['utf-32-be', '00000068', true],
  ['utf-32-be', '0010ffff', true],
  ['utf-32-be', '00110000', false],
  ['utf-32-be', '0000dfff', false],
  ['utf-32-be', '000000680000', true],
  ['utf-32-le', '68000000', true],
  ['utf-32-le', 'ffff1000', true],
  ['utf-32-le', '00001100', false],
  ['utf-32-le', '00dc0000', false],
  ['utf-32-le', '6800000000', true],
  ['utf-7', '2b414745415967426a2d', true],
  ['utf-7', '612b2f76382d62', true],
  ['utf-7', '2b414745', true],
  ['utf-7', '2b4147452d782b7c', false],
] as const)('decodesWithoutError(%s, %s) is %s, as in CPython', (enc, hex, expected) => {
  const data = Uint8Array.from(hex.match(/../g) ?? [], h => parseInt(h, 16));
  expect(decodesWithoutError(enc, data)).toBe(expected);
});

test('decodesCompletely: the strict sibling', () => {
  expect(decodesCompletely('cp1252', bytes('caf\xe9'))).toBe(true);
  expect(decodesCompletely('cp1252', bytes('caf\x81'))).toBe(false);
  expect(decodesCompletely('ascii', bytes('plain'))).toBe(true);
  expect(decodesCompletely('ascii', bytes('caf\xe9'))).toBe(false);
  expect(decodesCompletely('utf-8', DANGLING)).toBe(false); // tail is an error
});

test('danglingTailWithAsciiPrefix is keyed by encoding name', () => {
  expect(danglingTailWithAsciiPrefix('utf-8', DANGLING)).toBe(true);
  expect(danglingTailWithAsciiPrefix('utf-8', new TextEncoder().encode('mama'))).toBe(false);
  // A single-byte encoding has no multi-byte tail: 0xe1 is a whole character.
  expect(danglingTailWithAsciiPrefix('cp1252', DANGLING)).toBe(false);
  expect(danglingTailWithAsciiPrefix('cp500', DANGLING)).toBe(false);
});

test('decodeText: errors="ignore" text through the WHATWG decoder', () => {
  expect(decodeText('cp1252', bytes('caf\xe9'))).toBe('caf\u00e9');
  expect(decodeText('utf-8', bytes('caf\xc3\xa9'))).toBe('caf\u00e9');
  expect(decodeText('utf-8', bytes('caf\xff'))).toBe('caf\ufffd');
  // No WHATWG decoder: no text.
  expect(decodeText('cp500', bytes('\x88\x85'))).toBeNull();
});

test('decodeStrictText: the strict text, null when the bytes do not decode', () => {
  expect(decodeStrictText('cp1252', bytes('caf\xe9'))).toBe('caf\u00e9');
  expect(decodeStrictText('cp1252', bytes('caf\x81'))).toBeNull();
  // A page TextDecoder lacks decodes from the byte tables: "Hi".encode("cp500")
  expect(decodeStrictText('cp500', new Uint8Array([0xc8, 0x89]))).toBe('Hi');
  expect(decodeStrictText('utf-8', bytes('caf\xc3\xa9'))).toBe('caf\u00e9');
  expect(decodeStrictText('utf-8', bytes('caf\xff'))).toBeNull();
  // "Hi".encode("utf-16-le") / ("utf-16-be"); a lone low surrogate does not decode.
  expect(decodeStrictText('utf-16-le', new Uint8Array([0x48, 0x00, 0x69, 0x00]))).toBe('Hi');
  expect(decodeStrictText('utf-16-be', new Uint8Array([0x00, 0x48, 0x00, 0x69]))).toBe('Hi');
  expect(decodeStrictText('utf-16-le', new Uint8Array([0x00, 0xdc]))).toBeNull();
});
