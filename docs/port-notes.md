# Port Notes

Decisions made during porting that differ from the Python source, with rationale.

## Truncation-tolerant validity decoding

**Python:** `decodes_without_error` in `_utils.py` answers the validity question for `filter_by_validity`, `_validate_bytes` and `promote_markup_superset`. It decodes with an incremental decoder and `final=False`, so an incomplete multi-byte sequence at the end of the buffer is deferred instead of raising.

**TypeScript:** `decodesWithoutError` in `src/text-decoder.ts` reaches the same behaviour with `{ stream: true }`. All three call sites use it.

Why the tolerance matters: detection input is routinely a prefix of a larger whole. vscode reads the first 4096 or 65536 bytes of a file and hands over the slice; `_validateBytes` slices its own 4096-byte head regardless of what the caller passed. For a 2-byte encoding either cut lands mid-character about half the time, and a one-shot fatal decode cannot tell a truncated tail from corrupt data — a single dangling lead byte would eliminate **every** CJK encoding from the candidate list (GBK, Big5, Shift_JIS, EUC-JP, EUC-KR; UTF-8 is immune because its lead bytes encode the sequence length), leaving the answer to depend on input-length parity.

`{ stream: true }` is truncation-tolerant without being permissive: `TextDecoder` already knows each encoding's sequence structure, so this covers all of them with no per-encoding code, and genuine corruption is mid-buffer and still raises.

|  | `decode(buf)` | `decode(buf, {stream:true})` |
|---|---|---|
| complete GBK | accept | accept |
| truncated mid-character | **throw** | accept |
| illegal trail byte (`D6 20`) | throw | throw |
| unmapped bytes (`FF FF`) | throw | throw |

Two consequences worth knowing:

- **Streaming makes `TextDecoder` stateful, and `decoderForLabel` caches instances.** A deferred partial tail would otherwise be prepended to the next candidate's buffer, shifting every character pair — a silent corruption, since the decode still succeeds and just returns the wrong text. `decodesWithoutError` flushes in a `finally` block; the flush throws on a pending tail, which is expected and resets the decoder either way. Python has no equivalent hazard — it constructs a fresh incremental decoder per call. A fresh `TextDecoder` per call would avoid the flush here too, but costs ~24% on small inputs, which is the size a prefix-detector sees most.
- **Validity filtering is marginally weaker at detecting a lying charset declaration.** A body that is valid in the declared encoding except for a dangling final byte is not rejected. This only bites on inputs short enough to contain no other evidence; see the fixture note in `tests/markup.test.ts`.

Covered by `tests/truncated_input.test.ts` (port of Python's `test_truncated_input.py`, plus a TS-only regression test for the decoder-cache hazard above).

## Markup superset decode-safety promotion (not ported)

**Python:** `promote_markup_superset` promotes a markup result to its Windows superset *unconditionally* when the codec the reported name resolves to cannot decode the data but the superset can — a declared-Shift_JIS page using CP932 NEC/IBM extensions is reported as CP932, because Python callers who `.decode()` with the reported name `SHIFT_JIS` get plain `shift_jis`, which raises on those bytes. The structural-score comparison alone never catches this case (both scores tie at 1.0 for structurally clean data).

**TypeScript:** the branch is not ported. WHATWG collapses each promotion pair onto a single decoder — its `shift_jis` *is* cp932 and its `euc-kr` *is* cp949 — so the reported codec decodes whenever the superset does and the trigger condition can never hold. The failure mode the branch guards against also cannot happen for `TextDecoder` callers: decoding CP932-extended bytes with the label `shift_jis` succeeds. Only the structural-score promotion path is ported.

Consequences: `compare-with-chardet.js` / `tests/compare-detect` flag a DIFF wherever Python promotes on decode-safety alone (the corpus case is `cp932-ja/y-moto.com.xml`: SHIFT_JIS here, CP932 in Python), and that file stays in the known-failure lists in `tests/accuracy.test.ts`. Covered by the divergence test in `tests/markup.test.ts` ("NEC-extension bytes do not promote"); Python's `test_promote_when_reported_codec_cannot_decode` is intentionally not ported (see `docs/missing-python-tests.md`).

## Statistical-scoring rowmax pruning (not ported)

**Python:** statistical scoring can prune candidates with a per-model upper bound on the achievable score (`rowmax.bin`, `_score_pruned` in `pipeline/statistical.py`) — a pure performance fast path, guaranteed to return the same results as scoring every candidate. `full_ranking=True` bypasses it and scores everything.

**TypeScript:** the pruning machinery is not ported; the port always scores every candidate, matching the `full_ranking=True` path. Results are identical by construction, so there is no behavioural consequence — this is also why `scripts/generate-model-bins.js` converts three of upstream's four `.bin` files (`rowmax.bin` has no consumer here). Revisit if statistical-scoring cost ever becomes a problem; the pruning tests to bring along are listed in [missing-python-tests.md](missing-python-tests.md).

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

For Python tests that encode non-ASCII strings under non-UTF-8 labels (e.g. `"text".encode("iso-8859-7")`), inline the byte sequence as a `new Uint8Array([...])` literal with a comment naming the source encoding. Tests run on Node, which exposes `TextDecoder` for legacy labels but no symmetric `TextEncoder` — hand-rolling per-encoding encoders for the test harness duplicates the Python codec library and is out of scope. Pre-computed byte literals stay readable and keep the TS test suite dependency-free. Generate the inlined bytes with Python's codecs — the source of truth — not a JS-side encoder: an encoder whose table differs from Python's by one byte makes the ported test exercise different input than the upstream test, and it still passes.
