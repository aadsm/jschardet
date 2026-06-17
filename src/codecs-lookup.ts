import { ENCODING_ALIAS_MAP } from './encoding-alias-map.js';

// Mimic Python's normalize_encoding(): lowercase, then squish runs of
// non-alphanumeric, non-dot characters to a single underscore, stripping any
// at the start or end. Dots are preserved literally (Python treats `.` as
// alnum-equivalent in this normalisation -- e.g. ANSI_X3.4-1986 normalises to
// ansi_x3.4_1986, not ansi_x3_4_1986).
function _normalizeCodecName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, '_').replace(/^_|_$/g, '');
}

// Replacement for Python's codecs.lookup(name).name — resolves any encoding
// name or alias to its canonical Python codec name using ENCODING_ALIAS_MAP,
// which is pre-built to cover both Python's static alias dict
// (encodings.aliases) and its codec module import fallback.
export function codecsLookup(name: string): string | null {
  if (name.includes('\x00')) return null;
  const normalized = _normalizeCodecName(name);
  return ENCODING_ALIAS_MAP[normalized] ?? null;
}
