// The port's single-byte "codecs + unicodedata" layer: one lookup API over
// the build-time tables in _byte-decode-tables.ts, answering "what does this
// byte decode to under this encoding, as CPython would?" and "what is that
// character's Unicode general category, at CPython's UCD version?" for every
// encoding in the registry. The runtime cannot answer either faithfully:
// TextDecoder has no decoder at all for several of these encodings (the
// EBCDIC pages, hp-roman8, koi8-t), its WHATWG single-byte decoders gap-fill
// positions CPython's strict codecs leave undefined, and the JS engine's
// Unicode database drifts from CPython's. docs/textdecoder-vs-python.md maps
// the gaps; this module is the bridge for the single-byte, build-time-known
// corner of them.
//
// Three consumers: src/decode.ts (a single-byte encoding decodes iff it has
// no undefined byte), markup.ts (decoding an EBCDIC head as cp037), and
// confusion.ts (differingHighBytes, _pairCategories, _letterCaseTable).

import { lookupEncoding } from '../registry.js';
import {
  BYTE_DECODE_TABLES,
  ByteDecodeTable,
  CATEGORY_NAMES,
  CAT_BASE,
} from './_byte-decode-tables.js';

export type { ByteDecodeTable };
export { CATEGORY_NAMES };

// Sentinel code points in a table's cps: a byte that raised on decode, and a
// byte that decoded to zero or several characters (a stateful codec's shift
// byte). Distinct so both compare by value in differingHighBytes (undecodable
// != empty, matching Python's None != "").
export const UNDECODABLE_CP = 0xFFFF;
export const NON_SINGLE_CP = 0xFFFE;

const _tables = new Map(Object.entries(BYTE_DECODE_TABLES));

// The table for an encoding: by exact codec name first (cp037 has a table of
// its own even though the registry files it under cp1140), then by the
// registry's alias resolution — chardet resolves names through the codec
// registry, which lookupEncoding mirrors. null for a name outside both.
export function byteDecodeTable(encoding: string): ByteDecodeTable | null {
  const exact = _tables.get(encoding);
  if (exact !== undefined) return exact;
  const canonical = lookupEncoding(encoding);
  return canonical === null ? null : (_tables.get(canonical) ?? null);
}

// bytes([b]).decode(encoding): the code point, or a sentinel above.
export function decodedCodePoint(table: ByteDecodeTable, b: number): number {
  return table.cps.charCodeAt(b);
}

// unicodedata.category() of the decoded character, as its index into
// CATEGORY_NAMES; Cn for a byte that does not decode to one character.
export function categoryIndex(table: ByteDecodeTable, b: number): number {
  return table.cats.charCodeAt(b) - CAT_BASE;
}

export function category(table: ByteDecodeTable, b: number): string {
  return CATEGORY_NAMES[categoryIndex(table, b)] ?? 'Cn';
}

// Per single-byte table, a 256-entry mask of the bytes Python's strict codec
// rejects, or null when there are none (every byte decodes), so the common
// case costs no scan at all.
const _undefinedMasks = new Map<ByteDecodeTable, Uint8Array | null>();

function _undefinedByteMask(table: ByteDecodeTable): Uint8Array | null {
  let mask = _undefinedMasks.get(table);
  if (mask !== undefined) return mask;
  mask = null;
  for (let b = 0; b < 256; b++) {
    if (decodedCodePoint(table, b) === UNDECODABLE_CP) {
      mask ??= new Uint8Array(256);
      mask[b] = 1;
    }
  }
  _undefinedMasks.set(table, mask);
  return mask;
}

// chardet's decodes_without_error and decodes_completely for a single-byte
// encoding, which coincide there: a stateless codec decodes data iff no
// undefined byte appears — every defined byte maps to one character, and
// there is no multi-byte tail to defer or to truncate. null when the
// encoding is not a single-byte codec (multi-byte, the UTF family, or a name
// outside the registry), which the caller must answer another way.
export function decodesAsSingleByte(encoding: string, data: Uint8Array): boolean | null {
  const table = byteDecodeTable(encoding);
  if (table === null || !table.singleByte) return null;
  const mask = _undefinedByteMask(table);
  if (mask === null) return true;
  for (let i = 0; i < data.length; i++) {
    if (mask[data[i]] !== 0) return false;
  }
  return true;
}

// data.decode(encoding, errors="replace") for a single-byte table: each byte
// becomes its decoded character, an undefined byte U+FFFD.
export function decodeSingleByteText(table: ByteDecodeTable, data: Uint8Array): string {
  let out = '';
  for (let i = 0; i < data.length; i++) {
    const ch = table.cps[data[i]];
    out += ch === '\uFFFF' ? '\uFFFD' : ch;
  }
  return out;
}
