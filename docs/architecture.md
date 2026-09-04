# Architecture

This is a TypeScript port of Python [chardet](https://github.com/chardet/chardet). It targets both Node.js and browsers with zero runtime dependencies and a synchronous API.

The Python source lives in [`chardet/`](../chardet/), a git submodule that is the source of truth for all ported logic, tests, and model data.

## Repository Layout

- [`src/`](../src/) — TypeScript source
- [`chardet/`](../chardet/) — Python submodule (source of truth for logic, tests, model data)
- [`scripts/`](../scripts/) — build-time code generators and diagnostic helpers
- [`tests/`](../tests/) — Vitest test suite
- [`dist/`](../dist/) — esbuild browser bundles; browser consumers import from here
- `build/` — Node-targeted output; gitignored. Entry points `build/index.js` (ESM) and `build/index.cjs` (CommonJS), each with its declaration twin alongside

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

Subsections d and e below cover the two Python facilities the port cannot use
directly — `codecs` and `unicodedata`. They are two faces of one fault line
between the browser runtime and CPython; [`textdecoder-vs-python.md`](textdecoder-vs-python.md)
is the consolidated map of that fault line and every bridge the port builds for
it (this section names the per-mechanism specifics).

### d. bytes.decode() validity filtering

chardet calls [`bytes.decode(encoding, errors='strict')`](https://docs.python.org/3/library/stdtypes.html#bytes.decode) in [`pipeline/validity.py`](https://github.com/chardet/chardet/blob/main/src/chardet/pipeline/validity.py) to eliminate candidate encodings that cannot decode the input without raising `UnicodeDecodeError`.

TypeScript answers every such question through [`src/decode.ts`](../src/decode.ts), the port of chardet's decode primitives keyed by chardet encoding name: `decodesWithoutError`, `decodesCompletely` and `danglingTailWithAsciiPrefix` (the `_utils.py` trio, same names) plus `decodeText` and `decodeStrictText` (`bytes.decode` with `errors="ignore"` and strict). Each picks the mechanism per encoding. A multi-byte encoding decodes through [`TextDecoder`](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder) with `{ fatal: true }` by its WHATWG label — the `whatwg*` helpers in [`src/text-decoder.ts`](../src/text-decoder.ts), which throw on genuinely invalid sequences and which nothing else in the pipeline calls. See "Truncation-tolerant validity decoding" in [`docs/port-notes.md`](port-notes.md) for the truncated-tail tolerance and the cached-decoder state discipline.

A single-byte encoding never reaches `TextDecoder`. Some SBCS (windows-125x and others) leave byte positions undefined — Python treats those bytes as errors, but WHATWG `TextDecoder` silently accepts them because the WHATWG spec fills those gaps — and several have no WHATWG decoder at all. So [`src/pipeline/byte-decode.ts`](../src/pipeline/byte-decode.ts) answers them from the build-time byte tables (`_byte-decode-tables.ts`, see e. below), where an undefined position carries the code-point sentinel: a candidate whose undefined bytes appear in the input is rejected, matching Python's stricter behaviour. That includes `ascii`, whose WHATWG label is an alias of windows-1252 and would otherwise accept every high byte, and the charset a page declares, which the markup stage checks through the same predicate.

Two decode sites cover encodings `TextDecoder` lacks entirely:

- **EBCDIC** — the markup stage scans a cp037 decode of the head for charset declarations; [`src/pipeline/markup.ts`](../src/pipeline/markup.ts) decodes it through the byte tables (which carry cp037 itself, alongside its registry primary cp1140), and the declared MAINFRAME-era name's own decode check is the validity stage's predicate — for a single-byte encoding, "contains no undefined byte".
- **UTF-7** — the escape and BOM stages gate UTF-7 claims on a whole-buffer decode. [`utf7DecodesWithoutError`](../src/pipeline/to-utf8.ts) is a faithful reimplementation of CPython's `utf_7` incremental decoder's error behaviour (the lenient `_utf7ToUtf8` in the same file exists for language scoring and must not be used as a validity gate); it is pinned against CPython by the oracle cases in `tests/escape.test.ts`.

### e. unicodedata module

chardet uses [`unicodedata`](https://docs.python.org/3/library/unicodedata.html) in three places:

- [`evaluation.py`](https://github.com/chardet/chardet/blob/main/src/chardet/evaluation.py) uses [`normalize("NFKD")`](https://docs.python.org/3/library/unicodedata.html#unicodedata.normalize) and [`combining()`](https://docs.python.org/3/library/unicodedata.html#unicodedata.combining) to strip diacritic marks so that accented and unaccented forms of the same letter compare as equal when checking detection accuracy. TypeScript equivalent: [`str.normalize("NFKD")`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize)`.replace(/\p{M}/gu, "")`.
- [`pipeline/utf1632.py`](https://github.com/chardet/chardet/blob/main/src/chardet/pipeline/utf1632.py) uses [`category()`](https://docs.python.org/3/library/unicodedata.html#unicodedata.category) to classify characters as letters, marks, spaces, or controls for UTF-16/32 text-quality scoring. TypeScript equivalent: [Unicode property escapes](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Unicode_character_class_escape) (`\p{L}`, `\p{M}`, `\p{Zs}`, `\p{C}`) in [`src/pipeline/utf1632.ts`](../src/pipeline/utf1632.ts).
- [`pipeline/confusion.py`](https://github.com/chardet/chardet/blob/main/src/chardet/pipeline/confusion.py) builds per-encoding letter/case byte tables at runtime (`_letter_case_table`: codecs + `category()`) for context-aware category voting, and (for pairs the confusion maps do not cover) decodes single bytes under arbitrary encodings with `codecs` and reads their `unicodedata.category()` in `differing_high_bytes` / `_pair_categories`. Several of these encodings (the EBCDIC pages, hp-roman8, koi8-t) have no WHATWG decoder, so the port precomputes the byte data at build time by running Python over every encoding in the registry — `src/pipeline/_byte-decode-tables.ts` (each byte's decoded code point and general category), generated by [`scripts/generate-byte-tables.js`](../scripts/generate-byte-tables.js) and read through [`src/pipeline/byte-decode.ts`](../src/pipeline/byte-decode.ts), the same lookup the validity stage (d. above) and the EBCDIC markup scan use. The letter/case table is derived from those categories at runtime rather than stored separately (`_letter_case_table`'s 0/1/2 verdict is a pure function of the general category; the generator asserts the derivation matches chardet's own table before emitting).

One caveat applies to every category-based check evaluated at runtime: CPython bundles its own Unicode character database, while property escapes use the JS engine's (ICU's), and the two can be a Unicode version or two apart. A code point assigned in the newer version is `Cn` (unassigned, non-printable, no category) under the older one, so the implementations can classify recently-added characters differently until the versions align. This cannot be closed without shipping our own category tables; it does not affect the generated model/confusion data, whose categories are baked in at generation time by Python's `unicodedata`.

### f. struct.unpack

chardet uses [`struct.unpack`](https://docs.python.org/3/library/struct.html#struct.unpack) in [`models/_format.py`](https://github.com/chardet/chardet/blob/main/src/chardet/models/_format.py) (the format owner; the port mirrors its read side as [`src/models/_format.ts`](../src/models/_format.ts)) and [`pipeline/confusion.py`](https://github.com/chardet/chardet/blob/main/src/chardet/pipeline/confusion.py) to deserialize the packed binary records in the `.bin` files. `struct.unpack` reads binary fields from the `.bin` file headers using format strings (`">I"` for big-endian uint32, `">d"` for float64, `"!H"` for uint16, `"!B"` for uint8). [`DataView`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView) provides the same capability — `getUint32(offset, false)`, `getFloat64(offset, false)`, `getUint16(offset, false)`, `getUint8(offset)` — where `false` selects big-endian byte order, matching Python's `>` / `!` prefix.

### g. Dataclasses → interfaces

Python's [`@dataclass`](https://docs.python.org/3/library/dataclasses.html#dataclasses.dataclass) class decorator auto-generates `__init__`, `__repr__`, and comparison methods from a class's typed field declarations (e.g. `encoding: str | None`, `confidence: float`). The TypeScript translation depends on mutability:

- [`DetectionResult`](../src/pipeline/index.ts) and [`EncodingInfo`](../src/registry.ts) are declared `frozen=True` — immutable data bags with no behaviour — so they become TypeScript `interface`s; callers construct them as plain object literals.
- [`PipelineContext`](../src/pipeline/index.ts) is mutable per-run state with default field values, so it becomes a TypeScript `class` to support field initializers.

## The Two-Layer API

**Internal chardet API** ([`src/chardet.ts`](../src/chardet.ts), [`src/detector.ts`](../src/detector.ts)) is a faithful port of Python's public surface: `detect()`, `detect_all()`, and `UniversalDetector` with `feed()` / `close()` for streaming. Takes `Uint8Array` only; supports `encodingEra`, `preferSuperset`, `compatNames`, and other options.

**Public jschardet API** ([`src/index.ts`](../src/index.ts)) is the user-facing wrapper. It accepts `string | Uint8Array` and returns the `IDetectedMap` shape that is compatible with prior jschardet versions.

## Distribution Bundles

Three build steps:

- `npm run build` — TypeScript compilation → `build/` (ESM, Node-native)
- `npm run build:bundles` — esbuild → [`dist/`](../dist/) (browser bundles) and `build/index.cjs`
- `npm run build:types` — dts-bundle-generator → `build/index.d.ts` and `build/index.d.cts`

`dist/` is browser-targeted, `build/` is Node-targeted. Current bundle outputs (each has a
`*.js`, `*.min.js`, and `.map` source maps):

- [`dist/jschardet.esm.js`](../dist/jschardet.esm.js) — ESM, public jschardet API
- [`dist/jschardet.js`](../dist/jschardet.js) — IIFE, attaches `jschardet` to `window`; also calls `define()` when an AMD loader is present (see "Module formats" — incidental support, not a documented guarantee)
- `dist/chardet.esm.js` — ESM, lower-level internal chardet API

`build:bundles` also emits one Node artefact, `build/index.cjs` (unminified, single file): the
CommonJS entry that `require('jschardet')` resolves to. It lives in `build/` with the rest of
the Node output, not in `dist/`.

esbuild builds it rather than tsc because tsc derives the output extension from the input
extension — `.ts` yields `.js`, and only `.cts` would yield `.cjs`. Getting CommonJS from tsc
would mean renaming the sources or adding a second compile pass into a directory carrying its
own `"type": "commonjs"`, producing a parallel tree of files. esbuild emits a single bundle,
and targeting Node keeps `node:zlib`.

### Module formats

The package is ESM-first — `build/` is what `import 'jschardet'` resolves to. jschardet 3
documented two entry points, `require("jschardet")` and a `<script src>` leaving a global
behind; both still work, along with the ESM and AMD paths:

| Consumer | Resolves to | Inflate |
|---|---|---|
| `import 'jschardet'` | `build/index.js` (ESM, Node-native) | `node:zlib` |
| `require('jschardet')` | `build/index.cjs` (`require` condition, and `main`) | `node:zlib` |
| `<script src="jschardet.min.js">` | `dist/jschardet.min.js`, top-level `var` becomes a `window` property | JS decoder |
| AMD loader (`define`) | `dist/jschardet.min.js`, via the `define()` call in its footer | JS decoder |
| Browser bundlers | `dist/jschardet.esm.min.js` (`browser` condition) | JS decoder |

Node needs its own `build/index.cjs` because `"type": "module"` makes Node parse `dist/*.js`
as ESM regardless of what the code inside does — so the browser bundle can never serve
`require()`. Building it separately is not just a workaround: targeting Node keeps
`node:zlib`, which is ~5× faster than the bundled JS inflate on first `detect()`.

### Type declarations

Every entry point carries its declaration twin beside it:

```
build/index.js   +  build/index.d.ts     ESM
build/index.cjs  +  build/index.d.cts    CommonJS
```

That adjacency is deliberate, and it is why `package.json` has no `types` field and no `types`
condition in `exports`. TypeScript's default lookup resolves a specifier to a JS file and then
reads the declarations sitting next to it, so there is no mapping to keep in sync — add an
entry point, put its declarations alongside, done.

Both are the same flattened file, produced by `dts-bundle-generator` from tsc's declarations
and differing only in extension.

Flattening is required on the CommonJS side: a `.d.cts` importing `./chardet.js` would be a
CommonJS module importing an ES one, which fails with `TS1479`, so tsc's unbundled output would
need a `.d.cts` twin for every declaration in `build/`. A self-contained file has no relative
imports to resolve.

The ESM side is flattened for consistency and to keep the published surface to two declaration
files rather than the 35 tsc emits.

One file cannot serve both. A declaration file's module format comes from its extension plus the
package's `"type"` field, never from its contents, and TypeScript refuses to `require()` a
specifier whose declarations it classifies as ESM. Pointing both consumers at a lone `.d.ts`
fails with `TS1471`; pointing both at a lone `.d.cts` compiles, but types
`import x from 'jschardet'` with CommonJS interop so that `x.chardet` wrongly appears to exist.
Both were tried.

Worth knowing that this is temporary scaffolding, not a permanent constraint. `build/index.cjs`,
`build/index.d.cts` and `main` exist only because TypeScript still models `require()` of an ES
module as an error — a Node restriction lifted in 22.12, where `require(esm)` now works. Once
TypeScript follows, all three can be deleted and the package becomes ESM-only with no consumer
impact.

`npm run build:types` flattens tsc's declarations into `build/index.d.cts`, then
[`scripts/mirror-cjs-types.js`](../scripts/mirror-cjs-types.js) copies that over
`build/index.d.ts`. The copy is a separate step because the bundler reads `build/index.d.ts`
and cannot write back to its own input.

The AMD `define()` call in the browser bundle's footer is the one piece not driven by a
documented v3 guarantee — v3 got AMD for free from browserify `--standalone`, and consumers
came to rely on it. A full UMD wrapper would be pointless here: its CommonJS branch is
unreachable for the reason above, so only the `define()` hand-off is worth keeping.

[`tests/packaging.test.ts`](../tests/packaging.test.ts) exercises all of this against the
committed bundles.

## Testing

See [`docs/testing.md`](testing.md).
