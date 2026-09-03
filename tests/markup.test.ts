import { detectMarkupCharset, promoteMarkupSuperset } from '../src/pipeline/markup.js';
import { DetectionResult } from '../src/pipeline/index.js';

const DETERMINISTIC_CONFIDENCE = 0.95;

function enc(s: string): Uint8Array { return new TextEncoder().encode(s); }

function concat(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

describe('detectMarkupCharset', () => {
  test('XML encoding declaration', () => {
    const data = enc('<?xml version="1.0" encoding="iso-8859-1"?><root/>');
    const result = detectMarkupCharset(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('iso8859-1');
    expect(result!.confidence).toBeLessThan(1.0);
  });

  test('HTML5 meta charset', () => {
    const data = enc('<html><head><meta charset="utf-8"></head></html>');
    const result = detectMarkupCharset(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-8');
  });

  test('HTML4 content-type charset', () => {
    const data = enc(
      '<html><head>' +
      '<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">' +
      '</head></html>'
    );
    const result = detectMarkupCharset(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('cp1252');
  });

  test('plain text returns null', () => {
    expect(detectMarkupCharset(enc('Just plain text with no HTML or XML'))).toBeNull();
  });

  test('empty input returns null', () => {
    expect(detectMarkupCharset(new Uint8Array(0))).toBeNull();
  });

  test('XML with single quotes', () => {
    const data = enc("<?xml version='1.0' encoding='shift_jis'?><root/>");
    const result = detectMarkupCharset(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('shift_jis_2004');
  });

  test('case-insensitive meta', () => {
    const data = enc('<META CHARSET="UTF-8">');
    const result = detectMarkupCharset(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-8');
  });

  test('charset with whitespace', () => {
    const data = enc('<meta charset = "utf-8" >');
    const result = detectMarkupCharset(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-8');
  });

  test('unknown encoding returns null', () => {
    expect(detectMarkupCharset(enc('<meta charset="not-a-real-encoding">'))).toBeNull();
  });

  test('lying charset declaration rejected', () => {
    // Declares shift_jis but body is UTF-8 — _validateBytes must reject it.
    //
    // The body must be undecodable before its final character: validity
    // tolerates an incomplete trailing one, so a body whose only defect is a
    // dangling lead byte would pass. Same bytes as upstream's
    // test_lying_charset_declaration_rejected; they fail at byte 13 of 81.
    const data = concat(
      enc('<meta charset="shift_jis">'),
      enc('これは文字コード判定のテストに用いる日本語の文章です。'),
    );
    expect(detectMarkupCharset(data)).toBeNull();
  });

  test('valid charset declaration accepted', () => {
    // shift_jis bytes for "日本語テスト", captured via:
    //   python3 -c 'import sys; sys.stdout.buffer.write("日本語テスト".encode("shift_jis"))'
    const sjisBody = new Uint8Array([0x93,0xfa,0x96,0x7b,0x8c,0xea,0x83,0x65,0x83,0x58,0x83,0x67]);
    const data = concat(enc('<meta charset="shift_jis">'), sjisBody);
    const result = detectMarkupCharset(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('shift_jis_2004');
  });

  test('charset within scan limit found', () => {
    const padding = new Uint8Array(100).fill(0x78); // 'x' * 100
    const data = concat(padding, enc('<meta charset="utf-8">'));
    const result = detectMarkupCharset(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-8');
  });

  test('charset beyond scan limit ignored', () => {
    const padding = new Uint8Array(5000).fill(0x78); // 'x' * 5000, exceeds _SCAN_LIMIT
    const data = concat(padding, enc('<meta charset="utf-8">'));
    expect(detectMarkupCharset(data)).toBeNull();
  });

  test('non-ASCII charset name ignored', () => {
    const data = concat(enc('<meta charset="'), new Uint8Array([0xff, 0xfe]), enc('">'));
    expect(detectMarkupCharset(data)).toBeNull();
  });

  test('null byte in charset name does not crash', () => {
    // Regression test for chardet issue #369 — codecs.lookup() raises
    // ValueError on embedded nulls. Our codecsLookup short-circuits on '\x00'.
    const data = concat(enc('<meta charset="'), new Uint8Array([0x00]), enc('utf-8">'));
    expect(detectMarkupCharset(data)).toBeNull();
  });

  test('PEP 263 non-ASCII coding name', () => {
    // Python ports this test by monkey-patching _PEP263_RE to a broader
    // pattern that captures non-ASCII bytes, then asserts the exception
    // path returns None. Our production regex's `[-\w.]+` (no `u` flag)
    // already rejects bytes ≥ 0x80, so the test passes without patching.
    const data = concat(enc('# -*- coding: '), new Uint8Array([0xff, 0xfe]), enc(' -*-\n'));
    expect(detectMarkupCharset(data)).toBeNull();
  });
});

// Unit tests for promoteMarkupSuperset (end-to-end promotion coverage lives in
// tests/orchestrator.test.ts).
describe('promoteMarkupSuperset', () => {
  test('passes through results with encoding=null', () => {
    const result: DetectionResult = { encoding: null, confidence: 0.95, language: null, mimeType: null };
    const allowed = new Set(['cp932', 'shift_jis_2004']);
    expect(promoteMarkupSuperset(new Uint8Array(0), result, allowed)).toBe(result);
  });

  // The Python end-to-end test relies on bytes (0x85 0x40) that Python's
  // shift_jis_2004 codec accepts but Python's cp932 codec rejects, asserting
  // the pipeline does not promote shift_jis_2004 → cp932. The TS port maps
  // both shift_jis_2004 and cp932 to the same WHATWG `shift_jis` decoder
  // (encoding-whatwg-map.ts), so no byte sequence is "valid in shift_jis_2004
  // but invalid in cp932": the helper's superset-decode check has the same
  // outcome for both. See "bytes.decode() validity filtering" in
  // docs/architecture.md. We unit-test the bail-on-decode-failure branch
  // directly instead, with bytes invalid for the shared decoder.
  test('helper bails when superset decode fails', () => {
    // 0x85 alone (no trail byte) is invalid for the shift_jis decoder, so
    // decoderForLabel('shift_jis').decode rejects it. The helper should return
    // the markup result unchanged.
    const markupResult: DetectionResult = {
      encoding: 'shift_jis_2004',
      confidence: 0.95,
      language: null,
      mimeType: 'text/xml',
    };
    const allowed = new Set(['shift_jis_2004', 'cp932']);
    const data = new Uint8Array([0x85]);
    expect(promoteMarkupSuperset(data, markupResult, allowed)).toBe(markupResult);
  });

  // Divergence from Python's decode-safety promotion
  // (test_promote_when_reported_codec_cannot_decode): Python promotes
  // declared-Shift_JIS data carrying a CP932 NEC extension (0x87 0x40, the
  // circled digit one) to cp932, because the codec the reported name
  // resolves to — plain shift_jis — cannot decode it. WHATWG's shift_jis
  // decoder accepts CP932 extensions, so that condition can never hold here
  // and the branch is not ported; structural scores tie and no promotion
  // happens. See _MARKUP_SUPERSET_PROMOTIONS in src/pipeline/markup.ts
  // and "Markup superset decode-safety promotion" in docs/port-notes.md.
  test('NEC-extension bytes do not promote (WHATWG divergence)', () => {
    // "こんにちは".encode("shift_jis") + b"\x87\x40", captured via:
    //   python3 -c 'import sys; sys.stdout.buffer.write("こんにちは".encode("shift_jis"))'
    const data = new Uint8Array([
      0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd, 0x87, 0x40,
    ]);
    const markupResult: DetectionResult = {
      encoding: 'shift_jis_2004',
      confidence: 0.95,
      language: null,
      mimeType: 'text/xml',
    };
    const allowed = new Set(['shift_jis_2004', 'cp932']);
    const promoted = promoteMarkupSuperset(data, markupResult, allowed);
    expect(promoted.encoding).toBe('shift_jis_2004'); // Python yields 'cp932'
  });
});

// ---------------------------------------------------------------------------
// EBCDIC declarations and the structural-score promotion (chardet #386).
// ---------------------------------------------------------------------------

import { vi } from 'vitest';
import * as markupMod from '../src/pipeline/markup.js';

// "<meta charset=cp500><p>hello there dear reader of mainframe pages</p>".encode("cp500")
const CP500_META = new Uint8Array([0x4c,0x94,0x85,0xa3,0x81,0x40,0x83,0x88,0x81,0x99,0xa2,0x85,0xa3,0x7e,0x83,0x97,0xf5,0xf0,0xf0,0x6e,0x4c,0x97,0x6e,0x88,0x85,0x93,0x93,0x96,0x40,0xa3,0x88,0x85,0x99,0x85,0x40,0x84,0x85,0x81,0x99,0x40,0x99,0x85,0x81,0x84,0x85,0x99,0x40,0x96,0x86,0x40,0x94,0x81,0x89,0x95,0x86,0x99,0x81,0x94,0x85,0x40,0x97,0x81,0x87,0x85,0xa2,0x4c,0x61,0x97,0x6e]);
// same, but charset=utf-8
const CP500_META_UTF8 = new Uint8Array([0x4c,0x94,0x85,0xa3,0x81,0x40,0x83,0x88,0x81,0x99,0xa2,0x85,0xa3,0x7e,0xa4,0xa3,0x86,0x60,0xf8,0x6e,0x4c,0x97,0x6e,0x88,0x85,0x93,0x93,0x96,0x40,0xa3,0x88,0x85,0x99,0x85,0x40,0x84,0x85,0x81,0x99,0x40,0x99,0x85,0x81,0x84,0x85,0x99,0x40,0x96,0x86,0x40,0x94,0x81,0x89,0x95,0x86,0x99,0x81,0x94,0x85,0x40,0x97,0x81,0x87,0x85,0xa2,0x4c,0x61,0x97,0x6e]);
// "こんにちは、世界。".encode("shift_jis")
const SHIFT_JIS_HELLO = new Uint8Array([0x82,0xb1,0x82,0xf1,0x82,0xc9,0x82,0xbf,0x82,0xcd,0x81,0x41,0x90,0xa2,0x8a,0x45,0x81,0x42]);

test('an EBCDIC meta charset declaration is honoured', () => {
  const result = detectMarkupCharset(CP500_META);
  expect(result).not.toBeNull();
  expect(result!.encoding).toBe('cp500');
  expect(result!.mimeType).toBe('text/html');
});

test('an EBCDIC declaration naming a non-mainframe encoding is ignored', () => {
  const result = detectMarkupCharset(CP500_META_UTF8);
  expect(result === null || result.encoding !== 'utf-8').toBe(true);
});

test('the superset wins when its structural score beats the declared base', () => {
  const result: DetectionResult = {
    encoding: 'shift_jis_2004', confidence: 0.95, language: null, mimeType: 'text/html',
  };
  const allowed = new Set(['cp932', 'shift_jis_2004']);
  const spy = vi
    .spyOn(markupMod._internal, 'computeStructuralScore')
    .mockImplementation((_data, info) => (info.name === 'cp932' ? 2.0 : 1.0));
  const promoted = promoteMarkupSuperset(SHIFT_JIS_HELLO, result, allowed);
  spy.mockRestore();
  expect(promoted.encoding).toBe('cp932');
  expect(promoted.confidence).toBe(0.95);
  expect(promoted.mimeType).toBe('text/html');
});
