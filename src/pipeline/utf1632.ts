import { ASCII_TEXT_BYTES, DETERMINISTIC_CONFIDENCE, DetectionResult } from './index.js';
import { decoderForLabel } from '../text-decoder.js';

const _SAMPLE_SIZE = 4096;
const _MIN_BYTES_UTF32 = 16;
const _MIN_BYTES_UTF16 = 10;
const _UTF16_MIN_NULL_FRACTION = 0.03;
const _MIN_TEXT_QUALITY = 0.5;
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

  // Map from chardet encoding name to WHATWG TextDecoder label
  // (WHATWG uses 'utf-16le'/'utf-16be', not 'utf-16-le'/'utf-16-be')
  type Candidate = { name: string; decoderLabel: string; frac: number };
  const candidates: Candidate[] = [];
  if (leFrac >= _UTF16_MIN_NULL_FRACTION && !_isNullSeparatorPattern(data.subarray(0, sampleLen), leFrac)) {
    candidates.push({ name: 'utf-16-le', decoderLabel: 'utf-16le', frac: leFrac });
  }
  if (beFrac >= _UTF16_MIN_NULL_FRACTION && !_isNullSeparatorPattern(data.subarray(0, sampleLen), beFrac)) {
    candidates.push({ name: 'utf-16-be', decoderLabel: 'utf-16be', frac: beFrac });
  }
  if (candidates.length === 0) return null;

  if (candidates.length === 1) {
    const { name, decoderLabel } = candidates[0];
    try {
      // Replaces Python data.decode('utf-16-be') — TextDecoder throws on invalid sequences
      const text = decoderForLabel(decoderLabel).decode(data.subarray(0, sampleLen));
      if (_looksLikeText(text)) {
        return { encoding: name, confidence: DETERMINISTIC_CONFIDENCE, language: null, mimeType: null };
      }
    } catch { /* decode failed */ }
    return null;
  }

  // Both candidates matched — decode both and pick the one with higher text quality
  let bestName: string | null = null;
  let bestQuality = -1.0;
  for (const { name, decoderLabel } of candidates) {
    let text: string;
    try {
      // Replaces Python data.decode('utf-16-be') — TextDecoder throws on invalid sequences
      text = decoderForLabel(decoderLabel).decode(data.subarray(0, sampleLen));
    } catch { continue; }
    const quality = _textQuality(text);
    if (quality > bestQuality) {
      bestQuality = quality;
      bestName = name;
    }
  }
  if (bestName !== null && bestQuality >= _MIN_TEXT_QUALITY) {
    return { encoding: bestName, confidence: DETERMINISTIC_CONFIDENCE, language: null, mimeType: null };
  }
  return null;
}

export function _looksLikeText(text: string): boolean {
  if (!text) return false;
  const sample = text.slice(0, 500);
  let printable = 0;
  for (const c of sample) {
    if (c === '\n' || c === '\r' || c === '\t') { printable++; continue; }
    if (c.charCodeAt(0) >= 0x20) printable++; // rough printable check
  }
  return printable / sample.length > _MIN_PRINTABLE_FRACTION;
}

export function _textQuality(text: string, limit = 500): number {
  const sample = text.slice(0, limit);
  const n = sample.length;
  if (n === 0) return -1.0;

  let letters = 0;
  let marks = 0;
  let spaces = 0;
  let controls = 0;
  let asciiLetters = 0;

  for (const c of sample) {
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
