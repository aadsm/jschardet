// The single-byte "codecs + unicodedata" lookup API over the build-time byte
// tables (src/pipeline/byte-decode.ts). The tables are Python's answers,
// extracted at pin time; these tests pin the contract the three consumers
// (validity, markup, confusion) rely on. Expected values are Python's:
//   bytes([b]).decode(enc) / unicodedata.category(...)

import { REGISTRY } from '../src/registry.js';
import {
  NON_SINGLE_CP,
  UNDECODABLE_CP,
  byteDecodeTable,
  category,
  decodeSingleByteText,
  decodedCodePoint,
  decodesAsSingleByte,
} from '../src/pipeline/byte-decode.js';

function bytes(s: string): Uint8Array {
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

describe('byteDecodeTable', () => {
  test('every registry encoding has a table, keyed by its registry name', () => {
    for (const enc of Object.values(REGISTRY)) {
      expect(byteDecodeTable(enc.name), enc.name).not.toBeNull();
    }
  });

  test('resolves a registry alias to its primary', () => {
    expect(byteDecodeTable('windows-1252')).toBe(byteDecodeTable('cp1252'));
    expect(byteDecodeTable('latin-1')).toBe(byteDecodeTable('iso8859-1'));
  });

  test('an exact codec name wins over alias resolution: cp037 is not cp1140', () => {
    // The registry files cp037 as an alias of cp1140; the two codecs differ
    // at 0x9F (currency sign vs euro sign), and markup.ts decodes with cp037.
    const cp037 = byteDecodeTable('cp037')!;
    const cp1140 = byteDecodeTable('cp1140')!;
    expect(cp037).not.toBe(cp1140);
    expect(decodedCodePoint(cp037, 0x9f)).toBe(0xa4);
    expect(decodedCodePoint(cp1140, 0x9f)).toBe(0x20ac);
    for (let b = 0; b < 256; b++) {
      if (b !== 0x9f) expect(decodedCodePoint(cp037, b)).toBe(decodedCodePoint(cp1140, b));
    }
  });

  test('unknown names have no table', () => {
    expect(byteDecodeTable('no-such-codec')).toBeNull();
  });
});

describe('decodedCodePoint and category', () => {
  test('cover all 256 bytes, low half included', () => {
    const cp500 = byteDecodeTable('cp500')!;
    // EBCDIC puts letters in the high half and control characters low.
    expect(decodedCodePoint(cp500, 0x81)).toBe('a'.charCodeAt(0));
    expect(category(cp500, 0x81)).toBe('Ll');
    expect(decodedCodePoint(cp500, 0x40)).toBe(' '.charCodeAt(0));
    expect(category(cp500, 0x40)).toBe('Zs');
    expect(category(cp500, 0x00)).toBe('Cc');
  });

  test('an undefined byte is the 0xFFFF sentinel and reads as Cn', () => {
    const cp1252 = byteDecodeTable('cp1252')!;
    expect(decodedCodePoint(cp1252, 0x81)).toBe(UNDECODABLE_CP);
    expect(category(cp1252, 0x81)).toBe('Cn');
    expect(decodedCodePoint(cp1252, 0x80)).toBe(0x20ac);
    expect(category(cp1252, 0x80)).toBe('Sc');
  });

  test("a stateful codec's shift byte is the 0xFFFE sentinel", () => {
    // utf-7's '+' opens a base64 run and decodes to no character.
    expect(decodedCodePoint(byteDecodeTable('utf-7')!, 0x2b)).toBe(NON_SINGLE_CP);
    expect(category(byteDecodeTable('utf-7')!, 0x2b)).toBe('Cn');
  });
});

describe('decodesAsSingleByte', () => {
  test('is null for anything but a single-byte codec', () => {
    for (const name of ['utf-8', 'utf-16', 'utf-7', 'shift_jis_2004', 'gb18030', 'iso2022_jp_2', 'no-such-codec']) {
      expect(decodesAsSingleByte(name, bytes('abc')), name).toBeNull();
    }
  });

  test('flags exactly the registry single-byte codecs, UTF family excluded', () => {
    for (const enc of Object.values(REGISTRY)) {
      const expected = !enc.isMultibyte && !enc.name.startsWith('utf-') ? true : null;
      expect(decodesAsSingleByte(enc.name, new Uint8Array(0)), enc.name).toBe(expected);
    }
  });

  test('rejects an undefined byte and accepts everything else', () => {
    expect(decodesAsSingleByte('cp1252', bytes('caf\xe9'))).toBe(true);
    expect(decodesAsSingleByte('cp1252', bytes('caf\x81'))).toBe(false);
    expect(decodesAsSingleByte('cp1252', bytes('caf\x8d'))).toBe(false);
    // hp-roman8 has no WHATWG decoder; its one gap is 0xFF.
    expect(decodesAsSingleByte('hp-roman8', bytes('\x80\xfe'))).toBe(true);
    expect(decodesAsSingleByte('hp-roman8', bytes('\x80\xff'))).toBe(false);
  });

  test('sees undefined positions below 0x80: cp424', () => {
    // Python's cp424 leaves 0x70, 0x72, 0x73, 0x75, 0x76 and 0x77 undefined.
    for (const b of [0x70, 0x72, 0x73, 0x75, 0x76, 0x77]) {
      expect(decodesAsSingleByte('cp424', new Uint8Array([0x40, b])), b.toString(16)).toBe(false);
    }
    expect(decodesAsSingleByte('cp424', new Uint8Array([0x40, 0x71, 0x74]))).toBe(true);
  });

  test('ascii is a single-byte codec with the high half undefined', () => {
    expect(decodesAsSingleByte('ascii', bytes('plain'))).toBe(true);
    expect(decodesAsSingleByte('ascii', bytes('caf\xe9'))).toBe(false);
  });

  test('a gap-free codec accepts every byte', () => {
    const all = new Uint8Array(256);
    for (let b = 0; b < 256; b++) all[b] = b;
    for (const name of ['iso8859-1', 'cp437', 'cp500', 'koi8-r', 'mac-roman']) {
      expect(decodesAsSingleByte(name, all), name).toBe(true);
    }
  });
});

describe('decodeSingleByteText', () => {
  test('is bytes.decode(enc, errors="replace")', () => {
    // "<meta charset=cp500>".encode("cp037")
    const head = new Uint8Array([
      0x4c, 0x94, 0x85, 0xa3, 0x81, 0x40, 0x83, 0x88, 0x81, 0x99, 0xa2, 0x85,
      0xa3, 0x7e, 0x83, 0x97, 0xf5, 0xf0, 0xf0, 0x6e,
    ]);
    expect(decodeSingleByteText(byteDecodeTable('cp037')!, head)).toBe('<meta charset=cp500>');
    expect(decodeSingleByteText(byteDecodeTable('cp1252')!, bytes('a\x81b'))).toBe('a�b');
    expect(decodeSingleByteText(byteDecodeTable('cp1252')!, new Uint8Array(0))).toBe('');
  });
});
