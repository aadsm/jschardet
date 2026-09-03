// Confusion group resolution for similar single-byte encodings. Port of
// chardet/src/chardet/pipeline/confusion.py.
//
// Loads pre-computed distinguishing byte maps from confusion.bin and uses
// them to resolve statistical scoring ties between similar encodings.

import {
  ART_LANGUAGE,
  BigramProfile,
  getEncIndex,
  getIdfWeights,
  scoreWithProfile,
} from '../models/index.js';
import { DetectionResult } from './index.js';
import { lookupEncoding } from '../registry.js';
import { readBytes as readConfusionBin } from '../models/confusion.bin.js';
import { BYTE_DECODE_TABLES, ByteDecodeTable } from './_byte-decode-tables.js';

interface DiffEntry {
  diffBytes: Set<number>;
  categories: Map<number, [string, string]>;
}

export type DistinguishingMaps = Map<string, DiffEntry>;

// uint8 -> Unicode general category, inverse of the mapping used at
// serialization time (scripts/confusion_training.py upstream).
const _INT_TO_CATEGORY: readonly string[] = [
  'Lu', 'Ll', 'Lt', 'Lm', 'Lo',
  'Mn', 'Mc', 'Me',
  'Nd', 'Nl', 'No',
  'Pc', 'Pd', 'Ps', 'Pe', 'Pi', 'Pf', 'Po',
  'Sm', 'Sc', 'Sk', 'So',
  'Zs', 'Zl', 'Zp',
  'Cc', 'Cf', 'Cs', 'Co', 'Cn',
];

function pairKey(a: string, b: string): string {
  return `${a}\x00${b}`;
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

// Exported with underscore prefix as an internal helper for the test suite.
export function _deserializeConfusionDataFromBytes(data: Uint8Array): DistinguishingMaps {
  const result: DistinguishingMaps = new Map();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  const numPairs = view.getUint16(offset, false);
  offset += 2;

  for (let p = 0; p < numPairs; p++) {
    const nameALen = view.getUint8(offset);
    offset += 1;
    const nameA = utf8Decoder.decode(data.subarray(offset, offset + nameALen));
    offset += nameALen;

    const nameBLen = view.getUint8(offset);
    offset += 1;
    const nameB = utf8Decoder.decode(data.subarray(offset, offset + nameBLen));
    offset += nameBLen;

    const numDiffs = view.getUint8(offset);
    offset += 1;

    const diffBytes = new Set<number>();
    const categories = new Map<number, [string, string]>();
    for (let d = 0; d < numDiffs; d++) {
      const bv = view.getUint8(offset);
      const catAInt = view.getUint8(offset + 1);
      const catBInt = view.getUint8(offset + 2);
      offset += 3;
      diffBytes.add(bv);
      categories.set(bv, [
        _INT_TO_CATEGORY[catAInt] ?? 'Cn',
        _INT_TO_CATEGORY[catBInt] ?? 'Cn',
      ]);
    }
    result.set(pairKey(nameA, nameB), { diffBytes, categories });
  }
  return result;
}

let cached: DistinguishingMaps | null = null;

export function loadConfusionMaps(): DistinguishingMaps {
  if (cached) return cached;
  const raw = readConfusionBin();
  if (raw.length === 0) {
    console.warn(
      'jschardet confusion.bin is empty — confusion resolution disabled; ' +
      'reinstall jschardet to fix',
    );
    cached = new Map();
    return cached;
  }
  let rawMaps: DistinguishingMaps;
  try {
    rawMaps = _deserializeConfusionDataFromBytes(raw);
  } catch (e) {
    throw new Error(`corrupt confusion.bin: ${(e as Error).message}`);
  }
  // Normalize keys to canonical codec names so pipeline output matches.
  const normalized: DistinguishingMaps = new Map();
  for (const [key, value] of rawMaps) {
    const sep = key.indexOf('\x00');
    const a = key.slice(0, sep);
    const b = key.slice(sep + 1);
    const normA = lookupEncoding(a) ?? a;
    const normB = lookupEncoding(b) ?? b;
    normalized.set(pairKey(normA, normB), value);
  }
  cached = normalized;
  return cached;
}

// Unicode general category preference scores for voting resolution. Higher
// scores indicate more linguistically meaningful characters.
const _CATEGORY_PREFERENCE: Record<string, number> = {
  Lu: 10, Ll: 10, Lt: 10,
  Lm: 9, Lo: 9,
  Nd: 8, Nl: 7, No: 7,
  Pc: 6, Pd: 6, Ps: 6, Pe: 6, Pi: 6, Pf: 6, Po: 6,
  Sc: 5, Sm: 5,
  Sk: 4, So: 4,
  Zs: 3, Zl: 3, Zp: 3,
  Cf: 2,
  Cc: 1, Co: 1,
  Cs: 0, Cn: 0,
  Mn: 5, Mc: 5, Me: 5,
};

// Preference assigned to a letter reading whose context makes it an
// implausible word member — below every punctuation and symbol category.
export const _IMPLAUSIBLE_LETTER_PREFERENCE = 2;

// Vote margin at which category voting overrides the bigram rescore. Two
// context-decisive occurrences (letter-vs-punctuation with the word-shape
// rule fired: 2 x (6 - 2)) clear it; a lone punctuation-vs-punctuation
// reading (margin 1) never does. Raising this threshold is not safe: the
// EBCDIC record suite depends on a decisive margin of 12 (three
// occurrences) to hold off the rescore's max-over-variants bias.
export const _DECISIVE_VOTE_MARGIN = 8;

// Minimum number of distinct demotion-earning occurrences for a vote to be
// decisive. A single occurrence can reach margin 8 on its own (a
// plausible-letter reading at preference 10 against an implausible-letter
// reading demoted to 2), and one byte of context must never outrank the
// rescore's model evidence.
export const _DECISIVE_MIN_EVENTS = 2;

// Cap on distinguishing-byte occurrences examined per pair. Sparse by
// nature; the cap only bounds pathological inputs.
const _MAX_VOTE_OCCURRENCES = 256;

// Density at which the focused-profile scan stops paying off. Below one
// distinguishing byte per this many input bytes, locating the hits with
// indexOf beats walking every byte; above it, the set of start indices
// costs more than the straight loop it replaces. Held in a mutable test
// seam mirroring Python's patch.object(confusion_mod, "_DENSE_HIT_DIVISOR").
export const _testHooks = { denseHitDivisor: 4 };

// chardet's confusion._letter_case_table classifies each byte at runtime from
// Python's codecs + unicodedata: 0 = non-letter, 1 = uppercase letter, 2 =
// other letter (combining marks count as letters, since in decomposed text a
// base letter's neighbor is its diacritic — word-internal, not a boundary).
// That verdict is a pure function of the byte's Unicode general category, so
// the port derives it from the per-byte categories in _byte-decode-tables.ts
// (generate-byte-tables.js verifies the derivation matches chardet's own
// table byte-for-byte before emitting). Whitespace deliberately counts as a
// plain non-letter: exempting space-adjacent letters from the isolated-letter
// demotion was tried upstream and falsified by the accuracy suite.
const _EMPTY_CASE_TABLE = new Uint8Array(256);
const _caseTableCache = new Map<string, Uint8Array>();

// Category index (into _INT_TO_CATEGORY) -> letter kind. Lu -> 1; the other
// letter categories (Ll/Lt/Lm/Lo) and the combining marks (Mn/Mc/Me) -> 2;
// everything else -> 0.
const _CASE_FROM_CAT: Uint8Array = (() => {
  const t = new Uint8Array(_INT_TO_CATEGORY.length);
  _INT_TO_CATEGORY.forEach((cat, i) => {
    t[i] = cat === 'Lu' ? 1 : cat[0] === 'L' || cat[0] === 'M' ? 2 : 0;
  });
  return t;
})();

export function _letterCaseTable(encoding: string): Uint8Array {
  let table = _caseTableCache.get(encoding);
  if (table !== undefined) return table;
  const decode = _byteDecodeTable(encoding);
  if (decode === null) {
    // No generated table (an encoding outside the registry); all-zero means
    // every reading counts as a non-letter.
    table = _EMPTY_CASE_TABLE;
  } else {
    table = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      table[i] = _CASE_FROM_CAT[decode.cats.charCodeAt(i)] ?? 0;
    }
  }
  _caseTableCache.set(encoding, table);
  return table;
}

// Preference for reading a byte as cat, adjusted for word shape. A letter
// reading only deserves its high preference when its neighbors make it look
// like part of a word under the same encoding: a letter with no letter
// neighbors is quoted/isolated punctuation in disguise, and a lowercase
// letter immediately followed by an uppercase one is not a word shape any
// of the supported languages produce.
export function _contextPreference(
  cat: string,
  left: number,
  right: number,
  caseTable: Uint8Array,
): number {
  const pref = _CATEGORY_PREFERENCE[cat] ?? 0;
  if (cat[0] !== 'L') return pref;
  const leftKind = caseTable[left];
  const rightKind = caseTable[right];
  if (leftKind === 0 && rightKind === 0) return _IMPLAUSIBLE_LETTER_PREFERENCE;
  if (cat === 'Ll' && rightKind === 1) return _IMPLAUSIBLE_LETTER_PREFERENCE;
  return pref;
}

// 256-entry membership table for a pair's distinguishing bytes, cached per
// DiffEntry set (chardet's _pair_byte_tables caches per frozenset).
const _membershipCache = new WeakMap<Set<number>, Uint8Array>();

function _isDiffTable(diffBytes: Set<number>): Uint8Array {
  let table = _membershipCache.get(diffBytes);
  if (table === undefined) {
    table = new Uint8Array(256);
    for (const bv of diffBytes) table[bv] = 1;
    _membershipCache.set(diffBytes, table);
  }
  return table;
}

interface VoteResult {
  winner: string | null;
  margin: number;
  demotionMargin: number;
  demotionEvents: number;
}

// Context-aware category voting (chardet's _vote_with_margin).
//
// For each occurrence of a distinguishing byte, compare the two encodings'
// readings: Unicode category preference, adjusted for word shape (see
// _contextPreference). The reading that makes more linguistic sense of the
// byte in its context collects the vote; occurrences vote independently, so
// repeated evidence counts.
//
// demotionMargin counts only the winner's votes earned where the losing
// side's letter reading was word-shape-implausible — evidence against an
// impossible reading, which is far stronger than the naive
// letters-beat-symbols preference. demotionEvents counts how many distinct
// occurrences contributed to it, so callers can tell repeated evidence from
// one loud byte.
export function _voteWithMargin(
  data: Uint8Array,
  encA: string,
  encB: string,
  diffBytes: Set<number>,
  categories: Map<number, [string, string]>,
): VoteResult {
  const isDiff = _isDiffTable(diffBytes);
  const relevant = new Set<number>();
  for (let i = 0; i < data.length; i++) {
    if (isDiff[data[i]]) relevant.add(data[i]);
  }
  if (relevant.size === 0) {
    return { winner: null, margin: 0, demotionMargin: 0, demotionEvents: 0 };
  }
  const tableA = _letterCaseTable(encA);
  const tableB = _letterCaseTable(encB);
  let votesA = 0;
  let votesB = 0;
  let demotionA = 0;
  let demotionB = 0;
  let eventsA = 0;
  let eventsB = 0;
  const end = data.length - 1;
  for (const bv of relevant) {
    const cats = categories.get(bv);
    if (cats === undefined) continue;
    const [catA, catB] = cats;
    let pos = data.indexOf(bv);
    let examined = 0;
    while (pos >= 0 && examined < _MAX_VOTE_OCCURRENCES) {
      const left = pos > 0 ? data[pos - 1] : 0;
      const right = pos < end ? data[pos + 1] : 0;
      const prefA = _contextPreference(catA, left, right, tableA);
      const prefB = _contextPreference(catB, left, right, tableB);
      // A letter reading beating a *punctuation* reading on naive
      // preference alone is not evidence: punctuation of every category
      // legitimately borders letters (delimiters, hyphens, brackets,
      // apostrophes), so the letter interpretation is never the only
      // plausible one. A letter beating a *symbol* reading still counts —
      // box-drawing or dingbats inside a word is not a shape prose
      // produces.
      if (prefA > prefB) {
        if (!(catA[0] === 'L' && catB[0] === 'P')) {
          votesA += prefA - prefB;
          if (catB[0] === 'L' && prefB === _IMPLAUSIBLE_LETTER_PREFERENCE) {
            demotionA += prefA - prefB;
            eventsA += 1;
          }
        }
      } else if (prefB > prefA) {
        if (!(catB[0] === 'L' && catA[0] === 'P')) {
          votesB += prefB - prefA;
          if (catA[0] === 'L' && prefA === _IMPLAUSIBLE_LETTER_PREFERENCE) {
            demotionB += prefB - prefA;
            eventsB += 1;
          }
        }
      }
      examined += 1;
      pos = data.indexOf(bv, pos + 1);
    }
  }
  if (votesA > votesB) {
    return { winner: encA, margin: votesA - votesB, demotionMargin: demotionA, demotionEvents: eventsA };
  }
  if (votesB > votesA) {
    return { winner: encB, margin: votesB - votesA, demotionMargin: demotionB, demotionEvents: eventsB };
  }
  return { winner: null, margin: 0, demotionMargin: 0, demotionEvents: 0 };
}

// Return the byte-evidence winner between two encodings, or null.
//
// Mirrors the in-band pairwise rule of resolveConfusionGroups (decisive
// demotion vote, else bigram rescore, else category vote) for callers
// outside the ranked-results scan — e.g. the classic-Mac line-ending
// promotion, whose platform prior must not override distinguishing-byte
// evidence. Returns null when the pair has no distinguishing map or the
// evidence is inconclusive.
//
// languages must carry what the two results being compared report, or the
// mirror breaks: the rescore would arbitrate the same pair under a
// different rule than the confusion stage just did, and a veto built on
// that answer can reverse a promotion the stage had settled.
export function confusionPairWinner(
  data: Uint8Array,
  encX: string,
  encY: string,
  languages: ReadonlySet<string> = new Set(),
): string | null {
  const maps = loadConfusionMaps();
  const pair = _findPairKey(maps, encX, encY);
  if (pair === null) return null;
  const [encA, encB] = pair;
  const { diffBytes, categories } = maps.get(pairKey(encA, encB))!;
  const vote = _voteWithMargin(data, encA, encB, diffBytes, categories);
  if (
    vote.winner !== null &&
    vote.demotionMargin >= _DECISIVE_VOTE_MARGIN &&
    vote.demotionEvents >= _DECISIVE_MIN_EVENTS &&
    diffBytes.size < _CROSS_FAMILY_MIN_DIFFS
  ) {
    return vote.winner;
  }
  const bigramWinner = resolveByBigramRescore(data, encA, encB, diffBytes, languages);
  if (diffBytes.size >= _CROSS_FAMILY_MIN_DIFFS) {
    // Cross-family pairs: corroboration required (see the strict rule in
    // resolveConfusionGroups).
    if (bigramWinner !== null && bigramWinner === vote.winner) return bigramWinner;
    return null;
  }
  return bigramWinner !== null ? bigramWinner : vote.winner;
}

// Resolve between two encodings using context-aware category voting.
export function resolveByCategoryVoting(
  data: Uint8Array,
  encA: string,
  encB: string,
  diffBytes: Set<number>,
  categories: Map<number, [string, string]>,
): string | null {
  return _voteWithMargin(data, encA, encB, diffBytes, categories).winner;
}

const _modelledLanguagesCache = new Map<string, ReadonlySet<string>>();

// Languages enc has a bigram model for (chardet's _modelled_languages).
export function _modelledLanguages(enc: string): ReadonlySet<string> {
  let langs = _modelledLanguagesCache.get(enc);
  if (langs === undefined) {
    const set = new Set<string>();
    for (const [lang] of getEncIndex().get(enc) ?? []) {
      if (lang !== null) set.add(lang);
    }
    langs = set;
    _modelledLanguagesCache.set(enc, langs);
  }
  return langs;
}

// Languages to score encA and encB under, or null for all (chardet's
// _comparable_languages). null means unrestricted — score every variant,
// the original max-over-models comparison. It is not an abstention.
//
// An encoding should not win on language coverage the other side lacks:
// the restriction drops the languages only one side models, but only when
// both results still report a language inside the shared set. Both wider
// rules were measured upstream and rejected against the accuracy suite
// (restricting to the reported languages themselves costs 12 tests;
// restricting on partial overlap costs 6 — scoring the right encoding
// under the wrong language loses). Pairs modelling disjoint languages
// never restrict at all.
export function _comparableLanguages(
  encA: string,
  encB: string,
  languages: ReadonlySet<string>,
): ReadonlySet<string> | null {
  if (languages.size === 0) return null;
  const langsA = _modelledLanguages(encA);
  const langsB = _modelledLanguages(encB);
  const shared = new Set<string>();
  for (const lang of langsA) {
    if (langsB.has(lang)) shared.add(lang);
  }
  for (const lang of languages) {
    if (!shared.has(lang)) return null;
  }
  // The art pseudo-language is not a language, so the fairness argument
  // above does not reach it: cp437 is the only encoding carrying a zxx
  // model, which means a plain intersection would strip box-drawing
  // evidence from every restricted rescore it takes part in. Keeping it
  // for whichever side has it preserves the art protection the module
  // maintains elsewhere (see the zxx guard in resolveConfusionGroups).
  if (langsA.has(ART_LANGUAGE) || langsB.has(ART_LANGUAGE)) {
    shared.add(ART_LANGUAGE);
  }
  return shared;
}

// Best bigram score for enc, restricted to languages (chardet's
// _best_variant_score). languages of null means every variant. Note that
// a caller-supplied set naming no variant of enc scores 0.0, handing the
// comparison to the rival rather than abstaining.
export function _bestVariantScore(
  profile: BigramProfile,
  enc: string,
  languages: ReadonlySet<string> | null,
): number {
  const variants = getEncIndex().get(enc);
  if (variants === undefined || variants.length === 0) return 0.0;
  let best = 0.0;
  for (const [lang, model, modelKey] of variants) {
    if (languages !== null && (lang === null || !languages.has(lang))) continue;
    const s = scoreWithProfile(profile, model, modelKey);
    if (s > best) best = s;
  }
  return best;
}

// Resolve between two encodings by re-scoring only distinguishing bigrams.
//
// Builds a focused bigram profile containing only bigrams where at least
// one byte is a distinguishing byte, then scores both encodings under the
// languages they can be compared in (see _comparableLanguages).
//
// There is no abstention path here: when the pair has no comparable
// language the comparison widens to every variant rather than declining to
// answer. That is why a Danish mac-roman/mac-turkish document, whose pair
// models disjoint languages, is still decided by the Turkish model the
// rescore has no business consulting — the caller's category vote is
// better placed on such evidence, and overriding this to abstain was
// measured upstream as costing more accuracy than it recovers.
export function resolveByBigramRescore(
  data: Uint8Array,
  encA: string,
  encB: string,
  diffBytes: Set<number>,
  languages: ReadonlySet<string> = new Set(),
): string | null {
  const profile = buildFocusedProfile(data, diffBytes);
  if (profile === null) return null;

  const comparable = _comparableLanguages(encA, encB, languages);
  const bestA = _bestVariantScore(profile, encA, comparable);
  const bestB = _bestVariantScore(profile, encB, comparable);

  if (bestA > bestB) return encA;
  if (bestB > bestA) return encB;
  return null;
}

// Build the bigram profile of data restricted to diffBytes context, or null.
//
// The profile holds only bigrams where at least one byte is in diffBytes,
// weighted by IDF like the full-input profile, so scoring a model against it
// asks how well that model explains the bytes two encodings read differently,
// and nothing else. Returns null when data cannot form a bigram or contains no
// distinguishing byte. Shared by resolveByBigramRescore and the
// distinguishing-byte arbitration so both score against the exact same profile.
export function buildFocusedProfile(
  data: Uint8Array,
  diffBytes: Set<number>,
): BigramProfile | null {
  if (data.length < 2) return null;

  // Prefilter: if no distinguishing byte occurs anywhere, the focused
  // profile would be empty — skip the per-byte loop.
  const isDiff = _isDiffTable(diffBytes);
  let hits = 0;
  const present = new Set<number>();
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (isDiff[b]) {
      hits += 1;
      present.add(b);
    }
  }
  if (hits === 0) return null;

  const idf = getIdfWeights();
  const freq = new Map<number, number>();
  const limit = data.length - 1;
  if (hits * _testHooks.denseHitDivisor < data.length) {
    // Sparse case, which is nearly all of them: locate the hits with
    // indexOf rather than walking every byte. Each hit at position p
    // belongs to the bigrams starting at p-1 and p; collecting start
    // indices counts a bigram whose bytes are both distinguishing once,
    // exactly as the dense scan below does.
    const starts = new Set<number>();
    for (const bv of present) {
      let pos = data.indexOf(bv);
      while (pos >= 0) {
        if (pos > 0) starts.add(pos - 1);
        if (pos < limit) starts.add(pos);
        pos = data.indexOf(bv, pos + 1);
      }
    }
    for (const i of starts) {
      const idx = (data[i] << 8) | data[i + 1];
      freq.set(idx, (freq.get(idx) ?? 0) + idf[idx]);
    }
  } else {
    for (let i = 0; i < limit; i++) {
      const b1 = data[i];
      const b2 = data[i + 1];
      if (!(isDiff[b1] | isDiff[b2])) continue;
      const idx = (b1 << 8) | b2;
      freq.set(idx, (freq.get(idx) ?? 0) + idf[idx]);
    }
  }

  if (freq.size === 0) return null;
  return BigramProfile.fromWeightedFreq(freq);
}

// Byte -> decode-table lookup, keyed by canonical codec name (chardet resolves
// aliases through the codec registry; mirror with lookupEncoding).
let _decodeTablesByCanonical: Map<string, ByteDecodeTable> | null = null;
function _byteDecodeTable(encoding: string): ByteDecodeTable | null {
  if (_decodeTablesByCanonical === null) {
    _decodeTablesByCanonical = new Map();
    for (const [name, table] of Object.entries(BYTE_DECODE_TABLES)) {
      _decodeTablesByCanonical.set(lookupEncoding(name) ?? name, table);
    }
  }
  return _decodeTablesByCanonical.get(lookupEncoding(encoding) ?? encoding) ?? null;
}

// Sentinel code point for a byte that raised on decode; distinct from the
// 0xFFFE "decoded to zero or more than one char" sentinel, so both compare by
// value in differingHighBytes (undecodable != empty, matching Python's
// None != "").
const _UNDECODABLE_CP = 0xFFFF;

const _differingHighBytesCache = new Map<string, Set<number>>();

// Byte values >= 0x80 that encA and encB decode to different text.
//
// The distinguishing set for a pair the confusion maps do not cover, read from
// the build-time decode tables (chardet computes it from the codecs
// themselves). A byte only one side can decode counts as differing. Bytes
// below 0x80 are left out: the callers ask about high-byte evidence, and every
// single-byte Latin family agrees on ASCII anyway.
export function differingHighBytes(encA: string, encB: string): Set<number> {
  const key = pairKey(encA, encB);
  const cached = _differingHighBytesCache.get(key);
  if (cached !== undefined) return cached;
  const ta = _byteDecodeTable(encA);
  const tb = _byteDecodeTable(encB);
  const out = new Set<number>();
  for (let b = 0x80; b < 0x100; b++) {
    const cpA = ta === null ? _UNDECODABLE_CP : ta.cps.charCodeAt(b - 0x80);
    const cpB = tb === null ? _UNDECODABLE_CP : tb.cps.charCodeAt(b - 0x80);
    if (cpA !== cpB) out.add(b);
  }
  _differingHighBytesCache.set(key, out);
  return out;
}

// Unicode general categories of each distinguishing byte under both encodings.
//
// The confusion maps carry this table for their own pairs; callers that
// arbitrate a pair the maps do not cover (the niche-Latin demotion's candidate
// against its swap target) build it from the decode tables. A byte one side
// cannot decode, or that decodes to zero or several characters, reads as
// unassigned (Cn), which the vote treats as the least plausible reading of all.
export function _pairCategories(
  encA: string,
  encB: string,
  diffBytes: Set<number>,
): Map<number, [string, string]> {
  const ta = _byteDecodeTable(encA);
  const tb = _byteDecodeTable(encB);
  const table = new Map<number, [string, string]>();
  for (const b of diffBytes) {
    const catA = ta === null ? 'Cn' : (_INT_TO_CATEGORY[ta.cats.charCodeAt(b)] ?? 'Cn');
    const catB = tb === null ? 'Cn' : (_INT_TO_CATEGORY[tb.cats.charCodeAt(b)] ?? 'Cn');
    table.set(b, [catA, catB]);
  }
  return table;
}

// Decide a pair on its distinguishing bytes: model rescore, then context.
//
// The in-band rule of resolveConfusionGroups for a pair the confusion maps do
// not cover, with one difference: each side is scored under the languages the
// caller names for it rather than the shared set. The bigram rescore decides
// when the models have an opinion; when they score the distinguishing bigrams
// equally (usually both at zero, a byte neither model has seen in that
// context), the category vote reads word shape instead, so a letter between
// letters still beats a superscript between letters. Returns null when neither
// step can tell the two apart.
export function arbitrateDistinguishingBytes(
  data: Uint8Array,
  encA: string,
  encB: string,
  diffBytes: Set<number>,
  languagesA: ReadonlySet<string> | null,
  languagesB: ReadonlySet<string> | null,
): string | null {
  const profile = buildFocusedProfile(data, diffBytes);
  if (profile !== null) {
    const bestA = _bestVariantScore(profile, encA, languagesA);
    const bestB = _bestVariantScore(profile, encB, languagesB);
    if (bestA > bestB) return encA;
    if (bestB > bestA) return encB;
  }
  const { winner } = _voteWithMargin(
    data, encA, encB, diffBytes, _pairCategories(encA, encB, diffBytes),
  );
  return winner;
}

function _findPairKey(
  maps: DistinguishingMaps,
  encA: string,
  encB: string,
): [string, string] | null {
  if (maps.has(pairKey(encA, encB))) return [encA, encB];
  if (maps.has(pairKey(encB, encA))) return [encB, encA];
  return null;
}

// Pairs whose distinguishing set is at least this large come from the
// cross-family tier of the pair generator (byte-similar siblings differ at
// most at 51 positions under its 0.80 similarity floor). Cross-family
// pairs arbitrate wholesale-different byte tables, where the rescore alone
// is a coin flip whenever the distinguishing evidence in the data is
// sparse — so these pairs require vote/rescore corroboration even for
// in-band near-ties.
export const _CROSS_FAMILY_MIN_DIFFS = 52;

// Maximum confidence gap from the top result for candidates beyond
// position 1 to participate in confusion resolution. Public because it is a
// contract fact: the pruning contract in postprocess.ts composes it into the
// floor that statistical pruning must score exactly.
export const CONFUSION_BAND = 0.005;

// Minimum confidence, as a fraction of the top result's, for out-of-band
// candidates to participate in the strict tier of confusion resolution.
// Confusion siblings can score far apart in absolute terms while the
// statistical ranking among them is still noise (EBCDIC record data), so
// the strict tier extends beyond the band — but only for challengers with
// corroborated evidence (vote and bigram agreement, or a decisive
// demotion-driven vote). Public: a contract fact, see CONFUSION_BAND.
export const CONFUSION_FLOOR_RATIO = 0.5;

// The strict tier only opens when the top confidence is below this value.
// A low absolute confidence means no model explains the data, so the
// ranking among confusion siblings is noise and corroborated byte-level
// evidence may overturn it. A confident top means the statistics are
// working; overriding them from far down the ranking does more harm than
// good (correlated vote/rescore errors across the many near-scoring Latin
// encodings). Public: a contract fact, see CONFUSION_BAND.
export const STRICT_TIER_MAX_CONF = 0.2;

// Resolve confusion between similar encodings in the top results.
//
// Checks the top result against each candidate within a confidence band.
// Always checks position 1 (preserving original top-2 behavior); for
// positions 2+ only checks within the band, and candidates between the
// band and the floor enter the strict tier, which only opens when the
// statistics have failed outright.
export function resolveConfusionGroups(
  data: Uint8Array,
  results: DetectionResult[],
): DetectionResult[] {
  if (results.length < 2) return results;

  const top = results[0];
  if (top.encoding === null) return results;
  // An art-model win (the zxx pseudo-language: no linguistic content) is
  // not up for linguistic-plausibility review — voting and rescoring both
  // reason about prose, which box-drawing data is not. Narrowing this to
  // rescore-only review was tried upstream and rejected: under era
  // filtering a prose sibling can tie the art model exactly and the
  // diff-focused rescore then dethrones genuine art.
  if (top.language === ART_LANGUAGE) return results;

  const maps = loadConfusionMaps();
  const topConf = top.confidence;
  const floor = topConf * CONFUSION_FLOOR_RATIO;

  let championIdx = 0;
  let champion = top;
  let championEnc: string = top.encoding;
  for (let i = 1; i < results.length; i++) {
    const candidate = results[i];
    if (candidate.encoding === null) continue;
    // Position 1 and band members use the original in-band rules;
    // candidates between the band and the floor enter the strict tier.
    const inBand = i === 1 || topConf - candidate.confidence <= CONFUSION_BAND;
    if (!inBand && (topConf >= STRICT_TIER_MAX_CONF || candidate.confidence < floor)) {
      break;
    }

    const pair = _findPairKey(maps, championEnc, candidate.encoding);
    if (pair === null) continue;

    const [encA, encB] = pair;
    const { diffBytes, categories } = maps.get(pairKey(encA, encB))!;

    const vote = _voteWithMargin(data, encA, encB, diffBytes, categories);
    // A demotion-driven vote outranks the bigram rescore: those votes were
    // earned where the opposing reading was a word-shape-impossible letter
    // (lowercase jammed between digits or capitals), which is stronger
    // evidence than the rescore's prose-typicality priors. A vote won on
    // the naive letters-beat-symbols preference defers to the rescore's
    // model evidence. Decisiveness requires repeated evidence: one
    // occurrence can reach the margin on its own, and a single byte of
    // context must never outrank the models.
    //
    // The decisive-demotion override exists because *sibling* models are
    // too similar for the rescore to arbitrate — a premise that only holds
    // within-family. Cross-family models differ wholesale, so there the
    // rescore is at its most informative and the vote's linguistic priors
    // at their least reliable: cross-family pairs always require
    // corroboration instead.
    let winner: string | null;
    if (
      vote.winner !== null &&
      vote.demotionMargin >= _DECISIVE_VOTE_MARGIN &&
      vote.demotionEvents >= _DECISIVE_MIN_EVENTS &&
      diffBytes.size < _CROSS_FAMILY_MIN_DIFFS
    ) {
      winner = vote.winner;
    } else {
      // When both results read the document as the same language, the
      // rescore compares them in it rather than under whichever language
      // happens to like the distinguishing bytes most.
      const langs = new Set<string>();
      if (champion.language !== null) langs.add(champion.language);
      if (candidate.language !== null) langs.add(candidate.language);
      const bigramWinner = resolveByBigramRescore(data, encA, encB, diffBytes, langs);
      if (inBand && diffBytes.size < _CROSS_FAMILY_MIN_DIFFS) {
        winner = bigramWinner !== null ? bigramWinner : vote.winner;
      } else if (bigramWinner !== null && bigramWinner === vote.winner) {
        // Strict rule (out-of-band candidates, and cross-family pairs even
        // in-band): overturning the ranking needs corroboration — the vote
        // and the rescore must agree. (The decisive-demotion case is
        // handled above.)
        winner = bigramWinner;
      } else {
        winner = null;
      }
    }

    if (winner === null || winner !== candidate.encoding) continue;
    if (inBand) {
      // In-band promotion: trust it and stop, preserving the original
      // single-promotion behavior for near-ties.
      const promoted: DetectionResult = {
        encoding: candidate.encoding,
        confidence: topConf,
        language: candidate.language,
        mimeType: candidate.mimeType,
      };
      const rest = results.filter((_, j) => j !== i);
      return [promoted, ...rest];
    }
    // Strict-tier promotion: the new champion must defend against the
    // remaining candidates (king-of-the-hill), because the correct member
    // of a clique may rank below another sibling that also beats the
    // current champion. Known limitation: the scan is single-pass, so a
    // higher-ranked candidate skipped earlier for lack of a pair with the
    // then-champion is never revisited against the new one — accepted,
    // since the original top-anchored code could not arbitrate those
    // either.
    championIdx = i;
    champion = candidate;
    championEnc = candidate.encoding;
  }

  if (championIdx === 0) return results;

  // Give the promoted candidate the top result's confidence so the
  // promotion survives any downstream confidence-based sort.
  const promoted: DetectionResult = {
    encoding: champion.encoding,
    confidence: topConf,
    language: champion.language,
    mimeType: champion.mimeType,
  };
  const rest = results.filter((_, j) => j !== championIdx);
  return [promoted, ...rest];
}
