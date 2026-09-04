// Stage 2a: byte sequence validity filtering. Port of
// chardet/src/chardet/pipeline/validity.py — filter_by_validity.

import { EncodingInfo } from '../registry.js';
import { decodesWithoutError } from '../decode.js';

export function filterByValidity(
  data: Uint8Array,
  candidates: readonly EncodingInfo[],
): readonly EncodingInfo[] {
  if (data.length === 0) return candidates;

  const valid: EncodingInfo[] = [];
  for (const enc of candidates) {
    if (decodesWithoutError(enc.name, data)) {
      valid.push(enc);
    }
  }
  return valid;
}
