import { detectUtf8 } from '../src/pipeline/utf8.js';

describe('detectUtf8', () => {
  test('valid UTF-8 with multibyte', () => {
    const result = detectUtf8(new TextEncoder().encode('Héllo wörld café'));
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-8');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  test('valid UTF-8 Chinese', () => {
    const result = detectUtf8(new TextEncoder().encode('你好世界'));
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-8');
  });

  test('valid UTF-8 emoji', () => {
    const result = detectUtf8(new TextEncoder().encode('Hello 🌍🌎🌏'));
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-8');
  });

  test('pure ASCII returns null', () => {
    expect(detectUtf8(new TextEncoder().encode('Hello world'))).toBeNull();
  });

  test('invalid UTF-8 (bad continuation)', () => {
    expect(detectUtf8(new Uint8Array([0xc3, 0x00]))).toBeNull();
  });

  test('overlong encoding (0xC0 0xAF)', () => {
    expect(detectUtf8(new Uint8Array([0xc0, 0xaf]))).toBeNull();
  });

  test('invalid start byte', () => {
    expect(detectUtf8(new Uint8Array([0xff, 0xfe]))).toBeNull();
  });

  test('truncated multibyte sequence', () => {
    const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0xc3]);
    expect(detectUtf8(data)).toBeNull();
  });

  test('empty input', () => {
    expect(detectUtf8(new Uint8Array([]))).toBeNull();
  });

  test('Latin-1 is not valid UTF-8', () => {
    // 'Héllo' in Latin-1 = 48 e9 6c 6c 6f — 0xe9 is invalid UTF-8 start byte alone
    expect(detectUtf8(new Uint8Array([0x48, 0xe9, 0x6c, 0x6c, 0x6f]))).toBeNull();
  });

  test('surrogate pair rejected (ED A0 80)', () => {
    const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0xed, 0xa0, 0x80, 0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64]);
    expect(detectUtf8(data)).toBeNull();
  });

  test('overlong 3-byte rejected (E0 80 80)', () => {
    const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0xe0, 0x80, 0x80, 0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64]);
    expect(detectUtf8(data)).toBeNull();
  });

  test('overlong 4-byte rejected (F0 80 80 80)', () => {
    const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0xf0, 0x80, 0x80, 0x80, 0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64]);
    expect(detectUtf8(data)).toBeNull();
  });

  test('above U+10FFFF rejected (F4 90 80 80)', () => {
    const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0xf4, 0x90, 0x80, 0x80, 0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64]);
    expect(detectUtf8(data)).toBeNull();
  });
});
