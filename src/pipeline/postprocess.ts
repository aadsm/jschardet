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
import {
  CONFUSION_BAND,
  CONFUSION_FLOOR_RATIO,
  STRICT_TIER_MAX_CONF,
  _comparableLanguages,
  arbitrateDistinguishingBytes,
  confusionPairWinner,
  differingHighBytes,
  resolveConfusionGroups,
} from './confusion.js';
import { ART_LANGUAGE, RARE_LANGUAGES, getEncIndex } from '../models/index.js';
import { REGISTRY, lookupEncoding } from '../registry.js';
import { _COMPAT_NAMES } from '../output_names.js';
import {
  danglingTailWithAsciiPrefix,
  decodesWithoutError,
  whatwgLabelFor,
} from '../text-decoder.js';
import { decodesCompletelyUnderValidity } from './validity.js';

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

// Confidence gap within which two results count as a statistical dead heat.
const _DEAD_HEAT_EPSILON = 1e-4;

// Return True if top, a demotion candidate, has no byte evidence over target.
//
// Callers guarantee top.encoding is in _DEMOTION_CANDIDATES. Two questions,
// cheapest first. Does data contain any byte the candidate decodes differently
// from ISO-8859-1? If not, the data is equally valid under both encodings,
// nothing at the byte level favors the candidate, and it is demoted.
//
// If such bytes are present, do they favor the candidate? Presence alone is
// symmetric evidence: a Windows-1252 file whose only non-ASCII letter is an Ö
// carries 0xD6, which HP-Roman8 reads as ø, so both candidates "contain" the
// byte and the question is which reading holds up. That is a confusion-style
// arbitration between the candidate and its swap target on the distinguishing
// bytes alone, each side scored under the variant that actually won its slot.
// The models decide when they can; when they are silent, word shape decides; a
// byte that decides nothing either way goes to the more prevalent encoding.
//
// The arbitration is only asked when the candidate's lead over the swap target
// is within CONFUSION_BAND. A win by more than the band was decided on the full
// statistics, and re-litigating it on a handful of bytes is neither sound nor
// free.
function _shouldDemote(
  data: Uint8Array,
  top: DetectionResult,
  target: DetectionResult,
): boolean {
  const encoding = top.encoding ?? '';
  const distinguishing = _DEMOTION_CANDIDATES.get(encoding);
  if (distinguishing === undefined) return false;
  let present = false;
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b > 0x7F && distinguishing.has(b)) { present = true; break; }
  }
  if (!present) return true;
  if (top.confidence - target.confidence > CONFUSION_BAND) return false;
  const winner = arbitrateDistinguishingBytes(
    data,
    encoding,
    target.encoding ?? '',
    new Set(distinguishing),
    top.language === null ? null : new Set([top.language]),
    target.language === null ? null : new Set([target.language]),
  );
  return winner !== encoding;
}

// Pick the common Latin candidate that replaces a demoted top.
//
// Among the candidates within _DEAD_HEAT_EPSILON of the highest-scoring one,
// era prevalence chooses (windows-1252 over iso-8859-1): inside that band the
// confidence order is noise, the very premise of the demotion. A candidate
// trailing the best common Latin by more than the epsilon lost to it on real
// evidence and stays put. Equal era ranks (iso-8859-1 against iso-8859-15,
// both legacy ISO) keep confidence order, since the first of equals wins and
// the candidates arrive ranked.
function _swapTarget(candidates: DetectionResult[]): DetectionResult {
  let leadConf = candidates[0].confidence;
  for (const r of candidates) if (r.confidence > leadConf) leadConf = r.confidence;
  let best: DetectionResult | null = null;
  let bestRank = 0;
  for (const r of candidates) {
    if (leadConf - r.confidence > _DEAD_HEAT_EPSILON) continue;
    const rank = _eraRank(r.encoding ?? '');
    if (best === null || rank < bestRank) {
      best = r;
      bestRank = rank;
    }
  }
  // candidates is non-empty and the lead itself is always in band.
  return best as DetectionResult;
}

// Demote a niche Latin top that its distinguishing bytes do not support.
//
// Some bigram models (iso-8859-10, iso-8859-14, windows-1254, hp-roman8) can
// win on data that contains only bytes shared with the common Western Latin
// encodings, or on a lone shared byte the models cannot arbitrate. When
// _shouldDemote finds no byte-level evidence for the winning encoding, promote
// the swap target _swapTarget picks among the common Latin candidates and push
// the demoted encoding to last.
//
// The demoted entries take the confidence of the candidate they now sit
// behind. Rank position alone does not survive the trip out to callers:
// detectAll re-sorts by confidence, and a stable sort hands an entry that kept
// the top score its old place back.
function _demoteNicheLatin(
  data: Uint8Array,
  results: DetectionResult[],
): DetectionResult[] {
  if (results.length < 2 || !_DEMOTION_CANDIDATES.has(results[0].encoding ?? '')) {
    return results;
  }
  const candidates = results
    .slice(1)
    .filter(r => r.encoding !== null && _COMMON_LATIN_ENCODINGS.has(r.encoding));
  if (candidates.length === 0) return results;
  const target = _swapTarget(candidates);
  if (!_shouldDemote(data, results[0], target)) return results;
  const demotedEncoding = results[0].encoding;
  const topConf = results[0].confidence;
  const promoted: DetectionResult = {
    encoding: target.encoding,
    confidence: topConf,
    language: target.language,
    mimeType: target.mimeType,
  };
  const others = results.filter(x => x.encoding !== demotedEncoding && x !== target);
  const tailConf = others.length > 0 ? others[others.length - 1].confidence : topConf;
  const demotedEntries = results
    .filter(x => x.encoding === demotedEncoding)
    .map(x => ({
      encoding: x.encoding,
      confidence: Math.min(x.confidence, tailConf),
      language: x.language,
      mimeType: x.mimeType,
    }));
  return [promoted, ...others, ...demotedEntries];
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
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b > 0x7F && _KOI8_T_DISTINGUISHING.has(b)) {
      return _promoteToTop(results, koi8tIdx);
    }
  }
  return results;
}

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
// evidence, not just a prior. Structurally the confusion band: retuning
// CONFUSION_BAND carries this promotion's reach with it, keeping the band
// inside _CORRECTION_REACH so pruning always scores what it scans.
const _CR_MAC_BAND = CONFUSION_BAND;

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

// Break statistical dead heats in favour of the more prevalent era.
//
// When several encodings score within _DEAD_HEAT_EPSILON of the top result,
// the ranking among them is mostly an artifact of ASCII-bigram noise. Promote
// the candidate from the most prevalent era (modern web > legacy ISO > Mac >
// regional > DOS > mainframe) so evidence-free dead heats resolve to the
// likeliest real-world answer.
//
// A top result whose models carry no weight for any high-byte bigram in the
// data has no evidence at all and yields outright. One whose models do weight
// an observed bigram is not thereby safe: an English file with one capital É
// ranks MacRoman first because the MacRoman model reads 0xC9 as the ellipsis
// English text is full of. Such a top is arbitrated against the prevalent
// candidate on the bytes the two read differently, under the languages the two
// can be compared in. The prevalent candidate is promoted only when it wins
// outright; a tie keeps the top. Genuine MacRoman text never reaches the
// arbitration, since its hundreds of distinguishing bytes put Windows-1252 far
// outside the band.
function _preferPrevalentOnDeadHeat(
  data: Uint8Array,
  results: DetectionResult[],
): DetectionResult[] {
  const top = results.length > 0 ? results[0] : null;
  if (top === null || top.encoding === null || results.length < 2) return results;
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
  if (!_hasHighByteEvidence(data, top.encoding, top.language)) {
    return _promoteToTop(results, bestIdx);
  }
  const rival = results[bestIdx].encoding ?? '';
  const langs = new Set<string>();
  if (top.language !== null) langs.add(top.language);
  if (results[bestIdx].language !== null) langs.add(results[bestIdx].language!);
  const comparable = _comparableLanguages(top.encoding, rival, langs);
  const winner = arbitrateDistinguishingBytes(
    data,
    top.encoding,
    rival,
    differingHighBytes(top.encoding, rival),
    comparable,
    comparable,
  );
  if (winner === rival) return _promoteToTop(results, bestIdx);
  return results;
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
      if (_internal.confusionPairWinner(data, top.encoding, r.encoding, langs) === top.encoding) {
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
  if (!decodesCompletelyUnderValidity(encoding, data)) return false;
  const display = _COMPAT_NAMES[encoding];
  if (display === undefined) return true;
  return decodesCompletelyUnderValidity(lookupEncoding(display) ?? display, data);
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
// Fires only when data is the whole of what the caller handed over
// (inputTruncated is false — the maxBytes slice, the evidence-cap slice, or
// UniversalDetector's buffer cap all set it, and any of them means these
// bytes are not the whole story), the tail can actually hold a dangling
// sequence (a high byte in the final four), and the winner's tolerant decode
// is non-empty pure ASCII — its only multi-byte evidence is the dangling
// tail itself. The best-ranked rival that decodes the input completely under
// both its internal and public names then takes the top slot, regardless of
// the confidence gap. If no listed rival decodes, the winner stands.
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

// ---------------------------------------------------------------------------
// The pruning contract: what statistical pruning must score exactly
// ---------------------------------------------------------------------------
//
// The port always scores every candidate (no rowmax pruning — see
// "Statistical-scoring rowmax pruning" in docs/port-notes.md), so nothing here
// gates the port's own scoring. These two functions are kept to mirror
// chardet's postprocess.py exactly: they are the contract statistical pruning
// consumes upstream, and porting them keeps the mirror honest and lets the
// contract tests come across.

// How far below the running second-best score a candidate can sit and still be
// examined by a rank correction: rare-language arbitration reads margins up to
// _RARE_ARBITRATION_MARGIN from the top, and confusion resolution examines the
// band, kept with a 2x cushion for float noise.
const _CORRECTION_REACH = _RARE_ARBITRATION_MARGIN + 2 * CONFUSION_BAND;

// Return the score below which the rank corrections cannot examine a candidate.
//
// Given the running top two encoding scores, every candidate at or above this
// floor must carry its exact full-ranking score. The floor trails the
// second-best score by the corrections' reach; while the top is low enough for
// confusion resolution's strict tier to open, it extends down to that tier's
// floor, because a strict-tier promotion may raise any candidate above the tier
// floor into position 0 before the other corrections evaluate their triggers.
export function scoringFloor(top1: number, top2: number): number {
  let floor = top2 - _CORRECTION_REACH;
  if (top1 < STRICT_TIER_MAX_CONF) {
    floor = Math.min(floor, top1 * CONFUSION_FLOOR_RATIO);
  }
  return floor;
}

// Return the encodings the corrections look up by name, given the near-top set.
//
// postprocessResults inspects some encodings wherever they rank (the common
// Western Latin trio for niche Latin demotion, KOI8-T for the KOI8-R
// promotion), so pruning must score every variant of these whenever a trigger
// encoding sits at or above the scoringFloor.
export function forcedEncodings(nearTop: string[]): string[] {
  const forced: string[] = [];
  if (nearTop.some(e => _DEMOTION_CANDIDATES.has(e))) {
    forced.push(..._COMMON_LATIN_ENCODINGS);
  }
  if (nearTop.includes('koi8-r')) forced.push('koi8-t');
  return forced;
}

// Apply rank corrections to the statistically scored results.
//
// Steps run in sequence, weakest evidence first: dead-heat priors (superset
// preference, era prevalence), rare-language arbitration, then confusion-group
// resolution, niche Latin demotion, and KOI8-T promotion (byte-level
// evidence), and finally the classic-Mac line-ending promotion (platform
// evidence that should override the priors). The decode-safety tiebreak runs
// last of all: whatever the ranking settled on, a winner that cannot decode the
// caller's complete input, and whose own evidence is nothing but the
// undecodable tail, yields to the best-ranked rival that can decode it.
//
// inputTruncated is true when data is a chardet-made slice rather than the
// caller's whole input — the maxBytes slice, the evidence-cap slice, or
// UniversalDetector's buffer cap. Any of them means the bytes here are not the
// whole story, so the decode-safety tiebreak stands down.
export function postprocessResults(
  data: Uint8Array,
  results: DetectionResult[],
  { inputTruncated = false }: { inputTruncated?: boolean } = {},
): DetectionResult[] {
  results = _internal._promoteSupersetOnDeadHeat(data, results);
  results = _internal._preferPrevalentOnDeadHeat(data, results);
  results = _internal._arbitrateRareLanguage(results);
  results = _internal.resolveConfusionGroups(data, results);
  results = _internal._demoteNicheLatin(data, results);
  results = _internal._promoteKoi8t(data, results);
  results = _internal._promoteMacOnCrLineEndings(data, results);
  return _internal._preferDecodableOnTie(data, results, inputTruncated);
}

// Test-spy seam. Mirrors Python's monkeypatch of each correction in
// postprocess.py by routing the chain (and the classic-Mac veto's
// confusionPairWinner) through this object so vi.spyOn(_internal, name)
// intercepts them. See orchestrator.ts's _internal for the same pattern.
export const _internal = {
  _promoteSupersetOnDeadHeat,
  _preferPrevalentOnDeadHeat,
  _arbitrateRareLanguage,
  resolveConfusionGroups,
  _demoteNicheLatin,
  _promoteKoi8t,
  _promoteMacOnCrLineEndings,
  _preferDecodableOnTie,
  confusionPairWinner,
};

export {
  ART_LANGUAGE,
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
  _eraRank,
  _hasHighByteEvidence,
  _preferDecodableOnTie,
  _preferPrevalentOnDeadHeat,
  _promoteKoi8t,
  _promoteMacOnCrLineEndings,
  _promoteSupersetOnDeadHeat,
  _promoteToTop,
  _shouldDemote,
  _swapTarget,
};
