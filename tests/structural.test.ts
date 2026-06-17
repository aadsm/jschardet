// Port of chardet/tests/test_structural.py.

import { PipelineContext } from '../src/pipeline/index.js';
import {
  _analyzeBig5,
  _analyzeBig5hkscs,
  _analyzeCp932,
  _analyzeCp949,
  _analyzeEucKr,
  _analyzeShiftJis,
  computeLeadByteDiversity,
  computeMultibyteByteCoverage,
  computeStructuralScore,
} from '../src/pipeline/structural.js';
import { REGISTRY } from '../src/registry.js';

// Bytes generated from Python's str.encode() for each fixture (parity with
// chardet/tests/test_structural.py). See /tmp/gen_structural_fixtures.py.
const KONNICHIWA_SEKAI_SJIS = new Uint8Array([
  0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd, 0x90, 0xa2, 0x8a, 0x45,
]);
const KONNICHIWA_SEKAI_EUCJP = new Uint8Array([
  0xa4, 0xb3, 0xa4, 0xf3, 0xa4, 0xcb, 0xa4, 0xc1, 0xa4, 0xcf, 0xc0, 0xa4, 0xb3, 0xa6,
]);
const ANNYEONG_EUCKR = new Uint8Array([
  0xbe, 0xc8, 0xb3, 0xe7, 0xc7, 0xcf, 0xbc, 0xbc, 0xbf, 0xe4,
]);
const NIHAO_SHIJIE_GB18030 = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3, 0xca, 0xc0, 0xbd, 0xe7]);
const NIHAO_SHIJIE_BIG5 = new Uint8Array([0xa7, 0x41, 0xa6, 0x6e, 0xa5, 0x40, 0xac, 0xc9]);
const NIHAO_BIG5 = new Uint8Array([0xa7, 0x41, 0xa6, 0x6e]);
const BIG5HKSCS_TEST = new Uint8Array([
  0xa7, 0x41, 0xa6, 0x6e, 0xa5, 0x40, 0xac, 0xc9, 0xb4, 0xfa, 0xb8, 0xd5, 0xb8, 0xea, 0xae, 0xc6,
]);
const EUC_JIS_2004_TEST = new Uint8Array([
  0xa4, 0xb3, 0xa4, 0xf3, 0xa4, 0xcb, 0xa4, 0xc1, 0xa4, 0xcf, 0xc0, 0xa4, 0xb3, 0xa6,
  0xa5, 0xc6, 0xa5, 0xb9, 0xa5, 0xc8,
]);
const SHIFT_JIS_2004_TEST = new Uint8Array([
  0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd, 0x90, 0xa2, 0x8a, 0x45,
  0x83, 0x65, 0x83, 0x58, 0x83, 0x67,
]);

function ctx(): PipelineContext {
  return new PipelineContext();
}

test('shift_jis scores high on shift_jis data', () => {
  const score = computeStructuralScore(KONNICHIWA_SEKAI_SJIS, REGISTRY['shift_jis_2004'], ctx());
  expect(score).toBeGreaterThan(0.7);
});

test('euc_jp scores high on euc_jp data', () => {
  const score = computeStructuralScore(KONNICHIWA_SEKAI_EUCJP, REGISTRY['euc_jis_2004'], ctx());
  expect(score).toBeGreaterThan(0.7);
});

test('shift_jis scores lower than euc_jp on euc_jp data', () => {
  const c = ctx();
  const eucScore = computeStructuralScore(KONNICHIWA_SEKAI_EUCJP, REGISTRY['euc_jis_2004'], c);
  const sjisScore = computeStructuralScore(KONNICHIWA_SEKAI_EUCJP, REGISTRY['shift_jis_2004'], c);
  expect(eucScore).toBeGreaterThan(sjisScore);
});

test('euc_kr scores high on Korean data', () => {
  const score = computeStructuralScore(ANNYEONG_EUCKR, REGISTRY['euc_kr'], ctx());
  expect(score).toBeGreaterThan(0.7);
});

test('gb18030 scores high on Chinese data', () => {
  const score = computeStructuralScore(NIHAO_SHIJIE_GB18030, REGISTRY['gb18030'], ctx());
  expect(score).toBeGreaterThan(0.7);
});

test('big5 scores high on big5 data (via big5hkscs registry entry)', () => {
  const score = computeStructuralScore(NIHAO_SHIJIE_BIG5, REGISTRY['big5hkscs'], ctx());
  expect(score).toBeGreaterThan(0.7);
});

test('big5 trailing lone lead byte does not crash', () => {
  // Append 0xA5 — a Big5 lead byte with no trail.
  const data = new Uint8Array(NIHAO_BIG5.length + 1);
  data.set(NIHAO_BIG5);
  data[data.length - 1] = 0xa5;
  const [ratio, mb] = _analyzeBig5(data);
  expect(ratio).toBeGreaterThan(0);
  expect(mb).toBeGreaterThan(0);
});

test('single-byte encoding returns zero', () => {
  const data = new TextEncoder().encode('Hello world');
  const score = computeStructuralScore(data, REGISTRY['iso8859-1'], ctx());
  expect(score).toBe(0.0);
});

test('empty data returns zero', () => {
  const score = computeStructuralScore(new Uint8Array(0), REGISTRY['shift_jis_2004'], ctx());
  expect(score).toBe(0.0);
});

test('big5hkscs scores high on Big5-HKSCS data', () => {
  const score = computeStructuralScore(BIG5HKSCS_TEST, REGISTRY['big5hkscs'], ctx());
  expect(score).toBeGreaterThan(0.7);
});

test('euc_jis_2004 scores high on EUC-JIS-2004 data', () => {
  const score = computeStructuralScore(EUC_JIS_2004_TEST, REGISTRY['euc_jis_2004'], ctx());
  expect(score).toBeGreaterThan(0.7);
});

test('shift_jis_2004 scores high on Shift-JIS-2004 data', () => {
  const score = computeStructuralScore(SHIFT_JIS_2004_TEST, REGISTRY['shift_jis_2004'], ctx());
  expect(score).toBeGreaterThan(0.7);
});

test('euc_jp SS2 with invalid trail does not count as valid', () => {
  const data = new Uint8Array([0x8e, 0x20]);
  const score = computeStructuralScore(data, REGISTRY['euc_jis_2004'], ctx());
  expect(score).toBe(0.0);
});

test('euc_jp SS3 with valid 3-byte sequence', () => {
  const data = new Uint8Array(15);
  for (let i = 0; i < 5; i++) {
    data[i * 3] = 0x8f; data[i * 3 + 1] = 0xa1; data[i * 3 + 2] = 0xa1;
  }
  const score = computeStructuralScore(data, REGISTRY['euc_jis_2004'], ctx());
  expect(score).toBeGreaterThan(0.0);
});

test('euc_jp SS3 with invalid trails does not count as valid', () => {
  const data = new Uint8Array([0x8f, 0xa1, 0x20]);
  const score = computeStructuralScore(data, REGISTRY['euc_jis_2004'], ctx());
  expect(score).toBe(0.0);
});

test('multibyte byte coverage on all-ASCII data is zero', () => {
  const data = new TextEncoder().encode('Hello world plain ASCII');
  const coverage = computeMultibyteByteCoverage(data, REGISTRY['shift_jis_2004'], ctx(), 0);
  expect(coverage).toBe(0.0);
});

test('lead byte diversity on empty data is zero', () => {
  const diversity = computeLeadByteDiversity(new Uint8Array(0), REGISTRY['shift_jis_2004'], ctx());
  expect(diversity).toBe(0);
});

test('coverage with no analyzer returns zero', () => {
  const coverage = computeMultibyteByteCoverage(
    new Uint8Array([0x80, 0x81, 0x82]), REGISTRY['hz'], ctx(), 3,
  );
  expect(coverage).toBe(0.0);
});

test('diversity with no analyzer returns 256', () => {
  const diversity = computeLeadByteDiversity(new Uint8Array([0x80, 0x81]), REGISTRY['hz'], ctx());
  expect(diversity).toBe(256);
});

test('coverage on single-byte encoding is zero', () => {
  const coverage = computeMultibyteByteCoverage(
    new Uint8Array([0xc0, 0xc1, 0xc2]), REGISTRY['iso8859-1'], ctx(), 3,
  );
  expect(coverage).toBe(0.0);
});

test('euc_jp SS2 valid sequences score 1.0', () => {
  const seq = [0x8e, 0xa1, 0x8e, 0xb0, 0x8e, 0xdf];
  const data = new Uint8Array(seq.length * 3);
  for (let i = 0; i < 3; i++) data.set(seq, i * seq.length);
  const score = computeStructuralScore(data, REGISTRY['euc_jis_2004'], ctx());
  expect(score).toBe(1.0);
});

test('euc_jp SS2 contributes to multibyte byte coverage', () => {
  const data = new Uint8Array([0x8e, 0xa1, 0x8e, 0xb0, 0x8e, 0xdf]);
  const coverage = computeMultibyteByteCoverage(data, REGISTRY['euc_jis_2004'], ctx(), 6);
  expect(coverage).toBe(1.0);
});

test('johab lead byte with invalid trail falls through', () => {
  const data = new Uint8Array([0x84, 0x20, 0x84, 0x0f, 0x84, 0x7f]);
  const score = computeStructuralScore(data, REGISTRY['johab'], ctx());
  expect(score).toBe(0.0);
});

test('johab lead byte at end of data falls through', () => {
  const data = new Uint8Array([0x84]);
  const score = computeStructuralScore(data, REGISTRY['johab'], ctx());
  expect(score).toBe(0.0);
});

// --- Direct analyzer tests (extension byte recognition, fallthrough) ---

test('cp932 recognizes extended lead bytes 0xF0-0xFC', () => {
  const data = new Uint8Array([0xf0, 0x40, 0xf5, 0x80, 0xfc, 0x40]);
  const [ratio, mb, diversity] = _analyzeCp932(data);
  expect(ratio).toBe(1.0);
  expect(diversity).toBe(3);
  // 0xF0+0x40: lead=1, trail<0x80=0 -> 1; 0xF5+0x80: 1+1=2; 0xFC+0x40: 1+0=1.
  expect(mb).toBe(4);
});

test('shift_jis does not recognize cp932 extended leads', () => {
  const data = new Uint8Array([0xf0, 0x40, 0xf5, 0x80, 0xfc, 0x40]);
  const [ratio, mb, diversity] = _analyzeShiftJis(data);
  expect(ratio).toBe(0.0);
  expect(mb).toBe(0);
  expect(diversity).toBe(0);
});

test('cp932 half-width katakana are not lead bytes', () => {
  const data = new Uint8Array([0xa1, 0xa2, 0xa3, 0xb0, 0xdf]);
  const [ratio, mb, diversity] = _analyzeCp932(data);
  expect(ratio).toBe(0.0);
  expect(mb).toBe(0);
  expect(diversity).toBe(0);
});

test('cp932 mb_bytes: low trail counts 1, high trail counts 2', () => {
  const [, mbLow] = _analyzeCp932(new Uint8Array([0xf0, 0x40]));
  expect(mbLow).toBe(1);
  const [, mbHigh] = _analyzeCp932(new Uint8Array([0xf0, 0x80]));
  expect(mbHigh).toBe(2);
});

test('cp932 standard shift_jis range still works in both analyzers', () => {
  const data = new Uint8Array([0x81, 0x40, 0x9f, 0x7e, 0xe0, 0x80]);
  const [sjisRatio] = _analyzeShiftJis(data);
  const [cp932Ratio] = _analyzeCp932(data);
  expect(sjisRatio).toBe(1.0);
  expect(cp932Ratio).toBe(1.0);
});

test('cp949 recognizes UHC extension bytes', () => {
  const data = new Uint8Array([0x81, 0x41, 0x90, 0x61, 0xa0, 0x5a]);
  const [ratio, mb, diversity] = _analyzeCp949(data);
  expect(ratio).toBe(1.0);
  expect(diversity).toBe(3);
  expect(mb).toBe(3);
});

test('euc_kr does not recognize UHC extension', () => {
  const data = new Uint8Array([0x81, 0x41, 0x90, 0x61, 0xa0, 0x5a]);
  const [ratio, mb, diversity] = _analyzeEucKr(data);
  expect(ratio).toBe(0.0);
  expect(mb).toBe(0);
  expect(diversity).toBe(0);
});

test('cp949 skips 0xC9 lead byte', () => {
  const data = new Uint8Array([0xc9, 0xa1]);
  const [ratio, mb, diversity] = _analyzeCp949(data);
  expect(ratio).toBe(0.0);
  expect(mb).toBe(0);
  expect(diversity).toBe(0);
});

test('cp949 standard euc_kr range still works in both analyzers', () => {
  const data = new Uint8Array([0xa1, 0xa1, 0xb0, 0xfe, 0xfd, 0xa1]);
  const [eucRatio] = _analyzeEucKr(data);
  const [cp949Ratio] = _analyzeCp949(data);
  expect(eucRatio).toBe(1.0);
  expect(cp949Ratio).toBe(1.0);
});

test('cp949 mb_bytes: ASCII trail counts 1, high trail counts 2', () => {
  const [, mbLow] = _analyzeCp949(new Uint8Array([0x81, 0x41]));
  expect(mbLow).toBe(1);
  const [, mbHigh] = _analyzeCp949(new Uint8Array([0x81, 0xa1]));
  expect(mbHigh).toBe(2);
});

test('big5hkscs recognizes extended lead bytes', () => {
  const data = new Uint8Array([0x87, 0x40, 0x90, 0xa1, 0xfa, 0x7e, 0xfe, 0xfe]);
  const [ratio, mb, diversity] = _analyzeBig5hkscs(data);
  expect(ratio).toBe(1.0);
  expect(diversity).toBe(4);
  expect(mb).toBe(6);
});

test('big5 does not recognize hkscs extension', () => {
  const data = new Uint8Array([0x87, 0x41, 0x90, 0x42, 0xfa, 0x43, 0xfe, 0x44]);
  const [ratio, mb, diversity] = _analyzeBig5(data);
  expect(ratio).toBe(0.0);
  expect(mb).toBe(0);
  expect(diversity).toBe(0);
});

test('big5hkscs standard big5 range still works in both analyzers', () => {
  const data = new Uint8Array([0xa1, 0x40, 0xc0, 0x7e, 0xf9, 0xfe]);
  const [big5Ratio] = _analyzeBig5(data);
  const [hkscsRatio] = _analyzeBig5hkscs(data);
  expect(big5Ratio).toBe(1.0);
  expect(hkscsRatio).toBe(1.0);
});

test('big5hkscs mb_bytes: low trail counts 1, high trail counts 2', () => {
  const [, mbLow] = _analyzeBig5hkscs(new Uint8Array([0x87, 0x40]));
  expect(mbLow).toBe(1);
  const [, mbHigh] = _analyzeBig5hkscs(new Uint8Array([0x87, 0xa1]));
  expect(mbHigh).toBe(2);
});

test('cp932 lead byte at end of data falls through', () => {
  const [ratio, mb, diversity] = _analyzeCp932(new Uint8Array([0xf0]));
  expect(ratio).toBe(0.0);
  expect(mb).toBe(0);
  expect(diversity).toBe(0);
});

test('cp949 lead byte at end of data falls through', () => {
  const [ratio, mb, diversity] = _analyzeCp949(new Uint8Array([0x81]));
  expect(ratio).toBe(0.0);
  expect(mb).toBe(0);
  expect(diversity).toBe(0);
});

test('big5hkscs lead byte at end of data falls through', () => {
  const [ratio, mb, diversity] = _analyzeBig5hkscs(new Uint8Array([0x87]));
  expect(ratio).toBe(0.0);
  expect(mb).toBe(0);
  expect(diversity).toBe(0);
});
