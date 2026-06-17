// Internal chardet entry — port of chardet/src/chardet/__init__.py.
//
// This file mirrors the chardet API faithfully. It is consumed by jschardet's
// public API (a future compat layer in src/index.ts) but is itself internal:
// see Issue 8 in docs/chardet-ts-port-reference.md for the input-type rationale.

import {
  DEFAULT_MAX_BYTES,
  MINIMUM_THRESHOLD,
  _DEFAULT_CHUNK_SIZE,
  _resolvePreferSuperset,
  _validateMaxBytes,
  _warnDeprecatedChunkSize,
} from './utils.js';
import { EncodingEra } from './enums.js';
import {
  applyCompatNames,
  applyPreferredSuperset,
} from './equivalences.js';
import { DetectionResult } from './pipeline/index.js';
import { runPipeline } from './pipeline/orchestrator.js';
import { _validateEncoding, normalizeEncodings } from './registry.js';

export { DETERMINISTIC_CONFIDENCE } from './pipeline/index.js';
export type { DetectionResult } from './pipeline/index.js';
export { UniversalDetector } from './detector.js';
export { EncodingEra, LanguageFilter } from './enums.js';
export { DEFAULT_MAX_BYTES, MINIMUM_THRESHOLD } from './utils.js';

export interface DetectOptions {
  shouldRenameLegacy?: boolean;
  encodingEra?: number;
  chunkSize?: number;
  maxBytes?: number;
  preferSuperset?: boolean;
  compatNames?: boolean;
  includeEncodings?: Iterable<string> | null;
  excludeEncodings?: Iterable<string> | null;
  noMatchEncoding?: string;
  emptyInputEncoding?: string;
}

export interface DetectAllOptions extends DetectOptions {
  ignoreThreshold?: boolean;
}

// Python accepts bytes | bytearray and converts internally; the TS internal API
// is Uint8Array only (see Issue 8 in docs/chardet-ts-port-reference.md). Buffer
// is a Uint8Array subclass so Node callers work without conversion.
export function detect(byteStr: Uint8Array, options: DetectOptions = {}): DetectionResult {
  const shouldRenameLegacy = options.shouldRenameLegacy ?? false;
  const encodingEra = options.encodingEra ?? EncodingEra.ALL;
  const chunkSize = options.chunkSize ?? _DEFAULT_CHUNK_SIZE;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const preferSupersetIn = options.preferSuperset ?? false;
  const compatNames = options.compatNames ?? true;
  const includeEncodings = options.includeEncodings ?? null;
  const excludeEncodings = options.excludeEncodings ?? null;
  const noMatchEncodingIn = options.noMatchEncoding ?? 'cp1252';
  const emptyInputEncodingIn = options.emptyInputEncoding ?? 'utf-8';

  _warnDeprecatedChunkSize(chunkSize);
  _validateMaxBytes(maxBytes);
  const preferSuperset = _resolvePreferSuperset(shouldRenameLegacy, preferSupersetIn);
  const include = normalizeEncodings(includeEncodings, 'include_encodings');
  const exclude = normalizeEncodings(excludeEncodings, 'exclude_encodings');
  const noMatch = _validateEncoding(noMatchEncodingIn, 'no_match_encoding');
  const empty = _validateEncoding(emptyInputEncodingIn, 'empty_input_encoding');

  const results = runPipeline(byteStr, encodingEra, {
    maxBytes,
    includeEncodings: include,
    excludeEncodings: exclude,
    noMatchEncoding: noMatch,
    emptyInputEncoding: empty,
  });

  // Spread before applyPreferredSuperset/applyCompatNames so the orchestrator's
  // returned objects (including the singleton _NONE_RESULT and _BINARY_RESULT)
  // aren't mutated.
  const result: DetectionResult = { ...results[0] };
  if (preferSuperset) applyPreferredSuperset(result);
  if (compatNames) applyCompatNames(result);
  return result;
}

export function detectAll(
  byteStr: Uint8Array,
  options: DetectAllOptions = {},
): DetectionResult[] {
  const ignoreThreshold = options.ignoreThreshold ?? false;
  const shouldRenameLegacy = options.shouldRenameLegacy ?? false;
  const encodingEra = options.encodingEra ?? EncodingEra.ALL;
  const chunkSize = options.chunkSize ?? _DEFAULT_CHUNK_SIZE;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const preferSupersetIn = options.preferSuperset ?? false;
  const compatNames = options.compatNames ?? true;
  const includeEncodings = options.includeEncodings ?? null;
  const excludeEncodings = options.excludeEncodings ?? null;
  const noMatchEncodingIn = options.noMatchEncoding ?? 'cp1252';
  const emptyInputEncodingIn = options.emptyInputEncoding ?? 'utf-8';

  _warnDeprecatedChunkSize(chunkSize);
  _validateMaxBytes(maxBytes);
  const preferSuperset = _resolvePreferSuperset(shouldRenameLegacy, preferSupersetIn);
  const include = normalizeEncodings(includeEncodings, 'include_encodings');
  const exclude = normalizeEncodings(excludeEncodings, 'exclude_encodings');
  const noMatch = _validateEncoding(noMatchEncodingIn, 'no_match_encoding');
  const empty = _validateEncoding(emptyInputEncodingIn, 'empty_input_encoding');

  const results = runPipeline(byteStr, encodingEra, {
    maxBytes,
    includeEncodings: include,
    excludeEncodings: exclude,
    noMatchEncoding: noMatch,
    emptyInputEncoding: empty,
  });

  // Spread before applyPreferredSuperset/applyCompatNames so the orchestrator's
  // returned objects (including the singleton _NONE_RESULT and _BINARY_RESULT)
  // aren't mutated.
  let dicts: DetectionResult[] = results.map(r => ({ ...r }));
  if (!ignoreThreshold) {
    const filtered = dicts.filter(d => d.confidence > MINIMUM_THRESHOLD);
    if (filtered.length > 0) dicts = filtered;
  }
  for (const d of dicts) {
    if (preferSuperset) applyPreferredSuperset(d);
    if (compatNames) applyCompatNames(d);
  }
  dicts.sort((a, b) => b.confidence - a.confidence);
  return dicts;
}
