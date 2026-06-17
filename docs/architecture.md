# Architecture

This is a TypeScript port of Python [chardet](https://github.com/chardet/chardet). It targets both Node.js and browsers with zero runtime dependencies and a synchronous API.

The Python source lives in [`chardet/`](../chardet/), a git submodule that is the source of truth for all ported logic, tests, and model data.

## Repository Layout

- [`src/`](../src/) — TypeScript source
- [`chardet/`](../chardet/) — Python submodule (source of truth for logic, tests, model data)
- [`scripts/`](../scripts/) — build-time code generators and diagnostic helpers
- [`tests/`](../tests/) — Vitest test suite
- [`dist/`](../dist/) — esbuild browser bundles; browser consumers import from here
- `build/` — `tsc` output; gitignored; Node.js entry point is `build/index.js`

## chardet 7.x

The [`chardet/`](../chardet/) submodule is pinned to a specific upstream release. To move to a new version:

    node scripts/update-chardet.js <tag>

To list available versions: `node scripts/update-chardet.js --list`. The update script regenerates all necessary derived files automatically after pinning.

## Python → TypeScript File Map

Directories, filenames and casing are preserved from Python where possible, with a few caveats:

- `**/__init__.py` files → `**/index.ts` in the same directory.
- [`chardet/__init__.py`](https://github.com/chardet/chardet/blob/main/src/chardet/__init__.py) → **two** TS files: [`src/chardet.ts`](../src/chardet.ts) (internal API, faithful port) and [`src/index.ts`](../src/index.ts) (public jschardet-compatible API)
- Everything else maps 1:1 by name: [`detector.py`](https://github.com/chardet/chardet/blob/main/src/chardet/detector.py) → [`detector.ts`](../src/detector.ts), etc.

## Python → TypeScript Adaptations

### a. Model data

Files [`models.bin`](../src/models/models.bin.js), [`idf.bin`](../src/models/idf.bin.js), and [`confusion.bin`](../src/models/confusion.bin.js) are pre-trained binary payloads: bigram frequency tables per language/encoding, IDF weights for scoring input bigram profiles, and distinguishing-byte maps for resolving ties between similar single-byte encodings, respectively.

Python loads `.bin` files from disk. TypeScript ships them as zlib-compressed base64 JS modules ([`src/models/models.bin.js`](../src/models/models.bin.js), [`idf.bin.js`](../src/models/idf.bin.js), [`confusion.bin.js`](../src/models/confusion.bin.js)) generated at build time by [`scripts/generate-model-bins.js`](../scripts/generate-model-bins.js). Models are lazy-loaded and decompressed on the first `detect()` call via [`src/runtime/decompress.js`](../src/runtime/decompress.js) (Node) or [`src/runtime/decompress.browser.ts`](../src/runtime/decompress.browser.ts) (browser). Pass `--raw` to `generate-model-bins.js` to generate uncompressed wrappers for local debugging (do not commit). See [`docs/model-compression.md`](model-compression.md).

### b. IntFlag enums

Classes `EncodingEra` and `LanguageFilter` are defined as [`IntFlag`](https://docs.python.org/3/library/enum.html#enum.IntFlag) enums in [`chardet/src/chardet/enums.py`](https://github.com/chardet/chardet/blob/main/src/chardet/enums.py). Python's `IntFlag` gives each member a power-of-two value and lets them be combined with `|` into composite flags.

TypeScript has no built-in equivalent, so each enum becomes an `as const` object (preserving literal types) paired with a value union derived from it:

```ts
export const EncodingEra = { MODERN_WEB: 1, LEGACY_ISO: 2, … } as const;
```

Bitwise `|` and `&` on the values work identically at runtime since the members are plain numbers.

### c. codecs.lookup() alias normalization

chardet calls [`codecs.lookup()`](https://docs.python.org/3/library/codecs.html#codecs.lookup) in [`registry.py`](https://github.com/chardet/chardet/blob/main/src/chardet/registry.py) as a fallback to resolve encoding aliases to canonical names when a name is not found in chardet's own registry.

Python's `codecs` module normalizes 500+ aliases to canonical names at runtime. TypeScript uses two statically generated maps for the same purpose in [`src/codecs-lookup.ts`](../src/codecs-lookup.ts):

- [`src/encoding-alias-map.ts`](../src/encoding-alias-map.ts) (from Python's codec registry, via [`scripts/generate-encodings-alias-map.js`](../scripts/generate-encodings-alias-map.js)) and,
- [`src/encoding-whatwg-map.ts`](../src/encoding-whatwg-map.ts) (WHATWG→chardet name mapping, via [`scripts/generate-encodings-whatwg-map.js`](../scripts/generate-encodings-whatwg-map.js)).

Both are regenerated automatically by [`scripts/update-chardet.js`](../scripts/update-chardet.js).

### d. bytes.decode() validity filtering

chardet calls [`bytes.decode(encoding, errors='strict')`](https://docs.python.org/3/library/stdtypes.html#bytes.decode) in [`pipeline/validity.py`](https://github.com/chardet/chardet/blob/main/src/chardet/pipeline/validity.py) to eliminate candidate encodings that cannot decode the input without raising `UnicodeDecodeError`.

TypeScript uses [`TextDecoder`](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder) with `{ fatal: true }` (in [`src/text-decoder.ts`](../src/text-decoder.ts)) for WHATWG-supported encodings, which throws on genuinely invalid sequences.

However, some SBCS encodings (windows-125x and others) leave certain byte positions undefined — Python treats those bytes as errors, but WHATWG `TextDecoder` silently accepts them because the WHATWG spec fills those gaps. [`src/sbcs-undefined-bytes.ts`](../src/sbcs-undefined-bytes.ts) records the undefined byte values for each affected encoding; the validity stage rejects any candidate whose undefined bytes appear in the input, matching Python's stricter behaviour.

### e. unicodedata module

chardet uses [`unicodedata`](https://docs.python.org/3/library/unicodedata.html) in two places:

- [`equivalences.py`](https://github.com/chardet/chardet/blob/main/src/chardet/equivalences.py) uses [`normalize("NFKD")`](https://docs.python.org/3/library/unicodedata.html#unicodedata.normalize) and [`combining()`](https://docs.python.org/3/library/unicodedata.html#unicodedata.combining) to strip diacritic marks so that accented and unaccented forms of the same letter compare as equal when checking detection accuracy. TypeScript equivalent: [`str.normalize("NFKD")`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize)`.replace(/\p{M}/gu, "")`.
- [`pipeline/utf1632.py`](https://github.com/chardet/chardet/blob/main/src/chardet/pipeline/utf1632.py) uses [`category()`](https://docs.python.org/3/library/unicodedata.html#unicodedata.category) to classify characters as letters, marks, spaces, or controls for UTF-16/32 text-quality scoring. TypeScript equivalent: [Unicode property escapes](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Unicode_character_class_escape) (`\p{L}`, `\p{M}`, `\p{Zs}`, `\p{C}`) in [`src/pipeline/utf1632.ts`](../src/pipeline/utf1632.ts).

### f. struct.unpack

chardet uses [`struct.unpack`](https://docs.python.org/3/library/struct.html#struct.unpack) in [`models/__init__.py`](https://github.com/chardet/chardet/blob/main/src/chardet/models/__init__.py) and [`pipeline/confusion.py`](https://github.com/chardet/chardet/blob/main/src/chardet/pipeline/confusion.py) to deserialize the packed binary records in the `.bin` files. `struct.unpack` reads binary fields from the `.bin` file headers using format strings (`">I"` for big-endian uint32, `">d"` for float64, `"!H"` for uint16, `"!B"` for uint8). [`DataView`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView) provides the same capability — `getUint32(offset, false)`, `getFloat64(offset, false)`, `getUint16(offset, false)`, `getUint8(offset)` — where `false` selects big-endian byte order, matching Python's `>` / `!` prefix.

### g. Dataclasses → interfaces

Python's [`@dataclass`](https://docs.python.org/3/library/dataclasses.html#dataclasses.dataclass) class decorator auto-generates `__init__`, `__repr__`, and comparison methods from a class's typed field declarations (e.g. `encoding: str | None`, `confidence: float`). The TypeScript translation depends on mutability:

- [`DetectionResult`](../src/pipeline/index.ts) and [`EncodingInfo`](../src/registry.ts) are declared `frozen=True` — immutable data bags with no behaviour — so they become TypeScript `interface`s; callers construct them as plain object literals.
- [`PipelineContext`](../src/pipeline/index.ts) is mutable per-run state with default field values, so it becomes a TypeScript `class` to support field initializers.

## The Two-Layer API

**Internal chardet API** ([`src/chardet.ts`](../src/chardet.ts), [`src/detector.ts`](../src/detector.ts)) is a faithful port of Python's public surface: `detect()`, `detect_all()`, and `UniversalDetector` with `feed()` / `close()` for streaming. Takes `Uint8Array` only; supports `encodingEra`, `preferSuperset`, `compatNames`, and other options.

**Public jschardet API** ([`src/index.ts`](../src/index.ts)) is the user-facing wrapper. It accepts `string | Uint8Array` and returns the `IDetectedMap` shape that is compatible with prior jschardet versions.

## Distribution Bundles

Two build steps:

- `npm run build` — TypeScript compilation → `build/` (ESM, Node-native)
- `npm run build:bundles` — esbuild → [`dist/`](../dist/) (browser-compatible bundles)

Current bundle outputs (each has a `*.js`, `*.min.js`, and `.map` source maps):

- [`dist/jschardet.esm.js`](../dist/jschardet.esm.js) — ESM, public jschardet API
- [`dist/jschardet.js`](../dist/jschardet.js) — IIFE, attaches `jschardet` to `window`
- `dist/chardet.esm.js` — ESM, lower-level internal chardet API

## Testing

See [`docs/testing.md`](testing.md).
