// Decode bytes as CPython would, by chardet encoding name: the port of the
// decode questions chardet asks through the codecs module — the three
// predicates in chardet's _utils.py, and bytes.decode(..., errors="ignore")
// for language scoring. Every WHATWG decode the pipeline makes goes through
// here, so this is the one place that picks the mechanism per encoding:
//
//   - a single-byte codec is answered from the build-time byte tables
//     (pipeline/byte-decode.ts), which carry Python's strict codec behaviour:
//     windows-125x and the other SBCS with WHATWG labels then match Python's
//     strict decode instead of WHATWG's permissive pass-through of undefined
//     C1 positions, and the pages TextDecoder lacks are checked rather than
//     waved through;
//   - a multi-byte encoding decodes through its WHATWG decoder
//     (text-decoder.ts), the one mechanism the runtime has for it;
//   - an encoding with no WHATWG decoder cannot be decoded at runtime, and
//     each function says what it answers then.
//
// docs/textdecoder-vs-python.md maps the gaps between the two mechanisms.

import {
  whatwgDanglingTailWithAsciiPrefix,
  whatwgDecodeStrictText,
  whatwgDecodeText,
  whatwgDecodesCompletely,
  whatwgDecodesWithoutError,
  whatwgLabelFor,
} from './text-decoder.js';
import {
  byteDecodeTable,
  decodeSingleByteText,
  decodesAsSingleByte,
} from './pipeline/byte-decode.js';
import { utf7DecodesWithoutError } from './pipeline/to-utf8.js';

// chardet's decodes_without_error, the validity stage's per-encoding
// predicate: "could these bytes be text in this encoding?", answered exactly
// as filter_by_validity would — tolerant of an incomplete multi-byte
// sequence at the end of the input, which detection input (usually a prefix
// of a larger whole) routinely has. An encoding with no WHATWG decoder is
// treated as valid, exactly as filter_by_validity keeps it. ascii is a
// single-byte codec like any other, with every high byte undefined; its
// WHATWG label is an alias of windows-1252 and would accept them all.
//
// Callers that must reproduce validity's judgment on a different window — the
// past-cap validity hold, and prefer_superset's decode-safety check — go
// through this, never raw whatwgDecodesWithoutError, or windows-1252's
// gap-filling WHATWG decoder passes bytes (0x81, 0x8D, 0x9D) that Python's
// codec rejects.
export function decodesWithoutError(encName: string, data: Uint8Array): boolean {
  const singleByte = decodesAsSingleByte(encName, data);
  if (singleByte !== null) return singleByte;
  const utf = _utfDecodesWithoutError(encName, data);
  if (utf !== null) return utf;
  const label = whatwgLabelFor(encName);
  if (label === null) return true;
  return whatwgDecodesWithoutError(label, data);
}

// decodesWithoutError for the UTF encodings with no WHATWG label of their
// own, answered as CPython's codecs would; null for any other name. WHATWG
// has UTF-8 and the two fixed-endian UTF-16 decoders, so utf-8-sig and
// utf-16 decode through those once the mark is read (WHATWG's utf-16 label
// is plain utf-16le and does not read the mark), UTF-32 is checked by
// _utf32DecodesWithoutError, and UTF-7 by to-utf8.ts's reimplementation of
// CPython's decoder.
//
// CPython's utf-16 and utf-32 decoders take the byte order from the mark and
// raise when the stream does not start with one; a stream too short to hold
// a whole mark is deferred like any truncated tail.
function _utfDecodesWithoutError(encName: string, data: Uint8Array): boolean | null {
  switch (encName) {
    case 'utf-8-sig':
      return whatwgDecodesWithoutError('utf-8', data);
    case 'utf-16':
      if (data.length < 2) return true;
      if (data[0] === 0xfe && data[1] === 0xff) return whatwgDecodesWithoutError('utf-16be', data.subarray(2));
      if (data[0] === 0xff && data[1] === 0xfe) return whatwgDecodesWithoutError('utf-16le', data.subarray(2));
      return false;
    case 'utf-32':
      if (data.length < 4) return true;
      if (data[0] === 0x00 && data[1] === 0x00 && data[2] === 0xfe && data[3] === 0xff) {
        return _utf32DecodesWithoutError(data.subarray(4), false);
      }
      if (data[0] === 0xff && data[1] === 0xfe && data[2] === 0x00 && data[3] === 0x00) {
        return _utf32DecodesWithoutError(data.subarray(4), true);
      }
      return false;
    case 'utf-32-be':
      return _utf32DecodesWithoutError(data, false);
    case 'utf-32-le':
      return _utf32DecodesWithoutError(data, true);
    case 'utf-7':
      return utf7DecodesWithoutError(data);
    default:
      return null;
  }
}

// CPython's utf_32 decoder: every 4-byte unit must be a Unicode scalar value
// (at most U+10FFFF, not a surrogate). A partial unit at the end is a
// truncated tail and is tolerated, as decodesWithoutError tolerates one for
// every encoding.
function _utf32DecodesWithoutError(data: Uint8Array, littleEndian: boolean): boolean {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const whole = data.length - (data.length % 4);
  for (let i = 0; i < whole; i += 4) {
    const cp = view.getUint32(i, littleEndian);
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return false;
  }
  return true;
}

// The escape sequences WHATWG's iso-2022-jp decoder accepts. ISO-2022-JP-2
// has more (ESC $ ( D for JIS X 0212, ESC $ A for GB 2312, ESC . A for the
// Latin-1 upper half, ...) that the decoder rejects even though CPython's
// iso2022_jp_2 decodes them.
const _ISO2022JP_ESCAPES: readonly (readonly number[])[] = [
  [0x1b, 0x28, 0x42], // ESC ( B
  [0x1b, 0x28, 0x4a], // ESC ( J
  [0x1b, 0x28, 0x49], // ESC ( I
  [0x1b, 0x24, 0x40], // ESC $ @
  [0x1b, 0x24, 0x42], // ESC $ B
];

// decodesWithoutError for iso2022_jp_2, as the escape stage asks it. The
// port decodes iso2022_jp_2 with WHATWG's iso-2022-jp, which reads plain
// ISO-2022-JP only, so data using an escape sequence that decoder doesn't
// know cannot be checked and answers true, as an encoding with no decoder
// does; any other data gets iso-2022-jp's verdict. Only the escape stage
// asks this: decodesWithoutError itself stays keyed by name alone.
export function iso2022Jp2DecodesWithoutError(data: Uint8Array): boolean {
  for (let i = data.indexOf(0x1b); i !== -1; i = data.indexOf(0x1b, i + 1)) {
    const known = _ISO2022JP_ESCAPES.some(seq => seq.every((b, j) => data[i + j] === b));
    if (!known) return true;
  }
  return decodesWithoutError('iso2022_jp_2', data);
}

// chardet's decodes_completely, the strict, whole-input sibling of
// decodesWithoutError: "does the caller's own data.decode(encName) succeed
// over the entire input?" (a one-shot fatal decode, so a truncated multi-byte
// tail is an error, not a deferred tail). Used by the decode-safety flip, whose
// promise is that the reported name decodes the caller's complete input.
//
// It must reproduce Python's strict per-codec behaviour, which the WHATWG
// decoders relax: 'ascii' is a WHATWG alias for windows-1252 (so its decoder
// accepts every high byte), and the windows-125x decoders gap-fill the C1
// positions Python leaves undefined. Every single-byte encoding, ascii
// included, is answered from the authoritative byte tables; TextDecoder is
// left the multi-byte encodings, which it decodes faithfully. An encoding
// with no WHATWG decoder answers false: the caller's decode would not
// succeed either.
export function decodesCompletely(encName: string, data: Uint8Array): boolean {
  const singleByte = decodesAsSingleByte(encName, data);
  if (singleByte !== null) return singleByte;
  const label = whatwgLabelFor(encName);
  if (label === null) return false;
  return whatwgDecodesCompletely(label, data);
}

// chardet's dangling_tail_with_ascii_prefix: "is data non-empty pure ASCII
// followed by an incomplete multi-byte sequence?" — the decode-safety flip's
// test that a winner's only non-ASCII evidence is its undecodable tail. A
// single-byte encoding has no multi-byte tail, so the answer is false without
// a decode; a multi-byte encoding is answered by its WHATWG decoder, and one
// with no WHATWG decoder cannot be checked (chardet answers False for a codec
// it cannot build).
export function danglingTailWithAsciiPrefix(encName: string, data: Uint8Array): boolean {
  if (byteDecodeTable(encName)?.singleByte) return false;
  const label = whatwgLabelFor(encName);
  if (label === null) return false;
  return whatwgDanglingTailWithAsciiPrefix(label, data);
}

// data.decode(encName, errors="ignore") for language scoring, through the
// encoding's WHATWG decoder; null when there is none (the caller then has no
// text to score). The UTF family is decoded by pipeline/to-utf8.ts itself,
// which handles the BOM and the forms WHATWG lacks before falling through to
// this. A WHATWG single-byte decoder gap-fills the positions Python's codec
// drops and has no answer at all for the pages it lacks, so this is where
// language scoring still sees WHATWG's text rather than Python's.
export function decodeText(encName: string, data: Uint8Array): string | null {
  const label = whatwgLabelFor(encName);
  if (label === null) return null;
  return whatwgDecodeText(label, data);
}

// data.decode(encName): the strict text, or null when the bytes do not decode
// (Python raises) or the runtime has no decoder for the name. A single-byte
// encoding decodes from the byte tables; a multi-byte one through its WHATWG
// decoder. The UTF-16/32 stage reads its candidate text through this.
export function decodeStrictText(encName: string, data: Uint8Array): string | null {
  const singleByte = decodesAsSingleByte(encName, data);
  if (singleByte !== null) {
    return singleByte ? decodeSingleByteText(byteDecodeTable(encName)!, data) : null;
  }
  const label = whatwgLabelFor(encName);
  if (label === null) return null;
  return whatwgDecodeStrictText(label, data);
}
