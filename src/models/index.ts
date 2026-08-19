// Port of chardet/src/chardet/models/__init__.py — bigram model loading and scoring.
//
// `models.bin.js` already exposes the per-model bigram blob as raw,
// uncompressed bytes (the wrapper handles the zlib step before returning from
// readBytes()), so the parser here simply skips Python's
// _parse_models_bin call to zlib.decompress and otherwise mirrors it
// line-for-line.

import { REGISTRY, lookupEncoding } from '../registry.js';
import { readBytes as readModelsBin } from './models.bin.js';
import { readBytes as readIdfBin } from './idf.bin.js';

const V2_MAGIC = new Uint8Array([0x43, 0x4D, 0x44, 0x32]); // "CMD2"

const SINGLE_LANG_MAP: Record<string, string> = {};
for (const enc of Object.values(REGISTRY)) {
  if (enc.languages.length === 1) {
    SINGLE_LANG_MAP[enc.name] = enc.languages[0];
  }
}

export type ModelVariant = readonly [string | null, Uint8Array, string];

interface ParsedModels {
  models: Map<string, Uint8Array>;
  norms: Map<string, number>;
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

// Exported with underscore prefix as an internal helper for the test suite.
// Mirrors Python's _parse_models_bin; production callers go through
// loadModels()/getEncIndex() which handle caching and the empty-buffer path.
export function _parseModelsBin(data: Uint8Array): ParsedModels {
  if (data.length < 4 ||
      data[0] !== V2_MAGIC[0] || data[1] !== V2_MAGIC[1] ||
      data[2] !== V2_MAGIC[2] || data[3] !== V2_MAGIC[3]) {
    throw new Error('corrupt models.bin: missing CMD2 magic');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 4;

  try {
    const numModels = view.getUint32(offset, false);
    offset += 4;
    if (numModels > 10_000) {
      throw new Error(`corrupt models.bin: num_models=${numModels} exceeds limit`);
    }

    const names: string[] = [];
    const norms = new Map<string, number>();
    for (let i = 0; i < numModels; i++) {
      const nameLen = view.getUint32(offset, false);
      offset += 4;
      if (nameLen > 256) {
        throw new Error(`corrupt models.bin: name_len=${nameLen} exceeds 256`);
      }
      let name: string;
      try {
        name = utf8Decoder.decode(data.subarray(offset, offset + nameLen));
      } catch (e) {
        throw new Error(`corrupt models.bin: ${(e as Error).message}`);
      }
      offset += nameLen;
      const norm = view.getFloat64(offset, false);
      offset += 8;
      names.push(name);
      norms.set(name, norm);
    }

    // The blob arrives raw — the wrapper has already inflated the trailing
    // bigram payload, so we slice from `offset` directly without an extra
    // zlib step (Python does zlib.decompress here on still-compressed data).
    const blob = data.subarray(offset);
    const expectedSize = numModels * 65536;
    if (blob.length !== expectedSize) {
      throw new Error(
        `corrupt models.bin: blob size ${blob.length} != expected decompressed size ${expectedSize}`,
      );
    }

    const models = new Map<string, Uint8Array>();
    for (let i = 0; i < names.length; i++) {
      const start = i * 65536;
      models.set(names[i], blob.subarray(start, start + 65536));
    }
    return { models, norms };
  } catch (e) {
    if (e instanceof RangeError) {
      throw new Error(`corrupt models.bin: ${e.message}`);
    }
    throw e;
  }
}

let modelDataCache: ParsedModels | null = null;

function loadModelData(): ParsedModels {
  if (modelDataCache) return modelDataCache;
  const data = readModelsBin();
  if (data.length === 0) {
    console.warn(
      'jschardet models.bin is empty — statistical detection disabled; ' +
      'reinstall jschardet to fix',
    );
    modelDataCache = { models: new Map(), norms: new Map() };
    return modelDataCache;
  }
  modelDataCache = _parseModelsBin(data);
  return modelDataCache;
}

export function loadModels(): Map<string, Uint8Array> {
  return loadModelData().models;
}

// Exported with underscore prefix as an internal helper for the test suite.
export function _buildEncIndex(
  models: Map<string, Uint8Array>,
): Map<string, ModelVariant[]> {
  const index = new Map<string, ModelVariant[]>();
  for (const [key, model] of models) {
    const slash = key.indexOf('/');
    const lang = key.slice(0, slash);
    const enc = key.slice(slash + 1);
    let bucket = index.get(enc);
    if (!bucket) {
      bucket = [];
      index.set(enc, bucket);
    }
    bucket.push([lang, model, key]);
  }
  // Resolve aliases: copy entries to canonical names if missing.
  for (const encName of [...index.keys()]) {
    const canonical = lookupEncoding(encName);
    if (canonical !== null && !index.has(canonical)) {
      index.set(canonical, index.get(encName)!);
    }
  }
  return index;
}

let encIndexCache: Map<string, ModelVariant[]> | null = null;

export function getEncIndex(): Map<string, ModelVariant[]> {
  if (encIndexCache) return encIndexCache;
  encIndexCache = _buildEncIndex(loadModels());
  return encIndexCache;
}

export function inferLanguage(encoding: string): string | null {
  return SINGLE_LANG_MAP[encoding] ?? null;
}

export function hasModelVariants(encoding: string): boolean {
  return getEncIndex().has(encoding);
}

let idfWeightsCache: Uint8Array | null = null;

export function getIdfWeights(): Uint8Array {
  if (idfWeightsCache) return idfWeightsCache;
  const data = readIdfBin();
  if (data.length !== 65536) {
    console.warn(
      `jschardet idf.bin has wrong size (${data.length}), ` +
      'falling back to uniform weights',
    );
    idfWeightsCache = new Uint8Array(65536).fill(1);
    return idfWeightsCache;
  }
  idfWeightsCache = data;
  return idfWeightsCache;
}

// 256-entry membership table for whitespace bytes whose runs training
// collapsed. Covers the ASCII whitespace bytes (space, tab, LF, VT, FF, CR)
// plus NBSP (0xA0): training's run collapse operates on decoded text where
// regex \s matches all of these, so Latin models carry no run weight for
// them and an uncollapsed input run would match only unrelated models
// where the byte happens to be a letter. 0x85 (NEL in the ISO family) is
// deliberately absent: it decodes to the ellipsis in windows-1252, whose
// models legitimately carry ellipsis-run weight.
export const ASCII_WHITESPACE_TABLE = new Uint8Array(256);
for (const b of [0x20, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0xA0]) {
  ASCII_WHITESPACE_TABLE[b] = 1;
}

export class BigramProfile {
  // Exactly one of freq and values carries the weights, never both. The
  // streaming constructor keeps the dense freq table it had to build and
  // leaves values empty; fromWeightedFreq fills values parallel to nonzero
  // and no table, which is what lets it skip a 65536-entry allocation for
  // the small focused profiles confusion resolution builds (chardet's
  // BigramProfile stores them the same two ways).
  freq: Uint32Array | number[];
  nonzero: number[];
  values: number[];
  weightSum: number;
  inputNorm: number;

  constructor(data: Uint8Array) {
    const totalBigrams = data.length - 1;
    if (totalBigrams <= 0) {
      // Empty arrays match Python's no-op profile — scoreWithProfile returns
      // 0 early when inputNorm == 0, so freq is never indexed.
      this.freq = [];
      this.nonzero = [];
      this.values = [];
      this.weightSum = 0;
      this.inputNorm = 0;
      return;
    }

    const idf = getIdfWeights();
    const freq = new Uint32Array(65536);
    const nonzero: number[] = [];
    let wSum = 0;
    for (let i = 0; i < totalBigrams; i++) {
      const b1 = data[i];
      const b2 = data[i + 1];
      // Skip repeated-whitespace bigrams (equivalent to collapsing
      // whitespace runs, which training does before counting): padding
      // and indentation carry no encoding signal, and models trained
      // on lossy transcodes can carry spurious weight for them.
      if (b1 === b2 && ASCII_WHITESPACE_TABLE[b1]) continue;
      const idx = (b1 << 8) | b2;
      const w = idf[idx];
      if (freq[idx] === 0) nonzero.push(idx);
      freq[idx] += w;
      wSum += w;
    }
    this.freq = freq;
    this.nonzero = nonzero;
    this.values = [];
    this.weightSum = wSum;
    let normSq = 0;
    for (const idx of nonzero) {
      const v = freq[idx];
      normSq += v * v;
    }
    this.inputNorm = Math.sqrt(normSq);
  }

  static fromWeightedFreq(weightedFreq: Map<number, number>): BigramProfile {
    const profile = new BigramProfile(new Uint8Array(0));
    const nonzero: number[] = [];
    const values: number[] = [];
    let weightSum = 0;
    let normSq = 0;
    for (const [idx, count] of weightedFreq) {
      if (count) {
        nonzero.push(idx);
        values.push(count);
        weightSum += count;
        normSq += count * count;
      }
    }
    profile.nonzero = nonzero;
    profile.values = values;
    profile.weightSum = weightSum;
    profile.inputNorm = Math.sqrt(normSq);
    return profile;
  }
}

export function scoreWithProfile(
  profile: BigramProfile,
  model: Uint8Array,
  modelKey: string = '',
): number {
  if (profile.inputNorm === 0) return 0;
  const norms = loadModelData().norms;
  let modelNorm = modelKey ? norms.get(modelKey) : undefined;
  if (modelNorm === undefined) {
    let sqSum = 0;
    for (let i = 0; i < 65536; i++) {
      const v = model[i];
      if (v) sqSum += v * v;
    }
    modelNorm = Math.sqrt(sqSum);
  }
  if (modelNorm === 0) return 0;
  let dot = 0;
  const nonzero = profile.nonzero;
  const values = profile.values;
  if (values.length) {
    // Sparse profile (fromWeightedFreq): weights live in the parallel
    // values list, there is no dense table to index.
    for (let i = 0; i < nonzero.length; i++) {
      dot += model[nonzero[i]] * values[i];
    }
  } else {
    const freq = profile.freq;
    for (const idx of nonzero) {
      dot += model[idx] * freq[idx];
    }
  }
  return dot / (modelNorm * profile.inputNorm);
}

// ADR-0005's hand-audited rare-language set, shared with the encoding-side
// arbitration gate in pipeline/postprocess. One set, two gates: the
// deployment evidence that justifies membership is recorded in the ADR and
// any new genuine specimen forces a re-audit of both.
export const RARE_LANGUAGES: ReadonlySet<string> = new Set(['gd', 'cy', 'ga', 'br']);

// The ANSI/ASCII-art pseudo-language. Never a valid demotion target for
// the thin-rare band: swapping a rare label for "zxx" would tell the
// orchestrator the text has no linguistic content at all.
export const ART_LANGUAGE = 'zxx';

// The thin-margin band for demoteThinRare: inputs shorter than this are
// where bigram cosines stop discriminating (apostrophe-rich English
// snippets score as Gaelic). The callers in pipeline/language own the
// length judgment because only they know the pre-transcoding size.
export const THIN_RARE_MAX_BYTES = 128;

// Maximum lead over the best prevalent-language variant for a rare win on
// a short input to count as noise. Measured mislabels win by <= 0.021;
// genuine gd/cy snippets measure 0.07+. Short Breton and Irish can sit
// inside the band and are the accepted casualty class per ADR-0005's
// addendum — widening the margin widens that class.
const THIN_RARE_MARGIN = 0.03;

export function scoreBestLanguage(
  data: Uint8Array,
  encoding: string,
  profile?: BigramProfile,
  { demoteThinRare = false }: { demoteThinRare?: boolean } = {},
): [number, string | null] {
  if (data.length === 0 && profile === undefined) return [0, null];

  const variants = getEncIndex().get(encoding);
  if (variants === undefined) return [0, null];

  const p = profile ?? new BigramProfile(data);

  // demoteThinRare is passed only when the caller has judged the original
  // input thin (under THIN_RARE_MAX_BYTES before any transcoding) — this
  // function may receive transcoded bytes, so data.length here is not a
  // reliable proxy for input size. Language-fill callers pass it;
  // encoding-ranking callers must not, so candidate ordering stays
  // byte-identical (chardet's score_best_language demote_thin_rare).
  let bestScore = 0;
  let bestLang: string | null = null;
  let bestPrevalent = 0;
  let bestPrevalentLang: string | null = null;
  for (const [lang, model, modelKey] of variants) {
    const s = scoreWithProfile(p, model, modelKey);
    if (s > bestScore) {
      bestScore = s;
      bestLang = lang;
    }
    if (
      demoteThinRare &&
      (lang === null || (!RARE_LANGUAGES.has(lang) && lang !== ART_LANGUAGE)) &&
      s > bestPrevalent
    ) {
      bestPrevalent = s;
      bestPrevalentLang = lang;
    }
  }

  if (
    demoteThinRare &&
    bestLang !== null &&
    RARE_LANGUAGES.has(bestLang) &&
    bestPrevalentLang !== null &&
    bestScore - bestPrevalent < THIN_RARE_MARGIN
  ) {
    bestLang = bestPrevalentLang;
  }

  return [bestScore, bestLang];
}
