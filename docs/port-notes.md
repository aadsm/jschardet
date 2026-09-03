# Port Notes

Decisions made during porting that differ from the Python source, with rationale.

## Truncation-tolerant validity decoding

**Python:** `decodes_without_error` in `_utils.py` answers the validity question for `filter_by_validity`, `_validate_bytes` and `promote_markup_superset`. It decodes with an incremental decoder and `final=False`, so an incomplete multi-byte sequence at the end of the buffer is deferred instead of raising.

**TypeScript:** `decodesWithoutError` in `src/text-decoder.ts` reaches the same behaviour with `{ stream: true }`. All three call sites use it.

Why the tolerance matters: detection input is routinely a prefix of a larger whole. vscode reads the first 4096 or 65536 bytes of a file and hands over the slice; `_validateBytes` slices its own 4096-byte head regardless of what the caller passed. For a 2-byte encoding either cut lands mid-character about half the time, and a one-shot fatal decode cannot tell a truncated tail from corrupt data — a single dangling lead byte would eliminate **every** CJK encoding from the candidate list (GBK, Big5, Shift_JIS, EUC-JP, EUC-KR; UTF-8 is immune because its lead bytes encode the sequence length), leaving the answer to depend on input-length parity.

`{ stream: true }` is truncation-tolerant without being permissive: `TextDecoder` already knows each encoding's sequence structure, so this covers all of them with no per-encoding code, and genuine corruption is mid-buffer and still raises.

|  | `decode(buf)` | `decode(buf, {stream:true})` |
|---|---|---|
| complete GB text | accept | accept |
| truncated mid-character | **throw** | accept |
| illegal trail byte (`D6 20`) | throw | throw |
| unmapped bytes (`FF FF`) | throw | throw |

That table holds for the labels this port actually uses, which is not the same
set Python has codecs for. `ENCODING_WHATWG_MAP` has no `gbk` entry — the GB
family routes through `gb18030`, matching the WHATWG Encoding Standard, where
GBK's decoder *is* gb18030's decoder. The tests assert on `gb18030` for that
reason; Python's `test_truncated_input.py` uses its `gbk` codec, and the
equivalent TextDecoder label would not be exercised by any call site. It is
also not equivalent in practice: Node <= 20's `gbk` decoder accepts `FF FF`,
mapping it to `U+F8F5` rather than raising, while `gb18030` rejects it on every
version tested.

Three consequences worth knowing:

- **Streaming makes `TextDecoder` stateful, and `decoderForLabel` caches instances.** A deferred partial tail would otherwise be prepended to the next candidate's buffer, shifting every character pair — a silent corruption, since the decode still succeeds and just returns the wrong text. `decodesWithoutError` flushes in a `finally` block; the flush throws on a pending tail, which is expected and resets the decoder either way. Python has no equivalent hazard — it constructs a fresh incremental decoder per call. A fresh `TextDecoder` per call would avoid the flush here too, but costs ~24% on small inputs, which is the size a prefix-detector sees most.
- **A decoder that substitutes instead of raising defeats the check entirely.** ICU maps some undefined bytes into the Private Use Area rather than treating them as errors, and `fatal: true` cannot see the difference — the decode simply succeeds. `big5` does this for `FF` (to `U+F8F8`) on every Node tested, so invalid Big5 keeps `big5hkscs` in the candidate list where Python's codec drops it: a 400-byte Big5 sample with two `FF` bytes spliced in still ranks Big5 first here at 0.42, while upstream eliminates it and falls through to noise. Measured cost is nil — Big5 is 29/29 on the corpus — but it is a divergence, not a design choice. Chromium rejects the same bytes, so this is a Node-only divergence and browser builds match upstream; `tests/jschardet.test.ts` pins it with a `skipIf(browser).fails` case, which will flip to "expected to fail, but passed" on the Node release that fixes it, the way 22 quietly fixed `gbk`. `windows-874` substitutes the same way (`U+F8C8`), though `filterByValidity` consults the authoritative `SBCS_UNDEFINED_BYTES` table before TextDecoder for single-byte encodings, so only the direct callers in `pipeline/markup.ts` and `pipeline/postprocess.ts` are exposed. Rejecting PUA output is not the fix: 6217 of big5's 19720 decodable two-byte sequences legitimately map into the PUA, because HKSCS characters have no standard code points. A first-party lead/trail range check, in the shape of `SBCS_UNDEFINED_BYTES`, is what would close it.
- **Validity filtering is marginally weaker at detecting a lying charset declaration.** A body that is valid in the declared encoding except for a dangling final byte is not rejected. This only bites on inputs short enough to contain no other evidence; see the fixture note in `tests/markup.test.ts`.

Covered by `tests/truncated_input.test.ts` (port of Python's `test_truncated_input.py`, plus a TS-only regression test for the decoder-cache hazard above).

## Markup superset decode-safety promotion (not ported)

**Python:** `promote_markup_superset` promotes a markup result to its Windows superset *unconditionally* when the codec the reported name resolves to cannot decode the data but the superset can — a declared-Shift_JIS page using CP932 NEC/IBM extensions is reported as CP932, because Python callers who `.decode()` with the reported name `SHIFT_JIS` get plain `shift_jis`, which raises on those bytes. The structural-score comparison alone never catches this case (both scores tie at 1.0 for structurally clean data).

**TypeScript:** the branch is not ported. WHATWG collapses each promotion pair onto a single decoder — its `shift_jis` *is* cp932 and its `euc-kr` *is* cp949 — so the reported codec decodes whenever the superset does and the trigger condition can never hold. The failure mode the branch guards against also cannot happen for `TextDecoder` callers: decoding CP932-extended bytes with the label `shift_jis` succeeds. Only the structural-score promotion path is ported.

Consequences: `compare-with-chardet.js` / `tests/compare-detect` flag a DIFF wherever Python promotes on decode-safety alone. Three corpus files do, one per collapsed pair: `cp932-ja/y-moto.com.xml` and `cp932-ja/hardsoft.at.webry.info.xml` (SHIFT_JIS here, CP932 in Python), and `cp949-ko/ricanet.com.xml` (EUC-KR here, CP949 in Python) — the same not-ported branch on the `euc_kr`/`cp949` side. All three still pass the accuracy gate: it detects with `prefer_superset: true`, which remaps the port's subset name to the same superset Python promotes to, so only the cp932 pair (whose promotion the accuracy gate reads through `isCorrect`'s superset set) needs listing in `tests/accuracy.test.ts`'s divergent-failures. Covered by the divergence test in `tests/markup.test.ts` ("NEC-extension bytes do not promote"); Python's `test_promote_when_reported_codec_cannot_decode` is intentionally not ported (see `docs/missing-python-tests.md`).

## Statistical-scoring rowmax pruning (not ported)

**Python:** statistical scoring can prune candidates with a per-model upper bound on the achievable score (`rowmax.bin`, `_score_pruned` in `pipeline/statistical.py`) — a pure performance fast path, guaranteed to return the same results as scoring every candidate. `full_ranking=True` bypasses it and scores everything.

**TypeScript:** the pruning machinery is not ported; the port always scores every candidate, matching the `full_ranking=True` path. Results are identical by construction, so there is no behavioural consequence — this is also why `scripts/generate-model-bins.js` converts three of upstream's four `.bin` files (`rowmax.bin` has no consumer here). Revisit if statistical-scoring cost ever becomes a problem; the pruning tests to bring along are listed in [missing-python-tests.md](missing-python-tests.md).

## UTF-8 validation mechanism

**chardet:** `scan_utf8` in `pipeline/utf8.py` validates UTF-8 by feeding the
input to CPython's strict incremental decoder in chunks and discarding the
decoded text, with `final=False` for the truncated-tail tolerance. Upstream
rewrote it from an earlier hand-rolled per-byte loop for C-level speed (its
`utf8.py` docstring gives the rationale), and holds the two bit-identical with
a differential suite (`test_utf8_equivalence.py` against `utf8_oracle.py`).

**TypeScript:** `scanUtf8` in `src/pipeline/utf8.ts` keeps the hand-rolled
per-byte loop. The two implementations now check the same rules by different
mechanisms — the loop enforces exactly the overlong, surrogate, and
above-U+10FFFF rejections CPython's decoder does, and stops at a truncated
final sequence the same way. The port keeps the loop deliberately: it *is* the
validator upstream tested its C decoder against, it is already the fast path
under a JIT, and a `TextDecoder`-based rewrite would have to reintroduce the
tolerated-tail reconstruction (locating the incomplete final sequence to
exclude it from the multi-byte counts) for no change in result. The C-speed
rationale in `utf8.py`'s docstring does not carry over: `TextDecoder` validity
is already native speed, so the loop's cost is not the bottleneck the rewrite
addressed upstream.

The differential suite (`test_utf8_equivalence.py` + `utf8_oracle.py`) is not
ported — it pins two Python implementations against each other, and the port
never left the one the oracle *is*. See `docs/missing-python-tests.md`.

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

When pointing at Python code in a comment, use **symbol names** (function, class, regex constant), not `file.py:line`. Line numbers shift whenever the chardet submodule pin moves; symbol names survive minor refactors and stay grep-able from `chardet/src/chardet/`.

Attribute precisely: say **"chardet's X"** for upstream chardet symbols (`chardet's decodes_without_error`, `chardet's _letter_case_table`) and reserve **"Python"/"CPython"** for the language and its stdlib (`codecs`, `unicodedata`, `bytes.translate`, the `utf_7` codec). The port leans on both, and "Python's X" for a chardet symbol reads as a stdlib claim. Example:

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
