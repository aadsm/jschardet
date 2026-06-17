// Port of chardet/tests/test_api.py.
//
// Legacy-encoding fixtures are pre-computed Uint8Array literals (see
// "Byte literals in test ports" in docs/port-notes.md). The original Python
// source text is shown in a comment alongside each fixture so the test stays
// readable without round-tripping through a runtime encoder.

import { vi } from 'vitest';
import { detect, detectAll } from '../src/chardet.js';
import { UniversalDetector } from '../src/detector.js';
import { EncodingEra, LanguageFilter } from '../src/enums.js';
import { getCandidates, normalizeEncodings } from '../src/registry.js';

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

function repeatBytes(arr: Uint8Array, times: number): Uint8Array {
  const out = new Uint8Array(arr.length * times);
  for (let i = 0; i < times; i++) out.set(arr, i * arr.length);
  return out;
}

// Helper to scope a console.warn spy to a single test (Python uses
// warnings.catch_warnings).
function captureWarnings(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    calls.push(args.map(String).join(' '));
  });
  return { calls, restore: () => spy.mockRestore() };
}

const HELLO_WORLD = new TextEncoder().encode('Hello world');

// ---------------------------------------------------------------------------
// Pre-computed legacy-encoding fixtures
//
// Each Uint8Array below is the output of Python's `text.encode(label)` for the
// (text, label) pair shown in the comment above it. The source text mirrors
// the corresponding test in chardet/tests/test_api.py verbatim. To regenerate
// or verify a fixture, run:
//
//   python3 -c "print(', '.join(f'0x{b:02x}' for b in 'TEXT'.encode('LABEL')))"
//
// Rationale: TextEncoder only emits UTF-8, and hand-rolling a per-encoding
// encoder for the test harness duplicates Python's codec library. Inlining
// the bytes keeps the suite dependency-free and grep-friendly. See "Byte
// literals in test ports" in docs/port-notes.md.
// ---------------------------------------------------------------------------

// "Η Αθήνα είναι η πρωτεύουσα και μεγαλύτερη πόλη της Ελλάδας. Η πόλη έχει
//  μακρά ιστορία που εκτείνεται πάνω από τρεις χιλιετίες." encoded as iso-8859-7
const GREEK_ISO_8859_7 = new Uint8Array([
  0xc7, 0x20, 0xc1, 0xe8, 0xde, 0xed, 0xe1, 0x20, 0xe5, 0xdf, 0xed, 0xe1, 0xe9, 0x20, 0xe7, 0x20,
  0xf0, 0xf1, 0xf9, 0xf4, 0xe5, 0xfd, 0xef, 0xf5, 0xf3, 0xe1, 0x20, 0xea, 0xe1, 0xe9, 0x20, 0xec,
  0xe5, 0xe3, 0xe1, 0xeb, 0xfd, 0xf4, 0xe5, 0xf1, 0xe7, 0x20, 0xf0, 0xfc, 0xeb, 0xe7, 0x20, 0xf4,
  0xe7, 0xf2, 0x20, 0xc5, 0xeb, 0xeb, 0xdc, 0xe4, 0xe1, 0xf2, 0x2e, 0x20, 0xc7, 0x20, 0xf0, 0xfc,
  0xeb, 0xe7, 0x20, 0xdd, 0xf7, 0xe5, 0xe9, 0x20, 0xec, 0xe1, 0xea, 0xf1, 0xdc, 0x20, 0xe9, 0xf3,
  0xf4, 0xef, 0xf1, 0xdf, 0xe1, 0x20, 0xf0, 0xef, 0xf5, 0x20, 0xe5, 0xea, 0xf4, 0xe5, 0xdf, 0xed,
  0xe5, 0xf4, 0xe1, 0xe9, 0x20, 0xf0, 0xdc, 0xed, 0xf9, 0x20, 0xe1, 0xf0, 0xfc, 0x20, 0xf4, 0xf1,
  0xe5, 0xe9, 0xf2, 0x20, 0xf7, 0xe9, 0xeb, 0xe9, 0xe5, 0xf4, 0xdf, 0xe5, 0xf2, 0x2e,
]);

// "東京は日本の首都です。人口は約1400万人で、世界最大の都市圏を形成しています。" encoded as euc-jp
const JP_EUC_JP = new Uint8Array([
  0xc5, 0xec, 0xb5, 0xfe, 0xa4, 0xcf, 0xc6, 0xfc, 0xcb, 0xdc, 0xa4, 0xce, 0xbc, 0xf3, 0xc5, 0xd4,
  0xa4, 0xc7, 0xa4, 0xb9, 0xa1, 0xa3, 0xbf, 0xcd, 0xb8, 0xfd, 0xa4, 0xcf, 0xcc, 0xf3, 0x31, 0x34,
  0x30, 0x30, 0xcb, 0xfc, 0xbf, 0xcd, 0xa4, 0xc7, 0xa1, 0xa2, 0xc0, 0xa4, 0xb3, 0xa6, 0xba, 0xc7,
  0xc2, 0xe7, 0xa4, 0xce, 0xc5, 0xd4, 0xbb, 0xd4, 0xb7, 0xf7, 0xa4, 0xf2, 0xb7, 0xc1, 0xc0, 0xae,
  0xa4, 0xb7, 0xa4, 0xc6, 0xa4, 0xa4, 0xa4, 0xde, 0xa4, 0xb9, 0xa1, 0xa3,
]);

// "Grüße aus Deutschland" encoded as cp273 (German EBCDIC)
const DE_CP273 = new Uint8Array([
  0xc7, 0x99, 0xd0, 0xa1, 0x85, 0x40, 0x81, 0xa4, 0xa2, 0x40, 0xc4, 0x85, 0xa4, 0xa3, 0xa2, 0x83,
  0x88, 0x93, 0x81, 0x95, 0x84,
]);

// "Les élèves français étudient la littérature européenne avec enthousiasme.
//  Après les études, ils préfèrent dîner dans un café où ils discutent de
//  philosophie et dégustent des crêpes flambées accompagnées de thé à la
//  menthe." encoded as hp-roman8
const FR_HP_ROMAN8 = new Uint8Array([
  0x4c, 0x65, 0x73, 0x20, 0xc5, 0x6c, 0xc9, 0x76, 0x65, 0x73, 0x20, 0x66, 0x72, 0x61, 0x6e, 0xb5,
  0x61, 0x69, 0x73, 0x20, 0xc5, 0x74, 0x75, 0x64, 0x69, 0x65, 0x6e, 0x74, 0x20, 0x6c, 0x61, 0x20,
  0x6c, 0x69, 0x74, 0x74, 0xc5, 0x72, 0x61, 0x74, 0x75, 0x72, 0x65, 0x20, 0x65, 0x75, 0x72, 0x6f,
  0x70, 0xc5, 0x65, 0x6e, 0x6e, 0x65, 0x20, 0x61, 0x76, 0x65, 0x63, 0x20, 0x65, 0x6e, 0x74, 0x68,
  0x6f, 0x75, 0x73, 0x69, 0x61, 0x73, 0x6d, 0x65, 0x2e, 0x20, 0x41, 0x70, 0x72, 0xc9, 0x73, 0x20,
  0x6c, 0x65, 0x73, 0x20, 0xc5, 0x74, 0x75, 0x64, 0x65, 0x73, 0x2c, 0x20, 0x69, 0x6c, 0x73, 0x20,
  0x70, 0x72, 0xc5, 0x66, 0xc9, 0x72, 0x65, 0x6e, 0x74, 0x20, 0x64, 0xd1, 0x6e, 0x65, 0x72, 0x20,
  0x64, 0x61, 0x6e, 0x73, 0x20, 0x75, 0x6e, 0x20, 0x63, 0x61, 0x66, 0xc5, 0x20, 0x6f, 0xcb, 0x20,
  0x69, 0x6c, 0x73, 0x20, 0x64, 0x69, 0x73, 0x63, 0x75, 0x74, 0x65, 0x6e, 0x74, 0x20, 0x64, 0x65,
  0x20, 0x70, 0x68, 0x69, 0x6c, 0x6f, 0x73, 0x6f, 0x70, 0x68, 0x69, 0x65, 0x20, 0x65, 0x74, 0x20,
  0x64, 0xc5, 0x67, 0x75, 0x73, 0x74, 0x65, 0x6e, 0x74, 0x20, 0x64, 0x65, 0x73, 0x20, 0x63, 0x72,
  0xc1, 0x70, 0x65, 0x73, 0x20, 0x66, 0x6c, 0x61, 0x6d, 0x62, 0xc5, 0x65, 0x73, 0x20, 0x61, 0x63,
  0x63, 0x6f, 0x6d, 0x70, 0x61, 0x67, 0x6e, 0xc5, 0x65, 0x73, 0x20, 0x64, 0x65, 0x20, 0x74, 0x68,
  0xc5, 0x20, 0xc8, 0x20, 0x6c, 0x61, 0x20, 0x6d, 0x65, 0x6e, 0x74, 0x68, 0x65, 0x2e,
]);

// "Привет мир, как дела? Это тестовый текст на русском языке. Москва — столица
//  России, крупнейший город страны." encoded as windows-1251
const RU_CP1251 = new Uint8Array([
  0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x20, 0xec, 0xe8, 0xf0, 0x2c, 0x20, 0xea, 0xe0, 0xea, 0x20,
  0xe4, 0xe5, 0xeb, 0xe0, 0x3f, 0x20, 0xdd, 0xf2, 0xee, 0x20, 0xf2, 0xe5, 0xf1, 0xf2, 0xee, 0xe2,
  0xfb, 0xe9, 0x20, 0xf2, 0xe5, 0xea, 0xf1, 0xf2, 0x20, 0xed, 0xe0, 0x20, 0xf0, 0xf3, 0xf1, 0xf1,
  0xea, 0xee, 0xec, 0x20, 0xff, 0xe7, 0xfb, 0xea, 0xe5, 0x2e, 0x20, 0xcc, 0xee, 0xf1, 0xea, 0xe2,
  0xe0, 0x20, 0x97, 0x20, 0xf1, 0xf2, 0xee, 0xeb, 0xe8, 0xf6, 0xe0, 0x20, 0xd0, 0xee, 0xf1, 0xf1,
  0xe8, 0xe8, 0x2c, 0x20, 0xea, 0xf0, 0xf3, 0xef, 0xed, 0xe5, 0xe9, 0xf8, 0xe8, 0xe9, 0x20, 0xe3,
  0xee, 0xf0, 0xee, 0xe4, 0x20, 0xf1, 0xf2, 0xf0, 0xe0, 0xed, 0xfb, 0x2e,
]);

// "こんにちは世界、これはテストです。" encoded as iso-2022-jp
const JP_ISO_2022_JP = new Uint8Array([
  0x1b, 0x24, 0x42, 0x24, 0x33, 0x24, 0x73, 0x24, 0x4b, 0x24, 0x41, 0x24, 0x4f, 0x40, 0x24, 0x33,
  0x26, 0x21, 0x22, 0x24, 0x33, 0x24, 0x6c, 0x24, 0x4f, 0x25, 0x46, 0x25, 0x39, 0x25, 0x48, 0x24,
  0x47, 0x24, 0x39, 0x21, 0x23, 0x1b, 0x28, 0x42,
]);

// "Hello world, this is a longer UTF-16 test with café." encoded as utf-16-le
const UTF16_LE_TEXT = new Uint8Array([
  0x48, 0x00, 0x65, 0x00, 0x6c, 0x00, 0x6c, 0x00, 0x6f, 0x00, 0x20, 0x00, 0x77, 0x00, 0x6f, 0x00,
  0x72, 0x00, 0x6c, 0x00, 0x64, 0x00, 0x2c, 0x00, 0x20, 0x00, 0x74, 0x00, 0x68, 0x00, 0x69, 0x00,
  0x73, 0x00, 0x20, 0x00, 0x69, 0x00, 0x73, 0x00, 0x20, 0x00, 0x61, 0x00, 0x20, 0x00, 0x6c, 0x00,
  0x6f, 0x00, 0x6e, 0x00, 0x67, 0x00, 0x65, 0x00, 0x72, 0x00, 0x20, 0x00, 0x55, 0x00, 0x54, 0x00,
  0x46, 0x00, 0x2d, 0x00, 0x31, 0x00, 0x36, 0x00, 0x20, 0x00, 0x74, 0x00, 0x65, 0x00, 0x73, 0x00,
  0x74, 0x00, 0x20, 0x00, 0x77, 0x00, 0x69, 0x00, 0x74, 0x00, 0x68, 0x00, 0x20, 0x00, 0x63, 0x00,
  0x61, 0x00, 0x66, 0x00, 0xe9, 0x00, 0x2e, 0x00,
]);

// "これはテストです。日本語のテキスト。東京は日本の首都です。人口は約1400万人で、
//  世界最大の都市圏を形成しています。" encoded as shift_jis
const JP_SHIFT_JIS = new Uint8Array([
  0x82, 0xb1, 0x82, 0xea, 0x82, 0xcd, 0x83, 0x65, 0x83, 0x58, 0x83, 0x67, 0x82, 0xc5, 0x82, 0xb7,
  0x81, 0x42, 0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x82, 0xcc, 0x83, 0x65, 0x83, 0x4c, 0x83, 0x58,
  0x83, 0x67, 0x81, 0x42, 0x93, 0x8c, 0x8b, 0x9e, 0x82, 0xcd, 0x93, 0xfa, 0x96, 0x7b, 0x82, 0xcc,
  0x8e, 0xf1, 0x93, 0x73, 0x82, 0xc5, 0x82, 0xb7, 0x81, 0x42, 0x90, 0x6c, 0x8c, 0xfb, 0x82, 0xcd,
  0x96, 0xf1, 0x31, 0x34, 0x30, 0x30, 0x96, 0x9c, 0x90, 0x6c, 0x82, 0xc5, 0x81, 0x41, 0x90, 0xa2,
  0x8a, 0x45, 0x8d, 0xc5, 0x91, 0xe5, 0x82, 0xcc, 0x93, 0x73, 0x8e, 0x73, 0x8c, 0x97, 0x82, 0xf0,
  0x8c, 0x60, 0x90, 0xac, 0x82, 0xb5, 0x82, 0xc4, 0x82, 0xa2, 0x82, 0xdc, 0x82, 0xb7, 0x81, 0x42,
]);

// "这是中文测试文本，用于检测编码。北京是中国的首都，上海是最大的城市。" encoded as gb18030
const ZH_GB18030 = new Uint8Array([
  0xd5, 0xe2, 0xca, 0xc7, 0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4, 0xce, 0xc4, 0xb1, 0xbe,
  0xa3, 0xac, 0xd3, 0xc3, 0xd3, 0xda, 0xbc, 0xec, 0xb2, 0xe2, 0xb1, 0xe0, 0xc2, 0xeb, 0xa1, 0xa3,
  0xb1, 0xb1, 0xbe, 0xa9, 0xca, 0xc7, 0xd6, 0xd0, 0xb9, 0xfa, 0xb5, 0xc4, 0xca, 0xd7, 0xb6, 0xbc,
  0xa3, 0xac, 0xc9, 0xcf, 0xba, 0xa3, 0xca, 0xc7, 0xd7, 0xee, 0xb4, 0xf3, 0xb5, 0xc4, 0xb3, 0xc7,
  0xca, 0xd0, 0xa1, 0xa3,
]);

// "Hello, 世界!" encoded as utf-7
const UTF7_HELLO_WORLD = new Uint8Array([
  0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x2c, 0x20, 0x2b, 0x54, 0x68, 0x5a, 0x31, 0x54, 0x41, 0x21,
]);

// "Meeting notes: 日本語テスト and Ñoño." encoded as utf-7
const UTF7_MEETING = new Uint8Array([
  0x4d, 0x65, 0x65, 0x74, 0x69, 0x6e, 0x67, 0x20, 0x6e, 0x6f, 0x74, 0x65, 0x73, 0x3a, 0x20, 0x2b,
  0x5a, 0x65, 0x56, 0x6e, 0x4c, 0x49, 0x71, 0x65, 0x4d, 0x4d, 0x59, 0x77, 0x75, 0x54, 0x44, 0x49,
  0x20, 0x61, 0x6e, 0x64, 0x20, 0x2b, 0x41, 0x4e, 0x45, 0x2d, 0x6f, 0x2b, 0x41, 0x50, 0x45, 0x2d,
  0x6f, 0x2e,
]);

// "From: user@example.com\r\nSubject: Réunion\r\n\r\nBonjour à tous,\r\n
//  La réunion aura lieu à 14h dans la salle côté jardin.\r\n
//  Merci de préparer les données sur les résultats financiers.\r\n
//  Cordialement,\r\nFrançois\r\n" encoded as utf-7
const UTF7_EMAIL = new Uint8Array([
  0x46, 0x72, 0x6f, 0x6d, 0x3a, 0x20, 0x75, 0x73, 0x65, 0x72, 0x40, 0x65, 0x78, 0x61, 0x6d, 0x70,
  0x6c, 0x65, 0x2e, 0x63, 0x6f, 0x6d, 0x0d, 0x0a, 0x53, 0x75, 0x62, 0x6a, 0x65, 0x63, 0x74, 0x3a,
  0x20, 0x52, 0x2b, 0x41, 0x4f, 0x6b, 0x2d, 0x75, 0x6e, 0x69, 0x6f, 0x6e, 0x0d, 0x0a, 0x0d, 0x0a,
  0x42, 0x6f, 0x6e, 0x6a, 0x6f, 0x75, 0x72, 0x20, 0x2b, 0x41, 0x4f, 0x41, 0x20, 0x74, 0x6f, 0x75,
  0x73, 0x2c, 0x0d, 0x0a, 0x4c, 0x61, 0x20, 0x72, 0x2b, 0x41, 0x4f, 0x6b, 0x2d, 0x75, 0x6e, 0x69,
  0x6f, 0x6e, 0x20, 0x61, 0x75, 0x72, 0x61, 0x20, 0x6c, 0x69, 0x65, 0x75, 0x20, 0x2b, 0x41, 0x4f,
  0x41, 0x20, 0x31, 0x34, 0x68, 0x20, 0x64, 0x61, 0x6e, 0x73, 0x20, 0x6c, 0x61, 0x20, 0x73, 0x61,
  0x6c, 0x6c, 0x65, 0x20, 0x63, 0x2b, 0x41, 0x50, 0x51, 0x2d, 0x74, 0x2b, 0x41, 0x4f, 0x6b, 0x20,
  0x6a, 0x61, 0x72, 0x64, 0x69, 0x6e, 0x2e, 0x0d, 0x0a, 0x4d, 0x65, 0x72, 0x63, 0x69, 0x20, 0x64,
  0x65, 0x20, 0x70, 0x72, 0x2b, 0x41, 0x4f, 0x6b, 0x2d, 0x70, 0x61, 0x72, 0x65, 0x72, 0x20, 0x6c,
  0x65, 0x73, 0x20, 0x64, 0x6f, 0x6e, 0x6e, 0x2b, 0x41, 0x4f, 0x6b, 0x2d, 0x65, 0x73, 0x20, 0x73,
  0x75, 0x72, 0x20, 0x6c, 0x65, 0x73, 0x20, 0x72, 0x2b, 0x41, 0x4f, 0x6b, 0x2d, 0x73, 0x75, 0x6c,
  0x74, 0x61, 0x74, 0x73, 0x20, 0x66, 0x69, 0x6e, 0x61, 0x6e, 0x63, 0x69, 0x65, 0x72, 0x73, 0x2e,
  0x0d, 0x0a, 0x43, 0x6f, 0x72, 0x64, 0x69, 0x61, 0x6c, 0x65, 0x6d, 0x65, 0x6e, 0x74, 0x2c, 0x0d,
  0x0a, 0x46, 0x72, 0x61, 0x6e, 0x2b, 0x41, 0x4f, 0x63, 0x2d, 0x6f, 0x69, 0x73, 0x0d, 0x0a,
]);

// ---------------------------------------------------------------------------
// detect()
// ---------------------------------------------------------------------------

describe('detect()', () => {
  test('returns object with required keys', () => {
    const result = detect(HELLO_WORLD);
    expect(typeof result).toBe('object');
    expect('encoding' in result).toBe(true);
    expect('confidence' in result).toBe(true);
    expect('language' in result).toBe(true);
    expect('mimeType' in result).toBe(true);
  });

  test('ASCII', () => {
    const result = detect(HELLO_WORLD);
    // Default compat_names=true returns chardet 5.x compat names.
    expect(result.encoding).toBe('ascii');
    expect(result.confidence).toBe(1.0);
  });

  test('UTF-8 BOM', () => {
    const result = detect(bytes('\xef\xbb\xbfHello'));
    expect(result.encoding).toBe('UTF-8-SIG');
  });

  test('UTF-8 multibyte', () => {
    const data = new TextEncoder().encode('Héllo wörld café');
    expect(detect(data).encoding).toBe('utf-8');
  });

  test('empty', () => {
    const result = detect(new Uint8Array(0));
    expect(result.encoding).toBe('utf-8');
    expect(result.confidence).toBe(0.10);
  });

  test('with encoding_era', () => {
    expect(detect(HELLO_WORLD, { encodingEra: EncodingEra.MODERN_WEB }).encoding).not.toBeNull();
  });

  test('encoding_era excludes legacy', () => {
    // Greek text is detected as iso-8859-7 with ALL eras; restricted to
    // MODERN_WEB the candidate is filtered out.
    const modern = detect(GREEK_ISO_8859_7, {
      encodingEra: EncodingEra.MODERN_WEB,
      shouldRenameLegacy: false,
    });
    const legacy = detect(GREEK_ISO_8859_7, {
      encodingEra: EncodingEra.ALL,
      shouldRenameLegacy: false,
    });
    expect(legacy.encoding).toBe('ISO-8859-7');
    expect(modern.encoding).not.toBe('iso-8859-7');
  });

  test('with max_bytes', () => {
    const data = repeatBytes(HELLO_WORLD, 100_000);
    const result = detect(data, { maxBytes: 100 });
    expect(result.encoding).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0);
  });
});

describe('detectAll()', () => {
  test('returns array', () => {
    const result = detectAll(HELLO_WORLD);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  test('sorted by confidence descending', () => {
    const data = new TextEncoder().encode('Héllo wörld');
    const results = detectAll(data);
    const confidences = results.map(r => r.confidence);
    const sorted = [...confidences].sort((a, b) => b - a);
    expect(confidences).toEqual(sorted);
  });

  test('each entry has required keys', () => {
    const results = detectAll(HELLO_WORLD);
    for (const r of results) {
      expect('encoding' in r).toBe(true);
      expect('confidence' in r).toBe(true);
      expect('language' in r).toBe(true);
      expect('mimeType' in r).toBe(true);
    }
  });

  test.each<{ id: string; data: Uint8Array }>([
    { id: 'ascii', data: HELLO_WORLD },
    { id: 'utf8', data: new TextEncoder().encode('Héllo wörld café résumé') },
    { id: 'bom', data: bytes('\xef\xbb\xbfHello') },
    { id: 'latin', data: repeatBytes(new Uint8Array([0xe9, 0xe8, 0xea, 0xeb, 0xf6, 0xfc, 0xe4]), 20) },
    { id: 'empty', data: new Uint8Array(0) },
  ])('top result matches detect() — $id', ({ data }) => {
    const single = detect(data);
    const multi = detectAll(data);
    expect(multi[0]).toEqual(single);
  });
});

// ---------------------------------------------------------------------------
// should_rename_legacy / prefer_superset / compat_names
// ---------------------------------------------------------------------------

describe('should_rename_legacy', () => {
  test('default returns chardet 5.x compat name', () => {
    expect(detect(HELLO_WORLD).encoding).toBe('ascii');
  });

  test('explicit false returns chardet 5.x compat name', () => {
    expect(detect(HELLO_WORLD, { shouldRenameLegacy: false }).encoding).toBe('ascii');
  });

  test('explicit true renames regardless of era', () => {
    const { restore } = captureWarnings();
    try {
      const result = detect(HELLO_WORLD, {
        shouldRenameLegacy: true,
        encodingEra: EncodingEra.ALL,
      });
      expect(result.encoding).toBe('Windows-1252');
    } finally {
      restore();
    }
  });

  test('default with ALL era returns compat name', () => {
    expect(detect(HELLO_WORLD, { encodingEra: EncodingEra.ALL }).encoding).toBe('ascii');
  });

  test('detect_all with should_rename_legacy=true', () => {
    const { restore } = captureWarnings();
    try {
      expect(detectAll(HELLO_WORLD, { shouldRenameLegacy: true })[0].encoding).toBe('Windows-1252');
    } finally {
      restore();
    }
  });

  test('detect_all with should_rename_legacy=false', () => {
    expect(detectAll(HELLO_WORLD, { shouldRenameLegacy: false })[0].encoding).toBe('ascii');
  });

  test('detector with should_rename_legacy=true', () => {
    const { restore } = captureWarnings();
    try {
      const det = new UniversalDetector({ shouldRenameLegacy: true });
      det.feed(repeatBytes(new TextEncoder().encode('Hello world, this is enough ASCII data for detection. '), 2));
      det.close();
      expect(det.result.encoding).toBe('Windows-1252');
    } finally {
      restore();
    }
  });

  test('detector with should_rename_legacy=false', () => {
    const det = new UniversalDetector({ shouldRenameLegacy: false });
    det.feed(repeatBytes(new TextEncoder().encode('Hello world, this is enough ASCII data for detection. '), 2));
    det.close();
    expect(det.result.encoding).toBe('ascii');
  });

  test('compat names map EUC-JIS-2004 back to EUC-JP', () => {
    const result = detect(JP_EUC_JP, { shouldRenameLegacy: false });
    expect(result.encoding).toBe('EUC-JP');
  });

  test('emits DeprecationWarning when should_rename_legacy=true', () => {
    const { calls, restore } = captureWarnings();
    try {
      detect(HELLO_WORLD, { shouldRenameLegacy: true });
      const dep = calls.filter(c => c.startsWith('DEPRECATION:'));
      expect(dep.length).toBe(1);
      expect(dep[0]).toMatch(/should_rename_legacy/);
    } finally {
      restore();
    }
  });

  test('detector emits DeprecationWarning when should_rename_legacy=true', () => {
    const { calls, restore } = captureWarnings();
    try {
      new UniversalDetector({ shouldRenameLegacy: true });
      const dep = calls.filter(c => c.startsWith('DEPRECATION:'));
      expect(dep.length).toBe(1);
      expect(dep[0]).toMatch(/should_rename_legacy/);
    } finally {
      restore();
    }
  });
});

describe('compat_names / prefer_superset', () => {
  test('compat_names=false returns raw codec names', () => {
    const result = detect(JP_EUC_JP, { compatNames: false });
    expect(result.encoding).toBe('euc_jis_2004');
  });

  test('prefer_superset=true remaps ASCII to Windows-1252', () => {
    expect(detect(HELLO_WORLD, { preferSuperset: true }).encoding).toBe('Windows-1252');
  });

  test('prefer_superset=false (default) does not remap', () => {
    expect(detect(HELLO_WORLD, { preferSuperset: false }).encoding).toBe('ascii');
  });

  test('prefer_superset=true with compat_names=false returns raw codec superset names', () => {
    expect(detect(HELLO_WORLD, { preferSuperset: true, compatNames: false }).encoding).toBe('cp1252');
  });

  test('detect_all respects compat_names', () => {
    expect(detectAll(HELLO_WORLD, { compatNames: true })[0].encoding).toBe('ascii');
  });

  test('detect_all respects prefer_superset', () => {
    expect(detectAll(HELLO_WORLD, { preferSuperset: true })[0].encoding).toBe('Windows-1252');
  });

  test('detector respects compat_names', () => {
    const det = new UniversalDetector({ compatNames: true });
    det.feed(repeatBytes(new TextEncoder().encode('Hello world, this is enough ASCII data for detection. '), 2));
    det.close();
    expect(det.result.encoding).toBe('ascii');
  });

  test('detector respects prefer_superset', () => {
    const det = new UniversalDetector({ preferSuperset: true });
    det.feed(repeatBytes(new TextEncoder().encode('Hello world, this is enough ASCII data for detection. '), 2));
    det.close();
    expect(det.result.encoding).toBe('Windows-1252');
  });
});

// ---------------------------------------------------------------------------
// ignore_threshold / lang_filter / max_bytes / chunk_size
// ---------------------------------------------------------------------------

describe('ignore_threshold', () => {
  test('false filters low-confidence results', () => {
    const data = new TextEncoder().encode('Héllo wörld café résumé');
    const all = detectAll(data, { ignoreThreshold: true });
    const filtered = detectAll(data, { ignoreThreshold: false });
    expect(filtered.length).toBeLessThanOrEqual(all.length);
    for (const r of filtered) expect(r.confidence).toBeGreaterThan(0.20);
  });

  test('true returns all candidates', () => {
    const data = new TextEncoder().encode('Héllo wörld café résumé');
    expect(detectAll(data, { ignoreThreshold: true }).length).toBeGreaterThanOrEqual(1);
  });

  test('falls back to top result when all results filtered', () => {
    expect(detectAll(new Uint8Array(0), { ignoreThreshold: false }).length).toBeGreaterThanOrEqual(1);
  });
});

describe('lang_filter deprecation', () => {
  test('non-ALL emits DeprecationWarning', () => {
    const { calls, restore } = captureWarnings();
    try {
      new UniversalDetector({ langFilter: LanguageFilter.CJK });
      const dep = calls.filter(c => c.startsWith('DEPRECATION:'));
      expect(dep.length).toBe(1);
      expect(dep[0]).toMatch(/lang_filter/);
    } finally {
      restore();
    }
  });

  test('ALL does not warn', () => {
    const { calls, restore } = captureWarnings();
    try {
      new UniversalDetector({ langFilter: LanguageFilter.ALL });
      const dep = calls.filter(c => c.startsWith('DEPRECATION:'));
      expect(dep.length).toBe(0);
    } finally {
      restore();
    }
  });
});

describe('max_bytes validation', () => {
  test('detect with max_bytes=0 throws', () => {
    expect(() => detect(HELLO_WORLD, { maxBytes: 0 })).toThrow(/max_bytes/);
  });

  test('detect with max_bytes=-1 throws', () => {
    expect(() => detect(HELLO_WORLD, { maxBytes: -1 })).toThrow(/max_bytes/);
  });

  test('detect_all with max_bytes=0 throws', () => {
    expect(() => detectAll(HELLO_WORLD, { maxBytes: 0 })).toThrow(/max_bytes/);
  });

  test('detect_all with max_bytes=-1 throws', () => {
    expect(() => detectAll(HELLO_WORLD, { maxBytes: -1 })).toThrow(/max_bytes/);
  });
});

describe('chunk_size deprecation', () => {
  test('non-default emits DeprecationWarning', () => {
    const { calls, restore } = captureWarnings();
    try {
      detect(HELLO_WORLD, { chunkSize: 1024 });
      const dep = calls.filter(c => c.startsWith('DEPRECATION:'));
      expect(dep.length).toBe(1);
      expect(dep[0]).toMatch(/chunk_size/);
    } finally {
      restore();
    }
  });

  test('default does not warn', () => {
    const { calls, restore } = captureWarnings();
    try {
      detect(HELLO_WORLD);
      const dep = calls.filter(c => c.startsWith('DEPRECATION:'));
      expect(dep.length).toBe(0);
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// Regression tests
// ---------------------------------------------------------------------------

test('detect must not crash on null bytes in charset declaration (chardet#369)', () => {
  const result = detect(bytes('<meta charset="\x00utf-8">'));
  expect(typeof result).toBe('object');
  expect('encoding' in result).toBe(true);
});

// ---------------------------------------------------------------------------
// New encoding tests
// ---------------------------------------------------------------------------

describe('UTF-7 detection', () => {
  test('basic', () => {
    expect(detect(UTF7_HELLO_WORLD).encoding).toBe('utf-7');
  });

  test('era ALL', () => {
    expect(detect(UTF7_MEETING, { encodingEra: EncodingEra.ALL }).encoding).toBe('utf-7');
  });

  test('era MODERN_WEB skips UTF-7', () => {
    expect(detect(UTF7_HELLO_WORLD, { encodingEra: EncodingEra.MODERN_WEB }).encoding).not.toBe('UTF-7');
  });

  test('multi-paragraph email', () => {
    expect(detect(UTF7_EMAIL).encoding).toBe('utf-7');
  });
});

describe('HZ-GB-2312 detection', () => {
  // "Hello ~{CEDE~} World" is a literal ASCII / HZ escape sequence.
  const data = bytes('Hello ~{CEDE~} World');
  test('era ALL', () => {
    expect(detect(data, { encodingEra: EncodingEra.ALL }).encoding).toBe('HZ-GB-2312');
  });
  test('era MODERN_WEB skips it', () => {
    expect(detect(data, { encodingEra: EncodingEra.MODERN_WEB }).encoding).not.toBe('hz-gb-2312');
  });
});

describe('ISO-2022-KR detection', () => {
  // Raw escape sequence per the Python test.
  const data = bytes('\x1b$)C\x0e\x21\x21\x0f');
  test('era ALL', () => {
    expect(detect(data, { encodingEra: EncodingEra.ALL }).encoding).toBe('ISO-2022-KR');
  });
  test('era MODERN_WEB skips it', () => {
    expect(detect(data, { encodingEra: EncodingEra.MODERN_WEB }).encoding).not.toBe('iso-2022-kr');
  });
});

test('ISO-2022-JP still works in MODERN_WEB', () => {
  // Mixed ASCII + ISO-2022-JP escape sequence: "Hello \x1b$B$3$s$K$A$O\x1b(B World"
  const data = bytes('Hello \x1b$B$3$s$K$A$O\x1b(B World');
  const result = detect(data, { encodingEra: EncodingEra.MODERN_WEB });
  expect(['ISO-2022-JP', 'iso2022_jp_2004', 'iso2022_jp_ext']).toContain(result.encoding);
});

test('CP273 (EBCDIC German)', () => {
  const result = detect(DE_CP273, { encodingEra: EncodingEra.ALL });
  expect(result.encoding).not.toBeNull();
  expect(result.encoding!.toUpperCase().startsWith('CP')).toBe(true);
});

test('HP-Roman8', () => {
  const result = detect(FR_HP_ROMAN8, { encodingEra: EncodingEra.ALL });
  expect(result.encoding).toBe('hp-roman8');
});

// ---------------------------------------------------------------------------
// PEP 263 encoding declarations
// ---------------------------------------------------------------------------

describe('PEP 263 encoding declarations', () => {
  test('Emacs-style on line 1', () => {
    // # -*- coding: iso-8859-1 -*-\nx = 'élève'\n  (élève uses bytes 0xe9, 0xe8 in iso-8859-1)
    const data = bytes("# -*- coding: iso-8859-1 -*-\nx = '\xe9l\xe8ve'\n");
    const result = detect(data, { compatNames: false });
    expect(result.encoding).toBe('iso8859-1');
    expect(result.confidence).toBe(0.95);
  });

  test('bare form: # coding=<encoding>', () => {
    const data = new TextEncoder().encode("# coding=utf-8\nx = 'hello'\n");
    const result = detect(data, { compatNames: false });
    expect(result.encoding).toBe('utf-8');
    expect(result.confidence).toBe(0.95);
  });

  test('line 2 after shebang', () => {
    // #!/usr/bin/env python\n# -*- coding: iso-8859-1 -*-\nx = '\xe9'\n
    const data = bytes("#!/usr/bin/env python\n# -*- coding: iso-8859-1 -*-\nx = '\xe9'\n");
    const result = detect(data, { compatNames: false });
    expect(result.encoding).toBe('iso8859-1');
    expect(result.confidence).toBe(0.95);
  });

  test('line 3 ignored — only lines 1-2 are valid', () => {
    const data = new TextEncoder().encode('#!/usr/bin/env python\n# a comment\n# -*- coding: iso-8859-1 -*-\n');
    expect(detect(data).encoding).toBe('ascii');
  });

  test('unknown encoding name falls through', () => {
    const data = new TextEncoder().encode('# -*- coding: not-a-real-encoding -*-\nhello world\n');
    expect(detect(data).encoding).toBe('ascii');
  });
});

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------

describe('normalizeEncodings', () => {
  test('null returns null', () => {
    expect(normalizeEncodings(null, 'include_encodings')).toBeNull();
  });

  test('valid names', () => {
    expect(new Set(normalizeEncodings(['utf-8', 'cp1252'], 'include_encodings')!))
      .toEqual(new Set(['utf-8', 'cp1252']));
  });

  test('aliases', () => {
    expect(new Set(normalizeEncodings(['windows-1252', 'EUC-JP'], 'include_encodings')!))
      .toEqual(new Set(['cp1252', 'euc_jis_2004']));
  });

  test('unknown raises', () => {
    expect(() => normalizeEncodings(['utf-8', 'not-real'], 'include_encodings')).toThrow(/Unknown encoding/);
  });

  test('empty iterable raises', () => {
    expect(() => normalizeEncodings([], 'include_encodings')).toThrow(/must not be empty/);
  });
});

test('detect with empty include throws', () => {
  expect(() => detect(HELLO_WORLD, { includeEncodings: [] })).toThrow(/must not be empty/);
});

describe('getCandidates', () => {
  test('include_only', () => {
    const names = new Set(getCandidates(EncodingEra.ALL, new Set(['utf-8', 'cp1252'])).map(e => e.name));
    expect(names).toEqual(new Set(['utf-8', 'cp1252']));
  });

  test('exclude_only', () => {
    const names = new Set(getCandidates(EncodingEra.ALL, undefined, new Set(['utf-8'])).map(e => e.name));
    expect(names.has('utf-8')).toBe(false);
    expect(names.size).toBeGreaterThan(50);
  });

  test('include and exclude', () => {
    const names = new Set(getCandidates(
      EncodingEra.ALL,
      new Set(['utf-8', 'cp1252', 'cp1251']),
      new Set(['cp1252']),
    ).map(e => e.name));
    expect(names).toEqual(new Set(['utf-8', 'cp1251']));
  });

  test('include intersects era', () => {
    const names = new Set(getCandidates(EncodingEra.MODERN_WEB, new Set(['cp1252', 'iso8859-1'])).map(e => e.name));
    expect(names).toEqual(new Set(['cp1252']));
  });

  test('all filtered returns empty', () => {
    expect(getCandidates(EncodingEra.ALL, new Set(['cp1252']), new Set(['cp1252']))).toEqual([]);
  });

  test('no encodings args matches explicit undefined,undefined', () => {
    expect(getCandidates(EncodingEra.MODERN_WEB))
      .toEqual(getCandidates(EncodingEra.MODERN_WEB, undefined, undefined));
  });
});

// ---------------------------------------------------------------------------
// include / exclude / fallback / empty integration
// ---------------------------------------------------------------------------

describe('include / exclude / fallback / empty', () => {
  test('include_encodings narrows', () => {
    const data = new TextEncoder().encode('Héllo wörld café résumé naïve');
    expect(detect(data, { includeEncodings: ['cp1252'], compatNames: false }).encoding).toBe('cp1252');
  });

  test('exclude_encodings removes', () => {
    const result = detect(HELLO_WORLD, { excludeEncodings: ['ascii'], compatNames: false });
    expect(result.encoding).not.toBe('ascii');
    expect(result.encoding).not.toBeNull();
  });

  test('exclude utf-8-sig suppresses BOM detection', () => {
    const data = bytes('\xef\xbb\xbfHello world');
    expect(detect(data, { excludeEncodings: ['utf-8-sig'], compatNames: false }).encoding).toBe('utf-8');
  });

  test('include filters BOM', () => {
    const data = bytes('\xef\xbb\xbfHello world');
    expect(detect(data, { includeEncodings: ['cp1252'], compatNames: false }).encoding).toBe('cp1252');
  });

  test('custom no_match_encoding when no candidates survive', () => {
    // \x80..\x85: non-ASCII bytes that ASCII can't decode.
    const data = new Uint8Array([0x80, 0x81, 0x82, 0x83, 0x84, 0x85]);
    const result = detect(data, {
      includeEncodings: ['ascii'],
      noMatchEncoding: 'ascii',
      compatNames: false,
    });
    expect(result.encoding).toBe('ascii');
  });

  test('custom empty_input_encoding for empty input', () => {
    expect(detect(new Uint8Array(0), { emptyInputEncoding: 'ascii', compatNames: false }).encoding).toBe('ascii');
  });

  test('warning when no_match_encoding is filtered out', () => {
    const { calls, restore } = captureWarnings();
    try {
      const result = detect(new Uint8Array(0), {
        includeEncodings: ['cp1252'],
        compatNames: false,
      });
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(result.encoding).toBeNull();
      expect(result.confidence).toBe(0.0);
    } finally {
      restore();
    }
  });

  test('binary detection unaffected by filters', () => {
    const data = repeatBytes(new Uint8Array([0x00]), 100);
    expect(detect(data, { includeEncodings: ['utf-8'], compatNames: false }).encoding).toBeNull();
  });

  test('detect_all respects include_encodings', () => {
    const data = new TextEncoder().encode('Héllo wörld café résumé naïve');
    const results = detectAll(data, {
      includeEncodings: ['cp1252', 'cp1251'],
      ignoreThreshold: true,
      compatNames: false,
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect(['cp1252', 'cp1251', null]).toContain(r.encoding);
  });

  test('unknown include throws', () => {
    expect(() => detect(HELLO_WORLD, { includeEncodings: ['not-a-real-encoding'] })).toThrow(/Unknown encoding/);
  });

  test('unknown exclude throws', () => {
    expect(() => detect(HELLO_WORLD, { excludeEncodings: ['not-a-real-encoding'] })).toThrow(/Unknown encoding/);
  });

  test('unknown no_match throws', () => {
    expect(() => detect(HELLO_WORLD, { noMatchEncoding: 'not-real' })).toThrow(/Unknown encoding/);
  });

  test('unknown empty_input throws', () => {
    expect(() => detect(HELLO_WORLD, { emptyInputEncoding: 'not-real' })).toThrow(/Unknown encoding/);
  });

  test('detect_all respects exclude_encodings', () => {
    const data = new TextEncoder().encode('Héllo wörld café résumé naïve');
    const results = detectAll(data, {
      excludeEncodings: ['utf-8'],
      ignoreThreshold: true,
      compatNames: false,
    });
    for (const r of results) expect(r.encoding).not.toBe('utf-8');
  });

  test('overlapping include and exclude yields encoding=null', () => {
    const { calls, restore } = captureWarnings();
    try {
      const result = detect(HELLO_WORLD, {
        includeEncodings: ['ascii'],
        excludeEncodings: ['ascii'],
        compatNames: false,
      });
      expect(result.encoding).toBeNull();
      expect(result.confidence).toBe(0.0);
      expect(calls.length).toBeGreaterThanOrEqual(1);
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// UniversalDetector include/exclude/fallback/empty
// ---------------------------------------------------------------------------

describe('UniversalDetector include/exclude/fallback/empty', () => {
  test('include_encodings', () => {
    const det = new UniversalDetector({ includeEncodings: ['cp1252'], compatNames: false });
    det.feed(repeatBytes(new TextEncoder().encode('Hello world, this is enough ASCII data for detection. '), 2));
    expect(det.close().encoding).toBe('cp1252');
  });

  test('exclude_encodings', () => {
    const det = new UniversalDetector({ excludeEncodings: ['ascii'], compatNames: false });
    det.feed(repeatBytes(new TextEncoder().encode('Hello world, this is enough ASCII data for detection. '), 2));
    const result = det.close();
    expect(result.encoding).not.toBe('ascii');
    expect(result.encoding).not.toBeNull();
  });

  test('custom empty_input_encoding', () => {
    const det = new UniversalDetector({ emptyInputEncoding: 'ascii', compatNames: false });
    expect(det.close().encoding).toBe('ascii');
  });

  test('custom no_match_encoding', () => {
    const det = new UniversalDetector({
      includeEncodings: ['ascii'],
      noMatchEncoding: 'ascii',
      compatNames: false,
    });
    det.feed(new Uint8Array([0x80, 0x81, 0x82, 0x83, 0x84, 0x85]));
    expect(det.close().encoding).toBe('ascii');
  });

  test('unknown include throws', () => {
    expect(() => new UniversalDetector({ includeEncodings: ['not-real'] })).toThrow(/Unknown encoding/);
  });

  test('unknown exclude throws', () => {
    expect(() => new UniversalDetector({ excludeEncodings: ['not-real'] })).toThrow(/Unknown encoding/);
  });

  test('unknown no_match throws', () => {
    expect(() => new UniversalDetector({ noMatchEncoding: 'not-real' })).toThrow(/Unknown encoding/);
  });

  test('unknown empty_input throws', () => {
    expect(() => new UniversalDetector({ emptyInputEncoding: 'not-real' })).toThrow(/Unknown encoding/);
  });

  test('detect_all respects empty_input_encoding', () => {
    expect(detectAll(new Uint8Array(0), { emptyInputEncoding: 'ascii', compatNames: false })[0].encoding).toBe('ascii');
  });

  test('detect_all respects no_match_encoding', () => {
    const data = new Uint8Array([0x80, 0x81, 0x82, 0x83, 0x84, 0x85]);
    const results = detectAll(data, {
      includeEncodings: ['ascii'],
      noMatchEncoding: 'ascii',
      ignoreThreshold: true,
      compatNames: false,
    });
    expect(results[0].encoding).toBe('ascii');
  });
});

// ---------------------------------------------------------------------------
// include_encodings preserves accuracy
// ---------------------------------------------------------------------------

interface AccuracyCase {
  id: string;
  data: Uint8Array;
  includeSet: string[];
  expected: string;
}

// Each case targets a different pipeline stage to ensure include_encodings
// filtering does not interfere with any detection path. The `data` text is
// either inline (visible in the code) or a named fixture defined above with
// its source string in the constant's comment.
const ACCURACY_CASES: AccuracyCase[] = [
  // Multibyte UTF-8 stage with Latin single-byte confusables.
  {
    id: 'utf8-with-latin-confusables',
    data: new TextEncoder().encode('Héllo wörld café résumé naïve über straße'),
    includeSet: ['utf-8', 'cp1252', 'iso8859-1'],
    expected: 'utf-8',
  },
  // BOM stage: UTF-8 BOM bytes prepended to a plain ASCII document.
  {
    id: 'utf8-bom-with-alternatives',
    data: concat(new Uint8Array([0xef, 0xbb, 0xbf]), new TextEncoder().encode('Hello world, this is a BOM test document.')),
    includeSet: ['utf-8-sig', 'utf-8', 'cp1252'],
    expected: 'utf-8-sig',
  },
  // Escape stage: ISO-2022-JP with other Japanese encodings as alternatives.
  {
    id: 'iso2022-jp-with-alternatives',
    data: JP_ISO_2022_JP,
    includeSet: ['iso2022_jp_2', 'utf-8', 'euc_jis_2004'],
    expected: 'iso2022_jp_2',
  },
  // UTF-16 stage: BOM-less UTF-16-LE with endian confusable.
  {
    id: 'utf16-le-with-endian-confusable',
    data: UTF16_LE_TEXT,
    includeSet: ['utf-16-le', 'utf-16-be', 'utf-8'],
    expected: 'utf-16-le',
  },
  // Statistical stage: Cyrillic (windows-1251) with Cyrillic confusables.
  {
    id: 'windows-1251-with-cyrillic-confusables',
    data: RU_CP1251,
    includeSet: ['cp1251', 'cp1252', 'iso8859-5', 'koi8-r'],
    expected: 'cp1251',
  },
  // Statistical stage: Greek (iso-8859-7) with Latin confusables.
  {
    id: 'greek-with-latin-confusables',
    data: GREEK_ISO_8859_7,
    includeSet: ['iso8859-7', 'cp1252', 'iso8859-1'],
    expected: 'iso8859-7',
  },
  // Structural + Statistical: Japanese Shift-JIS with CJK confusables.
  {
    id: 'shift-jis-with-cjk-confusables',
    data: JP_SHIFT_JIS,
    includeSet: ['shift_jis_2004', 'euc_jis_2004', 'gb18030', 'big5hkscs'],
    expected: 'shift_jis_2004',
  },
  // Structural + Statistical: Chinese GB18030 with CJK confusables.
  {
    id: 'gb18030-with-cjk-confusables',
    data: ZH_GB18030,
    includeSet: ['gb18030', 'big5hkscs', 'euc_kr'],
    expected: 'gb18030',
  },
];

describe('include_encodings preserves accuracy', () => {
  test.each(ACCURACY_CASES)('$id', ({ data, includeSet, expected }) => {
    const result = detect(data, { includeEncodings: includeSet, compatNames: false });
    expect(result.encoding).toBe(expected);
  });
});
