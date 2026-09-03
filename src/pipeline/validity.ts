// Stage 2a: byte sequence validity filtering. Port of
// chardet/src/chardet/pipeline/validity.py — filter_by_validity.

import { EncodingInfo } from '../registry.js';
import { SBCS_UNDEFINED_BYTES } from '../sbcs-undefined-bytes.js';
import { decodesCompletely, decodesWithoutError, whatwgLabelFor } from '../text-decoder.js';

// The validity stage's per-encoding predicate: "could these bytes be text in
// this encoding?", answered exactly as filter_by_validity would. The
// build-time-extracted undefined-byte set is derived from Python's strict
// codec behaviour and is authoritative for the SBCS it covers, so it is
// consulted before TextDecoder — windows-125x (and other SBCS with WHATWG
// labels) then match Python's strict decode instead of WHATWG's permissive
// pass-through of undefined C1 positions. An encoding with neither a table
// entry nor a WHATWG label cannot be checked and is treated as valid, exactly
// as filter_by_validity keeps it.
//
// Callers that must reproduce validity's judgment on a different window — the
// past-cap validity hold, and prefer_superset's decode-safety check — go
// through this, never raw decodesWithoutError, or windows-1252's gap-filling
// WHATWG decoder passes bytes (0x81, 0x8D, 0x9D) that Python's codec rejects.
export function decodesUnderValidity(encName: string, data: Uint8Array): boolean {
  const undefSet = SBCS_UNDEFINED_BYTES[encName];
  if (undefSet !== undefined) {
    for (let i = 0; i < data.length; i++) {
      if (undefSet.has(data[i])) return false;
    }
    return true;
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
// positions Python leaves undefined. Consult the authoritative tables first —
// all-7-bit for ascii, the SBCS undefined-byte set otherwise — before falling
// back to TextDecoder for the encodings it decodes faithfully.
export function decodesCompletelyUnderValidity(encName: string, data: Uint8Array): boolean {
  if (encName === 'ascii') {
    for (let i = 0; i < data.length; i++) {
      if (data[i] >= 0x80) return false;
    }
    return true;
  }
  const undefSet = SBCS_UNDEFINED_BYTES[encName];
  if (undefSet !== undefined) {
    // A single-byte encoding decodes its whole input iff no undefined byte
    // appears: every defined byte maps, and there is no multi-byte tail to
    // truncate.
    for (let i = 0; i < data.length; i++) {
      if (undefSet.has(data[i])) return false;
    }
    return true;
  }
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
