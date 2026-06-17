import { DetectionResult } from './pipeline/index.js';
import { lookupEncoding } from './registry.js';

// Directional superset relationships: detecting any of the supersets when the
// expected encoding is the subset counts as correct (e.g., expected=ascii,
// detected=utf-8 is correct). Reverse is not (ascii ⊄ utf-8).
export const SUPERSETS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  "ASCII":          new Set(["utf-8", "cp1252"]),
  "TIS-620":        new Set(["iso8859-11", "cp874"]),
  "ISO-8859-11":    new Set(["cp874"]),
  "GB2312":         new Set(["gb18030"]),
  "GBK":            new Set(["gb18030"]),
  "Big5":           new Set(["big5hkscs", "cp950"]),
  "Shift_JIS":      new Set(["cp932", "shift_jis_2004"]),
  "Shift-JISX0213": new Set(["shift_jis_2004"]),
  "EUC-JP":         new Set(["euc_jis_2004"]),
  "EUC-JISX0213":   new Set(["euc_jis_2004"]),
  "EUC-KR":         new Set(["cp949"]),
  "CP037":          new Set(["cp1140"]),
  "ISO-2022-JP":    new Set(["iso2022_jp_2", "iso2022_jp_2004", "iso2022_jp_ext"]),
  "ISO2022-JP-1":   new Set(["iso2022_jp_2", "iso2022_jp_ext"]),
  "ISO2022-JP-3":   new Set(["iso2022_jp_2004"]),
  "ISO-8859-1":     new Set(["cp1252"]),
  "ISO-8859-2":     new Set(["cp1250"]),
  "ISO-8859-5":     new Set(["cp1251"]),
  "ISO-8859-6":     new Set(["cp1256"]),
  "ISO-8859-7":     new Set(["cp1253"]),
  "ISO-8859-8":     new Set(["cp1255"]),
  "ISO-8859-9":     new Set(["cp1254"]),
  "ISO-8859-13":    new Set(["cp1257"]),
  "UTF-16":         new Set(["utf-16-le", "utf-16-be"]),
  "UTF-16-LE":      new Set(["utf-16"]),
  "UTF-16-BE":      new Set(["utf-16"]),
  "UTF-32":         new Set(["utf-32-le", "utf-32-be"]),
  "UTF-32-LE":      new Set(["utf-32"]),
  "UTF-32-BE":      new Set(["utf-32"]),
});

export const PREFERRED_SUPERSET: Readonly<Record<string, string>> = Object.freeze({
  "ascii":     "cp1252",
  "euc_kr":    "cp949",
  "iso8859-1": "cp1252",
  "iso8859-2": "cp1250",
  "iso8859-5": "cp1251",
  "iso8859-6": "cp1256",
  "iso8859-7": "cp1253",
  "iso8859-8": "cp1255",
  "iso8859-9": "cp1254",
  "iso8859-11": "cp874",
  "iso8859-13": "cp1257",
  "tis-620":   "cp874",
});

function _remapEncoding(result: DetectionResult, mapping: Readonly<Record<string, string>>): DetectionResult {
  if (result.encoding !== null) {
    result.encoding = mapping[result.encoding] ?? result.encoding;
  }
  return result;
}

export function applyPreferredSuperset(result: DetectionResult): DetectionResult {
  return _remapEncoding(result, PREFERRED_SUPERSET);
}

// Deprecated alias — kept for external consumers.
export const applyLegacyRename = applyPreferredSuperset;

export const _COMPAT_NAMES: Readonly<Record<string, string>> = Object.freeze({
  "big5hkscs":      "Big5",
  "cp855":          "IBM855",
  "cp866":          "IBM866",
  "cp949":          "CP949",
  "euc_jis_2004":   "EUC-JP",
  "euc_kr":         "EUC-KR",
  "gb18030":        "GB18030",
  "hz":             "HZ-GB-2312",
  "iso2022_jp_2":   "ISO-2022-JP",
  "iso2022_kr":     "ISO-2022-KR",
  "iso8859-1":      "ISO-8859-1",
  "iso8859-5":      "ISO-8859-5",
  "iso8859-7":      "ISO-8859-7",
  "iso8859-8":      "ISO-8859-8",
  "iso8859-9":      "ISO-8859-9",
  "johab":          "Johab",
  "koi8-r":         "KOI8-R",
  "mac-cyrillic":   "MacCyrillic",
  "mac-roman":      "MacRoman",
  "shift_jis_2004": "SHIFT_JIS",
  "tis-620":        "TIS-620",
  "utf-16":         "UTF-16",
  "utf-32":         "UTF-32",
  "utf-8-sig":      "UTF-8-SIG",
  "cp1250":         "Windows-1250",
  "cp1251":         "Windows-1251",
  "cp1252":         "Windows-1252",
  "cp1253":         "Windows-1253",
  "cp1254":         "Windows-1254",
  "cp1255":         "Windows-1255",
  "kz1048":         "KZ1048",
  "mac-greek":      "MacGreek",
  "mac-iceland":    "MacIceland",
  "mac-latin2":     "MacLatin2",
  "mac-turkish":    "MacTurkish",
});

export function applyCompatNames(result: DetectionResult): DetectionResult {
  return _remapEncoding(result, _COMPAT_NAMES);
}

export const BIDIRECTIONAL_GROUPS: readonly (readonly string[])[] = Object.freeze([
  Object.freeze(["iso2022_jp_2", "iso2022_jp_2004", "iso2022_jp_ext"]),
]);

export const LANGUAGE_EQUIVALENCES: readonly (readonly string[])[] = Object.freeze([
  Object.freeze(["sk", "cs"]),
  Object.freeze(["uk", "ru", "bg", "be"]),
  Object.freeze(["ms", "id"]),
  Object.freeze(["no", "da", "sv"]),
]);

function _buildGroupIndex(
  groups: readonly (readonly string[])[],
  normalize: (n: string) => string = n => n,
): Map<string, ReadonlySet<string>> {
  const result = new Map<string, ReadonlySet<string>>();
  for (const group of groups) {
    const normed = new Set(group.map(normalize));
    for (const name of group) {
      result.set(normalize(name), normed);
    }
  }
  return result;
}

const _LANGUAGE_EQUIV = _buildGroupIndex(LANGUAGE_EQUIVALENCES);

export function isLanguageEquivalent(expected: string, detected: string): boolean {
  if (expected === detected) return true;
  const group = _LANGUAGE_EQUIV.get(expected);
  return group !== undefined && group.has(detected);
}

// Pre-built normalized superset lookups. Keys and values are canonical encoding
// names. Multiple SUPERSETS keys can normalize to the same canonical, so values
// are merged when keys collide.
const _NORMALIZED_SUPERSETS = new Map<string, Set<string>>();
for (const [subset, supersets] of Object.entries(SUPERSETS)) {
  const key = lookupEncoding(subset) ?? subset;
  const normed = new Set([...supersets].map(s => lookupEncoding(s) ?? s));
  const existing = _NORMALIZED_SUPERSETS.get(key);
  if (existing) {
    for (const s of normed) existing.add(s);
  } else {
    _NORMALIZED_SUPERSETS.set(key, normed);
  }
}

const _NORMALIZED_BIDIR = _buildGroupIndex(
  BIDIRECTIONAL_GROUPS,
  n => lookupEncoding(n) ?? n,
);

export function isCorrect(expected: string | null, detected: string | null): boolean {
  if (expected === null) return detected === null;
  if (detected === null) return false;
  const normExp = lookupEncoding(expected) ?? expected.toLowerCase();
  const normDet = lookupEncoding(detected) ?? detected.toLowerCase();
  if (normExp === normDet) return true;
  const bidir = _NORMALIZED_BIDIR.get(normExp);
  if (bidir !== undefined && bidir.has(normDet)) return true;
  const sup = _NORMALIZED_SUPERSETS.get(normExp);
  return sup !== undefined && sup.has(normDet);
}

// In Python, is_equivalent_detection() lives in equivalences.py and is used
// by tests, benchmarks, and diagnostic scripts. A full implementation requires
// decoding arbitrary byte sequences with encodings that go beyond what
// WHATWG's TextDecoder supports (e.g. DOS code pages, HP-Roman8), so it
// cannot run in browser environments. The Node.js implementation lives in
// tests/utils.ts. This stub exists solely for documentation purposes — to
// signal where the function conceptually belongs and why it isn't here.
export function isEquivalentDetection(
  _data: Uint8Array,
  _expected: string | null,
  _detected: string | null,
): boolean {
  return false;
}
