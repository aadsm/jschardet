// Decode raw bytes into UTF-8 for bigram language scoring (used by _fillMetadata Tier 3).
//
// Python's equivalent is trivial:
//   data.decode(encoding, errors='ignore').encode('utf-8', errors='surrogatepass')
// because Python's codec system handles all encoding names natively.
//
// WHATWG TextDecoder only accepts WHATWG labels, and the WHATWG Encoding Standard
// omits several encodings that chardet's early-exit pipeline stages can return:
//   utf-8-sig  — BOM-prefixed UTF-8, no WHATWG label (BOM is just a leading byte sequence)
//   utf-16     — BOM-detected UTF-16 (auto endianness); WHATWG has utf-16le/utf-16be but no
//                auto-detecting 'utf-16' label that honours both BOMs
//   utf-32*    — not in the WHATWG Encoding Standard at all
//   utf-7      — not in the WHATWG Encoding Standard at all
//
// This module provides explicit, errors=ignore-equivalent decode paths for each of those
// encodings and falls through to TextDecoder for everything else.

import { whatwgLabelFor } from '../text-decoder.js';

// Pre-built lookup: byte value → 6-bit base64 value, or 0xFF if not a base64 character.
// Used by _utf7ToUtf8. Modified UTF-7 (RFC 2152) uses the standard base64 alphabet.
const _BASE64_TABLE: Uint8Array = (() => {
  const t = new Uint8Array(256).fill(0xff);
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < alpha.length; i++) t[alpha.charCodeAt(i)] = i;
  return t;
})();

// Decode UTF-32 bytes to UTF-8. Called for 'utf-32', 'utf-32-be', 'utf-32-le'.
// 'utf-32' carries a BOM; the other two are bare (no BOM) and their names encode endianness.
function _utf32ToUtf8(data: Uint8Array, encoding: string): Uint8Array | null {
  let littleEndian: boolean;
  let start: number;

  if (encoding === 'utf-32') {
    // BOM: 0xFF 0xFE 0x00 0x00 = LE, 0x00 0x00 0xFE 0xFF = BE
    if (
      data.length >= 4
      && data[0] === 0xff && data[1] === 0xfe
      && data[2] === 0x00 && data[3] === 0x00
    ) {
      littleEndian = true;
      start = 4;
    } else if (
      data.length >= 4
      && data[0] === 0x00 && data[1] === 0x00
      && data[2] === 0xfe && data[3] === 0xff
    ) {
      littleEndian = false;
      start = 4;
    } else {
      return null;
    }
  } else {
    littleEndian = encoding === 'utf-32-le';
    start = 0;
  }

  const aligned = data.subarray(start);
  const numCPs = Math.floor(aligned.length / 4);
  if (numCPs === 0) return null;

  const view = new DataView(aligned.buffer, aligned.byteOffset, numCPs * 4);
  let str = '';
  for (let i = 0; i < numCPs; i++) {
    const cp = view.getUint32(i * 4, littleEndian);
    // Skip surrogates and out-of-range code points — errors=ignore semantics
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) continue;
    str += String.fromCodePoint(cp);
  }
  return str.length > 0 ? new TextEncoder().encode(str) : null;
}

// Decode UTF-7 bytes to UTF-8.
// UTF-7 (RFC 2152) encodes non-ASCII as Modified Base64 shift sequences:
//   + <base64 chars> -  →  decode as UTF-16BE code units
//   +-                  →  literal '+' character
//   any other byte < 0x80  →  literal ASCII
function _utf7ToUtf8(data: Uint8Array): Uint8Array | null {
  let str = '';
  let i = 0;
  while (i < data.length) {
    const b = data[i];
    if (b === 0x2b) { // '+'
      i++;
      if (i < data.length && data[i] === 0x2d) {
        // '+-' encodes a literal '+' (not a shift sequence)
        str += '+';
        i++;
        continue;
      }
      // Collect base64 characters until '-' or a non-base64 byte
      const b64Start = i;
      while (i < data.length && _BASE64_TABLE[data[i]] !== 0xff) i++;
      const b64Len = i - b64Start;
      if (i < data.length && data[i] === 0x2d) i++; // consume terminating '-'

      if (b64Len === 0) continue;

      // Decode base64 stream to raw bytes (each 4 chars → 3 bytes)
      const rawLen = Math.floor(b64Len * 6 / 8);
      const raw = new Uint8Array(rawLen);
      let accum = 0;
      let bits = 0;
      let byteIdx = 0;
      for (let j = 0; j < b64Len && byteIdx < rawLen; j++) {
        accum = (accum << 6) | _BASE64_TABLE[data[b64Start + j]];
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          raw[byteIdx++] = (accum >> bits) & 0xff;
        }
      }

      // Interpret raw bytes as UTF-16BE code units
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      const numUnits = Math.floor(raw.length / 2);
      let j = 0;
      while (j < numUnits) {
        const u = view.getUint16(j * 2, false); // big-endian
        j++;
        if (u >= 0xd800 && u <= 0xdbff && j < numUnits) {
          // High surrogate — look for matching low surrogate
          const lo = view.getUint16(j * 2, false);
          if (lo >= 0xdc00 && lo <= 0xdfff) {
            const cp = 0x10000 + ((u - 0xd800) << 10) + (lo - 0xdc00);
            str += String.fromCodePoint(cp);
            j++;
          }
          // Lone high surrogate: skip (errors=ignore)
        } else if (u < 0xd800 || u > 0xdfff) {
          str += String.fromCodePoint(u);
        }
        // Lone low surrogate: skip (errors=ignore)
      }
    } else if (b < 0x80) {
      str += String.fromCharCode(b);
      i++;
    } else {
      // High bytes outside shift sequences are invalid in UTF-7; skip
      i++;
    }
  }
  return str.length > 0 ? new TextEncoder().encode(str) : null;
}

// Decode raw bytes from `encoding` into UTF-8 for bigram language scoring.
// Mirrors Python's:
//   data.decode(encoding, errors='ignore').encode('utf-8', errors='surrogatepass')
// Returns null if the encoding cannot be decoded (unknown label, no BOM when required, etc.).
export function toUtf8(data: Uint8Array, encoding: string): Uint8Array | null {
  if (encoding === 'utf-8') return data;

  // utf-8-sig: BOM-prefixed UTF-8. Strip the 3-byte BOM; the payload is already valid UTF-8.
  if (encoding === 'utf-8-sig') {
    const hasBom = data.length >= 3
      && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf;
    return hasBom ? data.subarray(3) : data;
  }

  // utf-16 (BOM-detected): first 2 bytes are 0xFF 0xFE (LE) or 0xFE 0xFF (BE).
  if (encoding === 'utf-16') {
    let label: string;
    let start: number;
    if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
      label = 'utf-16le'; start = 2;
    } else if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
      label = 'utf-16be'; start = 2;
    } else {
      return null;
    }
    try {
      const decoded = new TextDecoder(label, { fatal: false }).decode(data.subarray(start));
      return new TextEncoder().encode(decoded);
    } catch { return null; }
  }

  // utf-16-le / utf-16-be (no-BOM): decode directly with the matching WHATWG label.
  if (encoding === 'utf-16-le') {
    try {
      return new TextEncoder().encode(
        new TextDecoder('utf-16le', { fatal: false }).decode(data),
      );
    } catch { return null; }
  }
  if (encoding === 'utf-16-be') {
    try {
      return new TextEncoder().encode(
        new TextDecoder('utf-16be', { fatal: false }).decode(data),
      );
    } catch { return null; }
  }

  // utf-32 variants: WHATWG TextDecoder has no UTF-32 support — decode manually.
  if (encoding === 'utf-32' || encoding === 'utf-32-be' || encoding === 'utf-32-le') {
    return _utf32ToUtf8(data, encoding);
  }

  // utf-7: WHATWG TextDecoder has no UTF-7 support — decode shift sequences manually.
  if (encoding === 'utf-7') {
    return _utf7ToUtf8(data);
  }

  // All other encodings: look up the WHATWG label and use TextDecoder.
  const label = whatwgLabelFor(encoding);
  if (label === null) return null;
  try {
    return new TextEncoder().encode(
      new TextDecoder(label, { fatal: false }).decode(data),
    );
  } catch { return null; }
}
