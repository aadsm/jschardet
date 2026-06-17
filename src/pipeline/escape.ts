import { findBytes } from '../utils.js';
import { DETERMINISTIC_CONFIDENCE, DetectionResult } from './index.js';

function _hasValidHzRegions(data: Uint8Array): boolean {
  const begin_marker = new Uint8Array([0x7e, 0x7b]); // "~{"
  const end_marker   = new Uint8Array([0x7e, 0x7d]); // "~}"
  let start = 0;
  while (true) {
    const begin = findBytes(data, begin_marker, start);
    if (begin === -1) return false;
    const end = findBytes(data, end_marker, begin + 2);
    if (end === -1) return false;
    const region = data.subarray(begin + 2, end);
    if (
      region.length >= 2 &&
      region.length % 2 === 0 &&
      region.every(b => b >= 0x21 && b <= 0x7e)
    ) {
      return true;
    }
    start = end + 2;
  }
}

// Base64 alphabet used inside UTF-7 shifted sequences
const _B64_CHARS = new Uint8Array(
  [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map(c => c.charCodeAt(0))
);
const _UTF7_BASE64 = new Set(_B64_CHARS);

// Lookup table mapping each Base64 byte to its 6-bit value (0–63)
const _B64_DECODE = new Map<number, number>();
for (let i = 0; i < _B64_CHARS.length; i++) _B64_DECODE.set(_B64_CHARS[i], i);

export function _isValidUtf7B64(b64Bytes: Uint8Array): boolean {
  const n = b64Bytes.length;
  const totalBits = n * 6;
  const paddingBits = totalBits % 16;
  if (paddingBits > 0) {
    const lastVal = _B64_DECODE.get(b64Bytes[n - 1])!;
    const mask = (1 << paddingBits) - 1;
    if (lastVal & mask) return false;
  }
  const numBytes = Math.floor(totalBits / 8);
  const raw = new Uint8Array(numBytes);
  let bitBuf = 0;
  let bitCount = 0;
  let outIdx = 0;
  for (const c of b64Bytes) {
    bitBuf = (bitBuf << 6) | _B64_DECODE.get(c)!;
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
      if (prevHigh) return false; // consecutive high surrogates
      prevHigh = true;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      if (!prevHigh) return false; // lone low surrogate
      prevHigh = false;
    } else {
      if (prevHigh) return false; // high surrogate not followed by low
      prevHigh = false;
    }
  }
  return !prevHigh;
}

const _B64_WITH_PAD = new Set([..._UTF7_BASE64, 0x3d]); // includes '='

function _isEmbeddedInBase64(data: Uint8Array, pos: number): boolean {
  let count = 0;
  let i = pos - 1;
  while (i >= 0) {
    const b = data[i];
    if (b === 0x0a || b === 0x0d) { i--; continue; }
    if (_B64_WITH_PAD.has(b)) { count++; i--; }
    else break;
  }
  return count >= 4;
}

function _hasValidUtf7Sequences(data: Uint8Array): boolean {
  let start = 0;
  while (true) {
    const shiftPos = data.indexOf(0x2b, start); // '+'
    if (shiftPos === -1) return false;
    let pos = shiftPos + 1;
    // +- is a literal plus, not a shifted sequence
    if (pos < data.length && data[pos] === 0x2d) { start = pos + 1; continue; }
    // Guard A: '+' as first base64 char encodes PUA — skip all consecutive '+'
    if (pos < data.length && data[pos] === 0x2b) {
      while (pos < data.length && data[pos] === 0x2b) pos++;
      start = pos;
      continue;
    }
    // Guard B: '+' embedded in a base64 stream (PEM, email attachment)
    if (_isEmbeddedInBase64(data, shiftPos)) { start = pos; continue; }
    // Collect consecutive Base64 characters
    let i = pos;
    while (i < data.length && _UTF7_BASE64.has(data[i])) i++;
    const b64Len  = i - pos;
    const b64Data = data.subarray(pos, i);
    // Guard C: reject base64 blocks with no uppercase letters
    if (b64Len >= 3 && !b64Data.some(b => b >= 0x41 && b <= 0x5a)) { start = i; continue; }
    if (b64Len >= 3 && _isValidUtf7B64(b64Data)) return true;
    start = Math.max(pos, i);
  }
}

// Escape sequence byte patterns for ISO-2022 variants
const _ESC_JP_2004_O = new Uint8Array([0x1b, 0x24, 0x28, 0x4f]);
const _ESC_JP_2004_P = new Uint8Array([0x1b, 0x24, 0x28, 0x50]);
const _ESC_JP_2004_Q = new Uint8Array([0x1b, 0x24, 0x28, 0x51]);
const _ESC_JP_EXT_I  = new Uint8Array([0x1b, 0x28, 0x49]);
const _ESC_JP_B      = new Uint8Array([0x1b, 0x24, 0x42]);
const _ESC_JP_AT     = new Uint8Array([0x1b, 0x24, 0x40]);
const _ESC_JP_J      = new Uint8Array([0x1b, 0x28, 0x4a]);
const _ESC_JP_D      = new Uint8Array([0x1b, 0x24, 0x28, 0x44]);
const _ESC_KR_C      = new Uint8Array([0x1b, 0x24, 0x29, 0x43]);

export function detectEscapeEncoding(data: Uint8Array): DetectionResult | null {
  const hasEsc   = data.includes(0x1b);
  const hasTilde = data.includes(0x7e);
  const hasPlus  = data.includes(0x2b);

  if (!hasEsc && !hasTilde && !hasPlus) return null;

  if (hasEsc) {
    if (
      findBytes(data, _ESC_JP_2004_O) !== -1 ||
      findBytes(data, _ESC_JP_2004_P) !== -1 ||
      findBytes(data, _ESC_JP_2004_Q) !== -1
    ) {
      return { encoding: 'iso2022_jp_2004', confidence: DETERMINISTIC_CONFIDENCE, language: 'ja', mimeType: null };
    }

    if (findBytes(data, _ESC_JP_EXT_I) !== -1) {
      return { encoding: 'iso2022_jp_ext', confidence: DETERMINISTIC_CONFIDENCE, language: 'ja', mimeType: null };
    }

    if (
      findBytes(data, _ESC_JP_B)  !== -1 ||
      findBytes(data, _ESC_JP_AT) !== -1 ||
      findBytes(data, _ESC_JP_J)  !== -1 ||
      findBytes(data, _ESC_JP_D)  !== -1
    ) {
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
  const tilde_open  = new Uint8Array([0x7e, 0x7b]); // "~{"
  const tilde_close = new Uint8Array([0x7e, 0x7d]); // "~}"
  if (
    hasTilde &&
    findBytes(data, tilde_open)  !== -1 &&
    findBytes(data, tilde_close) !== -1 &&
    _hasValidHzRegions(data)
  ) {
    return { encoding: 'hz', confidence: DETERMINISTIC_CONFIDENCE, language: 'zh', mimeType: null };
  }

  // UTF-7: every byte must be in 0x00–0x7F
  if (hasPlus) {
    // Spread into Math.max is unsafe on large Uint8Arrays; loop instead
    let maxByte = 0;
    for (const b of data) { if (b > maxByte) maxByte = b; }
    if (maxByte < 0x80 && _hasValidUtf7Sequences(data)) {
      return { encoding: 'utf-7', confidence: DETERMINISTIC_CONFIDENCE, language: null, mimeType: null };
    }
  }

  return null;
}
