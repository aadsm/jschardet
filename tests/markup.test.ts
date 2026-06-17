import { detectMarkupCharset } from '../src/pipeline/markup.js';

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
    const data = concat(enc('<meta charset="shift_jis">'), enc('日本語テスト'));
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
