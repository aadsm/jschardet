export const DEFAULT_MAX_BYTES = 200_000;

export const _DEFAULT_CHUNK_SIZE = 65_536;

// Python emits DeprecationWarning; JS uses console.warn with a "DEPRECATION:"
// prefix so tests can filter via regex.
export function _warnDeprecatedChunkSize(chunkSize: number): void {
  if (chunkSize !== _DEFAULT_CHUNK_SIZE) {
    console.warn("DEPRECATION: chunk_size is not used in this version of chardet and will be ignored");
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
    console.warn("DEPRECATION: should_rename_legacy is deprecated, use prefer_superset instead");
    return true;
  }
  return preferSuperset;
}

// Replaces Python bytes.find(needle, start) — Uint8Array has no multi-byte subsequence search
export function findBytes(haystack: Uint8Array, needle: Uint8Array, start = 0): number {
  outer: for (let i = start; i <= haystack.length - needle.length; i++) {
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
