import { ASCII_TEXT_BYTES, DETERMINISTIC_CONFIDENCE, DetectionResult } from './index.js';
import { decoderForLabel } from '../text-decoder.js';

const _SAMPLE_SIZE = 4096;
const _MIN_BYTES_UTF32 = 16;
const _MIN_BYTES_UTF16 = 10;
const _UTF16_MIN_NULL_FRACTION = 0.03;
const _MIN_TEXT_QUALITY = 0.5;
// Quality margin a byte order with the weaker null signal must win by to
// override the null pattern's choice. Keeps noisy near-ties (e.g. two
// alphabetic decodings of similar letter density) on the side the null
// evidence favors, while letting a clear gap (real CJK vs its byte-swapped
// scatter across the BMP) flip the answer.
const _QUALITY_TIE_MARGIN = 0.05;
const _MIN_PRINTABLE_FRACTION = 0.7;
const _NULL_SEPARATOR_MAX_FRACTION = 0.15;

// ASCII_TEXT_BYTES plus null — used by the null-separator guard
const _NULL_SEPARATOR_ALLOWED = new Set([0x00, ...ASCII_TEXT_BYTES]);

// Replaces Python unicodedata.category(c) — \p{L} = letters, \p{M} = marks, etc.
const _RE_LETTER   = /^\p{L}$/u;
const _RE_MARK     = /^\p{M}$/u;
const _RE_SPACE_SEP = /^\p{Zs}$/u;
const _RE_CONTROL  = /^\p{C}$/u;

function _isNullSeparatorPattern(data: Uint8Array, nullFrac: number): boolean {
  if (nullFrac >= _NULL_SEPARATOR_MAX_FRACTION) return false;
  // Replaces Python bytes.translate(None, ALLOWED) — count bytes not in the allowed set
  for (const b of data) { if (!_NULL_SEPARATOR_ALLOWED.has(b)) return false; }
  return true;
}

export function detectUtf1632Patterns(data: Uint8Array): DetectionResult | null {
  const sample = data.subarray(0, _SAMPLE_SIZE);
  if (sample.length < _MIN_BYTES_UTF16) return null;

  const result = _checkUtf32(sample);
  if (result !== null) return result;
  return _checkUtf16(sample);
}

function _checkUtf32(data: Uint8Array): DetectionResult | null {
  const trimmedLen = data.length - (data.length % 4);
  if (trimmedLen < _MIN_BYTES_UTF32) return null;
  const trimmed = data.subarray(0, trimmedLen);
  const numUnits = trimmedLen / 4;

  // UTF-32-BE: first byte of each 4-byte unit must be 0x00
  let beFirstNull = 0;
  let beSecondNull = 0;
  for (let i = 0; i < trimmed.length; i += 4) {
    if (trimmed[i]     === 0) beFirstNull++;
    if (trimmed[i + 1] === 0) beSecondNull++;
  }
  if (beFirstNull === numUnits && beSecondNull / numUnits > 0.5) {
    try {
      const text = _decodeUtf32BE(trimmed);
      if (text !== null && _looksLikeText(text)) {
        return { encoding: 'utf-32-be', confidence: DETERMINISTIC_CONFIDENCE, language: null, mimeType: null };
      }
    } catch { /* decode failed */ }
  }

  // UTF-32-LE: last byte of each 4-byte unit must be 0x00
  let leLastNull = 0;
  let leThirdNull = 0;
  for (let i = 0; i < trimmed.length; i += 4) {
    if (trimmed[i + 3] === 0) leLastNull++;
    if (trimmed[i + 2] === 0) leThirdNull++;
  }
  if (leLastNull === numUnits && leThirdNull / numUnits > 0.5) {
    try {
      const text = _decodeUtf32LE(trimmed);
      if (text !== null && _looksLikeText(text)) {
        return { encoding: 'utf-32-le', confidence: DETERMINISTIC_CONFIDENCE, language: null, mimeType: null };
      }
    } catch { /* decode failed */ }
  }

  return null;
}

function _checkUtf16(data: Uint8Array): DetectionResult | null {
  let sampleLen = Math.min(data.length, _SAMPLE_SIZE);
  sampleLen -= sampleLen % 2;
  if (sampleLen < _MIN_BYTES_UTF16) return null;
  const numUnits = sampleLen / 2;

  let beNullCount = 0;
  let leNullCount = 0;
  for (let i = 0; i < sampleLen; i += 2) {
    if (data[i]     === 0) beNullCount++;
    if (data[i + 1] === 0) leNullCount++;
  }
  const beFrac = beNullCount / numUnits;
  const leFrac = leNullCount / numUnits;

  const leQualified = leFrac >= _UTF16_MIN_NULL_FRACTION
    && !_isNullSeparatorPattern(data.subarray(0, sampleLen), leFrac);
  const beQualified = beFrac >= _UTF16_MIN_NULL_FRACTION
    && !_isNullSeparatorPattern(data.subarray(0, sampleLen), beFrac);

  if (!leQualified && !beQualified) return null;

  // The null-byte pattern only establishes that the data is UTF-16-like;
  // it cannot be trusted to pick the byte order on its own. In pure-CJK
  // text with no ASCII at all, the only null bytes come from the *low*
  // byte of characters like U+4E00, which sit in the opposite parity
  // position and vote for the swapped byte order. Decode both ways and
  // let text quality decide. Sides are visited in null-signal order and
  // a challenger must win by a clear margin, so noisy near-ties keep the
  // answer the null pattern chose.
  //
  // name is the chardet encoding name, decoderLabel the WHATWG TextDecoder
  // label (WHATWG uses 'utf-16le'/'utf-16be', not 'utf-16-le'/'utf-16-be').
  const sides = [
    { name: 'utf-16-le', decoderLabel: 'utf-16le', frac: leFrac, qualified: leQualified },
    { name: 'utf-16-be', decoderLabel: 'utf-16be', frac: beFrac, qualified: beQualified },
  ];
  if (beFrac > leFrac) sides.reverse();

  let bestName: string | null = null;
  let bestQuality = -2.0;
  let bestQualified = false;
  let viable = 0;
  let qualifiedSideDecoded = false;

  for (const { name, decoderLabel, qualified } of sides) {
    let text: string;
    try {
      // Replaces Python data.decode('utf-16-be') — TextDecoder throws on invalid sequences
      text = decoderForLabel(decoderLabel).decode(data.subarray(0, sampleLen));
    } catch { continue; }
    if (qualified) qualifiedSideDecoded = true;
    if (!_looksLikeText(text)) continue;
    viable++;
    const quality = _textQuality(text);
    if (quality > bestQuality + (viable > 1 ? _QUALITY_TIE_MARGIN : 0.0)) {
      bestQuality = quality;
      bestName = name;
      bestQualified = qualified;
    }
  }

  if (bestName === null) return null;

  let accepted: boolean;
  if (bestQualified) {
    // The null pattern and the quality comparison agree. A sole viable side
    // needs no quality floor (it matches the single-candidate acceptance);
    // a contested choice must look like real text on its own merits.
    accepted = viable === 1 || bestQuality >= _MIN_TEXT_QUALITY;
  } else {
    // A side that failed the null check can win only when a
    // null-qualified side actually decoded (so the quality comparison
    // was a fair fight, e.g. real CJK beating its byte-swapped scatter)
    // and the winner clears the quality floor. If the null-favored
    // side could not even decode, the data is corrupt in the only byte
    // order the evidence supports: report nothing rather than the swap.
    accepted = qualifiedSideDecoded && bestQuality >= _MIN_TEXT_QUALITY;
  }
  if (accepted) {
    return { encoding: bestName, confidence: DETERMINISTIC_CONFIDENCE, language: null, mimeType: null };
  }
  return null;
}

// Python str.isprintable() is False for categories Other (C*) and Separator
// (Z*), except the ASCII space. U+FFFF and friends must count as
// non-printable: the byte-order choice waives the quality floor for a sole
// viable side, so an over-permissive check here would accept binary data
// (e.g. a tiny GIF) as UTF-16.
const _RE_NONPRINTABLE = /^[\p{C}\p{Z}]$/u;

// Python's text[:500] and len() count characters; JS .slice/.length count
// UTF-16 code units, which double-count astral characters against the ratio.
// Both functions therefore bound and divide by code points, counted in the
// same for...of pass that classifies them.
export function _looksLikeText(text: string): boolean {
  if (!text) return false;
  let total = 0;
  let printable = 0;
  for (const c of text) {
    if (total === 500) break;
    total++;
    if (c === '\n' || c === '\r' || c === '\t' || c === ' ') { printable++; continue; }
    if (!_RE_NONPRINTABLE.test(c)) printable++;
  }
  return printable / total > _MIN_PRINTABLE_FRACTION;
}

export function _textQuality(text: string, limit = 500): number {
  let n = 0;
  let letters = 0;
  let marks = 0;
  let spaces = 0;
  let controls = 0;
  let asciiLetters = 0;

  for (const c of text) {
    if (n === limit) break;
    n++;
    if (_RE_LETTER.test(c)) {
      letters++;
      if (c.charCodeAt(0) < 128) asciiLetters++;
    } else if (_RE_MARK.test(c)) {
      marks++;
    } else if (_RE_SPACE_SEP.test(c) || c === '\n' || c === '\r' || c === '\t') {
      spaces++;
    } else if (_RE_CONTROL.test(c)) {
      controls++;
    }
  }
  if (n === 0) return -1.0;

  if (controls / n > 0.1)  return -1.0;
  if (marks   / n > 0.2)  return -1.0;

  let score = letters / n;
  score += (asciiLetters / n) * 0.5;
  if (n > 20 && spaces > 0) score += 0.1;
  return score;
}

// Manual UTF-32 decoders — TextDecoder does not support UTF-32 in the WHATWG Encoding Standard
function _decodeUtf32BE(data: Uint8Array): string | null {
  // Replaces Python int.from_bytes(data[a:b], 'big')
  let result = '';
  for (let i = 0; i < data.length; i += 4) {
    const cp = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0;
    if (cp > 0x10FFFF) return null;
    result += String.fromCodePoint(cp);
  }
  return result;
}

function _decodeUtf32LE(data: Uint8Array): string | null {
  // Replaces Python int.from_bytes(data[a:b], 'little')
  let result = '';
  for (let i = 0; i < data.length; i += 4) {
    const cp = (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)) >>> 0;
    if (cp > 0x10FFFF) return null;
    result += String.fromCodePoint(cp);
  }
  return result;
}
