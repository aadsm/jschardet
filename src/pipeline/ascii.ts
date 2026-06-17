import { ASCII_TEXT_BYTES, DetectionResult } from './index.js';

const _MAX_NULL_FRACTION = 0.05;

export function detectAscii(data: Uint8Array): DetectionResult | null {
  if (data.length === 0) return null;

  // Replaces Python bytes.translate(None, ALLOWED) — count bytes not in the allowed set
  let nonAllowed = 0;
  let nullCount = 0;
  for (const b of data) {
    if (!ASCII_TEXT_BYTES.has(b)) {
      nonAllowed++;
      if (b === 0x00) nullCount++;
    }
  }

  if (nonAllowed === 0) {
    return { encoding: 'ascii', confidence: 1.0, language: null, mimeType: null };
  }
  // All non-allowed bytes must be null separators
  if (nonAllowed !== nullCount) return null;

  const nullFraction = nullCount / data.length;
  if (nullFraction <= _MAX_NULL_FRACTION) {
    return { encoding: 'ascii', confidence: 0.99, language: null, mimeType: null };
  }
  return null;
}
