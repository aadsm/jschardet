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
