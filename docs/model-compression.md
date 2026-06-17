# Model Data and Compression

## From Python .bin to JS Modules

Python chardet loads three binary model files from disk at runtime: `models.bin` (~585 KB on disk), `idf.bin` (~64 KB), and `confusion.bin` (~8 KB). TypeScript cannot load files at runtime in a browser context, so instead these are shipped as JS modules that embed the data as a compressed base64 string.

[`scripts/generate-model-bins.js`](../scripts/generate-model-bins.js) reads each `.bin` file from the [`chardet/`](../chardet/) submodule, re-compresses it with `zlib.compressobj(level=9, strategy=Z_FIXED)`, base64-encodes the result, and writes it to [`src/models/models.bin.js`](../src/models/models.bin.js), [`src/models/idf.bin.js`](../src/models/idf.bin.js), and [`src/models/confusion.bin.js`](../src/models/confusion.bin.js). The script verifies the output by round-tripping through both the Node and browser decoders before writing. It is called automatically by [`scripts/update-chardet.js`](../scripts/update-chardet.js) when the chardet pin changes.

At runtime, each module exports a lazy loader: the first call to `readBytes()` decompresses the base64 payload and caches the result. Subsequent calls return the cached `Uint8Array` without re-decompressing.

The `--raw` flag produces uncompressed wrappers (passthrough base64, no decompression import) for local debugging — do not commit these.

## Two Decompression Paths

The compressed payloads are standard zlib streams (RFC 1950 wrapper around an
RFC 1951 DEFLATE block). There are two decompression implementations:

**Node.js** ([`src/runtime/decompress.js`](../src/runtime/decompress.js)): delegates to `zlib.inflateSync()` from the `node:zlib` standard library.

**Browser** ([`src/runtime/decompress.browser.ts`](../src/runtime/decompress.browser.ts)): a purpose-built ~300-line DEFLATE decoder that handles the RFC 1950 wrapper plus BTYPE=00 (stored) and BTYPE=01 (fixed Huffman) blocks. Dynamic Huffman blocks (BTYPE=10) are rejected because the encoder always uses `Z_FIXED`.

The `swap-decompress` esbuild plugin in [`scripts/build-bundles.js`](../scripts/build-bundles.js) replaces the Node path with the browser path when building the [`dist/`](../dist/) bundles.

## Why Z_FIXED

Using `strategy=Z_FIXED` forces the encoder to emit only fixed Huffman blocks. This means the browser decoder can skip dynamic Huffman table parsing entirely, keeping it to ~300 lines. A general-purpose zlib decoder that also handles dynamic Huffman tables would be several times larger.

## Browser Decoder Performance

The dominant payload is `models.bin`: ~711 KB compressed → ~23 MB raw. The inner decode loop runs once per output byte (~23 M iterations), so the implementation uses several optimisations to keep per-symbol overhead low:

- **32-bit bit accumulator** — pulls a whole byte into `bitBuf` when needed rather than checking the byte boundary on every bit
- **Huffman lookup tables** — a pre-built 512-entry table indexed by the next 9 bits of the stream decodes a lit/len symbol in one indexed access regardless of code length
- **Chunked Adler-32** — accumulates up to 5552 bytes between modulo reductions, cutting ~46 M modulo operations down to ~4 K

Run [`scripts/decompress-benchmark.js`](../scripts/decompress-benchmark.js) to measure the first-call decompression cost of each payload under both runtime paths, and to spot regressions when the encoder strategy or the browser decoder changes.
