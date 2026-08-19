// Port of chardet/src/chardet/pipeline/postprocess.py — Stage 13:
// post-processing rank corrections.
//
// After statistical scoring produces a ranked list of candidates, a chain
// of rank corrections fixes up the ranking when bigrams alone are
// insufficient — see postprocessResults for the order. The steps:
// dead-heat priors (superset preference, era prevalence), rare-language
// arbitration (ADR-0005), confusion-group resolution (delegated to
// confusion.ts), niche Latin demotion, KOI8-T promotion, classic-Mac
// line-ending promotion, and last of all the decode-safety flip, which
// hands a winner whose only multi-byte evidence is an undecodable trailing
// sequence to the best rival that can decode the caller's complete input.

import { DetectionResult } from './index.js';
import { confusionPairWinner, resolveConfusionGroups } from './confusion.js';
import {
  ART_LANGUAGE,
  ASCII_WHITESPACE_TABLE,
  BigramProfile,
  RARE_LANGUAGES,
  getEncIndex,
  getIdfWeights,
  scoreWithProfile,
} from '../models/index.js';
import { REGISTRY, lookupEncoding } from '../registry.js';
import { _COMPAT_NAMES } from '../output_names.js';
import {
  danglingTailWithAsciiPrefix,
  decodesCompletely,
  decodesWithoutError,
  whatwgLabelFor,
} from '../text-decoder.js';

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

// True if encoding is a demotion candidate with no real byte evidence.
//
// Checks whether any byte in data falls in the set of byte values that
// decode differently under the given encoding vs iso-8859-1. If none do,
// the data is equally valid under both encodings and there is no
// byte-level evidence for preferring the candidate encoding.
//
// Presence alone is not enough to stand the demotion down, though: a
// mostly-ASCII Latin-1 file whose only non-ASCII bytes are one 0xD6/0xF6
// pair carries a "distinguishing" byte (0xD6 is a lowercase letter under
// hp-roman8, uppercase O-umlaut under Latin-1) while the winning model
// earned less confidence from all its high-byte bigrams than the
// dead-heat epsilon. Such a win is statistical noise wearing a
// distinguishing byte as a costume, so the demotion also fires when the
// high-byte evidence contribution is at or under the noise floor.
function _shouldDemote(
  encoding: string,
  data: Uint8Array,
  language: string | null,
): boolean {
  const distinguishing = _DEMOTION_CANDIDATES.get(encoding);
  if (distinguishing === undefined) {
    return false;
  }
  let hasDistinguishing = false;
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b > 0x7F && distinguishing.has(b)) {
      hasDistinguishing = true;
      break;
    }
  }
  if (!hasDistinguishing) return true;
  return _highByteEvidenceMargin(data, encoding, language) <= _DEAD_HEAT_EPSILON;
}

function _demoteNicheLatin(
  data: Uint8Array,
  results: DetectionResult[],
): DetectionResult[] {
  if (
    results.length > 1
    && results[0].encoding !== null
    && _shouldDemote(results[0].encoding, data, results[0].language)
  ) {
    const demotedEncoding = results[0].encoding;
    const topConf = results[0].confidence;
    // The replacement is the most prevalent common Latin candidate among
    // those tied with the best-scoring one (within _DEAD_HEAT_EPSILON of
    // the highest-confidence common Latin candidate): inside that band the
    // confidence order is noise — the very premise of the demotion — so
    // era prevalence picks between e.g. iso8859-1 and cp1252 rather than
    // a sub-epsilon score difference. A candidate trailing the best
    // common Latin by more than the epsilon lost to it on real evidence
    // and stays put.
    const candidates = results.slice(1).filter(
      (x): x is DetectionResult & { encoding: string } =>
        x.encoding !== null && _COMMON_LATIN_ENCODINGS.has(x.encoding),
    );
    if (candidates.length > 0) {
      const leadConf = candidates[0].confidence;
      const inBand = candidates.filter(
        x => leadConf - x.confidence <= _DEAD_HEAT_EPSILON,
      );
      let r = inBand[0];
      let bestRank = _eraRank(r.encoding);
      for (const c of inBand) {
        const rank = _eraRank(c.encoding);
        if (rank < bestRank) {
          r = c;
          bestRank = rank;
        }
      }
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

// Confidence gap within which two results count as a statistical dead heat.
const _DEAD_HEAT_EPSILON = 1e-4;

// On a dead heat between an encoding and its Windows superset, prefer the
// superset: it decodes everything the base encoding does, so it is never a
// worse answer when the statistics cannot separate them. Mirrors
// markup._MARKUP_SUPERSET_PROMOTIONS (chardet also lists shift_jis, which
// the port folds into shift_jis_2004 — see the registry).
const _DEAD_HEAT_SUPERSETS: Readonly<Record<string, string>> = Object.freeze({
  shift_jis_2004: 'cp932',
  euc_kr: 'cp949',
});

// Confidence band for the classic-Mac line-ending promotion. Wider than the
// dead-heat epsilon because bare-\r line endings are decisive platform
// evidence, not just a prior. Matches confusion._CONFUSION_BAND.
const _CR_MAC_BAND = 0.005;

// Minimum number of \r line endings before the classic-Mac promotion fires.
const _CR_MAC_MIN_LINES = 3;

// EncodingEra.LEGACY_MAC.
const _LEGACY_MAC_ERA = 4;

// Cap on the data scanned for high-byte bigram evidence — matches the
// window statistical scoring uses (orchestrator's stat-score cap), so the
// evidence check sees the same bytes the scores were computed from.
const _EVIDENCE_SCAN_MAX_BYTES = 16384;

// Lowest era bit for encoding (lower = more prevalent today).
function _eraRank(encoding: string): number {
  const info = REGISTRY[encoding as keyof typeof REGISTRY];
  if (info === undefined) return 1 << 30;
  const era = info.era;
  return era & -era;
}

// True if encoding's winning model weights a high-byte bigram present in
// data. A candidate whose model assigns zero weight to every non-ASCII
// bigram in the data earned its statistical score purely from ASCII
// bigrams — noise that cannot distinguish encodings. Only the variant that
// actually won (language) counts: another language's variant having weight
// for those bytes says nothing about why this result is on top. Only
// called on dead heats, so the scan of the (capped) data is off the hot
// path.
function _hasHighByteEvidence(
  data: Uint8Array,
  encoding: string,
  language: string | null,
): boolean {
  const variants = getEncIndex().get(encoding);
  if (variants === undefined || variants.length === 0) return false;
  const window = data.subarray(0, _EVIDENCE_SCAN_MAX_BYTES);
  if (window.length === 0) return false;
  const seen = new Set<number>();
  let prev = window[0];
  for (let i = 1; i < window.length; i++) {
    const b = window[i];
    if (prev >= 0x80 || b >= 0x80) seen.add((prev << 8) | b);
    prev = b;
  }
  if (seen.size === 0) return false;
  for (const [lang, table] of variants) {
    if (language !== null && lang !== language) continue;
    for (const idx of seen) {
      if (table[idx]) return true;
    }
  }
  return false;
}

// The confidence encoding's winning model earned from high-byte bigrams
// (chardet's _high_byte_evidence_margin). Measured in confidence units:
// the winning variant's cosine terms restricted to bigrams with a byte
// >= 0x80, over the same scoring window and with the same
// repeated-whitespace skip the statistical score used (computed as a
// focused-profile score rescaled from the focused norm to the full
// window's norm). Used by the niche-Latin demotion, where presence alone
// must not veto: a lone accented letter can put one weight-1 bigram in
// some variant's table and hand the candidate a lead worth less than the
// dead-heat epsilon itself. Only the variant that actually won (language)
// counts. Only called on niche-Latin tops, so the scan of the (capped)
// data is off the hot path.
function _highByteEvidenceMargin(
  data: Uint8Array,
  encoding: string,
  language: string | null,
): number {
  const variants = getEncIndex().get(encoding);
  if (variants === undefined || variants.length === 0) return 0;
  const window = data.subarray(0, _EVIDENCE_SCAN_MAX_BYTES);
  if (window.length === 0) return 0;
  const full = new BigramProfile(window);
  if (full.inputNorm === 0) return 0;
  const idf = getIdfWeights();
  const freq = new Map<number, number>();
  let prev = window[0];
  for (let i = 1; i < window.length; i++) {
    const b = window[i];
    if ((prev >= 0x80 || b >= 0x80) && !(prev === b && ASCII_WHITESPACE_TABLE[b])) {
      const idx = (prev << 8) | b;
      freq.set(idx, (freq.get(idx) ?? 0) + idf[idx]);
    }
    prev = b;
  }
  if (freq.size === 0) return 0;
  const focused = BigramProfile.fromWeightedFreq(freq);
  // scoreWithProfile normalizes by the focused profile's norm; rescale to
  // the full window's norm so the result is the contribution these bigrams
  // make to the candidate's actual confidence.
  const rescale = focused.inputNorm / full.inputNorm;
  let best = 0;
  for (const [lang, model, modelKey] of variants) {
    if (language !== null && lang !== language) continue;
    const s = scoreWithProfile(focused, model, modelKey);
    if (s > 0) {
      const margin = s * rescale;
      if (margin > best) best = margin;
    }
  }
  return best;
}

// Break statistical dead heats in favour of the more prevalent era.
//
// When several encodings score within _DEAD_HEAT_EPSILON of the top result
// and the top result's models carry no weight for any high-byte bigram in
// the data, the ranking is an artifact of ASCII-bigram noise. Promote the
// candidate from the most prevalent era (modern web > legacy ISO > Mac >
// regional > DOS > mainframe) so evidence-free dead heats resolve to the
// likeliest real-world answer. A top result whose models do weight
// observed high-byte bigrams won on real evidence and is kept, however
// small its margin.
function _preferPrevalentOnDeadHeat(
  data: Uint8Array,
  results: DetectionResult[],
): DetectionResult[] {
  const top = results.length > 0 ? results[0] : null;
  if (top === null || top.encoding === null || results.length < 2) return results;
  if (_hasHighByteEvidence(data, top.encoding, top.language)) return results;
  let bestIdx = 0;
  let bestRank = _eraRank(top.encoding);
  for (let i = 1; i < results.length; i++) {
    const r = results[i];
    if (r.encoding === null) continue;
    if (top.confidence - r.confidence > _DEAD_HEAT_EPSILON) break;
    const rank = _eraRank(r.encoding);
    if (rank < bestRank) {
      bestRank = rank;
      bestIdx = i;
    }
  }
  if (bestIdx === 0) return results;
  return _promoteToTop(results, bestIdx);
}

// Move results[i] to the top, carrying the current top confidence.
function _promoteToTop(results: DetectionResult[], i: number): DetectionResult[] {
  const r = results[i];
  const promoted: DetectionResult = {
    encoding: r.encoding,
    confidence: results[0].confidence,
    language: r.language,
    mimeType: r.mimeType,
  };
  const rest = results.filter((_, j) => j !== i);
  return [promoted, ...rest];
}

// Promote a Windows superset over its base encoding on a dead heat.
function _promoteSupersetOnDeadHeat(
  data: Uint8Array,
  results: DetectionResult[],
): DetectionResult[] {
  const top = results.length > 0 ? results[0] : null;
  if (top === null || top.encoding === null || results.length < 2) return results;
  const superset = _DEAD_HEAT_SUPERSETS[top.encoding];
  if (superset === undefined) return results;
  for (let i = 1; i < results.length; i++) {
    const r = results[i];
    if (top.confidence - r.confidence > _DEAD_HEAT_EPSILON) break;
    if (r.encoding === superset) {
      const label = whatwgLabelFor(superset);
      if (label !== null && decodesWithoutError(label, data)) {
        return _promoteToTop(results, i);
      }
    }
  }
  return results;
}

// Maximum lead over the best prevalent-language candidate for a
// rare-language winner to count as a coin flip rather than evidence. The
// rare set itself is models.RARE_LANGUAGES — one definition, shared with
// the language fill's thin-margin band, so the two can never drift apart;
// the deployment evidence justifying membership is recorded in ADR-0005.
const _RARE_ARBITRATION_MARGIN = 0.02;

// A rare-language winner above this confidence won on real evidence and is
// never arbitrated.
const _RARE_ARBITRATION_MAX_CONFIDENCE = 0.15;

// Demote a rare-language winner that leads a prevalent rival by a coin
// flip. Fires only when the winner's language is in RARE_LANGUAGES, its
// absolute confidence is inside the evidence-free zone, and a
// prevalent-language candidate sits within _RARE_ARBITRATION_MARGIN.
// Genuine rare-language text fails both gates: even short files score
// confidently, and their entire neighborhood is same-language variants.
function _arbitrateRareLanguage(results: DetectionResult[]): DetectionResult[] {
  const top = results.length > 0 ? results[0] : null;
  if (
    top === null ||
    top.encoding === null ||
    top.language === null ||
    !RARE_LANGUAGES.has(top.language) ||
    top.confidence >= _RARE_ARBITRATION_MAX_CONFIDENCE ||
    results.length < 2
  ) {
    return results;
  }
  for (let i = 1; i < results.length; i++) {
    const r = results[i];
    if (top.confidence - r.confidence > _RARE_ARBITRATION_MARGIN) break;
    if (r.encoding === null || r.language === null) continue;
    if (!RARE_LANGUAGES.has(r.language)) return _promoteToTop(results, i);
  }
  return results;
}

// Promote a classic-Mac candidate when line endings are bare \r.
//
// Classic Mac OS is the only platform that terminated lines with a lone
// carriage return, so data with several \r bytes and no \n is
// near-certainly Mac-era text. When a LEGACY_MAC candidate scores within
// _CR_MAC_BAND of a non-Mac top result, promote it — unless the pair has a
// distinguishing-byte map and the byte-level evidence says the current top
// wins: a platform prior must not overturn direct evidence that confusion
// resolution may have just used to establish the top.
function _promoteMacOnCrLineEndings(
  data: Uint8Array,
  results: DetectionResult[],
): DetectionResult[] {
  const top = results.length > 0 ? results[0] : null;
  if (top === null || top.encoding === null || results.length < 2) return results;
  if (_eraRank(top.encoding) === _LEGACY_MAC_ERA) return results;
  // An art-model win is not up for prose-based review: the pairwise veto
  // below reasons about word shapes and prose bigrams, which box-drawing
  // data is not, and old ANSI art legitimately carries bare-CR line
  // endings.
  if (top.language === ART_LANGUAGE) return results;
  if (data.indexOf(0x0A) >= 0) return results;
  let crCount = 0;
  for (let i = 0; i < data.length && crCount < _CR_MAC_MIN_LINES; i++) {
    if (data[i] === 0x0D) crCount++;
  }
  if (crCount < _CR_MAC_MIN_LINES) return results;
  for (let i = 1; i < results.length; i++) {
    const r = results[i];
    if (top.confidence - r.confidence > _CR_MAC_BAND) break;
    if (r.encoding !== null && _eraRank(r.encoding) === _LEGACY_MAC_ERA) {
      // Pass both languages so the veto arbitrates this pair under the
      // same rule confusion resolution just applied to it.
      const langs = new Set<string>();
      if (top.language !== null) langs.add(top.language);
      if (r.language !== null) langs.add(r.language);
      if (confusionPairWinner(data, top.encoding, r.encoding, langs) === top.encoding) {
        // Byte-level evidence says the top beats the best-ranked Mac
        // candidate: stop entirely rather than letting a lower-ranked
        // sibling take the promotion just because it has no
        // distinguishing-byte map to be checked against.
        break;
      }
      return _promoteToTop(results, i);
    }
  }
  return results;
}

// Check that data decodes completely under encoding and its output name.
//
// The flip's promise is that the caller's decode of the reported result
// works, and the caller sees the *public* name: compatNames (the default)
// can remap to a strictly narrower codec (euc_jis_2004 is reported as
// EUC-JP), so a rival must decode under both names to be promoted.
function _decodesUnderPublicNames(data: Uint8Array, encoding: string): boolean {
  const label = whatwgLabelFor(encoding);
  if (label === null || !decodesCompletely(label, data)) return false;
  const display = _COMPAT_NAMES[encoding];
  if (display === undefined) return true;
  const displayLabel = whatwgLabelFor(lookupEncoding(display) ?? display);
  return displayLabel !== null && decodesCompletely(displayLabel, data);
}

// Promote a strictly decoding rival over a winner with no real evidence.
//
// Byte-validity filtering decodes with { stream: true }, tolerating an
// incomplete multi-byte sequence at the end because detection input is
// often a prefix of a larger whole. When chardet examined the caller's
// *entire* input, that tolerance can hand back an encoding the caller's
// very next decode will reject — a four-byte iso-8859-1 word ending in
// 0xE1 detected as utf-8 (chardet issue #380).
//
// Fires only when the input was not truncated by chardet itself (the
// orchestrator's maxBytes slice or UniversalDetector's buffer cap —
// either way these bytes are not the whole story and the caller was told
// so by inputTruncated), the tail can actually hold a dangling sequence
// (a high byte in the final four), and the winner's tolerant decode is
// non-empty pure ASCII — its only multi-byte evidence is the dangling
// tail itself. The best-ranked rival that decodes the input completely
// under both its internal and public names then takes the top slot,
// regardless of the confidence gap: an all-ASCII-evidence winner detected
// nothing the rival did not also detect. If no listed rival decodes, the
// winner stands.
//
// The pure-ASCII condition is what makes the unconditional flip safe: a
// short mid-character CJK cut has a correct answer that cannot decode the
// input, and flipping it to whichever single-byte codec happens to decode
// the bytes trades a right answer for a wrong one (measured upstream: 34
// correct CJK answers lost under a gap-based rule, zero under this one).
function _preferDecodableOnTie(
  data: Uint8Array,
  results: DetectionResult[],
  inputTruncated: boolean,
): DetectionResult[] {
  const top = results.length > 0 ? results[0] : null;
  if (inputTruncated || top === null || top.encoding === null || results.length < 2) {
    return results;
  }
  // A dangling multi-byte tail needs a high byte among the final bytes
  // (empty data trivially has none).
  let highTail = false;
  for (let i = Math.max(0, data.length - 4); i < data.length; i++) {
    if (data[i] >= 0x80) {
      highTail = true;
      break;
    }
  }
  if (!highTail) return results;
  const topLabel = whatwgLabelFor(top.encoding);
  if (topLabel === null || !danglingTailWithAsciiPrefix(topLabel, data)) {
    return results;
  }
  for (let i = 1; i < results.length; i++) {
    const r = results[i];
    if (r.encoding === null || !_decodesUnderPublicNames(data, r.encoding)) continue;
    return _promoteToTop(results, i);
  }
  return results;
}

// Apply rank corrections to the statistically scored results.
//
// Steps run in sequence, weakest evidence first: dead-heat priors
// (superset preference, era prevalence), rare-language arbitration, then
// confusion-group resolution, niche Latin demotion, and KOI8-T promotion
// (byte-level evidence), and finally the classic-Mac line-ending promotion
// (platform evidence that should override the priors). The decode-safety
// tiebreak runs last of all: whatever the ranking settled on, a winner
// that cannot decode the caller's complete input, and whose own evidence
// is nothing but the undecodable tail, yields to the best-ranked rival
// that can decode it.
//
// inputTruncated is true when the caller's input was longer than maxBytes,
// i.e. data is a chardet-made slice rather than the caller's whole input.
export function postprocessResults(
  data: Uint8Array,
  results: DetectionResult[],
  { inputTruncated = false }: { inputTruncated?: boolean } = {},
): DetectionResult[] {
  results = _promoteSupersetOnDeadHeat(data, results);
  results = _preferPrevalentOnDeadHeat(data, results);
  results = _arbitrateRareLanguage(results);
  results = resolveConfusionGroups(data, results);
  results = _demoteNicheLatin(data, results);
  results = _promoteKoi8t(data, results);
  results = _promoteMacOnCrLineEndings(data, results);
  return _preferDecodableOnTie(data, results, inputTruncated);
}

export {
  _COMMON_LATIN_ENCODINGS,
  _DEMOTION_CANDIDATES,
  _HP_ROMAN8_DISTINGUISHING,
  _ISO_8859_10_DISTINGUISHING,
  _ISO_8859_14_DISTINGUISHING,
  _KOI8_T_DISTINGUISHING,
  _WINDOWS_1254_DISTINGUISHING,
  _arbitrateRareLanguage,
  _decodesUnderPublicNames,
  _demoteNicheLatin,
  _hasHighByteEvidence,
  _highByteEvidenceMargin,
  _preferDecodableOnTie,
  _preferPrevalentOnDeadHeat,
  _promoteKoi8t,
  _promoteMacOnCrLineEndings,
  _promoteSupersetOnDeadHeat,
  _shouldDemote,
};
