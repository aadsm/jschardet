// Port of chardet/src/chardet/evaluation.py — test-time accuracy predicates:
// which detections count as correct or equivalent when scoring against a
// labeled corpus. Runtime name remapping lives in src/output_names.ts.

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

// In Python, is_equivalent_detection() lives in evaluation.py and is used
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
