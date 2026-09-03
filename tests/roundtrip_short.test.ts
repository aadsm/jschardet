// Port of chardet/tests/test_roundtrip_short.py.
//
// Encode -> detect -> decode must not raise for short whole strings.
//
// The contract under test (chardet issue #380): when a caller hands chardet
// a complete short string, decoding with the reported encoding succeeds. It
// is *not* a fidelity guarantee — a sibling codec may decode the bytes to
// different text — and it deliberately excludes fragments cut mid-character,
// where the correct answer is an encoding that cannot decode the input and
// correctness wins (see truncated_input.test.ts).
//
// Three populations, all measured upstream before these tests were written:
// ASCII-dominant strings ending in an accented letter (the dangling-tail
// bait, guaranteed by the decode-safety flip), fully non-ASCII whole words
// in single-byte scripts (naturally safe), and whole CJK strings at
// character boundaries (naturally safe).
//
// Byte fixtures are Python's encodes of the upstream strings (the source of
// truth for the codec tables); iconv-lite stands in for Python's decode.

import { detect } from '../src/chardet.js';
import * as iconv from 'iconv-lite';
import { REGISTRY, lookupEncoding } from '../src/registry.js';
import { decodesAsSingleByte } from '../src/pipeline/byte-decode.js';

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// [source encoding, text, Python `text.encode(encoding)` bytes]
const ALL: Array<[string, string, string]> = [
  ['windows-1252', 'mamá', '6d616de1'],
  ['windows-1252', 'papa ané', '7061706120616ee9'],
  ['windows-1252', 'cafe olé', '63616665206f6ce9'],
  ['iso-8859-1', 'mamá', '6d616de1'],
  ['iso-8859-1', 'the fox jumps ß', '74686520666f78206a756d707320df'],
  ['windows-1250', 'pan kůň', '70616e206bf9f2'],
  ['iso-8859-2', 'hello pané', '68656c6c6f2070616ee9'],
  ['windows-1254', 'pasha çabuş', '706173686120e7616275fe'],
  ['iso-8859-9', 'hello efendı', '68656c6c6f206566656e64fd'],
  ['mac-roman', 'voila déjà', '766f696c6120648e6a88'],
  ['windows-1253', 'hello κό', '68656c6c6f20eafc'],
  ['iso-8859-7', 'abc δώ', '61626320e4fe'],
  ['windows-1251', 'hello миря', '68656c6c6f20ece8f0ff'],
  ['iso-8859-5', 'abc покой', '61626320dfdedaded9'],
  ['koi8-r', 'hello миря', '68656c6c6f20cdc9d2d1'],
  ['cp866', 'hello мир', '68656c6c6f20aca8e0'],
  ['windows-1255', 'abc שלום', '61626320f9ece5ed'],
  ['windows-1256', 'abc مرحبا', '61626320e3d1cdc8c7'],
  ['windows-1251', 'привет мир', 'eff0e8e2e5f220ece8f0'],
  ['windows-1251', 'хорошо очень', 'f5eef0eef8ee20eef7e5edfc'],
  ['koi8-r', 'молоко', 'cdcfcccfcbcf'],
  ['cp866', 'вода', 'a2aea4a0'],
  ['iso-8859-7', 'καλημέρα', 'eae1ebe7ecddf1e1'],
  ['windows-1253', 'ευχαριστώ πολύ', 'e5f5f7e1f1e9f3f4fe20f0efebfd'],
  ['windows-1255', 'תודה רבה', 'fae5e3e420f8e1e4'],
  ['windows-1256', 'صباح الخير', 'd5c8c7cd20c7e1ceedd1'],
  ['cp874', 'สวัสดี', 'cac7d1cab4d5'],
  ['windows-1252', 'café', '636166e9'],
  ['windows-1252', 'niño año', '6e69f16f2061f16f'],
  ['iso-8859-2', 'žlutý kůň', 'be6c7574fd206bf9f2'],
  ['iso-8859-2', 'čeština', 'e865b974696e61'],
  ['shift_jis', 'こんにちは', '82b182f182c982bf82cd'],
  ['cp932', 'ありがとう', '82a082e882aa82c682a4'],
  ['euc-jp', 'こんにちは', 'a4b3a4f3a4cba4c1a4cf'],
  ['euc-kr', '안녕하세요', 'bec8b3e7c7cfbcbcbfe4'],
  ['cp949', '감사합니다', 'b0a8bbe7c7d5b4cfb4d9'],
  ['big5', '早安你好', 'a6ada677a741a66e'],
  ['gb2312', '早安你好', 'd4e7b0b2c4e3bac3'],
  ['gbk', '谢谢你们', 'd0bbd0bbc4e3c3c7'],
  ['gb18030', '谢谢你们', 'd0bbd0bbc4e3c3c7'],
];

// iconv-lite mirrors Python's strict decode closely enough for these
// checks: it has no fatal mode, so verify the reported name exists and the
// decode produces no replacement characters.
function decodesCleanly(data: Uint8Array, encoding: string): string | null {
  // The caller decodes with the *reported* name (Python's contract), which
  // iconv usually knows directly ("EUC-JP"); fall back to the canonical
  // name for reported names iconv does not recognize.
  const candidates = [encoding, lookupEncoding(encoding) ?? encoding];
  const name = candidates.find(n => iconv.encodingExists(n));
  if (name === undefined) {
    // iconv gap (e.g. cp1006, which Python's codec library has). For a
    // single-byte encoding "decodes" reduces to "no undefined byte", which
    // the byte tables answer. Return a placeholder — no fidelity check is
    // possible here.
    const canonical = lookupEncoding(encoding);
    if (canonical === null || REGISTRY[canonical].isMultibyte) return null;
    if (decodesAsSingleByte(canonical, data) === false) return null;
    return '(decodes; not decodable by iconv)';
  }
  const text = iconv.decode(Buffer.from(data), name);
  if (text.includes('�')) return null;
  return text;
}

describe('short string roundtrip decodes', () => {
  for (const [encoding, text, hex] of ALL) {
    test(`${encoding}-${text.slice(0, 8)}`, () => {
      const data = hexToBytes(hex);
      expect(data.length).toBeGreaterThanOrEqual(3);
      expect(data.length).toBeLessThanOrEqual(40);
      const result = detect(data);
      expect(result.encoding, `no detection for ${encoding} ${text}`).not.toBeNull();
      const decoded = decodesCleanly(data, result.encoding!);
      expect(decoded, `${result.encoding} cannot decode ${encoding} ${text}`).not.toBeNull();
      expect(decoded!.length).toBeGreaterThan(0);
    });
  }
});

test('roundtrip fidelity when detection is exact', () => {
  // "mamá".encode("iso-8859-1")
  const data = hexToBytes('6d616de1');
  const result = detect(data);
  expect(decodesCleanly(data, result.encoding!)).toBe('mamá');
});
