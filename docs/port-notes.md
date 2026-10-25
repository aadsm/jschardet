# Port Notes

Decisions made during porting that differ from the Python source, with rationale.

## Truncation-tolerant validity decoding

**Python:** `decodes_without_error` in `_utils.py` answers the validity question for `filter_by_validity`, `_validate_bytes` and `promote_markup_superset`. It decodes with an incremental decoder and `final=False`, so an incomplete multi-byte sequence at the end of the buffer is deferred instead of raising.

**TypeScript:** `decodesWithoutError` in `src/decode.ts` is the port, keyed by chardet name; single-byte encodings are answered from the byte tables, and the multi-byte encodings reach the same tail tolerance through `whatwgDecodesWithoutError` in `src/text-decoder.ts`, which decodes by WHATWG label with `{ stream: true }`. Every call site goes through the port; nothing outside `src/decode.ts` calls the WHATWG helper.

Why the tolerance matters: detection input is routinely a prefix of a larger whole. vscode reads the first 4096 or 65536 bytes of a file and hands over the slice, and chardet cuts its own `max_bytes` window regardless of what the caller passed. For a 2-byte encoding either cut lands mid-character about half the time, and a one-shot fatal decode cannot tell a truncated tail from corrupt data — a single dangling lead byte would eliminate **every** CJK encoding from the candidate list (GBK, Big5, Shift_JIS, EUC-JP, EUC-KR; UTF-8 is immune because its lead bytes encode the sequence length), leaving the answer to depend on input-length parity.

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

- **Streaming makes `TextDecoder` stateful, and `decoderForLabel` caches instances.** A deferred partial tail would otherwise be prepended to the next candidate's buffer, shifting every character pair — a silent corruption, since the decode still succeeds and just returns the wrong text. `whatwgDecodesWithoutError` flushes in a `finally` block; the flush throws on a pending tail, which is expected and resets the decoder either way. Python has no equivalent hazard — it constructs a fresh incremental decoder per call. A fresh `TextDecoder` per call would avoid the flush here too, but costs ~24% on small inputs, which is the size a prefix-detector sees most.
- **A decoder that substitutes instead of raising defeats the check entirely.** ICU maps some undefined bytes into the Private Use Area rather than treating them as errors, and `fatal: true` cannot see the difference — the decode simply succeeds. `big5` does this for `FF` (to `U+F8F8`) on every Node tested, so invalid Big5 keeps `big5hkscs` in the candidate list where Python's codec drops it: a 400-byte Big5 sample with two `FF` bytes spliced in still ranks Big5 first here at 0.42, while upstream eliminates it and falls through to noise. Measured cost is nil — Big5 is 29/29 on the corpus — but it is a divergence, not a design choice. Chromium rejects the same bytes, so this is a Node-only divergence and browser builds match upstream; `tests/jschardet.test.ts` pins it with a `skipIf(browser).fails` case, which will flip to "expected to fail, but passed" on the Node release that fixes it, the way 22 quietly fixed `gbk`. `windows-874` substitutes the same way (`U+F8C8`), but every single-byte encoding is answered from the authoritative byte tables (`src/decode.ts` over `pipeline/byte-decode.ts`) rather than TextDecoder, so that one is never reached. Rejecting PUA output is not the fix: 6217 of big5's 19720 decodable two-byte sequences legitimately map into the PUA, because HKSCS characters have no standard code points. A first-party lead/trail range check, in the shape of the byte tables' undefined positions, is what would close it.
- **Validity filtering is marginally weaker at detecting a lying charset declaration.** A body that is valid in the declared encoding except for a dangling final byte is not rejected. This only bites on inputs short enough to contain no other evidence; see the fixture note in `tests/markup.test.ts`.

Covered by `tests/truncated_input.test.ts` (port of Python's `test_truncated_input.py`, plus a TS-only regression test for the decoder-cache hazard above).

## Markup superset decode-safety promotion (not ported)

**Python:** `promote_markup_superset` promotes a markup result to its Windows superset *unconditionally* when the codec the reported name resolves to cannot decode the data but the superset can — a declared-Shift_JIS page using CP932 NEC/IBM extensions is reported as CP932, because Python callers who `.decode()` with the reported name `SHIFT_JIS` get plain `shift_jis`, which raises on those bytes. The structural-score comparison alone never catches this case (both scores tie at 1.0 for structurally clean data). The markup stage applies the same rule one step earlier: `_declared_encoding` reports the superset directly when the declared encoding cannot decode the window but the superset can (a declared EUC-KR page whose first CP949-only hangul sits past the header).

**TypeScript:** neither branch is ported; `_declaredEncoding` in `src/pipeline/markup.ts` keeps the declared encoding or drops it. WHATWG collapses each promotion pair onto a single decoder — its `shift_jis` *is* cp932 and its `euc-kr` *is* cp949 — so the reported codec decodes whenever the superset does and the trigger condition can never hold. The failure mode the branch guards against also cannot happen for `TextDecoder` callers: decoding CP932-extended bytes with the label `shift_jis` succeeds. Only the structural-score promotion path is ported.

Consequences: `compare-with-chardet.js` / `tests/compare-detect` flag a DIFF wherever Python promotes on decode-safety alone. Two corpus files do: `cp932-ja/y-moto.com.xml` and `cp932-ja/hardsoft.at.webry.info.xml` (SHIFT_JIS here, CP932 in Python), listed in `tests/accuracy.test.ts`'s divergent-failures because the accuracy gate reads the cp932 promotion through `isCorrect`'s superset set. On the `euc_kr`/`cp949` side a browser keeps a declared EUC-KR page as EUC-KR where Python answers CP949, which the accuracy gate's `prefer_superset: true` remaps to the same name; Node differs further, since its `euc-kr` decoder is not CP949 at all (see "Node's EUC decoders" below), and `cp949-ko/ricanet.com.xml` is the corpus file that shows it. Covered by the divergence tests in `tests/markup.test.ts` ("NEC-extension bytes do not promote", "a declared EUC-KR page with CP949-only hangul past the head stays EUC-KR"); Python's `test_promote_when_reported_codec_cannot_decode` is intentionally not ported (see `docs/missing-python-tests.md`).

## Escape-stage decode check (partly ported)

**Python:** `detect_escape_encoding` returns an ISO-2022 variant or HZ only when the whole window decodes under it, as it does for UTF-7: a designation is three bytes that ordinary text can contain, and a genuine stream can carry a bad byte past the header.

**TypeScript:** the check runs through `src/decode.ts` like every other decode question, so it is only as strong as the decoder behind each name:

- **UTF-7** is checked by the first-party `utf7DecodesWithoutError`, exactly as in Python.
- **ISO-2022-JP-2** decodes through WHATWG's `iso-2022-jp`, which reads plain ISO-2022-JP and rejects the JP-2 extras (`ESC $ ( D` for JIS X 0212, `ESC $ A`, `ESC . A`, ...) that CPython's `iso2022_jp_2` accepts. Checked as written, valid JP-2 streams using them would lose their answer, so the escape stage asks `iso2022Jp2DecodesWithoutError` instead: data containing any escape sequence other than the five `iso-2022-jp` accepts is treated as uncheckable and kept, and everything else gets the WHATWG verdict. `decodesWithoutError` itself stays keyed by encoding name alone.
- **HZ, ISO-2022-KR, ISO-2022-JP-EXT and ISO-2022-JP-2004** have no decoder at all, so `decodesWithoutError` keeps them and the stage answers on the designation, as it did before the check existed. Shifting their bytes into the GB18030 and EUC-KR decoders would catch most garbage but accepts rows CPython's narrow codecs reject, so it is not done.

Consequences: plain text that happens to contain an ISO-2022-KR designation, an HZ stream with a stray tilde, and a JIS X 0213:2000 (`ESC $ ( O`) stream still come back from the escape stage at 0.95 where Python falls through. Covered by the divergence tests in `tests/escape.test.ts` ("escape-stage decode check", "close marker before open, valid region follows"); the corresponding Python tests are listed in `docs/missing-python-tests.md`.

## Compat names for the narrower display codecs (not ported)

**Python:** `apply_compat_names` renames four internal names to display names that resolve to narrower Python codecs — `big5hkscs` → `Big5` (`big5`, no HKSCS), `euc_jis_2004` → `EUC-JP` and `shift_jis_2004` → `SHIFT_JIS` (no JIS X 0213), `iso2022_jp_2` → `ISO-2022-JP` (no JP-2 extras) — and keeps the internal name when the display codec cannot decode the window, so a Python caller never receives a name its own `.decode()` rejects.

**TypeScript:** not ported. Each internal name and its display name share one WHATWG decoder, so the check would always pass; the rename always applies, and the display name decodes the data for a `TextDecoder` caller (`TextDecoder('Big5')` reads HKSCS). Consequence: Big5 text with an HKSCS character comes back as `Big5` here and `big5hkscs` in Python, and the same holds for the JIS X 0213 cases WHATWG can decode. Covered by the divergence tests in `tests/api.test.ts` ("compat names for the narrower display codecs").

## Node's EUC decoders

Node's `TextDecoder` is backed by ICU converters that do not all match the WHATWG indexes. Two matter here, found by the whole-window markup validation:

- **`euc-kr` is plain EUC-KR, not CP949.** Of CP949's 17,048 two-byte sequences, 8,824 (the UHC extension hangul) come out wrong: one whose trail byte is 0x81 or above raises (`86 EB`, U+B17F), and one with an ASCII trail splits into a C1 character plus that ASCII byte (`81 41` → U+0081 `A`). WHATWG's `euc-kr` index is CP949, and Chromium decodes all three of those examples as CPython's `cp949` does. On Node a declared-EUC-KR page using CP949-only hangul loses its declaration, and validity filtering drops the CP949 candidate with it: `cp949-ko/ricanet.com.xml` comes back as GB18030 at 0.13 where Python and browsers answer CP949/EUC-KR at 0.95. Listed in `tests/accuracy.test.ts`'s divergent-failures.
- **`euc-jp` passes `0x80` through** as U+0080 where the WHATWG spec and CPython reject it, so a declared-EUC-JP page with a stray `0x80` keeps its declaration on Node. Pinned by the Node-only `.fails` cases in `tests/markup.test.ts`, which pass in browsers.

The fix in both cases is a first-party lead/trail check for the affected encodings, the same remedy as big5's `FF` above; until then both are Node-only divergences.

## Statistical-scoring rowmax pruning (not ported)

**Python:** statistical scoring can prune candidates with a per-model upper bound on the achievable score (`rowmax.bin`, `_score_pruned` in `pipeline/statistical.py`) — a pure performance fast path, guaranteed to return the same results as scoring every candidate. `full_ranking=True` bypasses it and scores everything.

**TypeScript:** the pruning machinery is not ported; the port always scores every candidate, matching the `full_ranking=True` path. Results are identical by construction, so there is no behavioural consequence — this is also why `scripts/generate-model-bins.js` converts four of upstream's five `.bin` files (`rowmax.bin` has no consumer here). Revisit if statistical-scoring cost ever becomes a problem; the pruning tests to bring along are listed in [missing-python-tests.md](missing-python-tests.md).

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

## Python warnings → console output

**Python:** chardet raises warnings through `warnings.warn`, and Python's default warnings filter (in the `warnings` stdlib module, so not implementation-specific) treats the categories differently: it **hides `DeprecationWarning`** outside `__main__` but **shows `UserWarning` and `RuntimeWarning`** — and a caller can retune any of it (`-W`, `PYTHONWARNINGS`, `filterwarnings`).

**TypeScript:** JS has no warnings filter — `console.warn` always prints, once per call, un-silenceable short of monkeypatching. So map each category to the JS behaviour that matches Python's *default*, not a blanket `console.warn`:

- `DeprecationWarning` → `warnDeprecated()` in `src/debug.ts`, gated behind `enableDebug()`. Silent by default like Python, opt-in through the same flag that turns on candidate logging — `enableDebug()` is the port's stand-in for the warnings filter. The condition stays at the call site; `warnDeprecated` owns only how the notice surfaces (the gate plus the `DEPRECATION:` prefix the suite filters on).
- `UserWarning` → `warnOnce()` in `src/debug.ts`: printed the first time each distinct message is raised, then suppressed, matching Python's default of showing a warning once per message and site. Without it, a caller detecting many files would see the warning on every call.
- `RuntimeWarning` → `console.warn` at the call site. chardet raises these only while loading model data, which happens once per process, so they need no de-duplication; a `RuntimeWarning` raised on a path that can repeat goes through `warnOnce()` instead.

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
