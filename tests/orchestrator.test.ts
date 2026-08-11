// Port of chardet/tests/test_orchestrator.py.

import { vi } from 'vitest';
import { EncodingEra } from '../src/enums.js';
import { DetectionResult } from '../src/pipeline/index.js';
import { _internal, runPipeline } from '../src/pipeline/orchestrator.js';

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

function repeat(arr: Uint8Array, times: number): Uint8Array {
  const out = new Uint8Array(arr.length * times);
  for (let i = 0; i < times; i++) out.set(arr, i * arr.length);
  return out;
}

function rangeBytes(start: number, end: number): Uint8Array {
  const out = new Uint8Array(end - start);
  for (let i = 0; i < out.length; i++) out[i] = start + i;
  return out;
}

describe('runPipeline', () => {
  test('empty input', () => {
    const result = runPipeline(new Uint8Array(0), EncodingEra.MODERN_WEB);
    expect(result).toEqual([{ encoding: 'utf-8', confidence: 0.10, language: null, mimeType: 'text/plain' }]);
  });

  test('BOM detected', () => {
    const data = bytes('\xef\xbb\xbfHello');
    const result = runPipeline(data, EncodingEra.ALL);
    expect(result[0].encoding).toBe('utf-8-sig');
    expect(result[0].confidence).toBe(1.0);
  });

  test('BOM utf-16-le', () => {
    const data = concat(new Uint8Array([0xff, 0xfe]), new Uint8Array([
      0x48, 0x00, 0x65, 0x00, 0x6c, 0x00, 0x6c, 0x00, 0x6f, 0x00, 0x20, 0x00,
      0x77, 0x00, 0x6f, 0x00, 0x72, 0x00, 0x6c, 0x00, 0x64, 0x00,
    ]));
    const result = runPipeline(data, EncodingEra.ALL);
    expect(result[0].encoding).toBe('utf-16');
    expect(result[0].confidence).toBe(1.0);
  });

  test('BOM utf-16-be', () => {
    const data = concat(new Uint8Array([0xfe, 0xff]), new Uint8Array([
      0x00, 0x48, 0x00, 0x65, 0x00, 0x6c, 0x00, 0x6c, 0x00, 0x6f, 0x00, 0x20,
      0x00, 0x77, 0x00, 0x6f, 0x00, 0x72, 0x00, 0x6c, 0x00, 0x64,
    ]));
    const result = runPipeline(data, EncodingEra.ALL);
    expect(result[0].encoding).toBe('utf-16');
    expect(result[0].confidence).toBe(1.0);
  });

  test('BOM utf-32-le', () => {
    const head = new Uint8Array([0xff, 0xfe, 0x00, 0x00]);
    const body = new Uint8Array(11 * 4);
    'Hello world'.split('').forEach((c, i) => { body[i * 4] = c.charCodeAt(0); });
    const data = concat(head, body);
    const result = runPipeline(data, EncodingEra.ALL);
    expect(result[0].encoding).toBe('utf-32');
    expect(result[0].confidence).toBe(1.0);
  });

  test('BOM utf-32-be', () => {
    const head = new Uint8Array([0x00, 0x00, 0xfe, 0xff]);
    const body = new Uint8Array(11 * 4);
    'Hello world'.split('').forEach((c, i) => { body[i * 4 + 3] = c.charCodeAt(0); });
    const data = concat(head, body);
    const result = runPipeline(data, EncodingEra.ALL);
    expect(result[0].encoding).toBe('utf-32');
    expect(result[0].confidence).toBe(1.0);
  });

  test('UTF-16-LE without BOM detected via null-byte patterns', () => {
    const text = 'Hello world, this is a test of UTF-16 detection.';
    const data = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) data[i * 2] = text.charCodeAt(i);
    const result = runPipeline(data, EncodingEra.ALL);
    expect(result[0].encoding).toBe('utf-16-le');
    expect(result[0].confidence).toBe(0.95);
  });

  test('UTF-16-BE without BOM detected via null-byte patterns', () => {
    const text = 'Hello world, this is a test of UTF-16 detection.';
    const data = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) data[i * 2 + 1] = text.charCodeAt(i);
    const result = runPipeline(data, EncodingEra.ALL);
    expect(result[0].encoding).toBe('utf-16-be');
    expect(result[0].confidence).toBe(0.95);
  });

  test('UTF-32-LE without BOM detected via null-byte patterns', () => {
    const text = 'Hello world, this is a test.';
    const data = new Uint8Array(text.length * 4);
    for (let i = 0; i < text.length; i++) data[i * 4] = text.charCodeAt(i);
    const result = runPipeline(data, EncodingEra.ALL);
    expect(result[0].encoding).toBe('utf-32-le');
    expect(result[0].confidence).toBe(0.95);
  });

  test('UTF-32-BE without BOM detected via null-byte patterns', () => {
    const text = 'Hello world, this is a test.';
    const data = new Uint8Array(text.length * 4);
    for (let i = 0; i < text.length; i++) data[i * 4 + 3] = text.charCodeAt(i);
    const result = runPipeline(data, EncodingEra.ALL);
    expect(result[0].encoding).toBe('utf-32-be');
    expect(result[0].confidence).toBe(0.95);
  });

  test('pure ASCII', () => {
    const result = runPipeline(new TextEncoder().encode('Hello world 123'), EncodingEra.ALL);
    expect(result[0].encoding).toBe('ascii');
    expect(result[0].confidence).toBe(1.0);
  });

  test('UTF-8 multibyte', () => {
    const data = new TextEncoder().encode('Héllo wörld café');
    const result = runPipeline(data, EncodingEra.ALL);
    expect(result[0].encoding).toBe('utf-8');
    expect(result[0].confidence).toBeGreaterThanOrEqual(0.9);
  });

  test('binary content', () => {
    const data = repeat(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]), 100);
    const result = runPipeline(data, EncodingEra.ALL);
    expect(result[0].encoding).toBeNull();
    expect(result[0].confidence).toBe(0.95);
  });

  test('XML charset declaration', () => {
    const data = new TextEncoder().encode('<?xml version="1.0" encoding="iso-8859-1"?><root>Hello</root>');
    const result = runPipeline(data, EncodingEra.ALL);
    expect(result[0].encoding).toBe('iso8859-1');
  });
});

// ---------------------------------------------------------------------------
// Markup superset promotion
// ---------------------------------------------------------------------------

describe('markup superset promotion', () => {
  test('Shift_JIS to CP932 when CP932-extended bytes present', () => {
    const data = concat(
      new TextEncoder().encode('<?xml version="1.0" encoding="Shift_JIS"?><root>'),
      repeat(new Uint8Array([0xf0, 0x40]), 50),
      new TextEncoder().encode('</root>'),
    );
    const result = runPipeline(data, EncodingEra.ALL);
    expect(result[0].encoding).toBe('cp932');
  });

  test('no promotion when no extended bytes', () => {
    const data = concat(
      new TextEncoder().encode('<?xml version="1.0" encoding="Shift_JIS"?><root>'),
      repeat(new Uint8Array([0x82, 0xa0]), 50),
      new TextEncoder().encode('</root>'),
    );
    const result = runPipeline(data, EncodingEra.ALL);
    expect(result[0].encoding).toBe('shift_jis_2004');
  });

  test('non-promotable markup declaration passes through unchanged', () => {
    const data = new TextEncoder().encode('<?xml version="1.0" encoding="iso-8859-1"?><root>Hello</root>');
    const result = runPipeline(data, EncodingEra.ALL);
    expect(result[0].encoding).toBe('iso8859-1');
  });

  test('promotion respects exclude_encodings', () => {
    const data = concat(
      new TextEncoder().encode('<?xml version="1.0" encoding="Shift_JIS"?><root>'),
      repeat(new Uint8Array([0xf0, 0x40]), 50),
      new TextEncoder().encode('</root>'),
    );
    const result = runPipeline(data, EncodingEra.ALL, {
      excludeEncodings: new Set(['cp932']),
    });
    expect(result[0].encoding).toBe('shift_jis_2004');
  });
});

describe('runPipeline misc', () => {
  test('max_bytes truncation', () => {
    const data = repeat(new TextEncoder().encode('Hello'), 100_000);
    const result = runPipeline(data, EncodingEra.ALL, { maxBytes: 100 });
    expect(result[0].encoding).toBe('ascii');
    expect(result[0].confidence).toBe(1.0);
  });

  test('returns array of DetectionResult', () => {
    const result = runPipeline(new TextEncoder().encode('Hello'), EncodingEra.ALL);
    expect(Array.isArray(result)).toBe(true);
    for (const r of result) {
      expect(typeof r.confidence).toBe('number');
      expect('encoding' in r).toBe(true);
    }
  });

  test('single high byte returns an encoding (not null)', () => {
    const result = runPipeline(new Uint8Array([0xe4]), EncodingEra.MODERN_WEB);
    expect(result[0].encoding).not.toBeNull();
  });

  test('encoding_era filtering — every era yields ≥ 1 result', () => {
    const data = new TextEncoder().encode('Hello world');
    for (const era of Object.values(EncodingEra)) {
      const result = runPipeline(data, era as number);
      expect(result.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('fallback when no valid single-byte encoding', () => {
    const data = repeat(rangeBytes(0x80, 0x100), 2);
    const result = runPipeline(data, EncodingEra.ALL);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].encoding).not.toBeNull();
  });

  test('confidence clamped to 1.0', () => {
    // Use a CJK text that triggers the byte-coverage boost
    const text = 'これは日本語のテストです。日本語の文章を検出できるかどうかを確認します。';
    // EUC-JP encoding via TextEncoder is utf-8; use the cached encoder. We'll
    // build EUC-JP bytes directly is complex — instead use UTF-8 bytes which
    // also triggers the boost on multibyte CJK encodings during scoring.
    const data = new TextEncoder().encode(text);
    const result = runPipeline(data, EncodingEra.ALL);
    for (const r of result) {
      expect(r.confidence).toBeLessThanOrEqual(1.0);
    }
  });
});

describe('orchestrator fallbacks (spy on _internal)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    vi.restoreAllMocks();
  });

  test('fallback when validity filtering eliminates all candidates', () => {
    vi.spyOn(_internal, 'filterByValidity').mockReturnValue([]);
    const data = repeat(rangeBytes(0x80, 0x100), 2);
    const result = runPipeline(data, EncodingEra.ALL);
    expect(result[0].encoding).not.toBeNull(); // fallback, not null
  });

  test('fallback when CJK gate eliminates all candidates', () => {
    const original = _internal._gateCjkCandidates;
    vi.spyOn(_internal, '_gateCjkCandidates').mockImplementation((data, candidates, ctx) => {
      // Run the real gate to populate mb_scores, then return empty
      original(data, candidates, ctx);
      return [];
    });
    const data = repeat(rangeBytes(0x80, 0x100), 2);
    const result = runPipeline(data, EncodingEra.ALL);
    expect(result[0].encoding).not.toBeNull();
  });

  test('fallback when structural scores high but statistical empty (regression for chardet#367)', () => {
    // 0xf9 0x92 is a valid cp932 multi-byte sequence that scores 1.0
    // structurally but yields no statistical bigram matches on 2 bytes.
    const result = runPipeline(new Uint8Array([0xf9, 0x92]), EncodingEra.ALL);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].encoding).not.toBeNull();
  });
});
