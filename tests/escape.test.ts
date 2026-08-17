import { detectEscapeEncoding, _isValidUtf7B64 } from '../src/pipeline/escape.js';
import { utf7DecodesWithoutError } from '../src/pipeline/to-utf8.js';

const DETERMINISTIC_CONFIDENCE = 0.95;

function enc(s: string): Uint8Array { return new TextEncoder().encode(s); }

describe('detectEscapeEncoding — ISO-2022-JP', () => {
  test('ESC $B → iso2022_jp_2', () => {
    const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x1b, 0x24, 0x42, 0x24, 0x33, 0x24, 0x73, 0x24, 0x4b, 0x24, 0x41, 0x24, 0x4f, 0x1b, 0x28, 0x42, 0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64]);
    const result = detectEscapeEncoding(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('iso2022_jp_2');
    expect(result!.confidence).toBe(DETERMINISTIC_CONFIDENCE);
  });

  test('ESC $@ → iso2022_jp_2', () => {
    const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x1b, 0x24, 0x40, 0x24, 0x33, 0x24, 0x73, 0x24, 0x4b, 0x24, 0x41, 0x24, 0x4f, 0x1b, 0x28, 0x42, 0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64]);
    const result = detectEscapeEncoding(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('iso2022_jp_2');
  });

  test('ISO-2022-KR', () => {
    const data = new Uint8Array([0x1b, 0x24, 0x29, 0x43, 0x0e, 0x21, 0x21, 0x0f]);
    const result = detectEscapeEncoding(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('iso2022_kr');
    expect(result!.confidence).toBe(DETERMINISTIC_CONFIDENCE);
  });

  test('iso2022_jp_2004 via ESC$(O', () => {
    const data = new Uint8Array([0x1b, 0x24, 0x42, 0x24, 0x33, 0x24, 0x73, 0x1b, 0x28, 0x42, 0x1b, 0x24, 0x28, 0x4f, 0x21, 0x21, 0x1b, 0x28, 0x42]);
    const result = detectEscapeEncoding(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('iso2022_jp_2004');
  });

  test('iso2022_jp_2004 via ESC$(Q', () => {
    const data = new Uint8Array([0x1b, 0x24, 0x42, 0x24, 0x33, 0x24, 0x73, 0x1b, 0x28, 0x42, 0x1b, 0x24, 0x28, 0x51, 0x21, 0x21, 0x1b, 0x28, 0x42]);
    const result = detectEscapeEncoding(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('iso2022_jp_2004');
  });

  test('iso2022_jp_ext via SI/SO', () => {
    const data = new Uint8Array([0x1b, 0x24, 0x42, 0x24, 0x33, 0x24, 0x73, 0x1b, 0x28, 0x42, 0x0e, 0xb1, 0xb2, 0x0f]);
    const result = detectEscapeEncoding(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('iso2022_jp_ext');
  });

  test('iso2022_jp_ext via ESC(I', () => {
    const data = new Uint8Array([0x1b, 0x24, 0x42, 0x24, 0x33, 0x24, 0x73, 0x1b, 0x28, 0x42, 0x1b, 0x28, 0x49, 0x31, 0x32, 0x1b, 0x28, 0x42]);
    const result = detectEscapeEncoding(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('iso2022_jp_ext');
  });

  test('iso2022_jp_ext via ESC(I alone', () => {
    const data = new Uint8Array([0x1b, 0x28, 0x49, 0x31, 0x32, 0x1b, 0x28, 0x42]);
    const result = detectEscapeEncoding(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('iso2022_jp_ext');
  });

  test('ESC$(D → iso2022_jp_2', () => {
    const data = new Uint8Array([0x1b, 0x24, 0x28, 0x44, 0x30, 0x21, 0x1b, 0x28, 0x42]);
    const result = detectEscapeEncoding(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('iso2022_jp_2');
  });

  test('JIS X 0213 alone → iso2022_jp_2004', () => {
    const data = new Uint8Array([0x1b, 0x24, 0x28, 0x4f, 0x21, 0x21, 0x1b, 0x28, 0x42]);
    const result = detectEscapeEncoding(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('iso2022_jp_2004');
  });
});

describe('detectEscapeEncoding — HZ-GB-2312', () => {
  test('basic HZ', () => {
    const result = detectEscapeEncoding(enc('Hello ~{CEDE~} World'));
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('hz');
    expect(result!.confidence).toBe(DETERMINISTIC_CONFIDENCE);
  });

  test('requires both markers', () => {
    expect(detectEscapeEncoding(enc('Hello ~{CEDE World'))).toBeNull();
  });

  test('rejects English with tildes', () => {
    expect(detectEscapeEncoding(enc('The formula ~{x + y~} is simple.'))).toBeNull();
  });

  test('rejects odd-length region', () => {
    expect(detectEscapeEncoding(enc('~{ABC~}'))).toBeNull();
  });

  test('rejects empty region', () => {
    expect(detectEscapeEncoding(enc('~{~}'))).toBeNull();
  });

  test('rejects bytes outside 0x21–0x7E', () => {
    expect(detectEscapeEncoding(enc('~{ a ~}'))).toBeNull();
  });

  test('close marker before open, valid region follows', () => {
    const result = detectEscapeEncoding(enc('prefix ~} text ~{CEDE~}'));
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('hz');
  });

  test('only close before open → null', () => {
    expect(detectEscapeEncoding(enc('~} some text ~{ invalid'))).toBeNull();
  });
});

// UTF-7 encodes non-ASCII characters as base64 of their UTF-16BE byte pairs,
// wrapped in +...- shift markers. All bytes in a UTF-7 stream are therefore
// 7-bit ASCII. JS has no native UTF-7 encoder; shifted sequences below are
// pre-computed from the Python originals using Python's utf-7 codec.
describe('detectEscapeEncoding — UTF-7', () => {
  test('basic UTF-7 (non-ASCII shifted sequence)', () => {
    // Python: "Hello, 世界".encode("utf-7") — JS has no native UTF-7 encoder.
    // "+ThZ1TA-" is the correct UTF-7 encoding of "世界" (U+4E16, U+754C as UTF-16BE base64).
    const data = enc('Hello, +ThZ1TA-');
    const result = detectEscapeEncoding(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-7');
    expect(result!.confidence).toBe(DETERMINISTIC_CONFIDENCE);
  });

  test('shifted sequence +AGkAbgB0AGUAbgBzAGU-', () => {
    const result = detectEscapeEncoding(enc('Hello +AGkAbgB0AGUAbgBzAGU-'));
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-7');
  });

  test('literal plus (+- is not shifted)', () => {
    expect(detectEscapeEncoding(enc('2+- 2 = 4'))).toBeNull();
  });

  test('stray plus in ASCII text (C++)', () => {
    expect(detectEscapeEncoding(enc('C++ is a programming language'))).toBeNull();
  });

  test('price with literal plus', () => {
    expect(detectEscapeEncoding(enc('price: 10+- tax'))).toBeNull();
  });

  test('URL with plus rejected', () => {
    expect(detectEscapeEncoding(enc('https://www.google.com/search?q=hello+ABC-DEF'))).toBeNull();
  });

  test('short base64 in text rejected', () => {
    expect(detectEscapeEncoding(enc('x+ABC-y'))).toBeNull();
  });

  test('MIME boundary rejected', () => {
    expect(detectEscapeEncoding(enc('--boundary+ABCdef123-end'))).toBeNull();
  });

  test('C++20 rejected (Guard A)', () => {
    expect(detectEscapeEncoding(enc('#include <ranges>  // C++20 feature\nint main() { return 0; }\n'))).toBeNull();
  });

  test('PEM certificate rejected (Guard B)', () => {
    const data = enc(
      '-----BEGIN CERTIFICATE-----\n' +
      'MIICpDCCAYwCCQDU+pQ4pHgSpDANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAls\n' +
      'b2NhbGhvc3QwHhcNMjMwNTI5MTI0ODQ3WhcNMjQwNTI4MTI0ODQ3WjAUMRIwEAYD\n' +
      'VQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC+\n' +
      '7e1RRz+BI/kHMBbOz+FN5bEwMmJ2KKQGXN+yTDaj8bKRMqgJ7MJifi3eFmFnqYg\n' +
      '-----END CERTIFICATE-----\n'
    );
    expect(detectEscapeEncoding(data)).toBeNull();
  });

  test('UTF-7 multi-paragraph document', () => {
    // Python: "".join(parts).encode("utf-7") where parts is a multi-line email
    // with Japanese (日本語テスト, 田中, 資料) and Latin-extended (Müller, René, André) text.
    const data = enc('From: sender@example.com\r\nSubject: Meeting notes\r\n\r\nMeeting at 3pm.\r\nTopic: +ZeVnLIqeMMYwuTDI.\r\nAttendees: M+APw-ller, Ren+AOk, +dTBOLQ.\r\n\r\nPlease review the +jMdlmQ before Thursday.\r\nBest regards,\r\nAndr+AOk\r\n');
    const result = detectEscapeEncoding(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-7');
  });

  test('UTF-7 mixed ASCII and shifted', () => {
    // Python: "Price: 100€, shipping to München, estimated 3-5 days. Sincerely, José.".encode("utf-7")
    const data = enc('Price: 100+IKw, shipping to M+APw-nchen, estimated 3-5 days. Sincerely, Jos+AOk.');
    const result = detectEscapeEncoding(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-7');
  });

  test('UTF-7 consecutive shifted sequences (CJK)', () => {
    // Python: "これはテストです".encode("utf-7") — all non-ASCII, no unshifted segments.
    const data = enc('+MFMwjDBvMMYwuTDIMGcwWQ-');
    const result = detectEscapeEncoding(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-7');
  });

  test('short base64 (< 3 chars) rejected', () => {
    expect(detectEscapeEncoding(enc('text +AB- more text'))).toBeNull();
  });

  test('increment operator ++row rejected', () => {
    expect(detectEscapeEncoding(enc('int f() {\n  int row = 0;\n  ++row;\n}'))).toBeNull();
  });

  test('triple-plus +++i rejected', () => {
    expect(detectEscapeEncoding(enc('for (int i = 0; i < n; +++i) {}'))).toBeNull();
  });

  test('double-plus at end rejected (C++)', () => {
    expect(detectEscapeEncoding(enc('I love C++'))).toBeNull();
  });

  test('all-lowercase base64 rejected (Guard C)', () => {
    expect(detectEscapeEncoding(enc('hello +foo world'))).toBeNull();
  });

  test('SHA-1 git hash rejected', () => {
    expect(detectEscapeEncoding(enc('+4bafdea31b1a83b6eff5dac6cedcff073cb984f6'))).toBeNull();
  });
});

describe('detectEscapeEncoding — plain input', () => {
  test('plain ASCII returns null', () => {
    expect(detectEscapeEncoding(enc('Hello World'))).toBeNull();
  });

  test('random bytes returns null', () => {
    const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) data[i] = i;
    expect(detectEscapeEncoding(data)).toBeNull();
  });
});

describe('_isValidUtf7B64', () => {
  test('rejects lone low surrogate (3AA = 0xDC00)', () => {
    expect(_isValidUtf7B64(enc('3AA'))).toBe(false);
  });

  test('rejects consecutive high surrogates (2ADYAQ = 0xD800 0xD801)', () => {
    expect(_isValidUtf7B64(enc('2ADYAQ'))).toBe(false);
  });

  test('rejects high surrogate followed by non-surrogate (2ABPYA)', () => {
    expect(_isValidUtf7B64(enc('2ABPYA'))).toBe(false);
  });

  test('rejects trailing high surrogate (2AA = 0xD800)', () => {
    expect(_isValidUtf7B64(enc('2AA'))).toBe(false);
  });

  test('accepts valid surrogate pair (2ADcAA = U+10000)', () => {
    expect(_isValidUtf7B64(enc('2ADcAA'))).toBe(true);
  });
});

// test_utf7_rejects_hex_hash_in_requirements_file omitted: requires chardet.detect()
// which is not available until Step 8. Add to escape.test.ts when Step 8 is complete.

// ---------------------------------------------------------------------------
// Strict UTF-7 validity decoder (utf7DecodesWithoutError)
// ---------------------------------------------------------------------------
//
// The decode gate must match CPython's utf_7 incremental decoder exactly —
// a gate slightly stricter or looser than Python's flips different inputs.
// Each row is [hex bytes, expected final=false verdict, expected final=true
// verdict], generated from codecs.getincrementaldecoder("utf-7") (CPython
// 3.11); the TS implementation was additionally swept against 3,500+
// randomized oracle cases with zero mismatches at port time. No test here
// may be edited to match the implementation — regenerate from CPython.
const UTF7_ORACLE_CASES: Array<[string, boolean, boolean]> = [
  ['2b7c78', false, false],
  ['2b2d', true, true],
  ['2b', true, true],
  ['2b414545', true, true],
  ['2b4145452d', true, true],
  ['2b4145', true, false],
  ['2b4146', true, false],
  ['2b3241412d', true, true],
  ['2b3241446341412d', true, true],
  ['2b3341412d', true, true],
  ['612b2062', false, false],
  ['2b0a', false, false],
  ['6162ff6364', false, false],
  ['2b41434521', true, true],
  ['7c31363834372b7c', false, false],
  ['2b41454578', true, false],
  ['2b41454578414545', true, false],
  ['2b414477', true, true],
  ['2b414141', true, true],
  ['2b42424242', true, false],
  ['2b4141', true, false],
  ['2b41412d', false, false],
  ['2b414545782d', false, false],
  ['2b414545412d', false, false],
  ['2b324141', true, false],
  ['2b324144', true, false],
  ['2b324144634141', true, true],
  ['0102', true, true],
  ['2b3d', false, false],
  ['612b3d78', false, false],
  ['2b4143453d', true, true],
  ['2b414545ff', false, false],
  ['2b41434541', true, false],
  ['2b4143454178', true, false],
  ['2b2b', true, false],
  ['2b2f76382d616263', true, true],
  ['2b2f7638', true, true],
  ['2b414546', true, false],
  ['2b4145462d', false, false],
  ['2b32414121', true, true],
  ['2b3241414145452d', false, false],
  ['48656c6c6f2c20576f726c6421', true, true],
  ['2b5432744968412d', true, true],
  ['432b2b323020616e64202b2b726f77', true, false],
  ['2b313030', true, true],
  ['2b414745415967426a2d78797a', true, true],
  ['', true, true],
  ['2d', true, true],
  ['2d2d2b', true, true],
  ['2b2f2f7639', true, false],
  ['2b2f76392d', false, false],
  ['2b2f762b', true, false],
  ['2b2f762f', true, false],
];

test('utf7DecodesWithoutError matches the CPython oracle', () => {
  const failures: string[] = [];
  for (const [hexStr, expectStream, expectFinal] of UTF7_ORACLE_CASES) {
    const data = new Uint8Array(hexStr.length / 2);
    for (let i = 0; i < data.length; i++) data[i] = parseInt(hexStr.substr(i * 2, 2), 16);
    const stream = utf7DecodesWithoutError(data, false);
    const final = utf7DecodesWithoutError(data, true);
    if (stream !== expectStream || final !== expectFinal) {
      failures.push(
        `${hexStr}: got stream=${stream} final=${final}, ` +
        `python says stream=${expectStream} final=${expectFinal}`,
      );
    }
  }
  expect(failures).toEqual([]);
});
