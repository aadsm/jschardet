import { detectBom } from '../src/pipeline/bom.js';

describe('detectBom', () => {
  test('UTF-8 BOM', () => {
    const data = new Uint8Array([0xef, 0xbb, 0xbf, 0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    expect(detectBom(data)).toEqual({ encoding: 'utf-8-sig', confidence: 1.0, language: null, mimeType: null });
  });

  test('UTF-16 LE BOM', () => {
    const data = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x65, 0x00, 0x6c, 0x00, 0x6c, 0x00, 0x6f, 0x00]);
    expect(detectBom(data)).toEqual({ encoding: 'utf-16', confidence: 1.0, language: null, mimeType: null });
  });

  test('UTF-16 BE BOM', () => {
    const data = new Uint8Array([0xfe, 0xff, 0x00, 0x48, 0x00, 0x65, 0x00, 0x6c, 0x00, 0x6c, 0x00, 0x6f]);
    expect(detectBom(data)).toEqual({ encoding: 'utf-16', confidence: 1.0, language: null, mimeType: null });
  });

  test('UTF-32 LE BOM', () => {
    const data = new Uint8Array([0xff, 0xfe, 0x00, 0x00, 0x48, 0x00, 0x00, 0x00]);
    expect(detectBom(data)).toEqual({ encoding: 'utf-32', confidence: 1.0, language: null, mimeType: null });
  });

  test('UTF-32 BE BOM', () => {
    const data = new Uint8Array([0x00, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x00, 0x48]);
    expect(detectBom(data)).toEqual({ encoding: 'utf-32', confidence: 1.0, language: null, mimeType: null });
  });

  test('no BOM', () => {
    expect(detectBom(new TextEncoder().encode('Hello, world!'))).toBeNull();
  });

  test('empty input', () => {
    expect(detectBom(new Uint8Array([]))).toBeNull();
  });

  test('too short for BOM', () => {
    expect(detectBom(new Uint8Array([0xef]))).toBeNull();
    expect(detectBom(new Uint8Array([0xef, 0xbb]))).toBeNull();
  });

  test('UTF-32 LE checked before UTF-16 LE', () => {
    const data = new Uint8Array([0xff, 0xfe, 0x00, 0x00, 0x48, 0x00, 0x00, 0x00]);
    const result = detectBom(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-32');
  });

  test('UTF-32 LE BOM only (no payload)', () => {
    const result = detectBom(new Uint8Array([0xff, 0xfe, 0x00, 0x00]));
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-32');
  });

  test('UTF-32 LE BOM falls through to UTF-16 when payload not aligned', () => {
    // FF FE 00 00 30 00 — 2-byte payload, not a multiple of 4 → falls back to UTF-16
    const data = new Uint8Array([0xff, 0xfe, 0x00, 0x00, 0x30, 0x00]);
    const result = detectBom(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-16');
  });

  test('UTF-32 BE BOM falls through when payload not aligned', () => {
    // 2-byte payload, not aligned, and no UTF-16 fallback for this sequence
    const data = new Uint8Array([0x00, 0x00, 0xfe, 0xff, 0x00, 0x48]);
    expect(detectBom(data)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// chardet 7.7.0: a mark names the encoding, but the body has to decode under
// it, and a UTF-32 mark survives a max_bytes cut mid-unit.
// ---------------------------------------------------------------------------

import { detect, detectAll } from '../src/chardet.js';
import { UniversalDetector } from '../src/detector.js';
import { decodesWithoutError } from '../src/decode.js';
import { lookupEncoding } from '../src/registry.js';

function utf16(text: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), littleEndian);
  return out;
}

function utf32(text: string, littleEndian: boolean): Uint8Array {
  const cps = Array.from(text, c => c.codePointAt(0)!);
  const out = new Uint8Array(cps.length * 4);
  const view = new DataView(out.buffer);
  cps.forEach((cp, i) => view.setUint32(i * 4, cp, littleEndian));
  return out;
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

const BOM_UTF32_LE = new Uint8Array([0xff, 0xfe, 0x00, 0x00]);
const BOM_UTF32_BE = new Uint8Array([0x00, 0x00, 0xfe, 0xff]);
const BOM_UTF16_LE = new Uint8Array([0xff, 0xfe]);

function detectThrough(api: string, data: Uint8Array, maxBytes: number) {
  if (api === 'detect') return detect(data, { maxBytes });
  if (api === 'detect_all') return detectAll(data, { maxBytes })[0];
  const detector = new UniversalDetector({ maxBytes });
  if (api === 'split-stream') {
    detector.feed(data.subarray(0, maxBytes));
    detector.feed(data.subarray(maxBytes));
  } else {
    detector.feed(data);
  }
  return detector.close();
}

const APIS = ['detect', 'detect_all', 'stream', 'split-stream'];

// chardet also round-trips the data through data.decode(result["encoding"]);
// TextDecoder has no UTF-32, so these pin the answer only.
describe.each(['utf-32-le', 'utf-32-be'])('a UTF-32 BOM survives a max_bytes cut (%s)', encoding => {
  const littleEndian = encoding.endsWith('le');
  const text = 'Hello world, this is a UTF-32 document. '.repeat(50);
  const data = concat(littleEndian ? BOM_UTF32_LE : BOM_UTF32_BE, utf32(text, littleEndian));
  test.each(APIS.flatMap(api => [1020, 1021, 1022, 1023].map(maxBytes => [api, maxBytes] as const)))(
    '%s, max_bytes=%i', (api, maxBytes) => {
      const result = detectThrough(api, data, maxBytes);
      expect(result.encoding).toBe('UTF-32');
      expect(result.confidence).toBe(1.0);
    });
});

describe.each([
  ['cjk', '\0' + '中文测试'.repeat(30)],
  ['ascii', '\0' + 'Hello world. '.repeat(30)],
])('an invalid UTF-32 reading still tries the overlapping UTF-16 BOM (%s)', (_id, text) => {
  // The mark FF FE 00 00 reads as UTF-32-LE until the body fails to decode
  // as UTF-32; then the shorter UTF-16-LE mark answers.
  const data = concat(BOM_UTF16_LE, utf16(text, true));
  test.each(APIS.flatMap(api => [101, 102, 103].map(maxBytes => [api, maxBytes] as const)))(
    '%s, max_bytes=%i', (api, maxBytes) => {
      const result = detectThrough(api, data, maxBytes);
      expect(result.encoding).toBe('UTF-16');
      expect(result.confidence).toBe(1.0);
      expect(new TextDecoder('utf-16le').decode(data.subarray(2))).toBe(text);
    });
});

test.each(['utf-32-le', 'utf-32-be'])('a cut UTF-32 window still rejects corruption before the tail (%s)', encoding => {
  // Tolerating a cut code unit must not tolerate an invalid complete one.
  const littleEndian = encoding.endsWith('le');
  const outOfRange = new Uint8Array(4);
  new DataView(outOfRange.buffer).setUint32(0, 0x110000, littleEndian);
  const data = concat(
    littleEndian ? BOM_UTF32_LE : BOM_UTF32_BE,
    utf32('Hello world. ', littleEndian),
    outOfRange,
    utf32('more text', littleEndian),
  );
  expect(detect(data, { maxBytes: data.length - 1 }).encoding).not.toBe('UTF-32');
});

// chardet's _decodes_or_none: whatever answers must decode the data. Here the
// answer is resolved to its codec name and checked with decodesWithoutError,
// which tolerates a cut tail where chardet's strict data.decode() does not;
// none of these inputs ends mid-character.
function decodesOrNone(data: Uint8Array): void {
  const encoding = detect(data).encoding;
  if (encoding !== null) expect(decodesWithoutError(lookupEncoding(encoding)!, data)).toBe(true);
}

describe('a mark names the encoding; the body has to decode under it', () => {
  test('a UTF-16 BOM followed by a lone surrogate is no answer', () => {
    const data = concat(BOM_UTF16_LE, utf16('Hello, world. '.repeat(20), true), new Uint8Array([0x00, 0xd8, 0x74, 0x00]));
    expect(detectBom(data)).toBeNull();
    decodesOrNone(data);
  });

  test('a UTF-16-BE BOM followed by a lone surrogate is no answer', () => {
    const data = concat(new Uint8Array([0xfe, 0xff]), utf16('Hello, world. '.repeat(20), false), new Uint8Array([0xd8, 0x00, 0x00, 0x74]));
    expect(detectBom(data)).toBeNull();
    decodesOrNone(data);
  });

  test.each([false, true])('a UTF-32 BOM with an out-of-range unit is no answer (inputTruncated=%s)', inputTruncated => {
    const data = concat(BOM_UTF32_LE, utf32('x '.repeat(20), true), new Uint8Array([0x00, 0x00, 0x11, 0x00]));
    expect(detectBom(data, inputTruncated)).toBeNull();
    decodesOrNone(data);
  });

  test('a UTF-8 BOM over cp1252 bytes is no answer', () => {
    // 'café résumé '.encode("cp1252") * 20
    const cafe = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x72, 0xe9, 0x73, 0x75, 0x6d, 0xe9, 0x20]);
    const data = concat(new Uint8Array([0xef, 0xbb, 0xbf]), ...Array<Uint8Array>(20).fill(cafe));
    expect(detectBom(data)).toBeNull();
    expect(detect(data).encoding).not.toBe('UTF-8-SIG');
    decodesOrNone(data);
  });

  test('a BOM with a decodable body is still certain', () => {
    const data = concat(new Uint8Array([0xef, 0xbb, 0xbf]), new TextEncoder().encode('café résumé '.repeat(20)));
    const result = detectBom(data);
    expect(result?.encoding).toBe('utf-8-sig');
    expect(result?.confidence).toBe(1.0);
  });
});
