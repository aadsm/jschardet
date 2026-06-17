// Confusion group resolution for similar single-byte encodings. Port of
// chardet/src/chardet/pipeline/confusion.py.
//
// Loads pre-computed distinguishing byte maps from confusion.bin and uses
// them to resolve statistical scoring ties between similar encodings.

import { BigramProfile, getEncIndex, getIdfWeights, scoreWithProfile } from '../models/index.js';
import { DetectionResult } from './index.js';
import { lookupEncoding } from '../registry.js';
import { readBytes as readConfusionBin } from '../models/confusion.bin.js';

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

export function resolveByCategoryVoting(
  data: Uint8Array,
  encA: string,
  encB: string,
  diffBytes: Set<number>,
  categories: Map<number, [string, string]>,
): string | null {
  let votesA = 0;
  let votesB = 0;
  const present = new Set<number>();
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (diffBytes.has(b)) present.add(b);
  }
  if (present.size === 0) return null;
  for (const bv of present) {
    const cats = categories.get(bv);
    if (cats === undefined) continue;
    const prefA = _CATEGORY_PREFERENCE[cats[0]] ?? 0;
    const prefB = _CATEGORY_PREFERENCE[cats[1]] ?? 0;
    if (prefA > prefB) votesA += prefA - prefB;
    else if (prefB > prefA) votesB += prefB - prefA;
  }
  if (votesA > votesB) return encA;
  if (votesB > votesA) return encB;
  return null;
}

function _bestVariantScore(profile: BigramProfile, enc: string): number {
  const variants = getEncIndex().get(enc);
  if (variants === undefined || variants.length === 0) return 0.0;
  let best = 0.0;
  for (const [, model, modelKey] of variants) {
    const s = scoreWithProfile(profile, model, modelKey);
    if (s > best) best = s;
  }
  return best;
}

export function resolveByBigramRescore(
  data: Uint8Array,
  encA: string,
  encB: string,
  diffBytes: Set<number>,
): string | null {
  if (data.length < 2) return null;

  const idf = getIdfWeights();
  const freq = new Map<number, number>();
  for (let i = 0; i < data.length - 1; i++) {
    const b1 = data[i];
    const b2 = data[i + 1];
    if (!diffBytes.has(b1) && !diffBytes.has(b2)) continue;
    const idx = (b1 << 8) | b2;
    freq.set(idx, (freq.get(idx) ?? 0) + idf[idx]);
  }

  if (freq.size === 0) return null;

  const profile = BigramProfile.fromWeightedFreq(freq);
  const bestA = _bestVariantScore(profile, encA);
  const bestB = _bestVariantScore(profile, encB);

  if (bestA > bestB) return encA;
  if (bestB > bestA) return encB;
  return null;
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

// Maximum confidence gap from the top result for candidates beyond position 1
// to participate in confusion resolution.
const _CONFUSION_BAND = 0.005;

export function resolveConfusionGroups(
  data: Uint8Array,
  results: DetectionResult[],
): DetectionResult[] {
  if (results.length < 2) return results;

  const top = results[0];
  if (top.encoding === null) return results;

  const maps = loadConfusionMaps();
  const topConf = top.confidence;

  for (let i = 1; i < results.length; i++) {
    const candidate = results[i];
    if (candidate.encoding === null) continue;
    // Always check position 1 (original top-2 behavior). For positions 2+,
    // only check within the confidence band.
    if (i > 1 && topConf - candidate.confidence > _CONFUSION_BAND) break;

    const pair = _findPairKey(maps, top.encoding, candidate.encoding);
    if (pair === null) continue;

    const [encA, encB] = pair;
    const { diffBytes, categories } = maps.get(pairKey(encA, encB))!;

    const catWinner = resolveByCategoryVoting(data, encA, encB, diffBytes, categories);
    const bigramWinner = resolveByBigramRescore(data, encA, encB, diffBytes);
    const winner = bigramWinner !== null ? bigramWinner : catWinner;

    if (winner !== null && winner === candidate.encoding) {
      // Promote the winning candidate to the top, preserving the top's
      // confidence so the promotion survives any downstream sort.
      const promoted: DetectionResult = {
        encoding: candidate.encoding,
        confidence: top.confidence,
        language: candidate.language,
        mimeType: candidate.mimeType,
      };
      const rest = results.filter((_, j) => j !== i);
      return [promoted, ...rest];
    }
  }

  return results;
}
