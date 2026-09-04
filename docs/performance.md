# jschardet performance

Benchmarked on 2026-09-04 against 3138 test files from the
[chardet test corpus](https://github.com/chardet/test-data).
Methodology mirrors
[chardet/docs/rewrite_performance.md](https://github.com/chardet/chardet/blob/main/docs/rewrite_performance.md):
each detector runs against the full corpus, equivalence rules
(directional supersets, bidirectional groups, decoded-output equivalence)
are applied identically across all detectors, and timing benchmarks take
the median across 5 runs.

Three detectors are compared:

- **jschardet 3.1.4** — the previous JavaScript port
- **jschardet 4.0.0** — this package, a TypeScript ground-up port of chardet 7
- **chardet 7.6.0** — upstream Python, run via PYTHONPATH against the
  `chardet/` submodule

Reproduce locally:

```bash
npm run benchmark:accuracy
npm run benchmark:throughput
npm run benchmark:coldstart
npm run benchmark:memory
```

## Overall accuracy

| Detector        | Correct   | Accuracy |
|-----------------|-----------|----------|
| jschardet 3.1.4 | 1352/3138 | 43.1%    |
| jschardet 4.0.0 | 3120/3138 | 99.4%    |
| chardet 7.6.0   | 3122/3138 | 99.5%    |

jschardet 4 lifts accuracy by 56.3pp over jschardet 3 — the underlying
chardet rewrite ships new bigram models, EBCDIC/DOS/Mac coverage, and
magic-number plus markup-charset pipelines that v3 lacked. It trails
upstream by two files (two cp932 samples, see the per-encoding table
below); every other encoding matches chardet exactly.

## Language detection accuracy

| Detector        | Correct   | Accuracy |
|-----------------|-----------|----------|
| jschardet 3.1.4 | n/a       | n/a      |
| jschardet 4.0.0 | 2922/3130 | 93.4%    |
| chardet 7.6.0   | 2922/3130 | 93.4%    |

jschardet 3 does not return a `language` field. The 208 wrong-language
cases under jschardet 4 are primarily confusable language pairs within
the same script (Danish/Norwegian, Belarusian/Bulgarian for Cyrillic,
etc.).

## Throughput

Per-file detection latency over the full corpus, median of 5 in-process
runs with per-file times aggregated element-wise. Chardet's upstream
`_run_timing_with_median` isolates each pass in its own subprocess; we
don't, to keep runtime reasonable.

| Detector        | Files/s | Mean    | Median  | p90      | p95      |
|-----------------|---------|---------|---------|----------|----------|
| jschardet 3.1.4 |     126 | 7.91 ms | 0.76 ms |  9.00 ms | 18.00 ms |
| jschardet 4.0.0 |     780 | 1.28 ms | 0.43 ms |  2.43 ms |  3.69 ms |
| chardet 7.6.0   |     222 | 4.51 ms | 1.85 ms | 10.91 ms | 15.76 ms |

jschardet 4 processes about 6× more files per second than jschardet 3
on this corpus, and the tail latency narrows too — p95 drops from
18.00 ms to 3.69 ms.

This port does not implement upstream's rowmax scoring pruning (see
[port-notes.md](port-notes.md#statistical-scoring-rowmax-pruning-not-ported));
it always scores every candidate, matching chardet's `full_ranking=True`
path. Probed separately against this corpus pin, that fast path is worth
single-digit percent here rather than the multiple upstream's "~2.9x with
mypyc" changelog entry suggests: pruning skips 22% of model scorings
(263k vs 337k across the corpus), statistical scoring accounts for only
~21% of this port's detection time, and chardet's own pruned and unpruned
paths measure within ~4% of each other when run interpreted. Making
single-byte scoring entirely free — a ceiling no real pruning reaches —
lifts a probe build by ~30%.

## Cold start

Import time and first `detect()` call latency in a fresh subprocess
(median of 5 runs). Each measurement is isolated to avoid module-cache
effects.

| Detector        | Import   | First detect | Total     |
|-----------------|----------|--------------|-----------|
| jschardet 3.1.4 | 29.23 ms |      0.68 ms |  29.91 ms |
| jschardet 4.0.0 | 44.74 ms |     64.46 ms | 109.20 ms |
| chardet 7.6.0   | 36.31 ms |     65.44 ms | 101.74 ms |

jschardet 4 trades a heavier first-call cost for a lighter steady state:
the bigram models ship zlib-compressed and decompress lazily on the first
`detect()` call (see [docs/model-compression.md](model-compression.md)),
so cold-start latency is ~4× higher than jschardet 3 but every
subsequent call is faster (see throughput above). jschardet 3 has no
models to decompress, which is why its first detect is essentially free.

## Memory

Peak resident-set-size (RSS high-water mark since process start, via
`getrusage(RUSAGE_SELF).ru_maxrss` — `process.resourceUsage().maxRSS`
in Node, `resource.getrusage().ru_maxrss` in Python) sampled in a fresh
subprocess at three points: before the detector is imported, after
import, and after `detect()` has been called on every file in the
corpus (median of 5 runs). Peak RSS is the apples-to-apples
cross-language metric — V8 has no `tracemalloc` equivalent, and reading
the same syscall on both sides keeps the numbers comparable.

| Detector        | Baseline RSS | Import delta | Peak delta | Final RSS |
|-----------------|--------------|--------------|------------|-----------|
| jschardet 3.1.4 | 138.5 MiB    | 668.0 KiB    | 831.8 MiB  | 970.2 MiB |
| jschardet 4.0.0 | 138.2 MiB    | 6.0 MiB      | 85.5 MiB   | 223.6 MiB |
| chardet 7.6.0   |  89.2 MiB    | 8.6 MiB      | 37.6 MiB   | 126.9 MiB |

jschardet 4's peak RSS is ~10× lower than jschardet 3 (85.5 MiB vs
831.8 MiB of growth above baseline). The chardet rewrite's dense bigram
model format (one 64 KiB lookup table per language, loaded once and
shared across calls) replaces the per-call sparse-map allocations that
drive v3's high water mark.

The baseline gap between Node (~138 MiB) and Python (~89 MiB) is the
interpreter's own resident footprint plus the corpus bytes — both
workers pre-load the full corpus into memory before measuring baseline,
so the corpus shows up there rather than under the detector.

## Per-encoding accuracy

| Encoding         |   N | jschardet 3.1.4  | jschardet 4.0.0  | chardet 7.6.0    |
|------------------|-----|------------------|------------------|------------------|
| (binary)         |   8 | 7/8 (87.5%)      | 8/8 (100.0%)     | 8/8 (100.0%)     |
| ascii            |  32 | 31/32 (96.9%)    | 32/32 (100.0%)   | 32/32 (100.0%)   |
| big5             |  29 | 29/29 (100.0%)   | 29/29 (100.0%)   | 29/29 (100.0%)   |
| cp037            |  34 | 0/34 (0.0%)      | 28/34 (82.4%)    | 28/34 (82.4%)    |
| cp1006           |   3 | 0/3 (0.0%)       | 3/3 (100.0%)     | 3/3 (100.0%)     |
| cp1026           |   8 | 0/8 (0.0%)       | 8/8 (100.0%)     | 8/8 (100.0%)     |
| cp1125           |   5 | 0/5 (0.0%)       | 5/5 (100.0%)     | 5/5 (100.0%)     |
| cp273            |   7 | 0/7 (0.0%)       | 7/7 (100.0%)     | 7/7 (100.0%)     |
| cp424            |   9 | 0/9 (0.0%)       | 9/9 (100.0%)     | 9/9 (100.0%)     |
| cp437            |  33 | 0/33 (0.0%)      | 32/33 (97.0%)    | 32/33 (97.0%)    |
| cp500            |  29 | 0/29 (0.0%)      | 28/29 (96.6%)    | 28/29 (96.6%)    |
| cp720            |  10 | 0/10 (0.0%)      | 10/10 (100.0%)   | 10/10 (100.0%)   |
| cp737            |   3 | 0/3 (0.0%)       | 3/3 (100.0%)     | 3/3 (100.0%)     |
| cp775            |  12 | 0/12 (0.0%)      | 12/12 (100.0%)   | 12/12 (100.0%)   |
| cp850            |  45 | 0/45 (0.0%)      | 42/45 (93.3%)    | 42/45 (93.3%)    |
| cp852            |  26 | 0/26 (0.0%)      | 26/26 (100.0%)   | 26/26 (100.0%)   |
| cp855            |  39 | 39/39 (100.0%)   | 39/39 (100.0%)   | 39/39 (100.0%)   |
| cp856            |   8 | 0/8 (0.0%)       | 8/8 (100.0%)     | 8/8 (100.0%)     |
| cp857            |   6 | 0/6 (0.0%)       | 6/6 (100.0%)     | 6/6 (100.0%)     |
| cp858            |  35 | 0/35 (0.0%)      | 33/35 (94.3%)    | 33/35 (94.3%)    |
| cp860            |   6 | 0/6 (0.0%)       | 6/6 (100.0%)     | 6/6 (100.0%)     |
| cp861            |   5 | 0/5 (0.0%)       | 5/5 (100.0%)     | 5/5 (100.0%)     |
| cp862            |   7 | 0/7 (0.0%)       | 7/7 (100.0%)     | 7/7 (100.0%)     |
| cp863            |   5 | 0/5 (0.0%)       | 5/5 (100.0%)     | 5/5 (100.0%)     |
| cp864            |   2 | 0/2 (0.0%)       | 2/2 (100.0%)     | 2/2 (100.0%)     |
| cp865            |   6 | 0/6 (0.0%)       | 6/6 (100.0%)     | 6/6 (100.0%)     |
| cp866            |  37 | 37/37 (100.0%)   | 37/37 (100.0%)   | 37/37 (100.0%)   |
| cp869            |   6 | 0/6 (0.0%)       | 6/6 (100.0%)     | 6/6 (100.0%)     |
| cp874            |   8 | 5/8 (62.5%)      | 6/8 (75.0%)      | 6/8 (75.0%)      |
| cp875            |   8 | 0/8 (0.0%)       | 8/8 (100.0%)     | 8/8 (100.0%)     |
| cp932            |   9 | 0/9 (0.0%)       | 7/9 (77.8%)      | 9/9 (100.0%)     |
| cp949            |   8 | 7/8 (87.5%)      | 8/8 (100.0%)     | 8/8 (100.0%)     |
| euc-jp           |  32 | 32/32 (100.0%)   | 32/32 (100.0%)   | 32/32 (100.0%)   |
| euc-kr           |  37 | 37/37 (100.0%)   | 37/37 (100.0%)   | 37/37 (100.0%)   |
| gb18030          |   9 | 9/9 (100.0%)     | 9/9 (100.0%)     | 9/9 (100.0%)     |
| gb2312           |  25 | 25/25 (100.0%)   | 25/25 (100.0%)   | 25/25 (100.0%)   |
| hp-roman8        |  44 | 12/44 (27.3%)    | 44/44 (100.0%)   | 44/44 (100.0%)   |
| hz-gb-2312       |   8 | 8/8 (100.0%)     | 8/8 (100.0%)     | 8/8 (100.0%)     |
| iso-2022-jp      |   8 | 8/8 (100.0%)     | 8/8 (100.0%)     | 8/8 (100.0%)     |
| iso-2022-jp-2004 |   6 | 6/6 (100.0%)     | 6/6 (100.0%)     | 6/6 (100.0%)     |
| iso-2022-jp-ext  |   4 | 4/4 (100.0%)     | 4/4 (100.0%)     | 4/4 (100.0%)     |
| iso-2022-kr      |   8 | 8/8 (100.0%)     | 8/8 (100.0%)     | 8/8 (100.0%)     |
| iso-8859-1       |  75 | 46/75 (61.3%)    | 75/75 (100.0%)   | 75/75 (100.0%)   |
| iso-8859-10      |   8 | 5/8 (62.5%)      | 8/8 (100.0%)     | 8/8 (100.0%)     |
| iso-8859-11      |   3 | 3/3 (100.0%)     | 3/3 (100.0%)     | 3/3 (100.0%)     |
| iso-8859-13      |  16 | 1/16 (6.3%)      | 16/16 (100.0%)   | 16/16 (100.0%)   |
| iso-8859-14      |  19 | 14/19 (73.7%)    | 19/19 (100.0%)   | 19/19 (100.0%)   |
| iso-8859-15      |  42 | 26/42 (61.9%)    | 41/42 (97.6%)    | 41/42 (97.6%)    |
| iso-8859-16      |  22 | 0/22 (0.0%)      | 22/22 (100.0%)   | 22/22 (100.0%)   |
| iso-8859-2       |  71 | 18/71 (25.4%)    | 71/71 (100.0%)   | 71/71 (100.0%)   |
| iso-8859-3       |  13 | 0/13 (0.0%)      | 13/13 (100.0%)   | 13/13 (100.0%)   |
| iso-8859-4       |  15 | 4/15 (26.7%)     | 15/15 (100.0%)   | 15/15 (100.0%)   |
| iso-8859-5       |  51 | 51/51 (100.0%)   | 51/51 (100.0%)   | 51/51 (100.0%)   |
| iso-8859-6       |  15 | 0/15 (0.0%)      | 15/15 (100.0%)   | 15/15 (100.0%)   |
| iso-8859-7       |  17 | 10/17 (58.8%)    | 17/17 (100.0%)   | 17/17 (100.0%)   |
| iso-8859-8       |  21 | 21/21 (100.0%)   | 21/21 (100.0%)   | 21/21 (100.0%)   |
| iso-8859-9       |  45 | 0/45 (0.0%)      | 45/45 (100.0%)   | 45/45 (100.0%)   |
| johab            |  10 | 0/10 (0.0%)      | 10/10 (100.0%)   | 10/10 (100.0%)   |
| koi8-r           |  25 | 25/25 (100.0%)   | 25/25 (100.0%)   | 25/25 (100.0%)   |
| koi8-t           |   3 | 0/3 (0.0%)       | 3/3 (100.0%)     | 3/3 (100.0%)     |
| koi8-u           |  11 | 0/11 (0.0%)      | 11/11 (100.0%)   | 11/11 (100.0%)   |
| kz1048           |   6 | 0/6 (0.0%)       | 6/6 (100.0%)     | 6/6 (100.0%)     |
| maccyrillic      |  38 | 34/38 (89.5%)    | 38/38 (100.0%)   | 38/38 (100.0%)   |
| macgreek         |   5 | 0/5 (0.0%)       | 5/5 (100.0%)     | 5/5 (100.0%)     |
| maciceland       |   5 | 0/5 (0.0%)       | 5/5 (100.0%)     | 5/5 (100.0%)     |
| maclatin2        |  23 | 0/23 (0.0%)      | 23/23 (100.0%)   | 23/23 (100.0%)   |
| macroman         |  46 | 0/46 (0.0%)      | 46/46 (100.0%)   | 46/46 (100.0%)   |
| macturkish       |   5 | 0/5 (0.0%)       | 5/5 (100.0%)     | 5/5 (100.0%)     |
| ptcp154          |   6 | 0/6 (0.0%)       | 6/6 (100.0%)     | 6/6 (100.0%)     |
| shift-jis        |   3 | 3/3 (100.0%)     | 3/3 (100.0%)     | 3/3 (100.0%)     |
| shift_jis        |  34 | 34/34 (100.0%)   | 34/34 (100.0%)   | 34/34 (100.0%)   |
| tis-620          |   8 | 8/8 (100.0%)     | 8/8 (100.0%)     | 8/8 (100.0%)     |
| utf-16           | 220 | 220/220 (100.0%) | 220/220 (100.0%) | 220/220 (100.0%) |
| utf-16be         | 153 | 0/153 (0.0%)     | 153/153 (100.0%) | 153/153 (100.0%) |
| utf-16le         | 154 | 0/154 (0.0%)     | 154/154 (100.0%) | 154/154 (100.0%) |
| utf-32           | 154 | 154/154 (100.0%) | 154/154 (100.0%) | 154/154 (100.0%) |
| utf-32be         | 153 | 0/153 (0.0%)     | 153/153 (100.0%) | 153/153 (100.0%) |
| utf-32le         | 153 | 0/153 (0.0%)     | 153/153 (100.0%) | 153/153 (100.0%) |
| utf-7            | 149 | 0/149 (0.0%)     | 149/149 (100.0%) | 149/149 (100.0%) |
| utf-8            | 268 | 268/268 (100.0%) | 268/268 (100.0%) | 268/268 (100.0%) |
| utf-8-sig        | 151 | 0/151 (0.0%)     | 151/151 (100.0%) | 151/151 (100.0%) |
| windows-1250     |  44 | 3/44 (6.8%)      | 44/44 (100.0%)   | 44/44 (100.0%)   |
| windows-1251     |  63 | 59/63 (93.7%)    | 63/63 (100.0%)   | 63/63 (100.0%)   |
| windows-1252     |  44 | 28/44 (63.6%)    | 44/44 (100.0%)   | 44/44 (100.0%)   |
| windows-1253     |   8 | 3/8 (37.5%)      | 8/8 (100.0%)     | 8/8 (100.0%)     |
| windows-1254     |   9 | 0/9 (0.0%)       | 9/9 (100.0%)     | 9/9 (100.0%)     |
| windows-1255     |   7 | 7/7 (100.0%)     | 7/7 (100.0%)     | 7/7 (100.0%)     |
| windows-1256     |  46 | 0/46 (0.0%)      | 46/46 (100.0%)   | 46/46 (100.0%)   |
| windows-1257     |  18 | 1/18 (5.6%)      | 18/18 (100.0%)   | 18/18 (100.0%)   |
| windows-1258     |  14 | 2/14 (14.3%)     | 14/14 (100.0%)   | 14/14 (100.0%)   |

The full list of known per-file failures is tracked in
`tests/accuracy.test.ts`.

## Methodology notes

- **Correctness rule** — exact match, alias, directional superset (e.g.
  `windows-1252` accepted when `iso-8859-1` was expected), bidirectional
  pair (UTF-16/32 endian variants), or decoded-output equivalence
  (NFKD-normalized text matches under both encodings). Same rule used by
  `tests/accuracy.test.ts` and chardet's own benchmark pipeline.
- **Raw counts** — no `KNOWN_FAILURES` allow-list is applied. This
  matches chardet's `rewrite_performance.md` methodology so the two
  documents can be read side by side.
- **Median of 5 runs** — applied to throughput, cold start, and memory.
  For throughput, the median is taken element-wise across per-file times
  (each file's median is taken across the 5 passes, then the standard
  mean/median/p90/p95 are computed over those medians).
- **Per-detector isolation** — chardet 7 runs in a Python subprocess via
  `tests/benchmark/lib/*-worker-chardet7.py`. For cold start and memory,
  every measurement is in a fresh subprocess to avoid module-cache or
  RSS-high-water-mark contamination.

## Hardware

```
Node v22.22.2 on linux/x64
CPU: Intel(R) Xeon(R) Processor @ 2.80GHz (4 cores)
RAM: 15.7 GiB
```
