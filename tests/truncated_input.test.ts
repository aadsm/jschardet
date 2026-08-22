// Port of chardet/tests/test_truncated_input.py.
//
// Detection must be stable when the input is a prefix of a larger whole.
//
// Callers routinely detect on a slice — an editor reads the first 4 kB or
// 64 kB of a file and hands over the buffer — and chardet slices further on
// its own, data[:max_bytes] in the orchestrator and data[:_SCAN_LIMIT] in
// markup's _validateBytes. For a two-byte encoding any of those cuts lands
// mid-character about half the time.
//
// A one-shot strict decode cannot tell a truncated tail from corrupt data, so
// a single dangling lead byte would drop every CJK candidate and the answer
// would come down to input-length parity. decodesWithoutError defers the
// partial tail instead — see "Truncation-tolerant validity decoding" in
// docs/port-notes.md.

import { DEFAULT_MAX_BYTES, detect } from '../src/chardet.js';
import { EncodingEra } from '../src/enums.js';
import { detectMarkupCharset } from '../src/pipeline/markup.js';
import { filterByValidity } from '../src/pipeline/validity.js';
import { getCandidates } from '../src/registry.js';
import { danglingTailWithAsciiPrefix, decoderForLabel, decodesCompletely, decodesWithoutError, whatwgLabelFor } from '../src/text-decoder.js';
import { _decodesUnderPublicNames } from '../src/pipeline/postprocess.js';
import { UniversalDetector } from '../src/detector.js';

function hex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

function repeatBytes(arr: Uint8Array, times: number): Uint8Array {
  const out = new Uint8Array(arr.length * times);
  for (let i = 0; i < times; i++) out.set(arr, i * arr.length);
  return out;
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

// The Python source encodes these sentences at runtime. Node exposes
// TextDecoder for legacy labels but no symmetric encoder, so the bytes are
// inlined (see "Byte literals in test ports" in docs/port-notes.md) —
// generated with iconv-lite and verified byte-identical to Python's
// .encode() for each codec.
const _ZH = '這是一個用於測試編碼偵測的中文句子，內容足夠長以便統計模型能夠正確判斷。';

// _ZH.encode("gbk")
const _ZH_GBK = hex(
  'df40cac7d2bb8280d3c3ecb69c79d487be8eb46182c99c79b5c4d6d0cec4bee4' +
  'd7d3a3ac83c8c8ddd7e389f2e94cd2d4b1e3bd79d38bc4a3d0cdc4dc89f2d5fd' +
  'b45fc5d094e0a1a3',
);
// _ZH.encode("big5")
const _ZH_BIG5 = hex(
  'b36fac4fa440add3a5cea9f3b4fab8d5bd73bd58b0bbb4faaabaa4a4a4e5a579' +
  'a46ca141a4baae65a8acb0f7aaf8a548ab4bb2cead70bcd2abacafe0b0f7a5bf' +
  'bd54a750c25fa143',
);
// _JA.encode("shift_jis"), _JA = 'これは文字コード判定のテストに用いる日本語の文章です。統計モデルが正しく判定できる長さにしています。'
const _JA_SHIFT_JIS = hex(
  '82b182ea82cd95b68e9a8352815b836894bb92e882cc83658358836782c99770' +
  '82a282e993fa967b8cea82cc95b68fcd82c582b78142939d8c7683828366838b' +
  '82aa90b382b582ad94bb92e882c582ab82e992b782b382c982b582c482a282dc' +
  '82b78142',
);
// _JA.encode("euc_jp")
const _JA_EUC_JP = hex(
  'a4b3a4eca4cfcab8bbfaa5b3a1bca5c9c8bdc4eaa4cea5c6a5b9a5c8a4cbcdd1' +
  'a4a4a4ebc6fccbdcb8eca4cecab8becfa4c7a4b9a1a3c5fdb7d7a5e2a5c7a5eb' +
  'a4acc0b5a4b7a4afc8bdc4eaa4c7a4ada4ebc4b9a4b5a4cba4b7a4c6a4a4a4de' +
  'a4b9a1a3',
);
// _KO.encode("euc_kr"), _KO = '이것은 문자 인코딩 감지를 테스트하기 위한 한국어 문장입니다. 통계 모델이 올바르게 판단할 수 있을 만큼 충분히 깁니다.'
const _KO_EUC_KR = hex(
  'c0ccb0cdc0ba20b9aec0da20c0cec4dab5f920b0a8c1f6b8a620c5d7bdbac6ae' +
  'c7cfb1e220c0a7c7d120c7d1b1b9beee20b9aec0e5c0d4b4cfb4d92e20c5ebb0' +
  'e820b8f0b5a8c0cc20bfc3b9d9b8a3b0d420c6c7b4dcc7d220bcf620c0d6c0bb' +
  '20b8b8c5ad20c3e6bad0c8f720b1e9b4cfb4d92e',
);

// One entry per multi-byte family. The expected value is a prefix match rather
// than an exact name because a superset (gb18030 for gbk, cp932 for shift_jis,
// cp949 for euc_kr) is an equally correct answer — the point is that the
// family survives, not which member wins.
const _MULTIBYTE_SAMPLES: ReadonlyArray<{
  name: string;
  data: Uint8Array;
  expected: readonly string[];
}> = [
  { name: 'gbk', data: repeatBytes(_ZH_GBK, 4), expected: ['gb'] },
  { name: 'big5', data: repeatBytes(_ZH_BIG5, 4), expected: ['big5'] },
  { name: 'shift_jis', data: repeatBytes(_JA_SHIFT_JIS, 4), expected: ['shift_jis', 'cp932'] },
  { name: 'euc_jp', data: repeatBytes(_JA_EUC_JP, 4), expected: ['euc-jp', 'euc_jp'] },
  { name: 'euc_kr', data: repeatBytes(_KO_EUC_KR, 4), expected: ['euc-kr', 'euc_kr', 'cp949'] },
  { name: 'utf-8', data: repeatBytes(new TextEncoder().encode(_ZH), 4), expected: ['utf-8'] },
];

// Four consecutive prefixes cover every byte-boundary offset for encodings up
// to four bytes per character, so at least one prefix per run cuts
// mid-character.
const _PREFIX_OFFSETS = [0, 1, 2, 3, 4];

describe('detection is stable across truncated prefixes', () => {
  test.each(_MULTIBYTE_SAMPLES)('$name', ({ name, data, expected }) => {
    for (const offset of _PREFIX_OFFSETS) {
      const prefix = data.subarray(0, data.length - offset);
      const result = detect(prefix, { encodingEra: EncodingEra.ALL });
      const encoding = (result.encoding ?? '').toLowerCase();
      expect(
        expected.some(e => encoding.startsWith(e)),
        `${name} minus ${offset} byte(s) detected as ${result.encoding}`,
      ).toBe(true);
    }
  });
});

test('truncated tail keeps encoding as candidate', () => {
  const data = repeatBytes(_ZH_GBK, 4).subarray(0, _ZH_GBK.length * 4 - 1);
  const candidates = getCandidates(EncodingEra.ALL).filter(e => e.name.startsWith('gb'));
  expect(candidates.length).toBeGreaterThan(0);
  expect(filterByValidity(data, candidates).length).toBeGreaterThan(0);
});

// These three assert on the gb18030 label, where Python's test uses its gbk
// codec. The port has no gbk label — ENCODING_WHATWG_MAP routes the whole GB
// family through gb18030, which is also what the WHATWG Encoding Standard
// does (GBK's decoder *is* gb18030's decoder). Passing 'gbk' here would test a
// label no call site can produce, and Node <= 20's gbk decoder accepts these
// invalid bytes rather than rejecting them. See "Truncation-tolerant validity
// decoding" in docs/port-notes.md.
test('illegal trail byte still eliminates encoding', () => {
  // 0xD6 is a valid GB lead byte; 0x20 is not a valid trail byte.
  expect(decodesWithoutError('gb18030', hex('d5e2cac7d620'))).toBe(false);
});

test('unmapped bytes still eliminate encoding', () => {
  expect(decodesWithoutError('gb18030', hex('d5e2cac7ffff'))).toBe(false);
});

test('corruption before a truncated tail is still caught', () => {
  // Corrupt pair mid-buffer, then a dangling lead byte at the end. Tolerating
  // the tail must not tolerate the corruption ahead of it.
  expect(decodesWithoutError('gb18030', hex('d5e2ffffd2bbd6'))).toBe(false);
});

test('markup declaration survives the scan limit cut', () => {
  // A complete, well-formed page with an honest declaration. _validateBytes
  // slices its own 4 kB head, and one byte of padding decides whether that cut
  // lands mid-character — which must not change the answer. (Python also
  // asserts _validate_bytes directly; here detectMarkupCharset returning
  // non-null subsumes it, since _validateBytes is not exported.)
  const body = repeatBytes(_ZH_GBK, 200);
  for (const pad of [0, 1]) {
    const data = concat(
      new TextEncoder().encode('<meta charset="gbk">'),
      new Uint8Array(pad).fill(0x20),
      body,
    );
    const result = detectMarkupCharset(data);
    expect(result, `pad=${pad} rejected an honest declaration`).not.toBeNull();
    expect(result!.mimeType).toBe('text/html');
  }
});

test('detection survives the max bytes cut', () => {
  // Likewise for the orchestrator's own data[:max_bytes] slice, on a complete
  // file larger than that limit.
  const data = repeatBytes(_ZH_GBK, Math.floor(DEFAULT_MAX_BYTES / _ZH_GBK.length) + 200);
  expect(data.length).toBeGreaterThan(DEFAULT_MAX_BYTES);
  for (const pad of [0, 1]) {
    const padded = concat(new Uint8Array(pad).fill(0x20), data);
    const result = detect(padded, { encodingEra: EncodingEra.ALL });
    expect(
      (result.encoding ?? '').toLowerCase().startsWith('gb'),
      `pad=${pad} detected as ${result.encoding}`,
    ).toBe(true);
  }
});

// No Python counterpart — guards a TextDecoder-specific hazard of the
// { stream: true } implementation.
test('a deferred partial tail does not leak into the shared decoder cache', () => {
  // decodesWithoutError decodes with { stream: true } against a cached — and
  // therefore stateful — TextDecoder, which markup and utf1632 also pull text
  // from. Without the flush, the pending lead byte from a truncated validity
  // check is prepended to the next buffer, shifting every subsequent character
  // pair. That corrupts silently: the decode still succeeds, it just returns
  // the wrong text.
  const truncated = _ZH_GBK.subarray(0, _ZH_GBK.length - 1);
  expect(decodesWithoutError('gbk', truncated)).toBe(true);

  const expected = new TextDecoder('gbk', { fatal: true }).decode(_ZH_GBK);
  expect(decoderForLabel('gbk').decode(_ZH_GBK)).toBe(expected);
});

// ---- Decode-safety additions (chardet issue #380) ----

// The strict sibling: same bytes, final=true flips the verdict.
test('decodesCompletely rejects the tail-tolerance gap', () => {
  const dangling = hex('6d616de1'); // "mamá".encode("iso-8859-1"), lone 0xE1 lead
  expect(decodesWithoutError(whatwgLabelFor('utf-8')!, dangling)).toBe(true);
  expect(decodesCompletely(whatwgLabelFor('utf-8')!, dangling)).toBe(false);
  expect(decodesCompletely(whatwgLabelFor('cp1250')!, dangling)).toBe(true);
});

// The flip's evidence test: non-empty ASCII prefix plus a deferred tail.
// b"mam\xe1" decodes to ASCII "mam" with 0xE1 deferred: true. A clipped
// emoji is one dangling sequence with *nothing* decoded, which is zero
// evidence rather than ASCII evidence: false. A mid-cut CJK fragment
// decodes real multi-byte characters first: false.
test('danglingTailWithAsciiPrefix classifies evidence', () => {
  const utf8 = whatwgLabelFor('utf-8')!;
  expect(danglingTailWithAsciiPrefix(utf8, hex('6d616de1'))).toBe(true);
  expect(danglingTailWithAsciiPrefix(utf8, hex('f09f98'))).toBe(false);
  const cjk = _JA_SHIFT_JIS.subarray(0, _JA_SHIFT_JIS.length - 1);
  expect(danglingTailWithAsciiPrefix(whatwgLabelFor('shift_jis_2004')!, cjk)).toBe(false);
  // Complete input has no deferred tail, so it is not a dangling shape.
  expect(danglingTailWithAsciiPrefix(utf8, new TextEncoder().encode('mama'))).toBe(false);
});

// A rival must decode under the name the caller will actually use. Python
// proves the euc_jis_2004/EUC-JP split with its own codecs; WHATWG
// collapses euc_jis_2004 onto the euc-jp decoder, so here the internal and
// public names are the *same* decoder and both reject the JIS X 0213 pair
// — the promotion is refused either way, which is the invariant that
// matters (see "bytes.decode() validity filtering" in docs/architecture.md).
test('flip verifies the public name too', () => {
  const data = hex('68656c6c6f20a2af'); // b"hello \xa2\xaf"
  expect(decodesCompletely(whatwgLabelFor('euc_jis_2004')!, data)).toBe(false);
  expect(_decodesUnderPublicNames(data, 'euc_jis_2004')).toBe(false);
});

// When chardet itself sliced, a dangling tail is chardet's own cut. The
// same four bytes that flip to a decodable Latin answer as complete input
// stay utf-8 when they are a maxBytes slice of longer data — the caller's
// input goes on past the cut, so the strict-decode question does not apply
// to the slice.
//
// The utf-8 assertion pins the current statistical coin flip over the
// Latin candidates deliberately: it is the only observable difference from
// the complete-input path (which flips to Windows-1250). If a model
// retrain moves the coin flip, update the string here, not the invariant.
test('internal slicing keeps the prefix tolerance', () => {
  // "mamá mamá mamá".encode("iso-8859-1")
  const data = hex('6d616de1206d616de1206d616de1');
  const result = detect(data, { maxBytes: 4 });
  expect(result.encoding).toBe('utf-8');
});

// Retrain-proof variant: sliced utf-8 keeps utf-8 via structure alone.
test('internal slicing tolerance is structural too', () => {
  const data = new TextEncoder().encode('héllo wörld '.repeat(50));
  let cut = 100;
  while (data[cut - 1] < 0x80) cut += 1; // land the slice mid-character
  const result = detect(data, { maxBytes: cut });
  expect(result.encoding).toBe('utf-8');
});

// UniversalDetector's cap is chardet-made truncation. feed() stops at
// exactly maxBytes, so the pipeline cannot see the cut in data.length; the
// detector must say so itself. Overflowed streams keep the tolerance and
// agree with detect() on the same call, and an exactly-filled buffer with
// nothing dropped counts as complete, also agreeing with detect().
test('streaming buffer cap keeps the prefix tolerance', () => {
  const data = hex('6d616de1206d616de1206d616de1');

  const overflowed = new UniversalDetector({ maxBytes: 4 });
  overflowed.feed(data);
  expect(overflowed.close().encoding).toBe(detect(data, { maxBytes: 4 }).encoding);

  const exact = new UniversalDetector({ maxBytes: 4 });
  exact.feed(hex('6d616de1'));
  expect(exact.close().encoding).toBe(detect(hex('6d616de1'), { maxBytes: 4 }).encoding);
});

// reset() must clear the truncation memory along with the buffer.
test('streaming truncation flag resets', () => {
  const det = new UniversalDetector({ maxBytes: 4 });
  det.feed(hex('6d616de1206d616de1')); // "mamá mamá"
  det.close();
  det.reset();
  det.feed(hex('6d616de1'));
  const result = det.close();
  expect(result.encoding).toBe(detect(hex('6d616de1'), { maxBytes: 4 }).encoding);
});

// A mid-character CJK cut must not flip to a low-confidence Latin codec.
// The guard is evidence, not confidence: a CJK winner has decoded real
// multi-byte characters before the cut, so its tolerant decode is not pure
// ASCII and the decode-safety flip never touches it.
test('truncated cjk chunk keeps its answer', () => {
  let chunk = repeatBytes(_JA_SHIFT_JIS, 8);
  const sjLabel = whatwgLabelFor('shift_jis_2004')!;
  while (decodesCompletely(sjLabel, chunk)) {
    chunk = chunk.subarray(0, chunk.length - 1);
  }
  const result = detect(chunk, { encodingEra: EncodingEra.ALL });
  const enc = (result.encoding ?? '').toLowerCase();
  expect(enc.startsWith('shift_jis') || enc.startsWith('cp932')).toBe(true);
});
