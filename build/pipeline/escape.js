import { findBytes } from '../utils.js';
import { DETERMINISTIC_CONFIDENCE } from './index.js';
import { utf7DecodesWithoutError } from './to-utf8.js';
function _hasValidHzRegions(data) {
    const begin_marker = new Uint8Array([0x7e, 0x7b]); // "~{"
    const end_marker = new Uint8Array([0x7e, 0x7d]); // "~}"
    let start = 0;
    while (true) {
        const begin = findBytes(data, begin_marker, start);
        if (begin === -1)
            return false;
        const end = findBytes(data, end_marker, begin + 2);
        if (end === -1)
            return false;
        const region = data.subarray(begin + 2, end);
        if (region.length >= 2 &&
            region.length % 2 === 0 &&
            region.every(b => b >= 0x21 && b <= 0x7e)) {
            return true;
        }
        start = end + 2;
    }
}
// Base64 alphabet used inside UTF-7 shifted sequences
const _B64_CHARS = new Uint8Array([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map(c => c.charCodeAt(0)));
const _UTF7_BASE64 = new Set(_B64_CHARS);
// Lookup table mapping each Base64 byte to its 6-bit value (0–63)
const _B64_DECODE = new Map();
for (let i = 0; i < _B64_CHARS.length; i++)
    _B64_DECODE.set(_B64_CHARS[i], i);
export function _isValidUtf7B64(b64Bytes) {
    const n = b64Bytes.length;
    const totalBits = n * 6;
    const paddingBits = totalBits % 16;
    if (paddingBits > 0) {
        const lastVal = _B64_DECODE.get(b64Bytes[n - 1]);
        const mask = (1 << paddingBits) - 1;
        if (lastVal & mask)
            return false;
    }
    const numBytes = Math.floor(totalBits / 8);
    const raw = new Uint8Array(numBytes);
    let bitBuf = 0;
    let bitCount = 0;
    let outIdx = 0;
    for (const c of b64Bytes) {
        bitBuf = (bitBuf << 6) | _B64_DECODE.get(c);
        bitCount += 6;
        if (bitCount >= 8) {
            bitCount -= 8;
            raw[outIdx++] = (bitBuf >> bitCount) & 0xff;
        }
    }
    // Validate as UTF-16BE — reject lone surrogates
    let prevHigh = false;
    for (let i = 0; i < numBytes - 1; i += 2) {
        const codeUnit = (raw[i] << 8) | raw[i + 1];
        if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
            if (prevHigh)
                return false; // consecutive high surrogates
            prevHigh = true;
        }
        else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
            if (!prevHigh)
                return false; // lone low surrogate
            prevHigh = false;
        }
        else {
            if (prevHigh)
                return false; // high surrogate not followed by low
            prevHigh = false;
        }
    }
    return !prevHigh;
}
const _B64_WITH_PAD = new Set([..._UTF7_BASE64, 0x3d]); // includes '='
function _isEmbeddedInBase64(data, pos) {
    let count = 0;
    let i = pos - 1;
    while (i >= 0) {
        const b = data[i];
        if (b === 0x0a || b === 0x0d) {
            i--;
            continue;
        }
        if (_B64_WITH_PAD.has(b)) {
            count++;
            i--;
        }
        else
            break;
    }
    return count >= 4;
}
function _hasValidUtf7Sequences(data) {
    let start = 0;
    while (true) {
        const shiftPos = data.indexOf(0x2b, start); // '+'
        if (shiftPos === -1)
            return false;
        let pos = shiftPos + 1;
        // +- is a literal plus, not a shifted sequence
        if (pos < data.length && data[pos] === 0x2d) {
            start = pos + 1;
            continue;
        }
        // Guard A: '+' as first base64 char encodes PUA — skip all consecutive '+'
        if (pos < data.length && data[pos] === 0x2b) {
            while (pos < data.length && data[pos] === 0x2b)
                pos++;
            start = pos;
            continue;
        }
        // Guard B: '+' embedded in a base64 stream (PEM, email attachment)
        if (_isEmbeddedInBase64(data, shiftPos)) {
            start = pos;
            continue;
        }
        // Collect consecutive Base64 characters
        let i = pos;
        while (i < data.length && _UTF7_BASE64.has(data[i]))
            i++;
        const b64Len = i - pos;
        const b64Data = data.subarray(pos, i);
        // Guard C: reject base64 blocks with no uppercase letters
        if (b64Len >= 3 && !b64Data.some(b => b >= 0x41 && b <= 0x5a)) {
            start = i;
            continue;
        }
        if (b64Len >= 3 && _isValidUtf7B64(b64Data)) {
            // Guard D: a block encoding a *single* code unit — with or without a
            // dash terminator — must decode into a script range where a lone
            // shifted character plausibly occurs. The corpus's single-unit
            // blocks live in Latin/Greek/Cyrillic/Hebrew/Arabic supplements,
            // Thai, general punctuation through arrows (em dashes and ellipses
            // dominate), CJK, kana, Hangul, and fullwidth forms. An accidental
            // uppercase run like "+LAY" (chardet issue #371) decodes to U+2C06,
            // Glagolitic — no genuine lone block in the corpus lands in such a
            // range. Multi-unit blocks are untouched: accidental ASCII does not
            // survive the padding and surrogate checks for long runs.
            if (Math.floor((b64Len * 6) / 16) === 1) {
                const unit = _singleUnit(b64Data);
                if (!_plausibleLoneUnit(unit)) {
                    start = i;
                    continue;
                }
            }
            return true;
        }
        start = Math.max(pos, i);
    }
}
// Decode the first (only) UTF-16 code unit of a single-unit block.
function _singleUnit(b64Data) {
    return (((_B64_DECODE.get(b64Data[0]) << 12) |
        (_B64_DECODE.get(b64Data[1]) << 6) |
        _B64_DECODE.get(b64Data[2])) >> 2);
}
// Script ranges where a lone shifted character plausibly occurs.
function _plausibleLoneUnit(unit) {
    return ((unit >= 0x0080 && unit <= 0x07ff) || // Latin supp. .. Arabic
        (unit >= 0x0e00 && unit <= 0x0fff) || // Thai, Lao, Tibetan
        (unit >= 0x2000 && unit <= 0x2bff) || // punctuation .. arrows (em dash, euro)
        (unit >= 0x3000 && unit <= 0x30ff) || // CJK punctuation, kana
        (unit >= 0x4e00 && unit <= 0x9fff) || // CJK unified
        (unit >= 0xac00 && unit <= 0xd7a3) || // Hangul
        (unit >= 0xff00 && unit <= 0xffef) // fullwidth forms
    );
}
// Escape sequence byte patterns for ISO-2022 variants
const _ESC_JP_2004_O = new Uint8Array([0x1b, 0x24, 0x28, 0x4f]);
const _ESC_JP_2004_P = new Uint8Array([0x1b, 0x24, 0x28, 0x50]);
const _ESC_JP_2004_Q = new Uint8Array([0x1b, 0x24, 0x28, 0x51]);
const _ESC_JP_EXT_I = new Uint8Array([0x1b, 0x28, 0x49]);
const _ESC_JP_B = new Uint8Array([0x1b, 0x24, 0x42]);
const _ESC_JP_AT = new Uint8Array([0x1b, 0x24, 0x40]);
const _ESC_JP_J = new Uint8Array([0x1b, 0x28, 0x4a]);
const _ESC_JP_D = new Uint8Array([0x1b, 0x24, 0x28, 0x44]);
const _ESC_KR_C = new Uint8Array([0x1b, 0x24, 0x29, 0x43]);
export function detectEscapeEncoding(data) {
    const hasEsc = data.includes(0x1b);
    const hasTilde = data.includes(0x7e);
    const hasPlus = data.includes(0x2b);
    if (!hasEsc && !hasTilde && !hasPlus)
        return null;
    if (hasEsc) {
        if (findBytes(data, _ESC_JP_2004_O) !== -1 ||
            findBytes(data, _ESC_JP_2004_P) !== -1 ||
            findBytes(data, _ESC_JP_2004_Q) !== -1) {
            return { encoding: 'iso2022_jp_2004', confidence: DETERMINISTIC_CONFIDENCE, language: 'ja', mimeType: null };
        }
        if (findBytes(data, _ESC_JP_EXT_I) !== -1) {
            return { encoding: 'iso2022_jp_ext', confidence: DETERMINISTIC_CONFIDENCE, language: 'ja', mimeType: null };
        }
        if (findBytes(data, _ESC_JP_B) !== -1 ||
            findBytes(data, _ESC_JP_AT) !== -1 ||
            findBytes(data, _ESC_JP_J) !== -1 ||
            findBytes(data, _ESC_JP_D) !== -1) {
            // SI/SO shift controls (0x0E / 0x0F) → JP-EXT
            if (data.includes(0x0e) && data.includes(0x0f)) {
                return { encoding: 'iso2022_jp_ext', confidence: DETERMINISTIC_CONFIDENCE, language: 'ja', mimeType: null };
            }
            return { encoding: 'iso2022_jp_2', confidence: DETERMINISTIC_CONFIDENCE, language: 'ja', mimeType: null };
        }
        if (findBytes(data, _ESC_KR_C) !== -1) {
            return { encoding: 'iso2022_kr', confidence: DETERMINISTIC_CONFIDENCE, language: 'ko', mimeType: null };
        }
    }
    // HZ-GB-2312
    const tilde_open = new Uint8Array([0x7e, 0x7b]); // "~{"
    const tilde_close = new Uint8Array([0x7e, 0x7d]); // "~}"
    if (hasTilde &&
        findBytes(data, tilde_open) !== -1 &&
        findBytes(data, tilde_close) !== -1 &&
        _hasValidHzRegions(data)) {
        return { encoding: 'hz', confidence: DETERMINISTIC_CONFIDENCE, language: 'zh', mimeType: null };
    }
    // UTF-7: plus-sign shifts into Base64-encoded Unicode. UTF-7 is a 7-bit
    // encoding (RFC 2152): every byte must be in 0x00–0x7F. The whole buffer
    // must also *decode* as UTF-7: tabular ASCII like "|16847+|" contains
    // "+|", which is illegal (a shift must be followed by base64 or "-"), so
    // the decode gate kills the delimited-data false-positive class outright
    // while genuine UTF-7 — which real encoders emit as valid streams —
    // always passes. The decoder fails fast on the first bad sequence.
    if (hasPlus) {
        // Spread into Math.max is unsafe on large Uint8Arrays; loop instead
        let maxByte = 0;
        for (const b of data) {
            if (b > maxByte)
                maxByte = b;
        }
        if (maxByte < 0x80 &&
            utf7DecodesWithoutError(data) &&
            _hasValidUtf7Sequences(data)) {
            return { encoding: 'utf-7', confidence: DETERMINISTIC_CONFIDENCE, language: null, mimeType: null };
        }
    }
    return null;
}
//# sourceMappingURL=escape.js.map