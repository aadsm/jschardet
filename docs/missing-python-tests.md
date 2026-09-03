# Missing Python Tests

Python tests from the chardet test suite that are not part of the TS port. Tests that are not applicable to the TS port (Python-specific build scripts, thread-safety, stdlib quirk documentation) are included for completeness.

---

## Not applicable

| Python file | Reason |
|---|---|
| `test_benchmark.py` | Performance benchmarks only |
| `test_thread_safety.py` | JS/TS is single-threaded |
| `test_python_stdlib_limitations.py` | Documents CPython codec quirks (BOM stripping behaviour) — not chardet behaviour |
| `test_utils.py` | Tests chardet's own Python `update-chardet` build script, not the detection library |
| `test_substitutions.py` | Tests `scripts/substitutions.py`, a Python-only preprocessing utility not present in the TS port |
| `test_kernel_pxd.py` | Guards the Cython scoring kernel's `.pxd` declarations against its `.py`; the port has no compiled kernel (bit-identical perf path only taken by CPython wheels) |
| `test_utf8_equivalence.py`, `utf8_oracle.py` | A differential suite pinning CPython's strict UTF-8 decoder against the old hand-rolled loop. The port's `scanUtf8` never left that loop, so there are not two implementations to pin — see "UTF-8 validation mechanism" in [port-notes.md](port-notes.md) |

## Individual tests not ported

### `test_markup.py::test_promote_when_reported_codec_cannot_decode`

Asserts that declared-Shift_JIS data carrying a CP932 NEC extension (`0x87 0x40`) is promoted to `cp932` because the codec the reported name resolves to (plain `shift_jis`) cannot decode it.

The decode-safety promotion branch this exercises is not ported — see "Markup superset decode-safety promotion" in [port-notes.md](port-notes.md) for why it cannot fire under WHATWG decoders. The port's behaviour on the same bytes is pinned by the divergence test in `tests/markup.test.ts`.

### `test_models.py` / `test_statistical.py` — rowmax pruning tests

The rowmax pruning machinery is not ported — see "Statistical-scoring rowmax pruning" in [port-notes.md](port-notes.md) — so its tests (rowmax loading and staleness rejection, `_decompress_tables` hardening, pruned-vs-full equivalence) have nothing to attach to. If the pruning is ever ported for speed, port these tests with it.

### `test_confusion.py::test_resolve_confusion_groups_passes_both_languages_to_the_rescore`

Monkeypatches `resolve_by_bigram_rescore` as a module global to spy on the
languages `resolve_confusion_groups` passes it. The port calls the rescore
directly (no `_internal`-style seam in `confusion.ts`), and ES module
exports cannot be patched, so the spy has no seam to attach to — the same
reason upstream skips this test on its compiled (mypyc) builds, where the
call is resolved at compile time. The behaviour it guards is covered end to
end by `tests/confusion.test.ts`'s "promotes on the restricted rescore"
(promotion only happens when both languages reach the rescore) and by the
accuracy corpus (`iso-8859-16-hu/culturax_OSCAR-2019_82421`).

### `test_confusion.py` / `test_orchestrator.py` — compiled-build guards

The `_needs_interpreted_build` skip markers added upstream (the
rescore-plumbing spy, `test_resolve_confusion_groups_no_swap_when_winner_is_top`,
and the two orchestrator fallback mocks) exist because mypyc resolves
intra-module calls at compile time, making mocks silently inert. The port
has no compiled build, so the markers themselves have nothing to guard;
the orchestrator fallback tests are ported through the `_internal` spy
seam in `orchestrator.ts`.

### `test_evaluation.py` — `is_exact_match` tests

`is_exact_match` is a strict-scoring predicate used only by chardet's accuracy-reporting harness (`compare_detectors.py`), not by detection. The port's evaluation helpers in `src/evaluation.ts` / `tests/utils.ts` don't include it.

### `test_internal_utils.py` — `count_deleted` and chunked-decode tests

`count_deleted` is a CPython allocation optimisation around `bytes.translate`
(chunking a deletion count so a large window never spikes memory). The port's
`detectAscii` / `isBinary` / escape validators already count in one allocation-free
pass, so there is no `count_deleted` helper to test. Its two tests, and the
chunked-decode straddle tests for `decodes_without_error` (the port's
`TextDecoder`-based check is not chunked — `{ stream: true }` carries decoder
state natively), have nothing to attach to. The unknown-codec cases map to
`whatwgLabelFor` returning `null`, covered in `tests/text-decoder.test.ts`.

### `test_models.py` — write side and zlib-stream parser (`_format`)

`chardet/models/_format.py` owns both directions of the model-artifacts format;
the port mirrors only the read side (`parseModelsBin`) in `src/models/_format.ts`.
The write side (`write_model_artifacts`, `read_models`, `_idf_table`) exists for
the trainer, which the port does not have, so its round-trip tests
(`test_roundtrip_*`, `test_read_models_*`, `test_serialize_*`) are not ported.
The zlib-stream hardening tests (`_decompress_tables` edge cases,
`test_read_models_ignores_post_stream_bytes`) test a decompression step the port
does not run: the `.bin.js` wrapper inflates the payload before `parseModelsBin`
sees it (see `docs/model-compression.md`). The port's equivalent gate is
`generate-model-bins.js --verify`.

### `test_confusion.py::test_letter_case_table_skips_zero_char_decodes`

Asserts that `_letter_case_table` classifies a byte that decodes to no character
(utf-7's `+`, which opens a base64 run) as a non-letter. In the port the case
tables are precomputed at build time by `scripts/generate-byte-tables.js` running
chardet's own `_letter_case_table` over the pinned submodule, so the zero-char
branch runs in the generator, not at runtime — there is no runtime code path for
this test to exercise.

### `test_confusion.py::test_confusion_pair_winner_cross_family_requires_corroboration`

Patches `load_confusion_data` as a module global to inject a synthetic
cross-family pair with controlled categories. ES module exports cannot be
patched, so the spy has no seam to attach to (the same reason upstream skips it
on compiled builds). The cross-family corroboration rule it exercises is covered
end to end by `tests/confusion.test.ts`'s "strict-tier corroborated" case and by
the accuracy corpus.

### `test_equivalences.py` — the deprecated-submodule shim

`chardet.equivalences` is a Python `__getattr__`/module-proxy shim that re-exports
the split `output_names` module with per-name deprecation warnings and supports
`mock.patch.object` delete round-trips. The port's `src/equivalences.ts` is a
plain silent re-export — ESM has no attribute-proxy idiom and no per-access
warning hook — so the shim's warning, `dir()`, rebinding, and delete-proxying
tests (14 in total) have no analogue. `tests/equivalences.test.ts` pins the one
thing that matters to the port: the re-exports are the same functions as
`output_names`.
