# jschardet

Before starting any work, read:
- docs/architecture.md
- docs/testing.md
- docs/port-notes.md

## Project structure

- `chardet/` — git submodule with the Python library this project ports and the source of truth for all ported logic, tests, and model data
- `build/` — intermediate `tsc` output; gitignored
- `dist/` — bundles produced by `npm run build:bundles` (esbuild). The four `jschardet.*` outputs are committed alongside their `.map` source maps: IIFE pair (`jschardet.js`, `jschardet.min.js`) for direct `<script src=...>` use, and ESM pair (`jschardet.esm.{js,min.js}`) for ESM imports from a CDN or git URL. The `chardet.esm.*` bundles (and their maps) are an internal-API build artefact and stay gitignored. Rebuild and commit when source changes affect the tracked four.
- `scripts/generate-encodings-alias-map.js` — generates `src/encoding-alias-map.ts` from Python's stdlib codec alias registry (`encodings.aliases`); run manually when the Python version changes
- `scripts/generate-encodings-whatwg-map.js` — generates `src/encoding-whatwg-map.ts` from chardet's `_WHATWG_TO_CHARDET` snapshot; called automatically by `update-chardet` after each pin change
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
all four benchmarks together in one session:

    npm run benchmark:all

Then update the tables, the date stamp at the top, the hardware block
at the bottom, and any prose multipliers (e.g. "~6×", "57.2pp") that
are derived from the table numbers. Never edit a single table or
multiplier in isolation — refresh the whole set or none.

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
