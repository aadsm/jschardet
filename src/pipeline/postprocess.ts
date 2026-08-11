// Port of chardet/src/chardet/pipeline/postprocess.py — post-scoring result
// adjustments: confusion resolution, niche-Latin demotion, and the KOI8-T
// promotion.

import { DetectionResult } from './index.js';
import { resolveConfusionGroups } from './confusion.js';

// Common Western Latin encodings that share the iso-8859-1 character repertoire
// for the byte values where iso-8859-10 is indistinguishable. Used as swap
// targets when demoting iso-8859-10 — we prefer these over iso-8859-10 but do
// not want to accidentally promote an unrelated encoding (e.g. windows-1254).
const _COMMON_LATIN_ENCODINGS: ReadonlySet<string> = new Set([
  'iso8859-1',
  'iso8859-15',
  'cp1252',
]);

// Bytes where iso-8859-10 decodes to a different character than iso-8859-1.
// Computed programmatically via:
//   {b for b in range(0x80, 0x100)
//    if bytes([b]).decode('iso-8859-10') != bytes([b]).decode('iso-8859-1')}
const _ISO_8859_10_DISTINGUISHING: ReadonlySet<number> = new Set([
  0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA8, 0xA9, 0xAA, 0xAB, 0xAC, 0xAE, 0xAF,
  0xB1, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB8, 0xB9, 0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF,
  0xC0, 0xC7, 0xC8, 0xCA, 0xCC, 0xD1, 0xD2, 0xD7, 0xD9,
  0xE0, 0xE7, 0xE8, 0xEA, 0xEC, 0xF1, 0xF2, 0xF7, 0xF9, 0xFF,
]);

// Bytes where iso-8859-14 decodes to a different character than iso-8859-1.
// Computed programmatically via:
//   {b for b in range(0x80, 0x100)
//    if bytes([b]).decode('iso-8859-14') != bytes([b]).decode('iso-8859-1')}
const _ISO_8859_14_DISTINGUISHING: ReadonlySet<number> = new Set([
  0xA1, 0xA2, 0xA4, 0xA5, 0xA6, 0xA8, 0xAA, 0xAB, 0xAC, 0xAF,
  0xB0, 0xB1, 0xB2, 0xB3, 0xB4, 0xB5, 0xB7, 0xB8, 0xB9, 0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF,
  0xD0, 0xD7, 0xDE, 0xF0, 0xF7, 0xFE,
]);

// Bytes where windows-1254 has Turkish-specific characters that differ from
// windows-1252. Windows-1254 differs from windows-1252 at 8 byte positions.
// Two (0x8E, 0x9E) are undefined in Windows-1254 but defined in Windows-1252;
// these are excluded here because undefined bytes are not useful for
// identifying Turkish text. The remaining six positions map to Turkish-specific
// letters and are the primary distinguishing signal.
const _WINDOWS_1254_DISTINGUISHING: ReadonlySet<number> = new Set([
  0xD0, 0xDD, 0xDE, 0xF0, 0xFD, 0xFE,
]);

// Bytes where HP-Roman8 maps to lowercase accented letters but ISO-8859-1 maps
// to uppercase letters. Real HP-Roman8 text (from HP-UX terminals) contains
// these bytes; data misdetected as HP-Roman8 typically does not.
//   {b for b in range(0x80, 0x100)
//    if (unicodedata.category(bytes([b]).decode('hp-roman8')) == 'Ll'
//        and unicodedata.category(bytes([b]).decode('iso-8859-1')) == 'Lu')}
const _HP_ROMAN8_DISTINGUISHING: ReadonlySet<number> = new Set([
  0xC0, 0xC1, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xCB, 0xCC, 0xCD, 0xCE, 0xCF,
  0xD1, 0xD4, 0xD5, 0xD6, 0xD9, 0xDD, 0xDE,
]);

// Encodings that are often false positives when their distinguishing bytes are
// absent. Keyed by encoding name -> set of byte values where that encoding
// differs from iso-8859-1 (or windows-1252 in the case of windows-1254).
const _DEMOTION_CANDIDATES: ReadonlyMap<string, ReadonlySet<number>> = new Map<
  string,
  ReadonlySet<number>
>([
  ['iso8859-10', _ISO_8859_10_DISTINGUISHING],
  ['iso8859-14', _ISO_8859_14_DISTINGUISHING],
  ['cp1254', _WINDOWS_1254_DISTINGUISHING],
  ['hp-roman8', _HP_ROMAN8_DISTINGUISHING],
]);

// Bytes where KOI8-T maps to Tajik-specific Cyrillic letters but KOI8-R maps to
// box-drawing characters. Presence of any of these bytes is strong evidence for
// KOI8-T over KOI8-R.
const _KOI8_T_DISTINGUISHING: ReadonlySet<number> = new Set([
  0x80, 0x81, 0x83, 0x8A, 0x8C, 0x8D, 0x8E, 0x90, 0xA1, 0xA2, 0xA5, 0xB5,
]);

function _shouldDemote(encoding: string, data: Uint8Array): boolean {
  const distinguishing = _DEMOTION_CANDIDATES.get(encoding);
  if (distinguishing === undefined) {
    return false;
  }
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b > 0x7F && distinguishing.has(b)) {
      return false;
    }
  }
  return true;
}

function _demoteNicheLatin(
  data: Uint8Array,
  results: DetectionResult[],
): DetectionResult[] {
  if (
    results.length > 1
    && results[0].encoding !== null
    && _shouldDemote(results[0].encoding, data)
  ) {
    const demotedEncoding = results[0].encoding;
    const topConf = results[0].confidence;
    for (let i = 1; i < results.length; i++) {
      const r = results[i];
      if (r.encoding !== null && _COMMON_LATIN_ENCODINGS.has(r.encoding)) {
        const promoted: DetectionResult = {
          encoding: r.encoding,
          confidence: topConf,
          language: r.language,
          mimeType: r.mimeType,
        };
        const others = results.filter(
          x => x.encoding !== demotedEncoding && x !== r,
        );
        const demotedEntries = results.filter(x => x.encoding === demotedEncoding);
        return [promoted, ...others, ...demotedEntries];
      }
    }
  }
  return results;
}

function _promoteKoi8t(
  data: Uint8Array,
  results: DetectionResult[],
): DetectionResult[] {
  if (results.length === 0 || results[0].encoding !== 'koi8-r') {
    return results;
  }
  // Array.prototype.findIndex returns -1 (not null) when absent, unlike
  // Python's next(..., None).
  const koi8tIdx = results.findIndex(r => r.encoding === 'koi8-t');
  if (koi8tIdx === -1) {
    return results;
  }
  // Check for Tajik-specific bytes
  let hasDistinguishing = false;
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b > 0x7F && _KOI8_T_DISTINGUISHING.has(b)) {
      hasDistinguishing = true;
      break;
    }
  }
  if (hasDistinguishing) {
    const koi8tResult = results[koi8tIdx];
    const topConf = results[0].confidence;
    const promoted: DetectionResult = {
      encoding: koi8tResult.encoding,
      confidence: topConf,
      language: koi8tResult.language,
      mimeType: koi8tResult.mimeType,
    };
    const others = results.filter((_, i) => i !== koi8tIdx);
    return [promoted, ...others];
  }
  return results;
}

export function postprocessResults(
  data: Uint8Array,
  results: DetectionResult[],
): DetectionResult[] {
  results = resolveConfusionGroups(data, results);
  results = _demoteNicheLatin(data, results);
  return _promoteKoi8t(data, results);
}

export {
  _COMMON_LATIN_ENCODINGS,
  _DEMOTION_CANDIDATES,
  _HP_ROMAN8_DISTINGUISHING,
  _ISO_8859_10_DISTINGUISHING,
  _ISO_8859_14_DISTINGUISHING,
  _KOI8_T_DISTINGUISHING,
  _WINDOWS_1254_DISTINGUISHING,
  _demoteNicheLatin,
  _promoteKoi8t,
  _shouldDemote,
};
