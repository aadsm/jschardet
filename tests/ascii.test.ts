import { detectAscii } from '../src/pipeline/ascii.js';

describe('detectAscii', () => {
  test('pure ASCII', () => {
    expect(detectAscii(new TextEncoder().encode('Hello, world! 123'))).toEqual(
      { encoding: 'ascii', confidence: 1.0, language: null, mimeType: null }
    );
  });

  test('ASCII with common whitespace', () => {
    expect(detectAscii(new TextEncoder().encode('Hello\n\tworld\r\n'))).toEqual(
      { encoding: 'ascii', confidence: 1.0, language: null, mimeType: null }
    );
  });

  test('high byte not ASCII', () => {
    expect(detectAscii(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x80, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64]))).toBeNull();
  });

  test('UTF-8 multibyte not ASCII', () => {
    expect(detectAscii(new TextEncoder().encode('Héllo'))).toBeNull();
  });

  test('empty input', () => {
    expect(detectAscii(new Uint8Array([]))).toBeNull();
  });

  test('single ASCII byte', () => {
    expect(detectAscii(new Uint8Array([0x41]))).toEqual(
      { encoding: 'ascii', confidence: 1.0, language: null, mimeType: null }
    );
  });

  test('all printable ASCII', () => {
    const data = new Uint8Array(0x7F - 0x20);
    for (let i = 0; i < data.length; i++) data[i] = i + 0x20;
    expect(detectAscii(data)).toEqual(
      { encoding: 'ascii', confidence: 1.0, language: null, mimeType: null }
    );
  });

  test('null byte not ASCII (above threshold)', () => {
    // 2 nulls in 10 bytes = 20% → above threshold
    expect(detectAscii(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x00, 0x72, 0x6c, 0x64]))).toBeNull();
  });

  test('ASCII with sparse null separators', () => {
    const str = 'master:README.md\x002\x00For support slack to #kodiak-support\nmaster:support.txt\x001\x00For support slack to #kodiak-support\n';
    const data = new TextEncoder().encode(str);
    const result = detectAscii(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('ascii');
    expect(result!.confidence).toBe(0.99);
  });

  test('ASCII with null-separated paths', () => {
    const str = '/home/user/documents/report.txt\x00/home/user/documents/notes.txt\x00/home/user/downloads/image.png\x00/home/user/music/song.mp3\x00';
    const data = new TextEncoder().encode(str);
    const result = detectAscii(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('ascii');
    expect(result!.confidence).toBe(0.99);
  });

  test('null at boundary (exactly 5%)', () => {
    // 1 null in 20 bytes = 5%
    const data = new TextEncoder().encode('abcdefghij\x00klmnopqrs');
    const result = detectAscii(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('ascii');
    expect(result!.confidence).toBe(0.99);
  });

  test('null just above boundary (5.26%)', () => {
    const data = new TextEncoder().encode('abcdefghij\x00klmnopqr');
    expect(detectAscii(data)).toBeNull();
  });

  test('high null fraction not ASCII', () => {
    // 5 nulls in 15 bytes = 33%
    const data = new TextEncoder().encode('ab\x00cd\x00ef\x00gh\x00ij\x00');
    expect(detectAscii(data)).toBeNull();
  });

  test('nulls with high bytes not ASCII', () => {
    const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x80, 0x57, 0x6f, 0x72, 0x6c, 0x64]);
    expect(detectAscii(data)).toBeNull();
  });

  test('pure ASCII without nulls still confidence 1.0', () => {
    expect(detectAscii(new TextEncoder().encode('Hello, world!'))).toEqual(
      { encoding: 'ascii', confidence: 1.0, language: null, mimeType: null }
    );
  });
});
