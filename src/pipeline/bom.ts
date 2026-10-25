import { startsWith } from '../utils.js';
import { DetectionResult } from './index.js';
import { decodesWithoutError } from '../decode.js';

// Where two marks share a prefix, the longer must come first: UTF-32 is
// checked before UTF-16 because the UTF-32-LE BOM starts with the UTF-16-LE
// BOM. The UTF-7 entries share no prefix with anything and sit last.
export const _BOMS: Array<[Uint8Array, string]> = [
  [new Uint8Array([0x00, 0x00, 0xfe, 0xff]), 'utf-32'],
  [new Uint8Array([0xff, 0xfe, 0x00, 0x00]), 'utf-32'],
  [new Uint8Array([0xef, 0xbb, 0xbf]),       'utf-8-sig'],
  [new Uint8Array([0xfe, 0xff]),             'utf-16'],
  [new Uint8Array([0xff, 0xfe]),             'utf-16'],
  // UTF-7 signatures: U+FEFF encoded in UTF-7 ("+/v8-" and friends). The
  // fourth base64 character varies with what follows the BOM, giving four
  // prefixes (RFC 2152). All four are ASCII bytes, so without these marks
  // a signed UTF-7 file reads as plain ASCII and the signature is returned
  // to the caller as literal text. These bytes also occur in ordinary text
  // ("+/v8/src/api.cc" in a diff), which is one more reason every mark is
  // held to the whole-buffer decode below.
  [new Uint8Array([0x2b, 0x2f, 0x76, 0x38]), 'utf-7'], // "+/v8"
  [new Uint8Array([0x2b, 0x2f, 0x76, 0x39]), 'utf-7'], // "+/v9"
  [new Uint8Array([0x2b, 0x2f, 0x76, 0x2b]), 'utf-7'], // "+/v+"
  [new Uint8Array([0x2b, 0x2f, 0x76, 0x2f]), 'utf-7'], // "+/v/"
];

const _UTF32_BOM_BE = _BOMS[0][0];
const _UTF32_BOM_LE = _BOMS[1][0];

function _isAscii(data: Uint8Array): boolean {
  for (let i = 0; i < data.length; i++) {
    if (data[i] >= 0x80) return false;
  }
  return true;
}

// Check for a byte order mark at the start of data. inputTruncated says
// whether the examination window ends before the input.
export function detectBom(data: Uint8Array, inputTruncated = false): DetectionResult | null {
  for (const [bomBytes, encoding] of _BOMS) {
    if (!startsWith(data, bomBytes)) continue;
    const isUtf32 = bomBytes === _UTF32_BOM_BE || bomBytes === _UTF32_BOM_LE;
    // UTF-32 BOMs overlap with UTF-16 BOMs (e.g. FF FE 00 00 starts with the
    // UTF-16-LE BOM FF FE). Validate that the payload after a UTF-32 BOM is a
    // valid number of UTF-32 code units (multiple of 4 bytes). If not, skip
    // to let the shorter UTF-16 BOM match, unless chardet cut the window
    // mid-unit. The tolerant decode below accepts that partial tail but
    // still rejects corruption.
    if (isUtf32) {
      const payloadLen = data.length - bomBytes.length;
      if (payloadLen % 4 !== 0 && !inputTruncated) continue;
    }
    // The mark names the encoding, but the answer is only true if the body
    // decodes under it: a lone surrogate after a UTF-16 mark, or cp1252 bytes
    // after a UTF-8 mark, would otherwise come back at 1.0 and fail in the
    // caller's own decode. A mark whose body fails is no answer at all, so
    // the other stages take over. The usual body behind a UTF-8 mark is plain
    // ASCII, which needs no decode.
    const bodyIsAscii = encoding === 'utf-8-sig' && _isAscii(data.subarray(bomBytes.length));
    if (!bodyIsAscii && !decodesWithoutError(encoding, data)) {
      // A UTF-32 match admitted only by the relaxed alignment check may be
      // UTF-16 starting with NUL. Try its shorter BOM before giving up, but
      // preserve rejection for ordinary matches.
      if (inputTruncated && isUtf32 && data.length % 4 !== 0) continue;
      return null;
    }
    return { encoding, confidence: 1.0, language: null, mimeType: null };
  }
  return null;
}
