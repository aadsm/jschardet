import { detectUtf1632Patterns, _looksLikeText, _textQuality } from '../src/pipeline/utf1632.js';

const DETERMINISTIC_CONFIDENCE = 0.95;

function encodeUtf16LE(text: string): Uint8Array {
  const codes = [...text].flatMap(c => {
    const cp = c.codePointAt(0)!;
    if (cp <= 0xFFFF) return [cp & 0xff, (cp >> 8) & 0xff];
    const hi = 0xD800 + ((cp - 0x10000) >> 10);
    const lo = 0xDC00 + ((cp - 0x10000) & 0x3FF);
    return [hi & 0xff, (hi >> 8) & 0xff, lo & 0xff, (lo >> 8) & 0xff];
  });
  return new Uint8Array(codes);
}

function encodeUtf16BE(text: string): Uint8Array {
  const codes = [...text].flatMap(c => {
    const cp = c.codePointAt(0)!;
    if (cp <= 0xFFFF) return [(cp >> 8) & 0xff, cp & 0xff];
    const hi = 0xD800 + ((cp - 0x10000) >> 10);
    const lo = 0xDC00 + ((cp - 0x10000) & 0x3FF);
    return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
  });
  return new Uint8Array(codes);
}

function encodeUtf32LE(text: string): Uint8Array {
  const cps = [...text].map(c => c.codePointAt(0)!);
  const buf = new Uint8Array(cps.length * 4);
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    buf[i * 4]     = cp & 0xff;
    buf[i * 4 + 1] = (cp >> 8) & 0xff;
    buf[i * 4 + 2] = (cp >> 16) & 0xff;
    buf[i * 4 + 3] = 0;
  }
  return buf;
}

function encodeUtf32BE(text: string): Uint8Array {
  const cps = [...text].map(c => c.codePointAt(0)!);
  const buf = new Uint8Array(cps.length * 4);
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    buf[i * 4]     = 0;
    buf[i * 4 + 1] = (cp >> 16) & 0xff;
    buf[i * 4 + 2] = (cp >> 8) & 0xff;
    buf[i * 4 + 3] = cp & 0xff;
  }
  return buf;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

describe('detectUtf1632Patterns — UTF-16-LE', () => {
  test('ASCII text as UTF-16-LE', () => {
    const data = encodeUtf16LE('Hello, this is a test of UTF-16 LE detection.');
    const result = detectUtf1632Patterns(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-16-le');
    expect(result!.confidence).toBe(DETERMINISTIC_CONFIDENCE);
    expect(result!.language).toBeNull();
  });

  test('longer ASCII text as UTF-16-LE', () => {
    const data = encodeUtf16LE('The quick brown fox jumps over the lazy dog. '.repeat(5));
    const result = detectUtf1632Patterns(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-16-le');
  });
});

describe('detectUtf1632Patterns — UTF-16-BE', () => {
  test('ASCII text as UTF-16-BE', () => {
    const data = encodeUtf16BE('Hello, this is a test of UTF-16 BE detection.');
    const result = detectUtf1632Patterns(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-16-be');
    expect(result!.confidence).toBe(DETERMINISTIC_CONFIDENCE);
    expect(result!.language).toBeNull();
  });

  test('longer ASCII text as UTF-16-BE', () => {
    const data = encodeUtf16BE('The quick brown fox jumps over the lazy dog. '.repeat(5));
    const result = detectUtf1632Patterns(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-16-be');
  });
});

describe('detectUtf1632Patterns — UTF-32-LE', () => {
  test('ASCII text as UTF-32-LE', () => {
    const data = encodeUtf32LE('Hello, this is a test of UTF-32 LE detection.');
    const result = detectUtf1632Patterns(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-32-le');
    expect(result!.confidence).toBe(DETERMINISTIC_CONFIDENCE);
    expect(result!.language).toBeNull();
  });

  test('longer ASCII text as UTF-32-LE', () => {
    const data = encodeUtf32LE('The quick brown fox jumps over the lazy dog. '.repeat(5));
    const result = detectUtf1632Patterns(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-32-le');
  });
});

describe('detectUtf1632Patterns — UTF-32-BE', () => {
  test('ASCII text as UTF-32-BE', () => {
    const data = encodeUtf32BE('Hello, this is a test of UTF-32 BE detection.');
    const result = detectUtf1632Patterns(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-32-be');
    expect(result!.confidence).toBe(DETERMINISTIC_CONFIDENCE);
    expect(result!.language).toBeNull();
  });

  test('longer ASCII text as UTF-32-BE', () => {
    const data = encodeUtf32BE('The quick brown fox jumps over the lazy dog. '.repeat(5));
    const result = detectUtf1632Patterns(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-32-be');
  });
});

describe('detectUtf1632Patterns — UTF-32 checked before UTF-16', () => {
  test('UTF-32-LE wins over UTF-16 for same data', () => {
    const data = encodeUtf32LE('Hello world test');
    const result = detectUtf1632Patterns(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-32-le');
  });
});

describe('detectUtf1632Patterns — minimum sizes', () => {
  test('too short for UTF-16 (8 bytes) returns null', () => {
    const data = encodeUtf16LE('Test'); // 8 bytes
    expect(data.length).toBe(8);
    expect(detectUtf1632Patterns(data)).toBeNull();
  });

  test('UTF-32 shorter than 16 bytes falls through (not detected as UTF-32)', () => {
    const data = encodeUtf32LE('Tes'); // 12 bytes
    expect(data.length).toBe(12);
    const result = detectUtf1632Patterns(data);
    if (result !== null) expect(result.encoding).not.toBe('utf-32-le');
  });

  test('exactly 10 bytes (min UTF-16) can be detected', () => {
    const data = encodeUtf16LE('Hello'); // 10 bytes
    expect(data.length).toBe(10);
    const result = detectUtf1632Patterns(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-16-le');
  });

  test('exactly 16 bytes (min UTF-32) can be detected', () => {
    const data = encodeUtf32LE('Test'); // 16 bytes
    expect(data.length).toBe(16);
    const result = detectUtf1632Patterns(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-32-le');
  });
});

describe('detectUtf1632Patterns — non-UTF-16/32 data', () => {
  test('plain ASCII returns null', () => {
    expect(detectUtf1632Patterns(new TextEncoder().encode('Hello, this is plain ASCII text with no special encoding.'))).toBeNull();
  });

  test('Latin-1 text returns null', () => {
    expect(detectUtf1632Patterns(new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x20, 0x63, 0x72, 0xe8, 0x6d, 0x65, 0x20, 0x61, 0x76, 0x65, 0x63, 0x20, 0x64, 0x65, 0x73, 0x20, 0x72, 0xe9, 0x73, 0x75, 0x6d, 0xe9, 0x73]))).toBeNull();
  });

  test('random bytes (no nulls) returns null', () => {
    const data = new Uint8Array(510);
    for (let i = 0; i < 510; i++) data[i] = (i % 255) + 1;
    expect(detectUtf1632Patterns(data)).toBeNull();
  });
});

describe('detectUtf1632Patterns — empty/tiny input', () => {
  test('empty returns null', () => {
    expect(detectUtf1632Patterns(new Uint8Array([]))).toBeNull();
  });

  test('single byte returns null', () => {
    expect(detectUtf1632Patterns(new Uint8Array([0x00]))).toBeNull();
  });
});

describe('detectUtf1632Patterns — alignment trimming', () => {
  test('UTF-16-LE with trailing stray byte', () => {
    const base = encodeUtf16LE('Hello, world! Test');
    const data = concat(base, new Uint8Array([0x42]));
    expect(data.length % 2).toBe(1);
    const result = detectUtf1632Patterns(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-16-le');
  });

  test('UTF-32-LE with trailing unaligned bytes', () => {
    const base = encodeUtf32LE('Hello, world! Test');
    const data = concat(base, new Uint8Array([0x42, 0x43]));
    expect(data.length % 4).not.toBe(0);
    const result = detectUtf1632Patterns(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-32-le');
  });

  test('UTF-32 trimming below minimum (15→12 bytes) skips UTF-32', () => {
    const base = encodeUtf32LE('Tes'); // 12 bytes
    const data = concat(base, new Uint8Array([0x00, 0x00, 0x00])); // 15 bytes → trims to 12
    expect(data.length).toBe(15);
    const result = detectUtf1632Patterns(data);
    if (result !== null) expect(result.encoding).not.toBe('utf-32-le');
  });
});

describe('detectUtf1632Patterns — CJK text', () => {
  test('Chinese text as UTF-16-LE', () => {
    const text = 'This document contains Chinese: 你好世界，欢迎来到这里。';
    const result = detectUtf1632Patterns(encodeUtf16LE(text));
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-16-le');
  });

  test('Chinese text as UTF-16-BE', () => {
    const text = 'This document contains Chinese: 你好世界，欢迎来到这里。';
    const result = detectUtf1632Patterns(encodeUtf16BE(text));
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-16-be');
  });

  test('Japanese text as UTF-16-LE', () => {
    const text = 'This is Japanese text: こんにちは世界。日本語のテストです。';
    const result = detectUtf1632Patterns(encodeUtf16LE(text));
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-16-le');
  });

  test('Korean text as UTF-16-LE', () => {
    const text = 'This is Korean text: 안녕하세요 세계에 오신 것을 환영합니다.';
    const result = detectUtf1632Patterns(encodeUtf16LE(text));
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-16-le');
  });
});

describe('detectUtf1632Patterns — mixed scripts', () => {
  const mixedText = 'Hello World. À bientôt! 你好世界. More English text follows here to pad the sample.';

  test('UTF-16-LE mixed scripts', () => {
    const result = detectUtf1632Patterns(encodeUtf16LE(mixedText));
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-16-le');
  });

  test('UTF-16-BE mixed scripts', () => {
    const result = detectUtf1632Patterns(encodeUtf16BE(mixedText));
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-16-be');
  });

  test('UTF-16-LE mostly ASCII with some non-ASCII', () => {
    const text = 'This is mostly ASCII text with a few accented chars: résumé, naïve, café.';
    const result = detectUtf1632Patterns(encodeUtf16LE(text));
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-16-le');
  });
});

describe('detectUtf1632Patterns — result type', () => {
  test('successful detection returns proper DetectionResult', () => {
    const data = encodeUtf16LE('Hello, this is a test of the return type.');
    const result = detectUtf1632Patterns(data);
    expect(result).toEqual({
      encoding: 'utf-16-le',
      confidence: DETERMINISTIC_CONFIDENCE,
      language: null,
      mimeType: null,
    });
  });
});

describe('detectUtf1632Patterns — UTF-32 non-ASCII', () => {
  test('UTF-32-LE with accented French', () => {
    const text = 'Café crème à la française avec des résumés.';
    const result = detectUtf1632Patterns(encodeUtf32LE(text));
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-32-le');
  });

  test('UTF-32-BE with accented French', () => {
    const text = 'Café crème à la française avec des résumés.';
    const result = detectUtf1632Patterns(encodeUtf32BE(text));
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-32-be');
  });
});

describe('detectUtf1632Patterns — all-null bytes', () => {
  test('all null bytes returns null (not text)', () => {
    expect(detectUtf1632Patterns(new Uint8Array(64).fill(0))).toBeNull();
  });
});

describe('detectUtf1632Patterns — decode errors', () => {
  test('UTF-32-BE with invalid code point returns null', () => {
    const valid   = new Uint8Array([0x00, 0x00, 0x00, 0x41]); // U+0041 BE
    const invalid = new Uint8Array([0x00, 0x11, 0x00, 0x00]); // U+110000 BE (above max)
    const data = concat(...Array(6).fill(valid), ...Array(2).fill(invalid));
    expect(detectUtf1632Patterns(data)).toBeNull();
  });

  test('UTF-32-LE with invalid code point returns null', () => {
    const valid   = new Uint8Array([0x41, 0x00, 0x00, 0x00]); // U+0041 LE
    const invalid = new Uint8Array([0x00, 0x00, 0x11, 0x00]); // U+110000 LE (above max)
    const data = concat(...Array(6).fill(valid), ...Array(2).fill(invalid));
    expect(detectUtf1632Patterns(data)).toBeNull();
  });

  test('UTF-16-LE single candidate with unpaired surrogate returns null', () => {
    const good = new Uint8Array([0x48, 0x00, 0x65, 0x00, 0x6c, 0x00, 0x6c, 0x00, 0x6f, 0x00]); // "Hello"
    const bad  = new Uint8Array([0x01, 0xd8]); // unpaired high surrogate D801
    const more = new Uint8Array([0x20, 0x00, 0x77, 0x00, 0x6f, 0x00, 0x72, 0x00, 0x6c, 0x00, 0x64, 0x00]);
    expect(detectUtf1632Patterns(concat(good, bad, more))).toBeNull();
  });

  test('UTF-16 both candidates low quality returns null', () => {
    const data = new Uint8Array(80);
    for (let i = 0; i < 80; i += 4) {
      data[i] = 0x01; data[i + 1] = 0x00; data[i + 2] = 0x00; data[i + 3] = 0x01;
    }
    expect(detectUtf1632Patterns(data)).toBeNull();
  });
});

describe('_looksLikeText', () => {
  test('empty string returns false', () => {
    expect(_looksLikeText('')).toBe(false);
  });
});

describe('_textQuality', () => {
  test('rejects text with >20% combining marks', () => {
    // U+0300 is a combining mark — 50% marks
    const text = 'à'.repeat(20);
    expect(_textQuality(text)).toBe(-1.0);
  });

  test('gives space bonus for text > 20 chars with whitespace', () => {
    expect(_textQuality('Hello World this is a test of text quality scoring')).toBeGreaterThan(0.5);
  });

  test('ASCII letters give high score', () => {
    expect(_textQuality('abcdefghijklmnopqrstuvwxyz')).toBeGreaterThanOrEqual(1.4);
  });

  test('rejects >10% control characters', () => {
    expect(_textQuality('ab\x01\x02\x03\x04\x05\x06\x07\x08')).toBe(-1.0);
  });

  test('low score for digits and punctuation only', () => {
    expect(_textQuality('12345!@#$%67890^&*()')).toBeLessThan(0.5);
  });
});

describe('detectUtf1632Patterns — null-separator guard', () => {
  test('ASCII with null separators not detected as UTF-16', () => {
    const data = new TextEncoder().encode(
      'master:README.md\x002\x00For support slack to #kodiak-support\nmaster:support.txt\x001\x00For support slack to #kodiak-support\n'
    );
    expect(detectUtf1632Patterns(data)).toBeNull();
  });

  test('find -print0 output not detected as UTF-16', () => {
    const data = new TextEncoder().encode(
      '/home/user/documents/report.txt\x00/home/user/documents/notes.txt\x00/home/user/downloads/image.png\x00/home/user/music/song.mp3\x00'
    );
    expect(detectUtf1632Patterns(data)).toBeNull();
  });

  test('real UTF-16-BE still detected after guard', () => {
    const data = encodeUtf16BE('The quick brown fox jumps over the lazy dog.');
    const result = detectUtf1632Patterns(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-16-be');
  });

  test('CJK UTF-16-LE still detected (low null fraction)', () => {
    const text = 'This document: 你好世界，欢迎来到这里。';
    const result = detectUtf1632Patterns(encodeUtf16LE(text));
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-16-le');
  });
});

describe('detectUtf1632Patterns — tie-breaking', () => {
  test('both LE and BE candidates with tie-breaking', () => {
    // 'A' (U+0041) LE = 0x41 0x00; 'Ā' (U+0100) LE = 0x00 0x01 → nulls in both positions
    const data = encodeUtf16LE('AĀ'.repeat(30));
    const result = detectUtf1632Patterns(data);
    expect(result).not.toBeNull();
    expect(['utf-16-le', 'utf-16-be']).toContain(result!.encoding);
    expect(result!.confidence).toBe(DETERMINISTIC_CONFIDENCE);
  });

  test('one side decode error — valid side wins', () => {
    // Alternating A/Ā in LE → nulls in both positions; 0xD8,0x41 is a high surrogate in BE
    const base = new Uint8Array(Array(20).fill([0x41, 0x00, 0x00, 0x01]).flat());
    const surrogateTrap = new Uint8Array([0xd8, 0x41, 0x00, 0x01]);
    const data = concat(base, surrogateTrap);
    const result = detectUtf1632Patterns(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-16-le');
  });
});
