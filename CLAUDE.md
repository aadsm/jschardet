# jschardet

Before starting any work, read:
- docs/architecture.md
- docs/testing.md
- docs/port-notes.md

## Project structure

- `chardet/` — git submodule with the Python library this project ports and the source of truth for all ported logic, tests, and model data
- `build/` — Node-targeted output; gitignored. Mostly `tsc` output (`index.js`, `cli.js`), plus `index.cjs` from `build:bundles` — the CommonJS entry `require('jschardet')` resolves to (esbuild builds it because `tsc` takes the output extension from the input extension, so `.ts` can only yield `.js`). Declarations sit beside their entry point (`index.d.ts`, `index.d.cts`) — that adjacency is why package.json needs no `types` field
- `dist/` — browser bundles produced by `npm run build:bundles` (esbuild). The four `jschardet.*` outputs are committed alongside their `.map` source maps: IIFE pair (`jschardet.js`, `jschardet.min.js`) for direct `<script src=...>` use (they also register with AMD loaders), and ESM pair (`jschardet.esm.{js,min.js}`) for ESM imports from a CDN or git URL. The `chardet.esm.*` bundles (and their maps) are an internal-API build artefact and stay gitignored. Rebuild and commit when source changes affect the tracked four. See "Module formats" in docs/architecture.md before touching the bundle footers or the `exports` map in package.json.
- `scripts/generate-encodings-alias-map.js` — generates `src/encoding-alias-map.ts` from Python's stdlib codec alias registry (`encodings.aliases`); run manually when the Python version changes
- `scripts/generate-encodings-whatwg-map.js` — generates `src/encoding-whatwg-map.ts` from chardet's `_WHATWG_TO_CHARDET` snapshot; called automatically by `update-chardet` after each pin change
- `scripts/generate-byte-tables.js` — generates `src/pipeline/_byte-decode-tables.ts` for every encoding in chardet's registry (plus cp037, which `markup.ts` decodes with by name): per single byte, its decoded code point and Unicode general category (all 256 bytes), computed by Python's `codecs` + `unicodedata`, and a `singleByte` flag marking the stateless single-byte codecs. `src/pipeline/byte-decode.ts` is the lookup API over the table, and the only reader of it; it backs three call sites: `validity.ts` (a single-byte encoding decodes data iff no byte of it is undefined, i.e. has the 0xFFFF code-point sentinel), `markup.ts` (the cp037 decode of an EBCDIC head), and `confusion.ts`'s `differingHighBytes` / `_pairCategories` (which arbitrate encoding pairs the confusion maps do not cover) and `_letterCaseTable`, whose letter/case verdict is derived from the stored categories. The generator asserts the derivation matches chardet's own `confusion._letter_case_table` byte-for-byte before emitting (so the letter/case verdict needs no table of its own), and that every `singleByte` codec really is stateless and one-character-per-byte. Called automatically by `update-chardet` after each pin change. See `docs/textdecoder-vs-python.md` for why this table exists — the single-byte bridge over the TextDecoder-vs-CPython gap
- `scripts/generate-model-bins.js` — generates `src/models/{models,idf,confusion}.bin.js` from chardet's three `.bin` files; called automatically by `update-chardet` after each pin change. Default mode emits compressed wrappers (zlib-compressed base64, decompressed at first `readBytes()` call) and verifies through both the Node decoder and the browser JS decoder. Flags: `--generate` (default; writes wrappers then verifies), `--verify` (re-checks on-disk wrappers against chardet source bytes without regenerating), `--raw` (emit uncompressed wrappers — passthrough base64, no `decompress` import; for local debugging, do not commit), `--compressed` (explicit form of the default). See `docs/model-compression.md` for the compression/decompression design — read it before changing model data, the wrappers, or the decoders in `src/runtime/decompress.*`.

# Claude Instructions

## Diagnostics

Read-only helpers for investigating detection questions (correctness
or performance). Use these instead of writing throwaway scripts under
`/tmp/`:

- `node scripts/diagnose-file.js <path>` — full candidate ranking
  from our port only. Quick check: "what does this port think this
  file is?"
- `node scripts/compare-with-chardet.js <path> [<path>...]` —
  side-by-side ranking from our port and upstream Python chardet,
  with a DIFF flag on rows where they disagree. Use to answer "is
  this a port issue or upstream behaviour?". Naming-only mismatches
  (e.g. `Windows-1250` vs `cp1250`) show as `OK*`.
- `node scripts/decompress-benchmark.js` — measures the first-call
  decompression cost of each `src/models/*.bin.js` payload under
  both runtime paths (`node:zlib` and the first-party browser JS
  decoder). Use to spot regressions when the encoder strategy or
  the JS decoder is changed.

`compare-with-chardet.js` runs upstream from the `chardet/` submodule
via `PYTHONPATH=chardet/src python3` — no pip install needed. It
auto-generates the submodule's gitignored `_version.py` (otherwise
`import chardet` fails) on first run and auto-runs `npm run build` if
`build/chardet.js` is missing.

## docs/performance.md

This doc is a snapshot, not a generated artefact, and the cross-detector
comparisons only hold if every number came from the same machine, Node
version, and chardet submodule pin. When refreshing the numbers, re-run
the timing benchmarks together in one session:

    npm run benchmark:all

Then update the tables, the date stamp at the top, the hardware block
at the bottom, and any prose multipliers (e.g. "~6×", "57.2pp") that
are derived from the table numbers. Never edit a single table or
multiplier in isolation — refresh the whole set or none.

`benchmark:bundle` is the exception to all of the above: dist/ is
committed, so bundle size is a deterministic function of the repo rather
than a measurement of this machine. It can be re-run anywhere, on its
own, without invalidating the rest of the set, and
`tests/bundle-size.test.ts` fails when the README drifts more than 1%
from the committed bundle. Paste the "README row" line it prints rather
than rounding by hand, and note that its gzip figures come from
node:zlib — the `gzip` binary emits ~0.6% larger at the same level.

Round prose multipliers to whole numbers with a `~` prefix (e.g. "~6×",
not "6.1×"): they're asymptotic comparisons, and one decimal place
implies a stability across runs that the benchmark noise floor doesn't
support. Percentage-point values stay exact ("57.2pp") because they're
direct differences, not ratios.

Pure copy edits (typo fixes, methodology wording, broken links) don't
touch numbers and don't trigger this rule.

## Commits

Always include the planned commit message in the plan before committing. Never include a Claude Code session URL in a commit message. Always include a Co-authored-by git trailer as the final line of every commit message, using the model name from the current session's system prompt: `Co-authored-by: Claude <model> <noreply@anthropic.com>`.

When a follow-up change is a fixup to the immediately preceding commit (a correction, a tweak, a reformat — anything that doesn't deserve its own history entry), amend that commit (`git commit --amend`) and force-push rather than creating a new commit. Create a new commit only when the change is logically independent.

## Comments and docs — no archaeology

Write comments and docs to describe the code as it *is*, not how it came to be. Don't narrate refactors or removed alternatives: no "previously", "used to", "the fold", "replaces the separate X file", "extracted from Y", "renamed from", "no longer". State the current design and its rationale directly — git history is where the evolution lives. (This is about *codebase* history; "before/after" describing runtime order or sequence within the code is fine.)
