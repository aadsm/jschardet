// src/decode.ts: chardet's decode questions by encoding name. Each picks the
// byte tables for a single-byte codec and the WHATWG decoder otherwise; the
// per-mechanism behaviour is covered in byte-decode.test.ts and
// text-decoder.test.ts, so these pin the routing.

import {
  danglingTailWithAsciiPrefix,
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
