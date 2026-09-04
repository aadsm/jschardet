import { warnDeprecated } from './debug.js';

export const DEFAULT_MAX_BYTES = 200_000;

// Evidence cap: how much of the examination window the candidate-filtering,
// validation, and probing stages consume before their answer is considered
// converged (ADR-0006). Exhaustive checks (BOM, magic, UTF-8, ASCII, binary,
// escape presence) take no cap. Must stay >= DEFAULT_MAX_BYTES so every call
// using the default window is provably unaffected; a test asserts the
// invariant.
export const EVIDENCE_CAP_BYTES = 256 * 1024;

export const _DEFAULT_CHUNK_SIZE = 65_536;

export function _warnDeprecatedChunkSize(chunkSize: number): void {
  if (chunkSize !== _DEFAULT_CHUNK_SIZE) {
    warnDeprecated("chunk_size is not used in this version of chardet and will be ignored");
  }
}

// Python rejects bool via isinstance(x, bool) before isinstance(x, int) (bool
// is a subclass of int). TS has no bool/int ambiguity; we just require a
// positive integer.
export function _validateMaxBytes(maxBytes: number): void {
  if (typeof maxBytes !== "number" || !Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new Error("max_bytes must be a positive integer");
  }
}

export function _resolvePreferSuperset(
  shouldRenameLegacy: boolean,
  preferSuperset: boolean,
): boolean {
  if (shouldRenameLegacy) {
    // The notice is debug-gated; the remap itself is unconditional.
    warnDeprecated("should_rename_legacy is deprecated, use prefer_superset instead");
    return true;
  }
  return preferSuperset;
}

// Replaces Python bytes.find(needle, start, end) — Uint8Array has no multi-byte
// subsequence search. When end is given the match must lie fully within
// [start, end), matching bytes.find's end argument (used by the evidence-cap
// bound on where an escape region may close).
export function findBytes(haystack: Uint8Array, needle: Uint8Array, start = 0, end?: number): number {
  const hi = end === undefined ? haystack.length : Math.min(haystack.length, end);
  outer: for (let i = start; i <= hi - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

// Replaces Python bytes.startswith(prefix) — Uint8Array has no .startsWith() method
export function startsWith(data: Uint8Array, prefix: Uint8Array): boolean {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (data[i] !== prefix[i]) return false;
  }
  return true;
}

export const MINIMUM_THRESHOLD = 0.20;

export const ISO_TO_LANGUAGE: Readonly<Record<string, string>> = Object.freeze({
  ar: "arabic",
  be: "belarusian",
  bg: "bulgarian",
  br: "breton",
  cs: "czech",
  cy: "welsh",
  da: "danish",
  de: "german",
  el: "greek",
  en: "english",
  eo: "esperanto",
  es: "spanish",
  et: "estonian",
  fa: "farsi",
  fi: "finnish",
  fr: "french",
  ga: "irish",
  gd: "gaelic",
  he: "hebrew",
  hr: "croatian",
  hu: "hungarian",
  id: "indonesian",
  is: "icelandic",
  it: "italian",
  ja: "japanese",
  kk: "kazakh",
  ko: "korean",
  lt: "lithuanian",
  lv: "latvian",
  mk: "macedonian",
  ms: "malay",
  mt: "maltese",
  nl: "dutch",
  no: "norwegian",
  pl: "polish",
  pt: "portuguese",
  ro: "romanian",
  ru: "russian",
  sk: "slovak",
  sl: "slovene",
  sr: "serbian",
  sv: "swedish",
  tg: "tajik",
  th: "thai",
  tr: "turkish",
  uk: "ukrainian",
  und: "undetermined",
  ur: "urdu",
  vi: "vietnamese",
  zh: "chinese",
});
