import { startsWith } from '../utils.js';
import { utf7DecodesWithoutError } from './to-utf8.js';
// Where two marks share a prefix, the longer must come first: UTF-32 is
// checked before UTF-16 because the UTF-32-LE BOM starts with the UTF-16-LE
// BOM. The UTF-7 entries share no prefix with anything and sit last.
export const _BOMS = [
    [new Uint8Array([0x00, 0x00, 0xfe, 0xff]), 'utf-32'],
    [new Uint8Array([0xff, 0xfe, 0x00, 0x00]), 'utf-32'],
    [new Uint8Array([0xef, 0xbb, 0xbf]), 'utf-8-sig'],
    [new Uint8Array([0xfe, 0xff]), 'utf-16'],
    [new Uint8Array([0xff, 0xfe]), 'utf-16'],
    // UTF-7 signatures: U+FEFF encoded in UTF-7 ("+/v8-" and friends). The
    // fourth base64 character varies with what follows the BOM, giving four
    // prefixes (RFC 2152). All four are ASCII bytes, so without these marks
    // a signed UTF-7 file reads as plain ASCII and the signature is returned
    // to the caller as literal text. Unlike the other marks these bytes
    // occur in ordinary text ("+/v8/src/api.cc" in a diff), so a UTF-7 match
    // additionally requires the whole buffer to decode.
    [new Uint8Array([0x2b, 0x2f, 0x76, 0x38]), 'utf-7'], // "+/v8"
    [new Uint8Array([0x2b, 0x2f, 0x76, 0x39]), 'utf-7'], // "+/v9"
    [new Uint8Array([0x2b, 0x2f, 0x76, 0x2b]), 'utf-7'], // "+/v+"
    [new Uint8Array([0x2b, 0x2f, 0x76, 0x2f]), 'utf-7'], // "+/v/"
];
const _UTF32_BOM_BE = _BOMS[0][0];
const _UTF32_BOM_LE = _BOMS[1][0];
export function detectBom(data) {
    for (const [bomBytes, encoding] of _BOMS) {
        if (!startsWith(data, bomBytes))
            continue;
        // UTF-32 BOMs overlap with UTF-16 BOMs — validate payload is a multiple of 4 bytes
        if (bomBytes === _UTF32_BOM_BE || bomBytes === _UTF32_BOM_LE) {
            const payloadLen = data.length - bomBytes.length;
            if (payloadLen % 4 !== 0)
                continue;
        }
        // A UTF-7 signature is only believable if the data is UTF-7: the
        // prefix alone is ordinary ASCII (see the table comment).
        if (encoding === 'utf-7' && !utf7DecodesWithoutError(data))
            continue;
        return { encoding, confidence: 1.0, language: null, mimeType: null };
    }
    return null;
}
//# sourceMappingURL=bom.js.map