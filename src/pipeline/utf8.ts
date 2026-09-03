// Stage 1d: UTF-8 structural validation.
//
// Upstream rewrote this as a chunked strict decode through CPython's C decoder
// (ADR-0006). The port keeps the hand-rolled per-byte loop below: it is the
// oracle upstream's differential suite tests against, it is already the fast
// path under a JIT, and a TextDecoder rewrite would reintroduce
// tolerated-tail reconstruction for no change in result. See "UTF-8 validation
// mechanism" in docs/port-notes.md for the divergence.

import { DetectionResult } from './index.js';

const _BASE_CONFIDENCE = 0.80;
const _MAX_CONFIDENCE = 0.99;
const _MB_RATIO_SCALE = 6;

export function detectUtf8(data: Uint8Array): DetectionResult | null {
  return scanUtf8(data)[1];
}

// Validate UTF-8 structure, separating validity from evidence.
//
// null from detectUtf8 is two different verdicts: the data is *not* UTF-8, or
// it is valid UTF-8 carrying no multi-byte evidence (pure ASCII, ASCII plus
// control bytes, ASCII plus a truncated tail). Only the first justifies ruling
// UTF-8 out downstream (the orchestrator's past-cap veto), so callers that act
// on a rejection need both halves of the answer. Returns
// [windowIsValidUtf8, resultOrNull]: the flag covers the whole of data; the
// result is present only when complete multi-byte sequences were found.
export function scanUtf8(data: Uint8Array): [boolean, DetectionResult | null] {
  if (data.length === 0) return [true, null];

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
      return [false, null]; // invalid start byte (0x80–0xC1, 0xF5–0xFF)
    }

    // Truncated final sequence — structurally correct so far, stop here. The
    // bytes seen are valid, so the window's validity is not in question.
    if (i + seqLen > length) break;

    // Validate continuation bytes (must be 0x80–0xBF)
    for (let j = 1; j < seqLen; j++) {
      if (!(0x80 <= data[i + j] && data[i + j] <= 0xBF)) return [false, null];
    }

    // Reject overlong encodings and surrogates
    if (seqLen === 3) {
      if (byte === 0xE0 && data[i + 1] < 0xA0) return [false, null]; // overlong 3-byte
      if (byte === 0xED && data[i + 1] > 0x9F) return [false, null]; // surrogates U+D800–U+DFFF
    } else if (seqLen === 4) {
      if (byte === 0xF0 && data[i + 1] < 0x90) return [false, null]; // overlong 4-byte
      if (byte === 0xF4 && data[i + 1] > 0x8F) return [false, null]; // above U+10FFFF
    }

    multibyteSequences++;
    multibyteBytes += seqLen;
    i += seqLen;
  }

  // Valid UTF-8, but no complete multi-byte sequence (pure ASCII, ASCII plus
  // control bytes, ASCII plus a truncated tail) — let the later stages handle
  // it. The window is still valid.
  if (multibyteSequences === 0) return [true, null];

  const mbRatio = multibyteBytes / length;
  const confidenceRange = _MAX_CONFIDENCE - _BASE_CONFIDENCE;
  const confidence = Math.min(
    _MAX_CONFIDENCE,
    _BASE_CONFIDENCE + confidenceRange * Math.min(mbRatio * _MB_RATIO_SCALE, 1.0)
  );
  return [true, { encoding: 'utf-8', confidence, language: null, mimeType: null }];
}
