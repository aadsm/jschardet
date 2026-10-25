import { EVIDENCE_CAP_BYTES, findBytes } from '../utils.js';
import { DETERMINISTIC_CONFIDENCE, DetectionResult } from './index.js';
import { decodesWithoutError, iso2022Jp2DecodesWithoutError } from '../decode.js';
import type { EncodingName } from '../registry.js';

// Check that at least one ~{...~} region contains valid GB2312 byte pairs.
//
// maxStart bounds where a region may open and maxEnd where it may close.
// Keeping them separate is what lets a region that opens inside the evidence
// window close beyond it: bounding both at the same offset would cut a
// straddling region and hide the only escape evidence a document has
// (ADR-0006).
export function _hasValidHzRegions(data: Uint8Array, maxStart: number, maxEnd: number): boolean {
  const begin_marker = new Uint8Array([0x7e, 0x7b]); // "~{"
  const end_marker   = new Uint8Array([0x7e, 0x7d]); // "~}"
  let start = 0;
  while (true) {
    const begin = findBytes(data, begin_marker, start);
    if (begin === -1 || begin >= maxStart) return false;
    const end = findBytes(data, end_marker, begin + 2, maxEnd);
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

// Consecutive base64 characters before a '+' that mark it as part of a base64
// stream rather than a UTF-7 shift.
const _EMBEDDED_B64_RUN = 4;

export function _isEmbeddedInBase64(data: Uint8Array, pos: number): boolean {
  // The walk stops at the fourth character rather than running to the start of
  // the run. Only the >= 4 verdict is used, and newlines are skipped rather
  // than ending the walk, so without the early exit a line-wrapped base64 blob
  // — a PEM file, a MIME attachment, exactly what this guard exists to
  // recognize — makes each '+' rescan everything before it, and the caller
  // quadratic in the size of the blob.
  let count = 0;
  let i = pos - 1;
  while (i >= 0) {
    const b = data[i];
    if (b === 0x0a || b === 0x0d) { i--; continue; }
    if (_B64_WITH_PAD.has(b)) {
      count++;
      if (count >= _EMBEDDED_B64_RUN) return true;
      i--;
    }
    else break;
  }
  return false;
}

// maxStart bounds where a shift may occur and maxEnd how far its base64 run may
// reach, so a run that begins inside the evidence window can finish beyond it
// (ADR-0006). A run that outruns maxEnd is skipped rather than judged on the
// part that fits: the padding and surrogate checks read a cut run as a
// different run, and accepting on evidence we did not see is the one direction
// this must never fail in.
export function _hasValidUtf7Sequences(data: Uint8Array, maxStart: number, maxEnd: number): boolean {
  let start = 0;
  const limit = Math.min(data.length, maxEnd);
  while (true) {
    const shiftPos = data.indexOf(0x2b, start); // '+'
    if (shiftPos === -1 || shiftPos >= maxStart) return false;
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
    // Collect consecutive Base64 characters, up to the end bound
    let i = pos;
    while (i < limit && _UTF7_BASE64.has(data[i])) i++;
    if (i === limit && limit < data.length && _UTF7_BASE64.has(data[i])) {
      // The run outruns the bound — skip it (see the function comment).
      start = i;
      continue;
    }
    const b64Len  = i - pos;
    const b64Data = data.subarray(pos, i);
    // Guard C: reject base64 blocks with no uppercase letters
    if (b64Len >= 3 && !b64Data.some(b => b >= 0x41 && b <= 0x5a)) { start = i; continue; }
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
function _singleUnit(b64Data: Uint8Array): number {
  return (
    ((_B64_DECODE.get(b64Data[0])! << 12) |
      (_B64_DECODE.get(b64Data[1])! << 6) |
      _B64_DECODE.get(b64Data[2])!) >> 2
  );
}

// Script ranges where a lone shifted character plausibly occurs.
function _plausibleLoneUnit(unit: number): boolean {
  return (
    (unit >= 0x0080 && unit <= 0x07ff) || // Latin supp. .. Arabic
    (unit >= 0x0e00 && unit <= 0x0fff) || // Thai, Lao, Tibetan
    (unit >= 0x2000 && unit <= 0x2bff) || // punctuation .. arrows (em dash, euro)
    (unit >= 0x3000 && unit <= 0x30ff) || // CJK punctuation, kana
    (unit >= 0x4e00 && unit <= 0x9fff) || // CJK unified
    (unit >= 0xac00 && unit <= 0xd7a3) || // Hangul
    (unit >= 0xff00 && unit <= 0xffef)    // fullwidth forms
  );
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

// Name the ISO-2022 variant whose designations appear in data, as
// [encoding, language], or null when no designation is present (chardet's
// _iso2022_variant).
function _iso2022Variant(data: Uint8Array): [EncodingName, string] | null {
  // ISO-2022-JP-2004: JIS X 0213 designations are unique to this variant.
  // CPython's codec reads the 2004 plane-1 (Q) and plane-2 (P) designations
  // but not the 2000 plane-1 one (O), so chardet's decode check rejects an O
  // stream; the port has no decoder for this variant (see
  // detectEscapeEncoding).
  if (
    findBytes(data, _ESC_JP_2004_O) !== -1 ||
    findBytes(data, _ESC_JP_2004_P) !== -1 ||
    findBytes(data, _ESC_JP_2004_Q) !== -1
  ) {
    return ['iso2022_jp_2004', 'ja'];
  }

  // ISO-2022-JP-EXT: JIS X 0201 Kana designation is unique to this variant.
  if (findBytes(data, _ESC_JP_EXT_I) !== -1) return ['iso2022_jp_ext', 'ja'];

  // ISO-2022-JP base: JIS X 0208/0201/0212 designations.
  if (
    findBytes(data, _ESC_JP_B)  !== -1 ||
    findBytes(data, _ESC_JP_AT) !== -1 ||
    findBytes(data, _ESC_JP_J)  !== -1 ||
    findBytes(data, _ESC_JP_D)  !== -1
  ) {
    // SI/SO shift controls (0x0E / 0x0F) → JP-EXT
    if (data.includes(0x0e) && data.includes(0x0f)) return ['iso2022_jp_ext', 'ja'];
    // Default to JP-2: a strict superset of JP and JP-1 that decodes all
    // base sequences correctly.
    return ['iso2022_jp_2', 'ja'];
  }

  // ISO-2022-KR: ESC sequence for KS C 5601
  if (findBytes(data, _ESC_KR_C) !== -1) return ['iso2022_kr', 'ko'];

  return null;
}

// Detect ISO-2022, HZ-GB-2312, and UTF-7 from escape/tilde/plus sequences.
//
// Every answer this stage returns decodes the whole window: a designation is
// three bytes that ordinary text can contain ("log: ESC $ B is the escape"),
// and a genuine ISO-2022 or HZ stream can still carry a bad byte past the
// header. The check costs one decode per hit only. The port can decode only
// iso2022_jp_2 and UTF-7 here: HZ, ISO-2022-KR, ISO-2022-JP-EXT and
// ISO-2022-JP-2004 have no decoder, so decodesWithoutError answers true and
// those are answered on their designations alone, and iso2022_jp_2 data
// using an escape sequence WHATWG's iso-2022-jp lacks is answered the same
// way (see iso2022Jp2DecodesWithoutError). See "Escape-stage decode check"
// in docs/port-notes.md.
export function detectEscapeEncoding(data: Uint8Array): DetectionResult | null {
  const hasEsc   = data.includes(0x1b);
  const hasTilde = data.includes(0x7e);
  const hasPlus  = data.includes(0x2b);

  if (!hasEsc && !hasTilde && !hasPlus) return null;

  if (hasEsc) {
    const variant = _iso2022Variant(data);
    if (variant !== null) {
      const [encoding, language] = variant;
      const decodes = encoding === 'iso2022_jp_2'
        ? iso2022Jp2DecodesWithoutError(data)
        : decodesWithoutError(encoding, data);
      if (decodes) {
        return { encoding, confidence: DETERMINISTIC_CONFIDENCE, language, mimeType: null };
      }
    }
  }

  // Bounds for the deep validators below. They walk candidate sites in loops
  // whose pathological case is *rejection* — a large tilde- or plus-heavy file
  // that is neither HZ nor UTF-7 — so where a sequence may *begin* converges
  // on the evidence cap (ADR-0006). Where it may *end* is a separate bound,
  // one further window on, so a sequence that opens just inside the evidence
  // window is judged whole rather than cut by the boundary and read as
  // malformed. Nothing plausible sits between the two: a single escape run a
  // quarter of a megabyte long is not text. Gates that decide whether an
  // answer is *true* stay exhaustive over the window.
  const maxStart = Math.min(data.length, EVIDENCE_CAP_BYTES);
  const maxEnd = Math.min(data.length, 2 * EVIDENCE_CAP_BYTES);

  // HZ-GB-2312
  const tilde_open  = new Uint8Array([0x7e, 0x7b]); // "~{"
  const tilde_close = new Uint8Array([0x7e, 0x7d]); // "~}"
  if (
    hasTilde &&
    findBytes(data, tilde_open)  !== -1 &&
    findBytes(data, tilde_close) !== -1 &&
    _hasValidHzRegions(data, maxStart, maxEnd) &&
    decodesWithoutError('hz', data)
  ) {
    return { encoding: 'hz', confidence: DETERMINISTIC_CONFIDENCE, language: 'zh', mimeType: null };
  }

  // UTF-7: plus-sign shifts into Base64-encoded Unicode. UTF-7 is a 7-bit
  // encoding (RFC 2152): every byte must be in 0x00–0x7F, checked over the
  // whole window. The buffer must also *decode* as UTF-7: tabular ASCII like
  // "|16847+|" contains "+|", which is illegal (a shift must be followed by
  // base64 or "-"), so the decode gate kills the delimited-data false-positive
  // class outright while genuine UTF-7 — which real encoders emit as valid
  // streams — always passes.
  //
  // The decode gate keeps the *whole* window: it is what makes a utf-7 answer
  // true, and this stage returns it at deterministic confidence. Capping it
  // would let an illegal shift past the cap pass as utf-7 that the caller's own
  // decode then rejects. It runs *after* the bounded sequence validator, the
  // reverse of the obvious order: plain ASCII is valid UTF-7, so on the common
  // case (a large ASCII file containing a '+' anywhere) the decode gate
  // succeeds over every byte, while the validator settles the same files from
  // bounded evidence. Both are pure predicates, so the order changes only cost.
  if (hasPlus) {
    // Spread into Math.max is unsafe on large Uint8Arrays; loop instead
    let maxByte = 0;
    for (const b of data) { if (b > maxByte) maxByte = b; }
    if (
      maxByte < 0x80 &&
      _hasValidUtf7Sequences(data, maxStart, maxEnd) &&
      decodesWithoutError('utf-7', data)
    ) {
      return { encoding: 'utf-7', confidence: DETERMINISTIC_CONFIDENCE, language: null, mimeType: null };
    }
  }

  return null;
}
