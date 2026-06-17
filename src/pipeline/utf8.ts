import { DetectionResult } from './index.js';

const _BASE_CONFIDENCE = 0.80;
const _MAX_CONFIDENCE = 0.99;
const _MB_RATIO_SCALE = 6;

export function detectUtf8(data: Uint8Array): DetectionResult | null {
  if (data.length === 0) return null;

  let i = 0;
  const length = data.length;
  let multibyteSequences = 0;
  let multibyteBytes = 0;

  while (i < length) {
    const byte = data[i];

    if (byte < 0x80) {
      i++;
      continue;
    }

    let seqLen: number;
    if (0xC2 <= byte && byte <= 0xDF) {
      seqLen = 2;
    } else if (0xE0 <= byte && byte <= 0xEF) {
      seqLen = 3;
    } else if (0xF0 <= byte && byte <= 0xF4) {
      seqLen = 4;
    } else {
      return null; // invalid start byte (0x80–0xC1, 0xF5–0xFF)
    }

    // Truncated final sequence — structurally correct so far, stop here
    if (i + seqLen > length) break;

    // Validate continuation bytes (must be 0x80–0xBF)
    for (let j = 1; j < seqLen; j++) {
      if (!(0x80 <= data[i + j] && data[i + j] <= 0xBF)) return null;
    }

    // Reject overlong encodings and surrogates
    if (seqLen === 3) {
      if (byte === 0xE0 && data[i + 1] < 0xA0) return null; // overlong 3-byte
      if (byte === 0xED && data[i + 1] > 0x9F) return null; // surrogates U+D800–U+DFFF
    } else if (seqLen === 4) {
      if (byte === 0xF0 && data[i + 1] < 0x90) return null; // overlong 4-byte
      if (byte === 0xF4 && data[i + 1] > 0x8F) return null; // above U+10FFFF
    }

    multibyteSequences++;
    multibyteBytes += seqLen;
    i += seqLen;
  }

  if (multibyteSequences === 0) return null; // pure ASCII — let ASCII detector handle it

  const mbRatio = multibyteBytes / length;
  const confidenceRange = _MAX_CONFIDENCE - _BASE_CONFIDENCE;
  const confidence = Math.min(
    _MAX_CONFIDENCE,
    _BASE_CONFIDENCE + confidenceRange * Math.min(mbRatio * _MB_RATIO_SCALE, 1.0)
  );
  return { encoding: 'utf-8', confidence, language: null, mimeType: null };
}
