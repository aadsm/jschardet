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

// Fill missing `language` fields on text results via the three-tier algorithm.
// Binary results (encoding === null) are passed through unchanged, as are
// results that already have a non-null language.
export function fillLanguages(
  data: Uint8Array,
  results: DetectionResult[],
): DetectionResult[] {
  data = data.subarray(0, _LANG_SCORE_MAX_BYTES);
  const filled: DetectionResult[] = [];
  let profile: BigramProfile | null = null;
  let utf8Profile: BigramProfile | null = null;
  for (const result of results) {
    if (result.language !== null || result.encoding === null) {
      filled.push(result);
      continue;
    }
    const encoding = result.encoding;
    // Tier 1: single-language encoding
    let lang = inferLanguage(encoding);
    // Tier 2: statistical scoring for multi-language encodings
    if (lang === null && data.length > 0 && hasModelVariants(encoding)) {
      if (profile === null) profile = new BigramProfile(data);
      const [, l] = scoreBestLanguage(data, encoding, profile);
      lang = l;
    }
    // Tier 3: decode to UTF-8, score against UTF-8 language models
    if (lang === null && data.length > 0 && hasModelVariants('utf-8')) {
      const utf8Data = _toUtf8(data, encoding);
      if (utf8Data !== null && utf8Data.length > 0) {
        if (utf8Profile === null || encoding !== 'utf-8') {
          utf8Profile = new BigramProfile(utf8Data);
        }
        const [, l] = scoreBestLanguage(utf8Data, 'utf-8', utf8Profile);
        lang = l;
      }
    }
    if (lang === null) {
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

export { _LANG_SCORE_MAX_BYTES, _toUtf8 };
