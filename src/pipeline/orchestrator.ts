// Pipeline orchestrator — runs all detection stages in sequence.
// Port of chardet/src/chardet/pipeline/orchestrator.py.

import { DEFAULT_MAX_BYTES } from '../utils.js';
import { ART_LANGUAGE } from '../models/index.js';
import {
  _NONE_RESULT,
  DETERMINISTIC_CONFIDENCE,
  DetectionResult,
  PipelineContext,
} from './index.js';
import { detectAscii } from './ascii.js';
import { isBinary } from './binary.js';
import { detectBom } from './bom.js';
import { detectEscapeEncoding } from './escape.js';
import { fillLanguages } from './language.js';
import { detectMagic } from './magic.js';
import { detectMarkupCharset, promoteMarkupSuperset } from './markup.js';
import { postprocessResults } from './postprocess.js';
import { scoreCandidates } from './statistical.js';
import {
  computeLeadByteDiversity,
  computeMultibyteByteCoverage,
  computeStructuralScore,
} from './structural.js';
import { detectUtf8 } from './utf8.js';
import { detectUtf1632Patterns } from './utf1632.js';
import { filterByValidity } from './validity.js';
import { EncodingInfo, getCandidates } from '../registry.js';

// Frozen because callers spread {..._BINARY_RESULT} before applyCompatNames
// mutates the encoding field (see src/output_names.ts _remapEncoding).
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

// Default mimeType to text/plain (text) or application/octet-stream (binary).
function _withDefaultMime(result: DetectionResult): DetectionResult {
  if (result.mimeType !== null) {
    return result;
  }
  const mime = result.encoding !== null ? 'text/plain' : 'application/octet-stream';
  return {
    encoding: result.encoding,
    confidence: result.confidence,
    language: result.language,
    mimeType: mime,
  };
}

export interface RunPipelineOptions {
  maxBytes?: number;
  includeEncodings?: ReadonlySet<string> | null;
  excludeEncodings?: ReadonlySet<string> | null;
  noMatchEncoding?: string;
  emptyInputEncoding?: string;
  // Pass true when data is already a truncated view of the caller's input
  // (UniversalDetector caps its buffer at maxBytes, which this function
  // cannot see from data.length alone). Truncation by the maxBytes slice
  // here is detected either way; the flag only ever widens it.
  inputTruncated?: boolean;
}

function _runPipelineCore(
  data: Uint8Array,
  encodingEra: number,
  maxBytes: number,
  includeEncodings: ReadonlySet<string> | null,
  excludeEncodings: ReadonlySet<string> | null,
  noMatchEncoding: string,
  emptyInputEncoding: string,
  inputTruncated: boolean,
): DetectionResult[] {
  const ctx = new PipelineContext();
  inputTruncated = inputTruncated || data.length > maxBytes;
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
  // bytes happen to be pure ASCII).
  let markupResult = detectMarkupCharset(data);
  if (markupResult !== null && markupResult.encoding !== null && allowed.has(markupResult.encoding)) {
    // A declaration is honoured over pure ASCII (the declared encoding decodes
    // those bytes identically), but not over genuine UTF-8 structure: data
    // containing valid multi-byte UTF-8 sequences is UTF-8 regardless of what
    // the (frequently stale) declaration claims, and decoding it as the
    // declared encoding would produce mojibake. Keep the markup mime type;
    // only the encoding wins.
    if (
      utf8Precheck !== null
      && utf8Precheck.encoding !== null
      && utf8Precheck.encoding !== markupResult.encoding
      && allowed.has(utf8Precheck.encoding)
    ) {
      return [{
        encoding: utf8Precheck.encoding,
        confidence: utf8Precheck.confidence,
        language: utf8Precheck.language,
        mimeType: markupResult.mimeType,
      }];
    }
    markupResult = _internal.promoteMarkupSuperset(data, markupResult, allowed);
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
        return _internal.postprocessResults(data, results, { inputTruncated });
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

  return _internal.postprocessResults(data, results, { inputTruncated });
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
    options?.inputTruncated ?? false,
  );
  results = _internal.fillLanguages(data, results);
  // The ANSI-art model is keyed under the "zxx" pseudo-language (ISO 639
  // for "no linguistic content"). Kept internal so language fill does not
  // overwrite it; callers see language=null.
  results = results.map(r =>
    r.language === ART_LANGUAGE
      ? { encoding: r.encoding, confidence: r.confidence, language: null, mimeType: r.mimeType }
      : r,
  );
  results = results.map(_withDefaultMime);
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
// directly via re-exports below (or from their home modules: markup.ts,
// postprocess.ts, language.ts).
export const _internal = {
  filterByValidity,
  promoteMarkupSuperset,
  _makeFallbackOrNone,
  _gateCjkCandidates,
  _scoreStructuralCandidates,
  postprocessResults,
  fillLanguages,
  _runPipelineCore,
};

export {
  _BINARY_RESULT,
  _gateCjkCandidates,
  _makeFallbackOrNone,
  _runPipelineCore,
  _scoreStructuralCandidates,
  _withDefaultMime,
};
