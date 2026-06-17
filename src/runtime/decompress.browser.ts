// First-party zlib decoder for the browser bundle. Handles RFC 1950 (zlib
// wrapper) plus RFC 1951 BTYPE=00 (stored) and BTYPE=01 (fixed Huffman) blocks.
// Dynamic Huffman (BTYPE=10) is rejected because the build-time encoder uses
// Z_FIXED. The runtime input is exactly three model payloads compressed by
// scripts/generate-model-bins.js — correctness is the build-time round-trip
// check in that script, not runtime tests.
//
// Performance notes (measure with scripts/decompress-benchmark.js)
// ---------------------------------------------------------------
// The dominant input is models.bin: ~711 KB compressed → ~23 MB raw. The
// inner loop runs once per output literal (~23 M iterations), so per-symbol
// overhead matters. Three deliberate choices keep that loop tight:
//
// 1. 32-bit bit accumulator (`bitBuf` + `bitCount`).
//    A naive bit reader holds (byteIdx, bitIdx) and checks the byte boundary
//    every single bit. With ~7–9 bits per Huffman code that's 7–9 boundary
//    checks per literal byte. The accumulator instead pulls a whole byte at
//    a time into bitBuf when needed, then exposes "read N bits" as `bitBuf &
//    ((1<<N)-1); bitBuf >>>= N; bitCount -= N` — one shift and one mask, no
//    branch in the common path. Refills happen only when the accumulator
//    runs low (~once per 4–5 symbols).
//
// 2. Huffman lookup tables (LITLEN_TABLE / DISTANCE_TABLE).
//    The spec assigns lit/len codes between 7 and 9 bits, and distance codes
//    a fixed 5 bits. Decoding bit-by-bit means: read 7 bits, branch on
//    range, maybe read 1 more, branch again, maybe read 1 more. With a
//    pre-built table indexed by the next 9 bits of the stream, decoding
//    becomes one indexed access that returns (symbol, bitLen) — a flat
//    cost regardless of code length. Each table entry packs both fields
//    into a Uint16 (`(symbol << 4) | bitLen`).
//
//    The non-obvious wrinkle: the spec packs bits LSB-first within bytes
//    but Huffman codes are transmitted MSB-first. So when we read 9 bits
//    out of bitBuf we get the **bit-reversed** Huffman code. The table is
//    therefore indexed by the reversed code, and `buildHuffmanTable` does
//    the reversal once at module init.
//
// 3. Chunked Adler-32.
//    The naive `s1 = (s1 + b) % 65521; s2 = (s2 + s1) % 65521` does two
//    modulo ops per output byte — ~46 M modulos for models.bin. The classic
//    zlib trick: s1 and s2 stay below 32-bit signed math for at least 5552
//    accumulated bytes (the constant `NMAX` from zlib's adler32.c), so we
//    can sum 5552 bytes before reducing. Same result, ~5500× fewer modulos.
//
// Combined, these took the all-three-payloads first-call cost from ~200 ms
// to ~78 ms on the bench machine (Node 22, x64), narrowing the gap to
// node:zlib's C implementation from ~12× to ~5×. The encoder and the
// emitted bytes are unchanged — this is purely a decoder rewrite.

const LENGTH_BASE = /* @__PURE__ */ new Uint16Array([
  3, 4, 5, 6, 7, 8, 9, 10,
  11, 13, 15, 17, 19, 23, 27, 31,
  35, 43, 51, 59, 67, 83, 99, 115,
  131, 163, 195, 227, 258,
]);

const LENGTH_EXTRA = /* @__PURE__ */ new Uint8Array([
  0, 0, 0, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 2, 2, 2, 2,
  3, 3, 3, 3, 4, 4, 4, 4,
  5, 5, 5, 5, 0,
]);

const DISTANCE_BASE = /* @__PURE__ */ new Uint16Array([
  1, 2, 3, 4, 5, 7, 9, 13,
  17, 25, 33, 49, 65, 97, 129, 193,
  257, 385, 513, 769, 1025, 1537, 2049, 3073,
  4097, 6145, 8193, 12289, 16385, 24577,
]);

const DISTANCE_EXTRA = /* @__PURE__ */ new Uint8Array([
  0, 0, 0, 0, 1, 1, 2, 2,
  3, 3, 4, 4, 5, 5, 6, 6,
  7, 7, 8, 8, 9, 9, 10, 10,
  11, 11, 12, 12, 13, 13,
]);

// Bit-reverse the low `len` bits of `v`. See the table-indexing wrinkle in the
// top-of-file Performance notes — the Huffman code as transmitted (MSB-first)
// reads back from the LSB-first bit stream as its bit-reversed form, so the
// lookup table is built around the reversed codes.
function reverseBits(v: number, len: number): number {
  let r = 0;
  for (let i = 0; i < len; i++) {
    r = (r << 1) | (v & 1);
    v >>>= 1;
  }
  return r;
}

// Build a 1<<maxLen entry table where T[i] = (symbol << 4) | bitLen for every
// 9-bit window whose low `bitLen` bits match the (reversed) Huffman code for
// that symbol. Codes are assigned per RFC 1951 §3.2.2 (canonical Huffman).
function buildHuffmanTable(lengths: Uint8Array, maxLen: number): Uint16Array {
  const counts = new Uint32Array(maxLen + 1);
  for (let i = 0; i < lengths.length; i++) {
    const l = lengths[i];
    if (l > 0) counts[l]++;
  }
  const nextCode = new Uint32Array(maxLen + 2);
  let code = 0;
  for (let bits = 1; bits <= maxLen; bits++) {
    code = (code + counts[bits - 1]) << 1;
    nextCode[bits] = code;
  }
  const tableSize = 1 << maxLen;
  const table = new Uint16Array(tableSize);
  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym];
    if (len === 0) continue;
    const c = nextCode[len]++;
    const reversed = reverseBits(c, len);
    const entry = (sym << 4) | len;
    const step = 1 << len;
    for (let slot = reversed; slot < tableSize; slot += step) {
      table[slot] = entry;
    }
  }
  return table;
}

const LITLEN_TABLE = /* @__PURE__ */ (() => {
  const lengths = new Uint8Array(288);
  for (let i = 0; i <= 143; i++) lengths[i] = 8;
  for (let i = 144; i <= 255; i++) lengths[i] = 9;
  for (let i = 256; i <= 279; i++) lengths[i] = 7;
  for (let i = 280; i <= 287; i++) lengths[i] = 8;
  return buildHuffmanTable(lengths, 9);
})();

const DISTANCE_TABLE = /* @__PURE__ */ (() => {
  const lengths = new Uint8Array(30);
  for (let i = 0; i < 30; i++) lengths[i] = 5;
  return buildHuffmanTable(lengths, 5);
})();

export function decompress(bytes: Uint8Array): Uint8Array {
  const inLen = bytes.length;
  if (inLen < 6) throw new Error('zlib: input too short');

  // RFC 1950 zlib wrapper: 2-byte CMF + FLG.
  const cmf = bytes[0];
  const flg = bytes[1];
  if ((cmf & 0x0f) !== 8) {
    throw new Error(`zlib: unsupported compression method ${cmf & 0x0f}`);
  }
  if (((cmf << 8) | flg) % 31 !== 0) {
    throw new Error('zlib: invalid header checksum');
  }
  if (flg & 0x20) {
    throw new Error('zlib: preset dictionary not supported');
  }

  // Bit accumulator. bitCount tracks valid bits in bitBuf (LSB-aligned).
  // The byte at byteIdx is the next byte to feed into bitBuf when refilling.
  let byteIdx = 2;
  let bitBuf = 0;
  let bitCount = 0;

  // Generously over-allocate so the typical model payload (compressed → ~30×)
  // never reallocates. Trimmed via subarray() at return.
  let out = new Uint8Array(Math.max(64, inLen * 40));
  let outLen = 0;

  let bfinal = 0;
  while (bfinal === 0) {
    // Read 1+2 bits for BFINAL + BTYPE.
    if (bitCount < 3) {
      if (byteIdx >= inLen) throw new Error('zlib: unexpected EOF');
      bitBuf |= bytes[byteIdx++] << bitCount;
      bitCount += 8;
    }
    bfinal = bitBuf & 1;
    const btype = (bitBuf >>> 1) & 3;
    bitBuf >>>= 3;
    bitCount -= 3;

    if (btype === 0) {
      // Stored block. Discard any leftover bits in current byte; align to
      // byte boundary by dropping bitCount % 8 bits (which always leaves
      // bitCount as a whole number of bytes worth).
      const drop = bitCount & 7;
      bitBuf >>>= drop;
      bitCount -= drop;
      // Now consume LEN/NLEN: 4 bytes total, possibly partly in bitBuf.
      const readByteAligned = (): number => {
        if (bitCount >= 8) {
          const b = bitBuf & 0xff;
          bitBuf >>>= 8;
          bitCount -= 8;
          return b;
        }
        if (byteIdx >= inLen) throw new Error('zlib: unexpected EOF');
        return bytes[byteIdx++];
      };
      const blen = readByteAligned() | (readByteAligned() << 8);
      const nlen = readByteAligned() | (readByteAligned() << 8);
      if ((blen ^ 0xffff) !== nlen) {
        throw new Error('zlib: stored block LEN/NLEN mismatch');
      }
      if (outLen + blen > out.length) {
        let cap = out.length;
        while (cap < outLen + blen) cap *= 2;
        const next = new Uint8Array(cap);
        next.set(out.subarray(0, outLen));
        out = next;
      }
      for (let i = 0; i < blen; i++) {
        out[outLen++] = readByteAligned();
      }
    } else if (btype === 1) {
      // Fixed Huffman block. Hot loop — keep allocations and function calls
      // out of the body. Refill bitBuf to ≥15 bits opportunistically (worst
      // case is 9-bit lit/len + 5-bit distance + extra bits up to 13 +
      // 13 = 40 — so we refill in two stages for length and distance).
      while (true) {
        // Need at least 9 bits for a lit/len lookup.
        while (bitCount < 9 && byteIdx < inLen) {
          bitBuf |= bytes[byteIdx++] << bitCount;
          bitCount += 8;
        }
        if (bitCount < 9) {
          // End-of-stream guard. Should not happen on well-formed input;
          // fall through to lookup which will catch it via length=0.
        }
        const llEntry = LITLEN_TABLE[bitBuf & 0x1ff];
        const llLen = llEntry & 0xf;
        const sym = llEntry >>> 4;
        if (llLen === 0) {
          throw new Error('zlib: invalid lit/len Huffman code');
        }
        bitBuf >>>= llLen;
        bitCount -= llLen;

        if (sym < 256) {
          if (outLen >= out.length) {
            const next = new Uint8Array(out.length * 2);
            next.set(out.subarray(0, outLen));
            out = next;
          }
          out[outLen++] = sym;
        } else if (sym === 256) {
          break;
        } else {
          // Length symbol. Read length-extra-bits then distance code + extras.
          const lenIdx = sym - 257;
          if (lenIdx >= 29) {
            throw new Error(`zlib: invalid length symbol ${sym}`);
          }
          const lExtra = LENGTH_EXTRA[lenIdx];
          if (lExtra > 0) {
            while (bitCount < lExtra) {
              if (byteIdx >= inLen) throw new Error('zlib: unexpected EOF');
              bitBuf |= bytes[byteIdx++] << bitCount;
              bitCount += 8;
            }
          }
          const length = LENGTH_BASE[lenIdx] + (bitBuf & ((1 << lExtra) - 1));
          bitBuf >>>= lExtra;
          bitCount -= lExtra;

          // Need at least 5 bits for distance code.
          while (bitCount < 5 && byteIdx < inLen) {
            bitBuf |= bytes[byteIdx++] << bitCount;
            bitCount += 8;
          }
          const dEntry = DISTANCE_TABLE[bitBuf & 0x1f];
          const dLen = dEntry & 0xf;
          const dSym = dEntry >>> 4;
          if (dLen === 0 || dSym >= 30) {
            throw new Error(`zlib: invalid distance code`);
          }
          bitBuf >>>= dLen;
          bitCount -= dLen;
          const dExtra = DISTANCE_EXTRA[dSym];
          if (dExtra > 0) {
            while (bitCount < dExtra) {
              if (byteIdx >= inLen) throw new Error('zlib: unexpected EOF');
              bitBuf |= bytes[byteIdx++] << bitCount;
              bitCount += 8;
            }
          }
          const distance = DISTANCE_BASE[dSym] + (bitBuf & ((1 << dExtra) - 1));
          bitBuf >>>= dExtra;
          bitCount -= dExtra;

          if (distance > outLen) {
            throw new Error('zlib: back-ref distance exceeds output');
          }
          if (outLen + length > out.length) {
            let cap = out.length;
            while (cap < outLen + length) cap *= 2;
            const next = new Uint8Array(cap);
            next.set(out.subarray(0, outLen));
            out = next;
          }
          // Byte-by-byte handles overlap (length > distance, RLE-style).
          const srcStart = outLen - distance;
          for (let i = 0; i < length; i++) {
            out[outLen + i] = out[srcStart + i];
          }
          outLen += length;
        }
      }
    } else if (btype === 2) {
      throw new Error('zlib: dynamic Huffman blocks not supported (Z_FIXED only)');
    } else {
      throw new Error('zlib: reserved block type 3');
    }
  }

  // Adler-32 trailer (RFC 1950): 4 bytes big-endian, after byte-aligning.
  // Drain bitBuf to a byte boundary, then read 4 bytes.
  const drop = bitCount & 7;
  bitBuf >>>= drop;
  bitCount -= drop;
  const readByteAligned = (): number => {
    if (bitCount >= 8) {
      const b = bitBuf & 0xff;
      bitBuf >>>= 8;
      bitCount -= 8;
      return b;
    }
    if (byteIdx >= inLen) throw new Error('zlib: unexpected EOF');
    return bytes[byteIdx++];
  };
  const adlerExpected = (
    (readByteAligned() * 0x1000000) +
    (readByteAligned() << 16) +
    (readByteAligned() << 8) +
    readByteAligned()
  ) >>> 0;

  // Adler-32 with the classic chunked-modulo optimisation: s1/s2 fit in 32-bit
  // signed math for at least 5552 bytes between mod-65521 reductions.
  let s1 = 1, s2 = 0;
  let i = 0;
  while (i < outLen) {
    const end = i + 5552 < outLen ? i + 5552 : outLen;
    while (i < end) {
      s1 += out[i++];
      s2 += s1;
    }
    s1 %= 65521;
    s2 %= 65521;
  }
  const adlerActual = ((s2 * 0x10000) + s1) >>> 0;
  if (adlerActual !== adlerExpected) {
    throw new Error('zlib: Adler-32 checksum mismatch');
  }

  return out.subarray(0, outLen);
}
