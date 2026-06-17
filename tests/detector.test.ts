// Port of chardet/tests/test_detector.py.

import { detect } from '../src/chardet.js';
import { UniversalDetector } from '../src/detector.js';
import { EncodingEra } from '../src/enums.js';

function bytes(s: string): Uint8Array {
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

function rangeBytes(start: number, end: number): Uint8Array {
  const out = new Uint8Array(end - start);
  for (let i = 0; i < out.length; i++) out[i] = start + i;
  return out;
}

function repeatBytes(arr: Uint8Array, times: number): Uint8Array {
  const out = new Uint8Array(arr.length * times);
  for (let i = 0; i < times; i++) out.set(arr, i * arr.length);
  return out;
}

function fillBytes(byte: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  out.fill(byte);
  return out;
}

describe('UniversalDetector', () => {
  test('basic lifecycle', () => {
    const detector = new UniversalDetector();
    detector.feed(new TextEncoder().encode('Hello world'));
    detector.close();
    const result = detector.result;
    expect(result.encoding).not.toBeNull();
  });

  test('result before close', () => {
    const detector = new UniversalDetector();
    detector.feed(new TextEncoder().encode('Hello world'));
    const result = detector.result;
    expect('encoding' in result).toBe(true);
    expect('confidence' in result).toBe(true);
    expect('language' in result).toBe(true);
  });

  test('reset', () => {
    const detector = new UniversalDetector();
    detector.feed(new TextEncoder().encode('Hello world'));
    detector.close();
    detector.reset();
    const result = detector.result;
    expect(result.encoding).toBeNull();
    expect(result.confidence).toBe(0.0);
  });

  test('done property starts false', () => {
    const detector = new UniversalDetector();
    expect(detector.done).toBe(false);
  });

  test('feed after close throws', () => {
    const detector = new UniversalDetector();
    detector.feed(new TextEncoder().encode('Hello'));
    detector.close();
    expect(() => detector.feed(new TextEncoder().encode('more data'))).toThrow();
  });

  test('feed after done is ignored', () => {
    const detector = new UniversalDetector({ maxBytes: 10 });
    detector.feed(fillBytes(0x78, 20));  // 'x' * 20
    expect(detector.done).toBe(true);
    // Should not throw
    detector.feed(new TextEncoder().encode('more data'));
    detector.close();
  });

  test('multiple feeds', () => {
    const detector = new UniversalDetector();
    const data = new TextEncoder().encode('Héllo wörld café');
    const chunkSize = 5;
    for (let i = 0; i < data.length; i += chunkSize) {
      detector.feed(data.subarray(i, i + chunkSize));
    }
    detector.close();
    expect(detector.result.encoding).not.toBeNull();
  });

  test('done set when max_bytes reached', () => {
    const detector = new UniversalDetector({ maxBytes: 50 });
    detector.feed(fillBytes(0x78, 30));
    expect(detector.done).toBe(false);
    detector.feed(fillBytes(0x78, 20));
    expect(detector.done).toBe(true);
  });

  test('done stays false before max_bytes', () => {
    const detector = new UniversalDetector({ maxBytes: 100 });
    detector.feed(new TextEncoder().encode('Hello world'));
    expect(detector.done).toBe(false);
  });

  test('encoding_era parameter', () => {
    const detector = new UniversalDetector({ encodingEra: EncodingEra.MODERN_WEB });
    detector.feed(new TextEncoder().encode('Hello world'));
    detector.close();
    expect(detector.result).not.toBeNull();
  });

  test('max_bytes parameter', () => {
    const detector = new UniversalDetector({ maxBytes: 100 });
    detector.feed(fillBytes(0x78, 200));
    detector.close();
    expect(detector.result).not.toBeNull();
  });

  test('max_bytes=0 throws', () => {
    expect(() => new UniversalDetector({ maxBytes: 0 })).toThrow(/max_bytes/);
  });

  test('max_bytes negative throws', () => {
    expect(() => new UniversalDetector({ maxBytes: -1 })).toThrow(/max_bytes/);
  });

  test('close is idempotent', () => {
    const detector = new UniversalDetector();
    detector.feed(repeatBytes(new TextEncoder().encode('Hello world, this is enough text. '), 3));
    const result1 = detector.close();
    const result2 = detector.close();
    expect(result1).toEqual(result2);
  });

  test('reset allows new detection', () => {
    const detector = new UniversalDetector();
    detector.feed(bytes('\xef\xbb\xbfHello'));
    detector.close();
    expect(detector.result.encoding).toBe('UTF-8-SIG');

    detector.reset();
    detector.feed(new TextEncoder().encode('Héllo wörld café'));
    detector.close();
    expect(detector.result.encoding).toBe('utf-8');
  });
});

// -- Equivalence tests: UniversalDetector must match detect() --

const EQUIVALENCE_SAMPLES: Record<string, Uint8Array> = {
  bom_utf8: bytes('\xef\xbb\xbfHello world'),
  bom_utf16le: concat(
    new Uint8Array([0xff, 0xfe]),
    new Uint8Array([0x48, 0x00, 0x65, 0x00, 0x6c, 0x00, 0x6c, 0x00, 0x6f, 0x00]),
  ),
  bom_utf16be: concat(
    new Uint8Array([0xfe, 0xff]),
    new Uint8Array([0x00, 0x48, 0x00, 0x65, 0x00, 0x6c, 0x00, 0x6c, 0x00, 0x6f]),
  ),
  ascii: repeatBytes(
    new TextEncoder().encode('Hello world, this is plain ASCII text. '),
    5,
  ),
  utf8: new TextEncoder().encode('Héllo wörld café résumé naïve über Ελληνικά'),
  escape_iso2022jp: bytes('Hello \x1b$B$3$s$K$A$O\x1b(B World'),
  markup_charset: new TextEncoder().encode(
    '<html><head><meta charset="windows-1252"></head><body>text</body></html>',
  ),
  markup_xml: new TextEncoder().encode(
    '<?xml version="1.0" encoding="iso-8859-1"?><root>text</root>',
  ),
  windows1252: concat(
    rangeBytes(0x20, 0x7F),
    repeatBytes(new Uint8Array([0xe9, 0xe8, 0xea, 0xeb, 0xf6, 0xfc, 0xe4]), 20),
  ),
  cjk_shiftjis: repeatBytes(
    new Uint8Array([0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd]),
    10,
  ),
};

interface EquivalenceCase {
  label: string;
  data: Uint8Array;
  chunkSize: number | null;
}
const EQUIVALENCE_CASES: EquivalenceCase[] = [];
for (const [label, data] of Object.entries(EQUIVALENCE_SAMPLES)) {
  for (const chunkSize of [1, 64, null]) {
    EQUIVALENCE_CASES.push({ label, data, chunkSize });
  }
}

describe('UniversalDetector equivalence with detect()', () => {
  test.each(EQUIVALENCE_CASES)(
    '$label (chunk=$chunkSize)',
    ({ data, chunkSize }) => {
      const expected = detect(data);

      const detector = new UniversalDetector();
      if (chunkSize === null) {
        detector.feed(data);
      } else {
        for (let i = 0; i < data.length; i += chunkSize) {
          detector.feed(data.subarray(i, i + chunkSize));
        }
      }
      const result = detector.close();

      expect(result.encoding).toBe(expected.encoding);
      expect(result.confidence).toBe(expected.confidence);
      expect(result.language).toBe(expected.language);
    },
  );
});
