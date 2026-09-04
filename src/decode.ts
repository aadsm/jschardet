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
  const label = whatwgLabelFor(encName);
  if (label === null) return true;
  return whatwgDecodesWithoutError(label, data);
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
