import { DEFAULT_MAX_BYTES } from '../utils.js';

const _BINARY_THRESHOLD = 0.01;

export function isBinary(data: Uint8Array, maxBytes: number = DEFAULT_MAX_BYTES): boolean {
  data = data.subarray(0, maxBytes);
  if (data.length === 0) return false;

  // Replaces Python bytes.translate(None, ALLOWED) — count bytes not in the allowed set
  // Binary indicators: 0x00–0x08 and 0x0E–0x1F (excludes \t \n \v \f \r)
  let binaryCount = 0;
  for (const b of data) {
    if (b <= 0x08 || (b >= 0x0E && b <= 0x1F)) binaryCount++;
  }
  return binaryCount / data.length > _BINARY_THRESHOLD;
}
