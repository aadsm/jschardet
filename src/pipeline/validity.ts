// Stage 2a: byte sequence validity filtering. Port of
// chardet/src/chardet/pipeline/validity.py — filter_by_validity.

import { EncodingInfo } from '../registry.js';
import { decodesCompletely, decodesWithoutError, whatwgLabelFor } from '../text-decoder.js';
import { decodesAsSingleByte } from './byte-decode.js';

// The validity stage's per-encoding predicate: "could these bytes be text in
// this encoding?", answered exactly as filter_by_validity would. A
// single-byte encoding is answered from the byte tables, which carry
// Python's strict codec behaviour and are authoritative — windows-125x (and
// other SBCS with WHATWG labels) then match Python's strict decode instead
// of WHATWG's permissive pass-through of undefined C1 positions, and the
// pages TextDecoder lacks are checked rather than waved through. A
// multi-byte encoding decodes through TextDecoder; one with no WHATWG label
// cannot be checked and is treated as valid, exactly as filter_by_validity
// keeps it.
//
// ascii is the one single-byte codec kept on the TextDecoder path: its WHATWG
// label is an alias of windows-1252, so it accepts every high byte here,
// where Python's codec rejects them. The ascii stage settles pure-ASCII
// input before validity runs, and the strict sibling below answers ascii
// from the tables.
//
// Callers that must reproduce validity's judgment on a different window — the
// past-cap validity hold, and prefer_superset's decode-safety check — go
// through this, never raw decodesWithoutError, or windows-1252's gap-filling
// WHATWG decoder passes bytes (0x81, 0x8D, 0x9D) that Python's codec rejects.
export function decodesUnderValidity(encName: string, data: Uint8Array): boolean {
  if (encName !== 'ascii') {
    const singleByte = decodesAsSingleByte(encName, data);
    if (singleByte !== null) return singleByte;
  }
  const label = whatwgLabelFor(encName);
  if (label === null) return true;
  return decodesWithoutError(label, data);
}

// The strict, whole-input sibling of decodesUnderValidity: "does the caller's
// own data.decode(encName) succeed over the entire input?", mirroring Python's
// decodes_completely (a one-shot fatal decode, so a truncated multi-byte tail
// is an error, not a deferred tail). Used by the decode-safety flip, whose
// promise is that the reported name decodes the caller's complete input.
//
// It must reproduce Python's strict per-codec behaviour, which the WHATWG
// decoders relax: 'ascii' is a WHATWG alias for windows-1252 (so its decoder
// accepts every high byte), and the windows-125x decoders gap-fill the C1
// positions Python leaves undefined. Every single-byte encoding, ascii
// included, is answered from the authoritative byte tables; TextDecoder is
// left the multi-byte encodings, which it decodes faithfully.
export function decodesCompletelyUnderValidity(encName: string, data: Uint8Array): boolean {
  const singleByte = decodesAsSingleByte(encName, data);
  if (singleByte !== null) return singleByte;
  const label = whatwgLabelFor(encName);
  if (label === null) return false;
  return decodesCompletely(label, data);
}

export function filterByValidity(
  data: Uint8Array,
  candidates: readonly EncodingInfo[],
): readonly EncodingInfo[] {
  if (data.length === 0) return candidates;

  const valid: EncodingInfo[] = [];
  for (const enc of candidates) {
    if (decodesUnderValidity(enc.name, data)) {
      valid.push(enc);
    }
  }
  return valid;
}
