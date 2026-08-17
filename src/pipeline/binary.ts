import { DEFAULT_MAX_BYTES } from '../utils.js';

const _BINARY_THRESHOLD = 0.01;

// Minimum fraction of high bytes (>= 0x80) among the *non-space* bytes for
// data to plausibly be EBCDIC text. EBCDIC encodes all lowercase letters
// above 0x80, so genuine EBCDIC text is dominated by high bytes — but the
// EBCDIC space is 0x40, and space-padded fixed-width records (the canonical
// mainframe data shape) would dilute a whole-data fraction below any useful
// threshold, so padding is excluded from the denominator.
const _EBCDIC_MIN_HIGH_FRACTION = 0.25;

// Minimum fraction of EBCDIC word separators (0x40 space or 0x05 HT) in
// the data. Text separates words or fields; a binary payload framed with
// ENQ/NAK passes the control-byte check yet has no reason to contain
// EBCDIC word structure (random bytes put each separator at ~0.4%, and
// per-record framing bytes stay well under 2%). HT counts so that
// tab-separated record exports with no spaces are still recognized.
const _EBCDIC_MIN_SPACE_FRACTION = 0.02;

const _EBCDIC_SPACE = 0x40;
const _EBCDIC_HT = 0x05;

export function isBinary(data: Uint8Array, maxBytes: number = DEFAULT_MAX_BYTES): boolean {
  data = data.subarray(0, maxBytes);
  if (data.length === 0) return false;

  // Replaces Python bytes.translate(None, _BINARY_DELETE) — count binary
  // indicators: 0x00–0x08 and 0x0E–0x1F (excludes \t \n \v \f \r). The
  // "hard" count additionally excludes the EBCDIC whitespace controls 0x05
  // (EBCDIC HT) and 0x15 (EBCDIC NL): EBCDIC text uses these as tab and
  // newline, so they are only binary evidence when the rest of the data
  // does not look like EBCDIC. The single pass also gathers the separator
  // and high-byte tallies the EBCDIC plausibility check below needs.
  let binaryCount = 0;
  let hardCount = 0;
  let spaceCount = 0;
  let highCount = 0;
  for (const b of data) {
    if (b <= 0x08 || (b >= 0x0E && b <= 0x1F)) {
      binaryCount++;
      if (b !== 0x05 && b !== 0x15) hardCount++;
    }
    if (b === _EBCDIC_SPACE || b === _EBCDIC_HT) spaceCount++;
    if (b >= 0x80) highCount++;
  }
  if (binaryCount / data.length <= _BINARY_THRESHOLD) return false;

  // Above the threshold — but if the excess comes entirely from the EBCDIC
  // whitespace bytes and the data looks like EBCDIC text, treat it as text.
  if (hardCount / data.length > _BINARY_THRESHOLD) return true;
  const nonSpace = data.length - spaceCount;
  if (nonSpace === 0) return false;
  if (highCount / nonSpace < _EBCDIC_MIN_HIGH_FRACTION) return true;
  return spaceCount / data.length < _EBCDIC_MIN_SPACE_FRACTION;
}
