# Testing

## Test Configs

Five Vitest configs at the project root:

| Command | Config | What it runs |
|---|---|---|
| `npm test` | [`vitest.config.ts`](../vitest.config.ts) | Full test suite under Node.js |
| `npm run test:browser` | [`vitest.browser.config.ts`](../vitest.browser.config.ts) | Same suite in real Chromium via Playwright |
| `npm run test:accuracy` | [`vitest.accuracy.config.ts`](../vitest.accuracy.config.ts) | Corpus accuracy gate; clones ~100 MB into `tests/data/` on first run |
| `npm run test:bundles` | both `vitest.bundles.*.config.ts` | Runs bundle tests sequentially in headless Chromium against the `dist/` bundles; requires `npm run build:bundles` first |

The two bundle configs run separately:
- [`vitest.bundles.jschardet.config.ts`](../vitest.bundles.jschardet.config.ts) — tests [`tests/jschardet.test.ts`](../tests/jschardet.test.ts) and [`tests/jschardet.global.test.ts`](../tests/jschardet.global.test.ts) against [`dist/jschardet.esm.js`](../dist/jschardet.esm.js) (and the IIFE [`dist/jschardet.js`](../dist/jschardet.js) for the global smoke test)
- [`vitest.bundles.chardet.config.ts`](../vitest.bundles.chardet.config.ts) — tests [`tests/detector.test.ts`](../tests/detector.test.ts) against `dist/chardet.esm.js`

## Test File Naming

Python uses the `test_` prefix for pytest discovery; Vitest uses the `.test.ts` suffix. Drop the `test_` prefix when porting: `test_enums.py` → [`tests/enums.test.ts`](../tests/enums.test.ts).

## Byte Literals in Ported Tests

Mirror the Python source's literal form so the TS port stays grep-able against [`chardet/tests/`](https://github.com/chardet/chardet/tree/main/tests):

- **`bytes([0x48, 0x65, ...])` (array of ints)** → `new Uint8Array([0x48, 0x65, ...])`
- **`b'\xef\xbb\xbfHello'` (mixed hex + ASCII)** → `bytes(s)` via a per-file helper that maps each character to its code point:
  ```ts
  function bytes(s: string): Uint8Array {
    return Uint8Array.from(s, c => c.charCodeAt(0));
  }
  ```
  Each `\xNN` escape must have two hex digits and produce a code point ≤ 0xFF.
- **`b'Hello world'` (pure ASCII)** → `new TextEncoder().encode('Hello world')`
- **Mixed sequences** → `concat(...arrays)` helper; concatenates multiple `Uint8Array`s into one

For Python tests that encode non-ASCII text under a specific label (e.g. `"text".encode("iso-8859-7")`), inline the byte sequence as a `new Uint8Array([...])` literal with a comment naming the source encoding.

## Fixtures

Tests that need real corpus bytes import them via a `?uint8array` query suffix:

```ts
import sample from './fixtures/<subdir>/<name>?uint8array';
```

The suffix is handled by [`scripts/lib/uint8array-plugin.js`](../scripts/lib/uint8array-plugin.js). Fixtures live under [`tests/fixtures/`](../tests/fixtures/) and are committed. Refresh them from `chardet/test-data` with `npm run update-test-fixtures`; the source-to-destination manifest is at the top of [`scripts/update-test-fixtures.js`](../scripts/update-test-fixtures.js).

## `isEquivalentDetection`

Two encodings are equivalent if they decode the input bytes to the same text.
There are two implementations:

- [`src/equivalences.ts`](../src/equivalences.ts) — no-op stub used in browser builds (iconv-lite can't run in a browser)
- [`tests/utils.ts`](../tests/utils.ts) — real implementation via iconv-lite, used by all Node tests

Test files import it from `./utils.js`, not `../src/equivalences.js`.

## Browser-Mode Exclusions

These tests are excluded from [`vitest.browser.config.ts`](../vitest.browser.config.ts) because they depend on Node-only capabilities:

- [`accuracy.test.ts`](../tests/accuracy.test.ts) — dynamically clones a 100 MB corpus
- [`equivalences.test.ts`](../tests/equivalences.test.ts), [`github_issues.test.ts`](../tests/github_issues.test.ts) — iconv-lite oracle; safer-buffer needs `Buffer.prototype`, which Vite externalizes in browser builds
- [`spec_decode_roundtrip.test.ts`](../tests/spec_decode_roundtrip.test.ts) —
  spawns a `python3` subprocess

Don't add to this list without a similar reason.

## Python Parity Check

[`tests/compare-detect/run.sh`](../tests/compare-detect/run.sh) runs `detect()` from both Python chardet and this port over the whole `tests/data/` corpus and diffs the results per record (encoding / confidence / language divergences). Use it to confirm parity after a chardet pin bump.

It prints the Markdown report to stdout and progress to stderr, so redirect to capture a report:

```sh
tests/compare-detect/run.sh > /tmp/parity.md
```

Requires python3 (with the chardet submodule checked out), `npx tsx`, and a populated `tests/data/` corpus (`npm run test:accuracy` once if missing).

## Python Tests Not Ported

See [`docs/missing-python-tests.md`](missing-python-tests.md) for Python tests intentionally not ported to TypeScript and the reason for each.
