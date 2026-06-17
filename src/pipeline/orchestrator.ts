// Pipeline orchestrator — runs all detection stages in sequence.
// Port of chardet/src/chardet/pipeline/orchestrator.py.

import { DEFAULT_MAX_BYTES } from '../utils.js';
import {
  BigramProfile,
  hasModelVariants,
  inferLanguage,
  scoreBestLanguage,
} from '../models/index.js';
import {
  _NONE_RESULT,
  DETERMINISTIC_CONFIDENCE,
  DetectionResult,
  PipelineContext,
} from './index.js';
import { detectAscii } from './ascii.js';
import { isBinary } from './binary.js';
import { detectBom } from './bom.js';
import { resolveConfusionGroups } from './confusion.js';
import { detectEscapeEncoding } from './escape.js';
import { detectMagic } from './magic.js';
import { detectMarkupCharset } from './markup.js';
import { scoreCandidates } from './statistical.js';
import {
  computeLeadByteDiversity,
  computeMultibyteByteCoverage,
  computeStructuralScore,
} from './structural.js';
import { detectUtf8 } from './utf8.js';
import { detectUtf1632Patterns } from './utf1632.js';
import { filterByValidity } from './validity.js';
import { EncodingInfo, REGISTRY, getCandidates } from '../registry.js';
import { decoderForLabel, whatwgLabelFor } from '../text-decoder.js';
import { toUtf8 as _toUtf8 } from './to-utf8.js';

// Frozen because callers spread {..._BINARY_RESULT} before applyCompatNames
// mutates the encoding field (see src/equivalences.ts _remapEncoding).
const _BINARY_RESULT: Readonly<DetectionResult> = Object.freeze({
  encoding: null,
  confidence: DETERMINISTIC_CONFIDENCE,
  language: null,
  mimeType: 'application/octet-stream',
});

// Threshold at which a CJK structural score is confident enough to trigger
// combined structural+statistical ranking rather than purely statistical.
const _STRUCTURAL_CONFIDENCE_THRESHOLD = 0.85;

// Maximum bytes used for statistical bigram scoring. Bigram models converge
// quickly — 16 KB is sufficient for discrimination across all language models
// (single-byte and multi-byte alike) while avoiding unnecessary work on large
// files. Experimentally verified: 0 real accuracy losses across 835 test files
// at this threshold.
const _STAT_SCORE_MAX_BYTES = 16384;

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

// Markup charset declarations that commonly refer to a Windows superset
// encoding rather than the strict standard encoding. Japanese web content
// almost universally declares "Shift_JIS" but actually uses CP932 extensions;
// similarly, Korean web content declares "EUC-KR" but uses CP949/UHC. When the
// declared encoding resolves to the base (left), we check whether the superset
// (right) is a better structural match.
const _MARKUP_SUPERSET_PROMOTIONS: Readonly<Record<string, string>> = Object.freeze({
  shift_jis_2004: 'cp932',
  euc_kr: 'cp949',
});

function _tryPromoteMarkupSuperset(
  data: Uint8Array,
  markupResult: DetectionResult,
  allowed: ReadonlySet<string>,
): DetectionResult {
  if (markupResult.encoding === null) {
    return markupResult;
  }
  const supersetName = _MARKUP_SUPERSET_PROMOTIONS[markupResult.encoding];
  if (supersetName === undefined || !allowed.has(supersetName)) {
    return markupResult;
  }
  const supersetInfo = REGISTRY[supersetName as keyof typeof REGISTRY];
  if (supersetInfo === undefined) {
    return markupResult;
  }
  // Validate: superset must be able to decode the data. Cached decoderForLabel
  // is fatal:true (Python errors="strict").
  const label = whatwgLabelFor(supersetName);
  if (label === null) {
    return markupResult;
  }
  try {
    decoderForLabel(label).decode(data);
  } catch {
    return markupResult;
  }
  // Compare structural scores
  const ctx = new PipelineContext();
  const baseInfo = REGISTRY[markupResult.encoding as keyof typeof REGISTRY];
  if (baseInfo === undefined) {
    return markupResult;
  }
  const baseScore = computeStructuralScore(data, baseInfo, ctx);
  const supersetScore = computeStructuralScore(data, supersetInfo, ctx);
  if (supersetScore > baseScore) {
    return {
      encoding: supersetName,
      confidence: markupResult.confidence,
      language: markupResult.language,
      mimeType: markupResult.mimeType,
    };
  }
  return markupResult;
}

function _makeFallbackOrNone(
  encoding: string,
  allowed: ReadonlySet<string>,
  paramName: string,
): DetectionResult[] {
  if (!allowed.has(encoding)) {
    // Python uses warnings.warn(..., stacklevel=5) to attribute the warning to
    // the public caller. JS has no stacklevel mechanism; console.warn attributes
    // to wherever the runtime decides.
    console.warn(
      `${paramName} '${encoding}' is excluded by include_encodings/exclude_encodings; returning encoding=None`,
    );
    return [{ ..._NONE_RESULT }];
  }
  return [{ encoding, confidence: 0.10, language: null, mimeType: null }];
}

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

// Minimum structural score (valid multi-byte sequences / lead bytes) required
// to keep a CJK multi-byte candidate. Below this threshold the encoding is
// eliminated as a false positive (e.g. Shift_JIS matching Latin data where
// scattered high bytes look like lead bytes but rarely form valid pairs).
const _CJK_MIN_MB_RATIO = 0.05;
// Minimum number of non-ASCII bytes required for a CJK candidate to survive
// gating. Very short inputs are validated by the other gates (structural pair
// ratio, byte coverage) and by coverage-aware boosting in statistical scoring —
// so we keep this threshold low to let even 1-character CJK inputs compete.
const _CJK_MIN_NON_ASCII = 2;
// Minimum ratio of non-ASCII bytes that must participate in valid multi-byte
// sequences for a CJK candidate to survive gating. Genuine CJK text has nearly
// all non-ASCII bytes in valid pairs (coverage >= 0.95); Latin text with
// scattered high bytes has many orphan bytes (coverage often < 0.5). The lowest
// true-positive coverage in the test suite is ~0.39 (a CP932 HTML file with
// many half-width katakana).
const _CJK_MIN_BYTE_COVERAGE = 0.35;
// Minimum number of distinct lead byte values for a CJK candidate to survive
// gating. Genuine CJK text uses a wide range of lead bytes; European false
// positives cluster in a narrow band. Only applied when there are enough
// non-ASCII bytes to expect diversity (see _CJK_DIVERSITY_MIN_NON_ASCII).
const _CJK_MIN_LEAD_DIVERSITY = 4;
// Minimum non-ASCII byte count before applying the lead diversity gate. Very
// small files (e.g. 8 non-ASCII bytes) may genuinely have low diversity even
// for real CJK text (e.g. repeated katakana).
const _CJK_DIVERSITY_MIN_NON_ASCII = 16;

function _gateCjkCandidates(
  data: Uint8Array,
  validCandidates: readonly EncodingInfo[],
  ctx: PipelineContext,
): readonly EncodingInfo[] {
  const gated: EncodingInfo[] = [];
  for (const enc of validCandidates) {
    if (enc.isMultibyte) {
      const mbScore = computeStructuralScore(data, enc, ctx);
      ctx.mbScores.set(enc.name, mbScore);
      if (mbScore < _CJK_MIN_MB_RATIO) continue; // No multi-byte structure -> eliminate
      if (ctx.nonAsciiCount === null) {
        // Python uses bytes.translate(None, HIGH_BYTES) to drop high bytes and
        // measure by length. Uint8Array has no translate; an explicit byte loop
        // is faster than allocating a filtered copy in TS.
        let n = 0;
        for (let i = 0; i < data.length; i++) {
          if (data[i] > 0x7F) n++;
        }
        ctx.nonAsciiCount = n;
      }
      if (ctx.nonAsciiCount < _CJK_MIN_NON_ASCII) continue; // Too few high bytes to trust the score
      const byteCoverage = computeMultibyteByteCoverage(
        data,
        enc,
        ctx,
        ctx.nonAsciiCount,
      );
      ctx.mbCoverage.set(enc.name, byteCoverage);
      if (byteCoverage < _CJK_MIN_BYTE_COVERAGE) continue; // Most high bytes are orphans -> not CJK
      if (ctx.nonAsciiCount >= _CJK_DIVERSITY_MIN_NON_ASCII) {
        const leadDiversity = computeLeadByteDiversity(data, enc, ctx);
        if (leadDiversity < _CJK_MIN_LEAD_DIVERSITY) continue; // Too few distinct lead bytes -> not CJK
      }
    }
    gated.push(enc);
  }
  return gated;
}

function _scoreStructuralCandidates(
  data: Uint8Array,
  structuralScores: ReadonlyArray<readonly [string, number]>,
  validCandidates: readonly EncodingInfo[],
  ctx: PipelineContext,
): DetectionResult[] {
  const encLookup = new Map<string, EncodingInfo>();
  for (const e of validCandidates) {
    if (e.isMultibyte) encLookup.set(e.name, e);
  }
  const validMb: EncodingInfo[] = [];
  for (const [name] of structuralScores) {
    const e = encLookup.get(name);
    if (e !== undefined) validMb.push(e);
  }
  const singleByte = validCandidates.filter(e => !e.isMultibyte);
  const results = scoreCandidates(
    data.subarray(0, _STAT_SCORE_MAX_BYTES),
    [...validMb, ...singleByte],
  );

  // Boost multi-byte candidates with high byte coverage.
  const boosted: DetectionResult[] = [];
  for (const r of results) {
    const coverage = r.encoding ? (ctx.mbCoverage.get(r.encoding) ?? 0.0) : 0.0;
    if (coverage >= 0.95) {
      boosted.push({
        encoding: r.encoding,
        confidence: r.confidence * (1 + coverage),
        language: r.language,
        mimeType: r.mimeType,
      });
    } else {
      boosted.push(r);
    }
  }
  boosted.sort((a, b) => b.confidence - a.confidence);
  return boosted;
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

// Maximum bytes of data used for language scoring in _fillMetadata. Language
// bigrams converge quickly — 2 KB is sufficient for discrimination across all
// language models while keeping Tier 3 (language-model scoring) fast.
const _LANG_SCORE_MAX_BYTES = 2048;


function _fillMetadata(
  data: Uint8Array,
  results: DetectionResult[],
): DetectionResult[] {
  const filled: DetectionResult[] = [];
  let profile: BigramProfile | null = null;
  let utf8Profile: BigramProfile | null = null;
  for (const result of results) {
    let lang = result.language;
    if (lang === null && result.encoding !== null) {
      // Tier 1: single-language encoding
      lang = inferLanguage(result.encoding);
      // Tier 2: statistical scoring for multi-language encodings
      if (lang === null && data.length > 0 && hasModelVariants(result.encoding)) {
        if (profile === null) profile = new BigramProfile(data);
        const [, l] = scoreBestLanguage(data, result.encoding, profile);
        lang = l;
      }
      // Tier 3: decode to UTF-8, score against UTF-8 language models
      if (lang === null && data.length > 0 && hasModelVariants('utf-8')) {
        const utf8Data = _toUtf8(data, result.encoding);
        if (utf8Data !== null && utf8Data.length > 0) {
          if (utf8Profile === null || result.encoding !== 'utf-8') {
            utf8Profile = new BigramProfile(utf8Data);
          }
          const [, l] = scoreBestLanguage(utf8Data, 'utf-8', utf8Profile);
          lang = l;
        }
      }
    }

    let mime = result.mimeType;
    if (mime === null) {
      mime = result.encoding !== null ? 'text/plain' : 'application/octet-stream';
    }

    if (lang !== result.language || mime !== result.mimeType) {
      filled.push({
        encoding: result.encoding,
        confidence: result.confidence,
        language: lang,
        mimeType: mime,
      });
    } else {
      filled.push(result);
    }
  }
  return filled;
}

function _postprocessResults(
  data: Uint8Array,
  results: DetectionResult[],
): DetectionResult[] {
  results = resolveConfusionGroups(data, results);
  results = _internal._demoteNicheLatin(data, results);
  return _internal._promoteKoi8t(data, results);
}

export interface RunPipelineOptions {
  maxBytes?: number;
  includeEncodings?: ReadonlySet<string> | null;
  excludeEncodings?: ReadonlySet<string> | null;
  noMatchEncoding?: string;
  emptyInputEncoding?: string;
}

function _runPipelineCore(
  data: Uint8Array,
  encodingEra: number,
  maxBytes: number,
  includeEncodings: ReadonlySet<string> | null,
  excludeEncodings: ReadonlySet<string> | null,
  noMatchEncoding: string,
  emptyInputEncoding: string,
): DetectionResult[] {
  const ctx = new PipelineContext();
  // subarray gives a zero-copy view; Python's data[:maxBytes] copies.
  data = data.subarray(0, maxBytes);

  // Build candidate set once — used for both early-exit gating and statistical
  // scoring. The set incorporates encodingEra, include, and exclude filters so
  // all pipeline stages are gated consistently.
  const candidates = getCandidates(
    encodingEra,
    includeEncodings ?? undefined,
    excludeEncodings ?? undefined,
  );
  const allowed: ReadonlySet<string> = new Set(candidates.map(enc => enc.name));

  if (data.length === 0) {
    return _makeFallbackOrNone(emptyInputEncoding, allowed, 'empty_input_encoding');
  }

  // Stage 1a: BOM detection (runs first — BOMs are definitive and UTF-16/32
  // data looks binary due to null bytes)
  const bomResult = detectBom(data);
  if (bomResult !== null && bomResult.encoding !== null && allowed.has(bomResult.encoding)) {
    return [bomResult];
  }

  // Stage 1a+: UTF-16/32 null-byte pattern detection (for files without BOMs —
  // must run before binary detection since these encodings contain many null
  // bytes that would trigger the binary check)
  const utf1632Result = detectUtf1632Patterns(data);
  if (utf1632Result !== null && utf1632Result.encoding !== null && allowed.has(utf1632Result.encoding)) {
    return [utf1632Result];
  }

  // Escape-sequence encodings (ISO-2022, HZ-GB-2312, UTF-7): must run before
  // binary detection (ESC is a control byte) and before ASCII detection
  // (HZ-GB-2312 uses only printable ASCII plus tildes).
  const escapeResult = detectEscapeEncoding(data);
  if (
    escapeResult !== null
    && escapeResult.encoding !== null
    && allowed.has(escapeResult.encoding)
  ) {
    return [escapeResult];
  }

  // Magic number detection for known binary formats — runs before UTF-8/ASCII
  // prechecks to avoid unnecessary analysis on binary data.
  const magicResult = detectMagic(data);
  if (magicResult !== null) {
    return [magicResult];
  }

  // Pre-check UTF-8 to prevent false binary classification. Valid UTF-8 with
  // multi-byte sequences can contain control bytes (e.g. ESC for ANSI codes)
  // that would otherwise exceed the binary threshold. We compute the result now
  // but return it at the normal pipeline position (after markup) so that
  // explicit charset declarations still take precedence.
  const utf8Precheck = detectUtf8(data);

  // Pre-check ASCII to prevent false binary classification. ASCII text with
  // null byte separators (e.g. find -print0 output) would exceed the binary
  // threshold due to the null bytes. Like the UTF-8 precheck, we compute the
  // result now but return it at the normal position (after markup) so explicit
  // charset declarations still take precedence.
  const asciiPrecheck = detectAscii(data);

  // Stage 0: Binary detection (skip when data is valid UTF-8 or ASCII). Binary
  // detection (encoding=None) is NOT gated by filters.
  if (
    utf8Precheck === null
    && asciiPrecheck === null
    && isBinary(data, maxBytes)
  ) {
    return [{ ..._BINARY_RESULT }];
  }

  // Stage 1b: Markup charset extraction (before ASCII/UTF-8 so explicit
  // declarations like <?xml encoding="iso-8859-1"?> are honoured even when the
  // bytes happen to be pure ASCII or valid UTF-8).
  let markupResult = detectMarkupCharset(data);
  if (markupResult !== null && markupResult.encoding !== null && allowed.has(markupResult.encoding)) {
    markupResult = _internal._tryPromoteMarkupSuperset(data, markupResult, allowed);
    return [markupResult];
  }

  // Stage 1c: ASCII (use pre-computed result)
  if (asciiPrecheck !== null && asciiPrecheck.encoding !== null && allowed.has(asciiPrecheck.encoding)) {
    return [asciiPrecheck];
  }

  // Stage 1d: UTF-8 structural validation (use pre-computed result)
  if (utf8Precheck !== null && utf8Precheck.encoding !== null && allowed.has(utf8Precheck.encoding)) {
    return [utf8Precheck];
  }

  // Stage 2a: Byte validity filtering
  let validCandidates = _internal.filterByValidity(data, candidates);

  if (validCandidates.length === 0) {
    return _makeFallbackOrNone(noMatchEncoding, allowed, 'no_match_encoding');
  }

  // Gate: eliminate CJK multi-byte candidates that lack genuine multi-byte
  // structure. Cache structural scores for Stage 2b.
  validCandidates = _internal._gateCjkCandidates(data, validCandidates, ctx);

  if (validCandidates.length === 0) {
    return _makeFallbackOrNone(noMatchEncoding, allowed, 'no_match_encoding');
  }

  // Stage 2b: Structural probing for multi-byte encodings. Reuse scores already
  // computed during the CJK gate above.
  const structuralScores: Array<[string, number]> = [];
  for (const enc of validCandidates) {
    if (enc.isMultibyte) {
      let score = ctx.mbScores.get(enc.name);
      if (score === undefined) {
        score = computeStructuralScore(data, enc, ctx);
      }
      if (score > 0.0) {
        structuralScores.push([enc.name, score]);
      }
    }
  }

  // If a multi-byte encoding scored very high, score all candidates (CJK +
  // single-byte) statistically.
  if (structuralScores.length > 0) {
    structuralScores.sort((a, b) => b[1] - a[1]);
    const bestScore = structuralScores[0][1];
    if (bestScore >= _STRUCTURAL_CONFIDENCE_THRESHOLD) {
      const results = _scoreStructuralCandidates(
        data,
        structuralScores,
        validCandidates,
        ctx,
      );
      if (results.length > 0) {
        return _postprocessResults(data, results);
      }
    }
  }

  // Stage 3: Statistical scoring for all remaining candidates. Bigram models
  // converge quickly and don't benefit from scanning beyond 16 KB — cap the
  // data to avoid unnecessary work on large files.
  const statData = data.subarray(0, _STAT_SCORE_MAX_BYTES);
  const results = scoreCandidates(statData, validCandidates);
  if (results.length === 0) {
    return _makeFallbackOrNone(noMatchEncoding, allowed, 'no_match_encoding');
  }

  return _postprocessResults(data, results);
}

export function runPipeline(
  data: Uint8Array,
  encodingEra: number,
  options?: RunPipelineOptions,
): DetectionResult[] {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const includeEncodings = options?.includeEncodings ?? null;
  const excludeEncodings = options?.excludeEncodings ?? null;
  const noMatchEncoding = options?.noMatchEncoding ?? 'cp1252';
  const emptyInputEncoding = options?.emptyInputEncoding ?? 'utf-8';

  let results = _runPipelineCore(
    data,
    encodingEra,
    maxBytes,
    includeEncodings,
    excludeEncodings,
    noMatchEncoding,
    emptyInputEncoding,
  );
  // Language scoring uses only the first 2 KB — bigrams converge quickly and
  // this keeps Tier 3 (language-model scoring) fast even on large inputs.
  results = _internal._fillMetadata(data.subarray(0, _LANG_SCORE_MAX_BYTES), results);
  if (results.length === 0) {
    throw new Error('pipeline must always return at least one result');
  }
  // Clamp confidence to [0.0, 1.0] at the public API boundary. Internal stages
  // may boost confidence above 1.0 for ranking purposes (e.g. CJK byte-coverage
  // boost), but callers expect a probability-like value.
  return results.map(r =>
    r.confidence > 1.0
      ? { encoding: r.encoding, confidence: 1.0, language: r.language, mimeType: r.mimeType }
      : r,
  );
}

// Test-spy seam. Mirrors Python's monkeypatch.setattr(orchestrator, ...) by
// routing helper calls through this object so vi.spyOn(_internal, name)
// intercepts them. Tests that don't need spying can import the helpers
// directly via re-exports below.
export const _internal = {
  filterByValidity,
  _tryPromoteMarkupSuperset,
  _makeFallbackOrNone,
  _shouldDemote,
  _gateCjkCandidates,
  _scoreStructuralCandidates,
  _demoteNicheLatin,
  _promoteKoi8t,
  _toUtf8,
  _fillMetadata,
  _postprocessResults,
  _runPipelineCore,
};

export {
  _BINARY_RESULT,
  _COMMON_LATIN_ENCODINGS,
  _DEMOTION_CANDIDATES,
  _HP_ROMAN8_DISTINGUISHING,
  _ISO_8859_10_DISTINGUISHING,
  _ISO_8859_14_DISTINGUISHING,
  _KOI8_T_DISTINGUISHING,
  _MARKUP_SUPERSET_PROMOTIONS,
  _WINDOWS_1254_DISTINGUISHING,
  _demoteNicheLatin,
  _fillMetadata,
  _gateCjkCandidates,
  _makeFallbackOrNone,
  _postprocessResults,
  _promoteKoi8t,
  _runPipelineCore,
  _scoreStructuralCandidates,
  _shouldDemote,
  _toUtf8,
  _tryPromoteMarkupSuperset,
};
