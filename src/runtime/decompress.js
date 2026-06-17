// Node decompress path. The browser bundle swaps this for a first-party
// fixed-Huffman decoder via the swap-decompress esbuild plugin in
// scripts/build-bundles.js. Both produce identical output bytes — the
// build-time round-trip check in scripts/generate-model-bins.js verifies that.
import { inflateSync } from 'node:zlib';

/**
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function decompress(bytes) {
  const buf = inflateSync(bytes);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
