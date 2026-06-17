# Port Notes

Decisions made during porting that differ from the Python source, with rationale.

## `bytes.find()` → `findBytes` helper

**Python:** `bytes.find(needle, start)` searches for a byte subsequence and returns its index, or -1.

**TypeScript:** `Uint8Array` has `.indexOf()` for single bytes only. A shared helper `findBytes(haystack, needle, start?)` is added to `src/utils.ts` for multi-byte subsequence searches. Used by `escape.ts`, `magic.ts`, and `utf1632.ts`. Single-byte searches use `Uint8Array.prototype.indexOf()` directly.

## `bytes.startswith()` → `startsWith` helper

**Python:** `bytes.startswith(prefix)` checks whether a byte sequence begins with a given prefix.

**TypeScript:** `Uint8Array` has no `.startsWith()` method. A shared helper `startsWith(data, prefix)` is added to `src/utils.ts`. Used by `bom.ts` and `magic.ts`.

## Dataclasses without methods → interfaces

**Python:** dataclasses used purely as data containers, with no methods.

**TypeScript:** port these as an `interface`, not a `class` — a class adds no value over an interface when there is no behaviour to encapsulate. (`DetectionResult`, below, is an instance of this rule.)

## `DetectionResult` and `DetectionDict` collapsed into one

**Python:** `DetectionResult` is a frozen dataclass; `DetectionDict` is a `TypedDict`. They are distinct types — `to_dict()` is needed to convert between them.

**TypeScript:** Structural typing makes two identically-shaped interfaces interchangeable. `DetectionDict` is dropped; `DetectionResult` is an interface. `toDict()` is not ported — callers assign or spread directly.

## Referencing the Python source in TS comments

When pointing at Python code in a comment, use **symbol names** (function, class, regex constant), not `file.py:line`. Line numbers shift whenever the chardet submodule pin moves; symbol names survive minor refactors and stay grep-able from `chardet/src/chardet/`. Example:

    // Python _detect_pep263 short-circuits if no '#' is in the first 200 bytes.

not

    // markup.py:37 — short-circuit if no '#' is in the first 200 bytes.

## Test file naming: drop the `test_` prefix

**Python:** uses the `test_` prefix for pytest discovery (`test_enums.py`).

**TypeScript:** Vitest discovers by the `.test.ts` suffix instead, making the prefix redundant: `test_enums.py` → `tests/enums.test.ts`.

## Byte literals in test ports

Mirror the Python source's literal form so the TS port stays grep-able against `chardet/tests/`:

- **Python `bytes([0x48, 0x65, ...])` (array of ints)** → `new Uint8Array([0x48, 0x65, ...])`. Existing convention in `tests/escape.test.ts`, `tests/utf8.test.ts`.
- **Python `b'\xef\xbb\xbfHello'` (string-form mixing hex escapes and ASCII)** → `bytes("\xef\xbb\xbfHello")` using a per-file helper:

      function bytes(s: string): Uint8Array {
        return Uint8Array.from(s, c => c.charCodeAt(0));
      }

  The `charCodeAt`-mapping pattern is already used by the `latin-1` branch of `encode()` in `tests/validity.test.ts`. Each `\xNN` escape in the source string must have two hex digits and produce a code point ≤ 0xFF.
- **Python `b'Hello world'` (pure ASCII)** → `new TextEncoder().encode('Hello world')`. Equivalent for ASCII; matches the existing usage in `tests/markup.test.ts`.
- **Mixed sequences** → `concat(...arrays)` helper (existing convention in `tests/markup.test.ts`).

For Python tests that encode non-ASCII strings under non-UTF-8 labels (e.g. `"text".encode("iso-8859-7")`), inline the byte sequence as a `new Uint8Array([...])` literal with a comment naming the source encoding. Tests run on Node, which exposes `TextDecoder` for legacy labels but no symmetric `TextEncoder` — hand-rolling per-encoding encoders for the test harness duplicates the Python codec library and is out of scope. Pre-computed byte literals stay readable and keep the TS test suite dependency-free.
