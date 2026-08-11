// Port of chardet/src/chardet/output_names.py — runtime public-API name
// remapping: superset preference and 5.x/6.x-compatible display names.

import { DetectionResult } from './pipeline/index.js';

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
  "cp874":          "CP874",
  "cp932":          "CP932",
  "cp949":          "CP949",
  "euc_jis_2004":   "EUC-JP",
  "euc_kr":         "EUC-KR",
  "gb18030":        "GB18030",
  "hz":             "HZ-GB-2312",
  "iso2022_jp_2":   "ISO-2022-JP",
  "iso2022_kr":     "ISO-2022-KR",
  "iso8859-1":      "ISO-8859-1",
  "iso8859-2":      "ISO-8859-2",
  "iso8859-5":      "ISO-8859-5",
  "iso8859-6":      "ISO-8859-6",
  "iso8859-7":      "ISO-8859-7",
  "iso8859-8":      "ISO-8859-8",
  "iso8859-9":      "ISO-8859-9",
  "iso8859-13":     "ISO-8859-13",
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
  "cp1256":         "Windows-1256",
  "cp1257":         "Windows-1257",
  "kz1048":         "KZ1048",
  "mac-greek":      "MacGreek",
  "mac-iceland":    "MacIceland",
  "mac-latin2":     "MacLatin2",
  "mac-turkish":    "MacTurkish",
});

export function applyCompatNames(result: DetectionResult): DetectionResult {
  return _remapEncoding(result, _COMPAT_NAMES);
}
