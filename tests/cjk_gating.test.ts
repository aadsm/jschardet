// Port of chardet/tests/test_cjk_gating.py.
//
// Verifies that the CJK multi-byte gating heuristic rejects non-CJK candidates
// without suppressing real CJK content.
//
// CJK byte fixtures are pre-computed Uint8Array literals; see "Byte literals
// in test ports" in docs/port-notes.md.

import { detect } from '../src/chardet.js';
import { EncodingEra } from '../src/enums.js';
import { runPipeline } from '../src/pipeline/orchestrator.js';
import macromanDeSample from './fixtures/cjk_gating/macroman_de.txt?uint8array';

const _CJK_ENCODINGS = new Set([
  'gb18030', 'big5hkscs', 'cp932', 'cp949', 'euc_jis_2004', 'euc_kr',
  'shift_jis_2004', 'johab', 'hz', 'iso2022_jp_2', 'iso2022_kr',
]);

// "Hello World, this is a test of EBCDIC encoding.".encode("cp037")
const _EBCDIC_HELLO = new Uint8Array([
  0xc8, 0x85, 0x93, 0x93, 0x96, 0x40, 0xe6, 0x96, 0x99, 0x93, 0x84, 0x6b,
  0x40, 0xa3, 0x88, 0x89, 0xa2, 0x40, 0x89, 0xa2, 0x40, 0x81, 0x40, 0xa3,
  0x85, 0xa2, 0xa3, 0x40, 0x96, 0x86, 0x40, 0xc5, 0xc2, 0xc3, 0xc4, 0xc9,
  0xc3, 0x40, 0x85, 0x95, 0x83, 0x96, 0x84, 0x89, 0x95, 0x87, 0x4b,
]);

// "Héllo wörld, tëst dàta wïth äccénts.".encode("iso-8859-1")
function bytes(s: string): Uint8Array {
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
const _LATIN_TEXT = bytes('H\xe9llo w\xf6rld, t\xebst d\xe0ta w\xefth \xe4cc\xe9nts.');

// "これはテストです。日本語のテキストです。".encode("shift_jis")
const _SHIFT_JIS_TEXT = new Uint8Array([
  0x82, 0xb1, 0x82, 0xea, 0x82, 0xcd, 0x83, 0x65, 0x83, 0x58, 0x83, 0x67,
  0x82, 0xc5, 0x82, 0xb7, 0x81, 0x42, 0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea,
  0x82, 0xcc, 0x83, 0x65, 0x83, 0x4c, 0x83, 0x58, 0x83, 0x67, 0x82, 0xc5,
  0x82, 0xb7, 0x81, 0x42,
]);

// "这是一个测试。中文文本应该被正确检测。".encode("GB18030")
const _GB18030_TEXT = new Uint8Array([
  0xd5, 0xe2, 0xca, 0xc7, 0xd2, 0xbb, 0xb8, 0xf6, 0xb2, 0xe2, 0xca, 0xd4,
  0xa1, 0xa3, 0xd6, 0xd0, 0xce, 0xc4, 0xce, 0xc4, 0xb1, 0xbe, 0xd3, 0xa6,
  0xb8, 0xc3, 0xb1, 0xbb, 0xd5, 0xfd, 0xc8, 0xb7, 0xbc, 0xec, 0xb2, 0xe2,
  0xa1, 0xa3,
]);

// "이것은 테스트입니다. 한국어 텍스트입니다.".encode("euc-kr")
const _EUC_KR_TEXT = new Uint8Array([
  0xc0, 0xcc, 0xb0, 0xcd, 0xc0, 0xba, 0x20, 0xc5, 0xd7, 0xbd, 0xba, 0xc6,
  0xae, 0xc0, 0xd4, 0xb4, 0xcf, 0xb4, 0xd9, 0x2e, 0x20, 0xc7, 0xd1, 0xb1,
  0xb9, 0xbe, 0xee, 0x20, 0xc5, 0xd8, 0xbd, 0xba, 0xc6, 0xae, 0xc0, 0xd4,
  0xb4, 0xcf, 0xb4, 0xd9, 0x2e,
]);

test('ebcdic not detected as gb18030', () => {
  const result = runPipeline(_EBCDIC_HELLO, EncodingEra.ALL);
  expect(result[0].encoding).not.toBe('gb18030');
});

test('latin text not detected as cp932', () => {
  const result = runPipeline(_LATIN_TEXT, EncodingEra.ALL);
  expect(result[0].encoding).not.toBe('cp932');
});

test('real cjk still detected', () => {
  const result = runPipeline(_SHIFT_JIS_TEXT, EncodingEra.ALL);
  expect(new Set(['shift_jis_2004', 'cp932']).has(result[0].encoding!)).toBe(true);
});

test('real chinese still detected', () => {
  const result = runPipeline(_GB18030_TEXT, EncodingEra.ALL);
  expect(_CJK_ENCODINGS.has(result[0].encoding!)).toBe(true);
});

test('real korean still detected', () => {
  const result = runPipeline(_EUC_KR_TEXT, EncodingEra.ALL);
  expect(_CJK_ENCODINGS.has(result[0].encoding!)).toBe(true);
});

test('german macroman not detected as cjk', () => {
  const result = detect(macromanDeSample, { encodingEra: EncodingEra.ALL, compatNames: false });
  expect(_CJK_ENCODINGS.has(result.encoding!)).toBe(false);
});
