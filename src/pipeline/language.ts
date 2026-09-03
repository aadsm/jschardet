// Port of chardet/src/chardet/pipeline/language.py — three-tier language
// detection for filling DetectionResult languages.
//
// Tier 1: hardcoded mapping for single-language encodings (e.g. Big5 -> Chinese).
// Tier 2: statistical bigram scoring against the encoding's language-model variants.
// Tier 3: decode to UTF-8 and score against the UTF-8 byte-level language models.
//
// Python's private _to_utf8 helper lives in ./to-utf8.ts here: TextDecoder has
// no UTF-32/UTF-7 support and no auto-endian 'utf-16' label, so the one-line
// Python decode expands into per-encoding fallbacks.

import {
  BigramProfile,
  RARE_LANGUAGES,
  THIN_RARE_MAX_BYTES,
  hasModelVariants,
  inferLanguage,
  scoreBestLanguage,
} from '../models/index.js';
import { DetectionResult } from './index.js';
import { toUtf8 as _toUtf8 } from './to-utf8.js';

// Maximum bytes of data used for language scoring. Language bigrams converge
// quickly — 2 KB is sufficient for discrimination across all language models
// while keeping Tier 3 (language-model scoring) fast.
const _LANG_SCORE_MAX_BYTES = 2048;

function _bytesEqual(a: Uint8Array, b: Uint8Array | null): boolean {
  if (b === null || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Fill missing `language` fields on text results via the three-tier algorithm.
// Binary results (encoding === null) are passed through unchanged, as are
// results that already have a non-null language — except a RARE_LANGUAGES
// label on a thin input, which is re-derived through the same scoring so the
// thin-rare demotion band applies to statistically-attached labels too, not
// only to labels this function computes. A re-derivation can only *demote*
// to a prevalent language; it never swaps one rare label for another.
export function fillLanguages(
  data: Uint8Array,
  results: DetectionResult[],
): DetectionResult[] {
  data = data.subarray(0, _LANG_SCORE_MAX_BYTES);
  // Thinness is judged once, on the bytes the caller actually has. Tier 3
  // transcodes to UTF-8 before scoring, which can inflate curly punctuation
  // 3x — judging length after that would exempt exactly the inputs the
  // band exists for.
  const thin = data.length > 0 && data.length < THIN_RARE_MAX_BYTES;
  const filled: DetectionResult[] = [];
  let profile: BigramProfile | null = null;
  let utf8Profile: BigramProfile | null = null;
  let utf8ProfileSrc: Uint8Array | null = null;
  for (const result of results) {
    const recheck =
      thin &&
      result.language !== null &&
      RARE_LANGUAGES.has(result.language) &&
      result.encoding !== null;
    if (result.encoding === null || (result.language !== null && !recheck)) {
      filled.push(result);
      continue;
    }
    const encoding = result.encoding;
    // Tier 1: single-language encoding (skipped on re-check: the label
    // exists; only the scored tiers can justify a demotion)
    let lang = recheck ? null : inferLanguage(encoding);
    // Tier 2: statistical scoring for multi-language encodings
    if (lang === null && data.length > 0 && _internal.hasModelVariants(encoding)) {
      if (profile === null) profile = new BigramProfile(data);
      const [, l] = scoreBestLanguage(data, encoding, profile, { demoteThinRare: thin });
      lang = l;
    }
    // Tier 3: decode to UTF-8, score against UTF-8 language models. Also
    // entered by a thin rare Tier-2 label: an encoding whose variant set is
    // all-Celtic (iso8859-14) can never offer the band a prevalent rival,
    // so the utf-8 models — which always have one — get the deciding vote.
    // Their verdict is only accepted as a demotion; a rare verdict leaves
    // the Tier-2 label in place.
    const escalate = thin && lang !== null && RARE_LANGUAGES.has(lang);
    if ((lang === null || escalate) && data.length > 0 && _internal.hasModelVariants('utf-8')) {
      const utf8Data = _toUtf8(data, encoding);
      if (utf8Data !== null && utf8Data.length > 0) {
        if (!_bytesEqual(utf8Data, utf8ProfileSrc)) {
          utf8Profile = new BigramProfile(utf8Data);
          utf8ProfileSrc = utf8Data;
        }
        const [, utf8Lang] = scoreBestLanguage(utf8Data, 'utf-8', utf8Profile!, {
          demoteThinRare: thin,
        });
        if (lang === null || (utf8Lang !== null && !RARE_LANGUAGES.has(utf8Lang))) {
          lang = utf8Lang;
        }
      }
    }
    if (recheck && (lang === null || RARE_LANGUAGES.has(lang))) {
      // The band did not fire (or scoring was unavailable): the original
      // label stands. Never replace one rare label with another — the
      // re-check's only authority is the demotion.
      filled.push(result);
    } else if (lang === null) {
      filled.push(result);
    } else {
      filled.push({
        encoding,
        confidence: result.confidence,
        language: lang,
        mimeType: result.mimeType,
      });
    }
  }
  return filled;
}

// Test-spy seam. The Python tier tests monkeypatch language.has_model_variants
// to force each tier; routing the two gate calls through this object lets
// vi.spyOn(_internal, 'hasModelVariants') do the same. See orchestrator.ts's
// _internal for the pattern.
export const _internal = { hasModelVariants };

export { _LANG_SCORE_MAX_BYTES, _toUtf8 };
