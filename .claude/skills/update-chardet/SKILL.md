---
name: update-chardet
description: Port a new upstream chardet release into jschardet — scope the commit range, port behavioral changes, mirror structure, verify parity, produce the single update commit. Use when asked to update/upgrade chardet to a new version.
---

# Update chardet to a new release

Process for moving the chardet submodule pin and porting the upstream range.
Facts owned elsewhere are linked, not restated: port conventions in
`docs/port-notes.md`, mechanism mappings in `docs/architecture.md`, commit
rules and benchmark policy in `CLAUDE.md`.

## 1. Scope the range

- Branch `update-chardet-<ver>` from `origin/main` (verify the base — not a
  local main or WIP branch).
- Deepen the submodule's tag history **before** listing commits:
  `git -C chardet fetch --depth=100 origin tag <new>`. The update script
  fetches `--depth=1`, which re-shallows history — a shallow
  `git log <old>..<new>` silently under-reports the range.
- Work through every commit oldest-first (`git -C chardet log --reverse
  <old>..<new>`), reading the full body — upstream messages document
  verification and edge cases the diff alone doesn't — and assign each a
  verdict:
  - **TO PORT** — changes detection behavior (port from the Python diff;
    chardet is the source of truth, even when a similar local experiment
    exists), or reorganizes modules/files (the file map in architecture.md
    is 1:1 by name, and upstream test-file splits are mirrored too)
  - **ALREADY IN JSCHARDET** — e.g. backported earlier, or the port never
    had the bug
  - **NOT PORTABLE** — with the reason (usually the WHATWG decoder
    collapse; handling in step 3)
  - **NO ACTION NEEDED** — docs, CI, benchmarks, and perf work with a
    bit-identical-results guarantee; for the latter, record the skipped
    tests in `docs/missing-python-tests.md`
- The scoping deliverable is a per-commit report published as an artifact:
  commits oldest-first, grouped into phases matching how the upstream work
  unfolded, each with what changed, why, and its verdict. Call out anything
  needing a maintainer decision, such as an announced future default change.
  Wait for the maintainer to review the verdicts before porting — the TO
  PORT rows are the work plan for the steps below, and after the port the
  report doubles as the cross-check that every commit was either handled or
  consciously skipped.

## 2. Pin and regenerate

- `node scripts/update-chardet.js <tag>` — regenerates the WHATWG map, model
  bins, and byte decode tables, and refreshes the
  committed fixtures. The test-data corpus ref needs no step of its own: it
  is derived from the submodule at test time (see "Test Corpus" in
  docs/testing.md). Version-stamp-only diffs in generated files are normal
  and correct.

## 3. Port

- Comments and docs read as current code — never "chardet X.Y changed this".
- Anything upstream does through the codecs module lands in `src/decode.ts`:
  the `_utils.py` predicates (`decodes_without_error`, `decodes_completely`,
  `dangling_tail_with_ascii_prefix`) and the pipeline's `bytes.decode(...)`
  calls each have a by-name counterpart there (`decodesWithoutError`,
  `decodesCompletely`, `danglingTailWithAsciiPrefix`, `decodeText`,
  `decodeStrictText`), which answers a single-byte encoding from the byte
  tables and a multi-byte one through TextDecoder. Pipeline code never calls
  `text-decoder.ts`'s `whatwg*` helpers or `TextDecoder` for a chardet decode
  question; a new kind of decode gets a new by-name function beside the
  others. A codec the port decodes by literal name (markup's cp037) goes in
  `EXTRA_CODECS` in `scripts/generate-byte-tables.js`; a chardet name whose
  WHATWG label the upstream snapshot lacks (the utf-16 pair) goes in the
  supplement in `scripts/generate-encodings-whatwg-map.js`. The map of what
  each mechanism gets wrong is `docs/textdecoder-vs-python.md`.
- A NOT PORTABLE verdict also needs a divergence test pinning the port's
  behavior on the input Python treats differently.
- Doc changes in the update commit must be caused by the update's code
  changes. Pre-existing behavior noticed along the way gets documented
  separately, if at all.

## 4. Verify

- `npx tsc --noEmit`, `npm test`, `npm run test:accuracy` (investigate every
  XPASS and new failure; prune/extend expected-failure lists deliberately),
  `npm run test:browser`, `npm run test:bundles`.
- Full-corpus parity vs Python: `tests/compare-detect/run.sh` (runs Python
  from the submodule, pinned at the new tag by step 2). Every DIFF must end
  the session explained: naming-only (`OK*`), a documented divergence, or a
  bug.
- Existing docs are part of verification: sweep them for statements the
  changes invalidated — grep for every file path and symbol name the port
  moved or renamed, and reread claims about behavior the port changed.
- Rebuild and commit build outputs: `npm run build && npm run build:bundles
  && npm run build:types`; the four tracked dist bundles + maps go in the
  commit.
- Do **not** touch `docs/performance.md` or README benchmark numbers unless
  on the canonical benchmark machine (policy in CLAUDE.md).

## 5. Commit and report

- The `update-chardet-<ver>` branch carries one commit, `Update chardet to
  <ver>`. Body lists what was ported, what was deliberately not ported and
  why, per the commit rules in CLAUDE.md. Related work from the same range
  (e.g. a mirrored module split) folds into this commit rather than
  trailing it.
- Before handing over: confirm the new tag is reachable on the public
  chardet remote (submodule CI resolution), and that nothing non-doc drifted
  since the last full test run.
- Deliver a closing summary: clean ports / not-so-clean ports (where the TS
  change reached further than the upstream diff, and why) / impossible ports
  and their handling / the byte-size delta of each tracked dist bundle
  against the previous commit / items for the maintainer to look at.
