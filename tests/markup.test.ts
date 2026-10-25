import { detectMarkupCharset, promoteMarkupSuperset } from '../src/pipeline/markup.js';
import { DetectionResult } from '../src/pipeline/index.js';
import { detect } from '../src/chardet.js';

const DETERMINISTIC_CONFIDENCE = 0.95;

function enc(s: string): Uint8Array { return new TextEncoder().encode(s); }

function bytes(s: string): Uint8Array {
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

function repeat(a: Uint8Array, n: number): Uint8Array {
  return concat(...Array<Uint8Array>(n).fill(a));
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

// A declared single-byte charset is honoured only if Python's strict codec
// decodes the window (chardet's _validate_bytes). WHATWG's windows-1252 decoder
// accepts 0x81 and TextDecoder('ascii') is an alias of windows-1252, so both
// would honour these declarations; Python rejects them and falls through to
// statistics.
describe('declared single-byte charsets are judged by the Python codec', () => {
  test('a declared windows-1252 page is honoured when it decodes', () => {
    const data = concat(enc('<meta charset="windows-1252"><p>caf'), new Uint8Array([0xe9]), enc('</p>'));
    expect(detectMarkupCharset(data)?.encoding).toBe('cp1252');
  });

  test('a declared windows-1252 page with an undefined byte is not', () => {
    const data = concat(enc('<meta charset="windows-1252"><p>caf'), new Uint8Array([0x81]), enc('</p>'));
    expect(detectMarkupCharset(data)).toBeNull();
  });

  test('a declared ascii page with a high byte is not', () => {
    const data = concat(enc('<meta charset="us-ascii"><p>caf'), new Uint8Array([0xe9]), enc('</p>'));
    expect(detectMarkupCharset(data)).toBeNull();
  });
});

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

// ---------------------------------------------------------------------------
// chardet 7.7.0: meta attribute parsing, whole-window validation, and the
// WHATWG-prescan reading of declarations.
// ---------------------------------------------------------------------------

// '한국어 텍스트입니다.'.encode("euc-kr")
const KR_TEXT = new Uint8Array([0xc7,0xd1,0xb1,0xb9,0xbe,0xee,0x20,0xc5,0xd8,0xbd,0xba,0xc6,0xae,0xc0,0xd4,0xb4,0xcf,0xb4,0xd9,0x2e]);
// '똠'.encode("cp949")
const KR_CP949_ONLY = new Uint8Array([0x8c,0x63]);
// 'café résumé '.encode("cp1252")
const CAFE_RESUME_CP1252 = new Uint8Array([0x63,0x61,0x66,0xe9,0x20,0x72,0xe9,0x73,0x75,0x6d,0xe9,0x20]);
// '日本語のテキストです。'.encode("shift_jis")
const JA_TEXT_SJIS = new Uint8Array([0x93,0xfa,0x96,0x7b,0x8c,0xea,0x82,0xcc,0x83,0x65,0x83,0x4c,0x83,0x58,0x83,0x67,0x82,0xc5,0x82,0xb7,0x81,0x42]);
// 'Voilà, un résumé très détaillé à lire. '.encode("latin-1")
const VOILA_LIRE_LATIN1 = new Uint8Array([0x56,0x6f,0x69,0x6c,0xe0,0x2c,0x20,0x75,0x6e,0x20,0x72,0xe9,0x73,0x75,0x6d,0xe9,0x20,0x74,0x72,0xe8,0x73,0x20,0x64,0xe9,0x74,0x61,0x69,0x6c,0x6c,0xe9,0x20,0xe0,0x20,0x6c,0x69,0x72,0x65,0x2e,0x20]);
// 'Voilà, un résumé très détaillé. '.encode("latin-1") * 10
const LATIN1_TEXT = repeat(new Uint8Array([0x56,0x6f,0x69,0x6c,0xe0,0x2c,0x20,0x75,0x6e,0x20,0x72,0xe9,0x73,0x75,0x6d,0xe9,0x20,0x74,0x72,0xe8,0x73,0x20,0x64,0xe9,0x74,0x61,0x69,0x6c,0x6c,0xe9,0x2e,0x20]), 10);
// '“café”'.encode("cp1252")
const QUOTED_CAFE_CP1252 = new Uint8Array([0x93,0x63,0x61,0x66,0xe9,0x94]);
// 'привет'.encode("cp1251")
const PRIVET_CP1251 = new Uint8Array([0xef,0xf0,0xe8,0xe2,0xe5,0xf2]);
// '<meta charset=cp424>'.encode("cp037")
const META_CP424_CP037 = new Uint8Array([0x4c,0x94,0x85,0xa3,0x81,0x40,0x83,0x88,0x81,0x99,0xa2,0x85,0xa3,0x7e,0x83,0x97,0xf4,0xf2,0xf4,0x6e]);
// 'hello mainframe '.encode("cp037")
const HELLO_MAINFRAME_CP037 = new Uint8Array([0x88,0x85,0x93,0x93,0x96,0x40,0x94,0x81,0x89,0x95,0x86,0x99,0x81,0x94,0x85,0x40]);
// '<?xml version="1.0" encoding="cp500"?><doc>hello there dear reader of mainframe pages</doc>'.encode("cp500")
const XML_CP500 = new Uint8Array([0x4c,0x6f,0xa7,0x94,0x93,0x40,0xa5,0x85,0x99,0xa2,0x89,0x96,0x95,0x7e,0x7f,0xf1,0x4b,0xf0,0x7f,0x40,0x85,0x95,0x83,0x96,0x84,0x89,0x95,0x87,0x7e,0x7f,0x83,0x97,0xf5,0xf0,0xf0,0x7f,0x6f,0x6e,0x4c,0x84,0x96,0x83,0x6e,0x88,0x85,0x93,0x93,0x96,0x40,0xa3,0x88,0x85,0x99,0x85,0x40,0x84,0x85,0x81,0x99,0x40,0x99,0x85,0x81,0x84,0x85,0x99,0x40,0x96,0x86,0x40,0x94,0x81,0x89,0x95,0x86,0x99,0x81,0x94,0x85,0x40,0x97,0x81,0x87,0x85,0xa2,0x4c,0x61,0x84,0x96,0x83,0x6e]);

// A declared EUC-KR page whose first CP949-only hangul sits past the head.
const EUC_KR_PAGE_WITH_CP949 = concat(enc('<meta charset="euc-kr">'), repeat(KR_TEXT, 400), KR_CP949_ONLY, repeat(KR_TEXT, 10));

describe('meta attribute parsing', () => {
  test('charset= inside another attribute does not hide the meta charset', () => {
    // A refresh URL or a description can contain the letters charset=.
    // That is not the page encoding. The meta charset attribute is.
    let data = enc('<meta http-equiv="refresh" content="0;url=http://example.com/?charset=iso-8859-1"><meta charset="utf-8">');
    expect(detectMarkupCharset(data)?.encoding).toBe('utf-8');
    data = enc('<meta name="description" content="see charset=iso-8859-1 for notes"><meta charset="utf-8">');
    expect(detectMarkupCharset(data)?.encoding).toBe('utf-8');
  });

  test("name='content-type' is accepted", () => {
    // Wrong by the spec but common in the wild.
    const data = enc("<html><head><meta name='content-type' content='text/html;charset=iso-8859-6'></head></html>");
    expect(detectMarkupCharset(data)?.encoding).toBe('iso8859-6');
  });

  test('first value wins when an attribute repeats', () => {
    expect(detectMarkupCharset(enc('<meta charset="iso-8859-5" charset="utf-8">'))?.encoding).toBe('iso8859-5');
  });

  test('unquoted charset value', () => {
    expect(detectMarkupCharset(enc('<meta charset=koi8-r>'))?.encoding).toBe('koi8-r');
  });

  test('an unclosed meta tag is not a declaration', () => {
    expect(detectMarkupCharset(enc('<meta charset="utf-8"'))).toBeNull();
  });

  test('a bad declaration does not hide a later one', () => {
    expect(detectMarkupCharset(enc('<meta charset="no-such-encoding"><meta charset="utf-8">'))?.encoding).toBe('utf-8');
  });

  test('a non-ASCII XML encoding name is ignored', () => {
    expect(detectMarkupCharset(bytes('<?xml version="1.0" encoding="\xff\xfe"?><root/>'))).toBeNull();
  });

  test.each([
    'charset="windows-1252"',
    "charset='windows-1252'",
    'charset = windows-1252',
    'CHARSET\t=\t"windows-1252"',
  ])('quoted or spaced content charset: %s', parameter => {
    const outerQuote = parameter.includes("'") ? '"' : "'";
    const data = concat(
      enc(`<meta http-equiv="Content-Type" content=${outerQuote}text/html; ${parameter}${outerQuote}>caf`),
      new Uint8Array([0xe9]),
    );
    const result = detectMarkupCharset(data);
    expect(result?.encoding).toBe('cp1252');
    expect(result?.mimeType).toBe('text/html');
    expect(detect(data).encoding).toBe('Windows-1252');
    expect(detect(data).mimeType).toBe('text/html');
  });

  test.each(['charset="windows-1252', 'charset=""'])('invalid quoted content charset: %s', parameter => {
    const data = enc(`<meta http-equiv='Content-Type' content='text/html; ${parameter}'>`);
    expect(detectMarkupCharset(data)).toBeNull();
  });
});

const IS_NODE = typeof process !== 'undefined' && process.versions?.node != null;

describe('declarations are validated against the whole window', () => {
  // Node's euc-jp decoder maps the stray byte 0x80 to U+0080 where Python's
  // codec and the WHATWG spec reject it, so on Node the EUC-JP declaration
  // in the next two tests still decodes and stands. The same ICU leniency as
  // big5's 0xFF ("Truncation-tolerant validity decoding" in
  // docs/port-notes.md); browsers reject the byte and pass. When a Node
  // release fixes it these flip to "expected to fail, but passed".
  const nodeEucJpLenient = IS_NODE ? test.fails : test;

  nodeEucJpLenient('a charset declaration is dropped when the window fails to decode', () => {
    // The stage returns nothing and the other stages answer as if there were
    // no declaration.
    const data = concat(enc('<meta charset="euc-jp">'), enc('x'.repeat(5000)), new Uint8Array([0x80, 0x80, 0x80]));
    expect(detectMarkupCharset(data)).toBeNull();
    const result = detect(data);
    expect(result.encoding).not.toBe('EUC-JP');
    expect(result.mimeType).not.toBe('text/html');
  });

  nodeEucJpLenient('a PEP 263 coding line is dropped when the window fails to decode', () => {
    const data = concat(enc('# coding: euc-jp\n# ' + 'x'.repeat(5000) + '\n'), new Uint8Array([0x80, 0x80, 0x80]));
    expect(detect(data).encoding).not.toBe('EUC-JP');
  });

  test('an EBCDIC declaration is dropped when it cannot decode the window', () => {
    // cp424 leaves byte 0x70 undefined. The declaration and the high-byte
    // head decode cleanly, but a 0x70 byte past the head does not.
    const data = concat(META_CP424_CP037, repeat(HELLO_MAINFRAME_CP037, 400), new Uint8Array([0x70]));
    expect(detect(data).encoding).not.toBe('cp424');
  });

  // Divergence from chardet's
  // test_declared_subset_promotes_when_superset_bytes_sit_past_the_head and
  // test_declared_subset_promotes_from_the_stage: chardet's euc_kr codec
  // rejects the CP949-only hangul past the head, so the declaration falls
  // back to its Windows superset and the answer is CP949. WHATWG's euc-kr
  // decoder is CP949, so the declaration decodes as given and stands. See
  // "Markup superset decode-safety promotion" in docs/port-notes.md.
  test('a declared EUC-KR page with CP949-only hangul past the head stays EUC-KR (WHATWG divergence)', () => {
    const stage = detectMarkupCharset(EUC_KR_PAGE_WITH_CP949);
    expect(stage?.encoding).toBe('euc_kr'); // chardet: cp949
    expect(stage?.mimeType).toBe('text/html');
    const result = detect(EUC_KR_PAGE_WITH_CP949);
    expect(result.encoding).toBe('EUC-KR'); // chardet: CP949
    expect(result.confidence).toBe(0.95);
    expect(result.mimeType).toBe('text/html');
  });

  test('a stale prolog does not hide a correct meta', () => {
    // The first declaration decodes the head but not the window; the second
    // is right.
    const data = concat(
      enc('<?xml version="1.0" encoding="utf-8"?><html><head>'),
      enc('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">'),
      enc('</head><body>' + 'x'.repeat(4200)),
      repeat(VOILA_LIRE_LATIN1, 40),
    );
    const result = detect(data);
    expect(result.encoding).toBe('ISO-8859-1');
    expect(result.confidence).toBe(0.95);
    expect(result.mimeType).toBe('text/html');
  });

  test('no promotion when the better-scoring superset cannot decode', () => {
    const data = concat(SHIFT_JIS_HELLO, new Uint8Array([0x81, 0x20])); // lead, bad trail
    const result: DetectionResult = { encoding: 'shift_jis_2004', confidence: 0.95, language: null, mimeType: 'text/html' };
    const allowed = new Set(['cp932', 'shift_jis_2004']);
    const spy = vi
      .spyOn(markupMod._internal, 'computeStructuralScore')
      .mockImplementation((_data, info) => (info.name === 'cp932' ? 2.0 : 1.0));
    try {
      expect(promoteMarkupSuperset(data, result, allowed)).toBe(result);
    } finally {
      spy.mockRestore();
    }
  });

  // Declared pages pay at most one window decode, two when a superset is in
  // play. The euc-kr case answers EUC-KR rather than chardet's CP949 — see
  // the divergence test above.
  test.each([
    ['single-byte', concat(enc('<meta charset="windows-1252">'), repeat(CAFE_RESUME_CP1252, 2000)), 'Windows-1252', 1],
    ['shift_jis-clean', concat(enc('<meta charset="shift_jis">'), repeat(JA_TEXT_SJIS, 1000)), 'SHIFT_JIS', 2],
    ['euc-kr-promoted', concat(enc('<meta charset="euc-kr">'), repeat(KR_TEXT, 1000), KR_CP949_ONLY), 'EUC-KR', 2],
  ] as const)('declared page window decode budget: %s', (_id, data, expected, budget) => {
    const real = markupMod._internal.decodesWithoutError;
    const windowDecodes: string[] = [];
    const spy = vi
      .spyOn(markupMod._internal, 'decodesWithoutError')
      .mockImplementation((encoding, buf) => {
        if (buf.length > markupMod._SCAN_LIMIT) windowDecodes.push(encoding);
        return real(encoding, buf);
      });
    try {
      expect(detect(data).encoding).toBe(expected);
    } finally {
      spy.mockRestore();
    }
    expect(windowDecodes.length).toBeLessThanOrEqual(budget);
  });
});

describe('PEP 263 cookies', () => {
  describe.each([['\\n', '\n'], ['\\r\\n', '\r\n']])('newline %s', (_label, newline) => {
    test.each(['print("hello")', 'print("hello") # a trailing comment', '"a docstring"'])(
      'a second-line cookie after code is not a declaration: %s', firstLine => {
        const data = enc(firstLine + newline + '# coding: cp1251' + newline);
        expect(detectMarkupCharset(data)).toBeNull();
        expect(detect(data).encoding).toBe('ascii');
      });

    test.each(['# ordinary comment', '#!/usr/bin/python', '', ' \t\f'])(
      'a second-line cookie after a comment or blank is a declaration: %j', firstLine => {
        const data = enc(firstLine + newline + '# coding: cp1251' + newline);
        expect(detectMarkupCharset(data)?.encoding).toBe('cp1251');
      });
  });

  test('an ignored cookie does not override the actual UTF-8 source encoding', () => {
    expect(detect(enc('print("привет")\n# coding: cp1251\n')).encoding).toBe('utf-8');
  });

  test.each([
    ['iso-latin-1', 'iso8859-1'],
    ['ISO_LATIN_1', 'iso8859-1'],
    ['latin-1-unix', 'iso8859-1'],
    ['utf-8-sig', 'utf-8'],
    ['utf_8', 'utf-8'],
    ['cp1251', 'cp1251'],
  ])('names resolve like tokenize: %s', (name, expected) => {
    // iso-latin-1 is a valid cookie that no codec answers to, and a
    // utf-8-sig cookie names plain UTF-8 rather than a file that starts with
    // a mark.
    const result = detectMarkupCharset(enc(`# -*- coding: ${name} -*-\nx = 1\n`));
    expect(result?.encoding).toBe(expected);
    expect(result?.mimeType).toBe('text/x-python');
  });

  test.each([' '.repeat(300), '# ' + 'x'.repeat(300)])('a long first line does not hide the cookie on line 2', firstLine => {
    const data = concat(enc(firstLine + '\n# coding: cp1251\n'), PRIVET_CP1251);
    expect(detectMarkupCharset(data)?.encoding).toBe('cp1251');
  });

  test('a cookie past the scan limit is ignored', () => {
    const data = concat(enc('# ' + 'x'.repeat(5000) + '\n# coding: cp1251\n'), PRIVET_CP1251);
    expect(detectMarkupCharset(data)).toBeNull();
  });
});

describe('declarations read the way the WHATWG prescan reads them', () => {
  test.each([
    ['<meta ', '<meta charset="iso-8859-1">'],
    ['<?xml ', '<?xml version="1.0" encoding="iso-8859-1"?>'],
  ])('a head of unclosed %s tags still finds the declaration', (junk, declaration) => {
    // A tag scan stops at the next <, so unclosed tags hide only themselves.
    const data = concat(enc(junk.repeat(600) + declaration), LATIN1_TEXT);
    expect(detectMarkupCharset(data)?.encoding).toBe('iso8859-1');
  });

  test('an unclosed meta does not swallow the next one', () => {
    const data = concat(
      enc('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-5" <meta charset="iso-8859-1">'),
      LATIN1_TEXT,
    );
    expect(detectMarkupCharset(data)?.encoding).toBe('iso8859-1');
  });

  test.each(['utf-16', 'utf-16le', 'UTF-16BE', 'utf-32', 'utf-32le'])(
    'a %s label in ASCII markup reads as UTF-8', label => {
      // UTF-16 text would have null bytes between the letters of the tag, so
      // the WHATWG prescan reads the label as UTF-8. Any even run of ASCII is
      // valid UTF-16, so honouring the label would be confident and wrong.
      const body = enc('café'.repeat(10));
      const page = concat(enc(`<html><head><meta charset="${label}"></head><body>`), body);
      let result = detectMarkupCharset(page);
      expect(result?.encoding).toBe('utf-8');
      expect(result?.mimeType).toBe('text/html');
      expect(detect(page).encoding).toBe('utf-8');

      const xml = concat(enc(`<?xml version="1.0" encoding="${label}"?><a>`), body, enc('</a>'));
      result = detectMarkupCharset(xml);
      expect(result?.encoding).toBe('utf-8');
      expect(result?.mimeType).toBe('text/xml');
      expect(detect(xml).encoding).toBe('utf-8');
    });

  test('a UTF-16 label on non-UTF-8 bytes is dropped', () => {
    const page = concat(enc('<meta charset="utf-16">'), LATIN1_TEXT);
    expect(detectMarkupCharset(page)).toBeNull();
    expect(detect(page).encoding!.toLowerCase().startsWith('utf-16')).toBe(false);
  });

  test('x-user-defined reads as windows-1252', () => {
    const page = concat(enc('<meta charset="x-user-defined">'), repeat(QUOTED_CAFE_CP1252, 10));
    expect(detectMarkupCharset(page)?.encoding).toBe('cp1252');
    expect(detect(page).encoding).toBe('Windows-1252');
  });

  test('a declaration inside a comment is not a declaration', () => {
    const live = concat(enc('<meta charset="iso-8859-1">'), LATIN1_TEXT);
    for (const commented of [
      '<!-- <meta charset="iso-8859-5"> -->',
      '<!-- <?xml version="1.0" encoding="iso-8859-5"?> -->',
      "<!-- \n<meta\ncharset='iso-8859-5'>\n-->",
    ]) {
      const data = concat(enc(commented), live);
      expect(detectMarkupCharset(data)?.encoding).toBe('iso8859-1');
      expect(detect(data).encoding).toBe('ISO-8859-1');
    }
    expect(detectMarkupCharset(concat(enc('<!-- <meta charset="iso-8859-5"> -->'), LATIN1_TEXT))).toBeNull();
  });

  test('an unclosed comment hides the rest of the head', () => {
    expect(detectMarkupCharset(concat(enc('<!-- <meta charset="iso-8859-1">'), LATIN1_TEXT))).toBeNull();
  });

  test.each(['<!-->', '<!--->'])('a comment may close on its own dashes: %s', opener => {
    const data = concat(enc(opener + '<meta charset="iso-8859-1">'), LATIN1_TEXT);
    expect(detectMarkupCharset(data)?.encoding).toBe('iso8859-1');
  });
});

describe('EBCDIC declarations', () => {
  test('an EBCDIC XML declaration reports XML', () => {
    const result = detectMarkupCharset(XML_CP500);
    expect(result?.encoding).toBe('cp500');
    expect(result?.mimeType).toBe('text/xml');
  });

  test('the declaration regex is linear in whitespace', () => {
    // A charset= whose value never arrives (a long run of spaces instead)
    // must not make the engine try every way to split the spaces. The budget
    // is far above the linear cost and still catches a relapse.
    const probe = 'charset=' + ' '.repeat(16384);
    const start = performance.now();
    expect(probe.search(markupMod._EBCDIC_DECL_RE)).toBe(-1);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
