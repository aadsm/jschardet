# jschardet performance

Benchmarked on 2026-05-26 against 2517 test files from the
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
- **chardet 7.4.3** — upstream Python, run via PYTHONPATH against the
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
| jschardet 3.1.4 | 1057/2517 | 42.0%    |
| jschardet 4.0.0 | 2496/2517 | 99.2%    |
| chardet 7.4.3   | 2496/2517 | 99.2%    |

jschardet 4 lifts accuracy by 57.2pp over jschardet 3 — the underlying
chardet rewrite ships new bigram models, EBCDIC/DOS/Mac coverage, and
magic-number plus markup-charset pipelines that v3 lacked.

## Language detection accuracy

| Detector        | Correct   | Accuracy |
|-----------------|-----------|----------|
| jschardet 3.1.4 | n/a       | n/a      |
| jschardet 4.0.0 | 2445/2509 | 97.4%    |
| chardet 7.4.3   | 2445/2509 | 97.4%    |

jschardet 3 does not return a `language` field. The 64 wrong-language
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
| jschardet 3.1.4 |     154 | 6.51 ms | 0.59 ms |  3.58 ms |  6.17 ms |
| jschardet 4.0.0 |     945 | 1.06 ms | 0.28 ms |  2.26 ms |  3.31 ms |
| chardet 7.4.3   |     187 | 5.36 ms | 1.89 ms | 12.77 ms | 16.22 ms |

jschardet 4 processes about 6× more files per second than jschardet 3
on this corpus, and the tail latency narrows too — p95 drops from
6.17 ms to 3.31 ms.

## Cold start

Import time and first `detect()` call latency in a fresh subprocess
(median of 5 runs). Each measurement is isolated to avoid module-cache
effects.

| Detector        | Import   | First detect | Total    |
|-----------------|----------|--------------|----------|
| jschardet 3.1.4 | 25.14 ms |      0.59 ms | 25.73 ms |
| jschardet 4.0.0 | 34.76 ms |     45.51 ms | 80.27 ms |
| chardet 7.4.3   | 29.81 ms |     65.08 ms | 94.90 ms |

jschardet 4 trades a heavier first-call cost for a lighter steady state:
the bigram models ship zlib-compressed and decompress lazily on the first
`detect()` call (see [docs/model-compression.md](model-compression.md)),
so cold-start latency is ~3× higher than jschardet 3 but every
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
| jschardet 3.1.4 | 106.7 MiB    | 2.2 MiB      | 751.4 MiB  | 858.1 MiB |
| jschardet 4.0.0 | 106.6 MiB    | 7.1 MiB      | 84.5 MiB   | 191.1 MiB |
| chardet 7.4.3   |  59.5 MiB    | 4.5 MiB      | 50.7 MiB   | 110.2 MiB |

jschardet 4's peak RSS is ~9× lower than jschardet 3 (84.5 MiB vs
751.4 MiB of growth above baseline). The chardet rewrite's dense bigram
model format (one 64 KiB lookup table per language, loaded once and
shared across calls) replaces the per-call sparse-map allocations that
drive v3's high water mark.

The baseline gap between Node (~107 MiB) and Python (~60 MiB) is the
interpreter's own resident footprint plus the corpus bytes — both
workers pre-load the full corpus into memory before measuring baseline,
so the corpus shows up there rather than under the detector.

## Per-encoding accuracy

| Encoding         | N   | jschardet 3.1.4  | jschardet 4.0.0  | chardet 7.4.3    |
|------------------|-----|------------------|------------------|------------------|
| (binary)         |   8 | 7/8 (87.5%)      | 8/8 (100.0%)     | 8/8 (100.0%)     |
| ascii            |  18 | 17/18 (94.4%)    | 18/18 (100.0%)   | 18/18 (100.0%)   |
| big5             |  29 | 29/29 (100.0%)   | 29/29 (100.0%)   | 29/29 (100.0%)   |
| cp037            |  28 | 0/28 (0.0%)      | 28/28 (100.0%)   | 28/28 (100.0%)   |
| cp1006           |   3 | 0/3 (0.0%)       | 3/3 (100.0%)     | 3/3 (100.0%)     |
| cp1026           |   3 | 0/3 (0.0%)       | 3/3 (100.0%)     | 3/3 (100.0%)     |
| cp1125           |   3 | 0/3 (0.0%)       | 3/3 (100.0%)     | 3/3 (100.0%)     |
| cp273            |   3 | 0/3 (0.0%)       | 3/3 (100.0%)     | 3/3 (100.0%)     |
| cp424            |   4 | 0/4 (0.0%)       | 4/4 (100.0%)     | 4/4 (100.0%)     |
| cp437            |  27 | 0/27 (0.0%)      | 26/27 (96.3%)    | 26/27 (96.3%)    |
| cp500            |  24 | 0/24 (0.0%)      | 23/24 (95.8%)    | 23/24 (95.8%)    |
| cp720            |   6 | 0/6 (0.0%)       | 6/6 (100.0%)     | 6/6 (100.0%)     |
| cp737            |   1 | 0/1 (0.0%)       | 1/1 (100.0%)     | 1/1 (100.0%)     |
| cp775            |  10 | 0/10 (0.0%)      | 10/10 (100.0%)   | 10/10 (100.0%)   |
| cp850            |  37 | 0/37 (0.0%)      | 34/37 (91.9%)    | 34/37 (91.9%)    |
| cp852            |  24 | 0/24 (0.0%)      | 24/24 (100.0%)   | 24/24 (100.0%)   |
| cp855            |  39 | 39/39 (100.0%)   | 39/39 (100.0%)   | 39/39 (100.0%)   |
| cp856            |   3 | 0/3 (0.0%)       | 3/3 (100.0%)     | 3/3 (100.0%)     |
| cp857            |   4 | 0/4 (0.0%)       | 4/4 (100.0%)     | 4/4 (100.0%)     |
| cp858            |  33 | 0/33 (0.0%)      | 31/33 (93.9%)    | 31/33 (93.9%)    |
| cp860            |   3 | 0/3 (0.0%)       | 3/3 (100.0%)     | 3/3 (100.0%)     |
| cp861            |   3 | 0/3 (0.0%)       | 3/3 (100.0%)     | 3/3 (100.0%)     |
| cp862            |   3 | 0/3 (0.0%)       | 3/3 (100.0%)     | 3/3 (100.0%)     |
| cp863            |   3 | 0/3 (0.0%)       | 3/3 (100.0%)     | 3/3 (100.0%)     |
| cp864            |   1 | 0/1 (0.0%)       | 1/1 (100.0%)     | 1/1 (100.0%)     |
| cp865            |   4 | 0/4 (0.0%)       | 4/4 (100.0%)     | 4/4 (100.0%)     |
| cp866            |  37 | 37/37 (100.0%)   | 37/37 (100.0%)   | 37/37 (100.0%)   |
| cp869            |   4 | 0/4 (0.0%)       | 4/4 (100.0%)     | 4/4 (100.0%)     |
| cp874            |   2 | 0/2 (0.0%)       | 0/2 (0.0%)       | 0/2 (0.0%)       |
| cp875            |   3 | 0/3 (0.0%)       | 3/3 (100.0%)     | 3/3 (100.0%)     |
| cp932            |   5 | 0/5 (0.0%)       | 4/5 (80.0%)      | 4/5 (80.0%)      |
| cp949            |   1 | 0/1 (0.0%)       | 1/1 (100.0%)     | 1/1 (100.0%)     |
| euc-jp           |  32 | 32/32 (100.0%)   | 32/32 (100.0%)   | 32/32 (100.0%)   |
| euc-kr           |  33 | 33/33 (100.0%)   | 33/33 (100.0%)   | 33/33 (100.0%)   |
| gb18030          |   4 | 4/4 (100.0%)     | 4/4 (100.0%)     | 4/4 (100.0%)     |
| gb2312           |  24 | 24/24 (100.0%)   | 23/24 (95.8%)    | 23/24 (95.8%)    |
| hp-roman8        |  42 | 12/42 (28.6%)    | 42/42 (100.0%)   | 42/42 (100.0%)   |
| hz-gb-2312       |   2 | 2/2 (100.0%)     | 2/2 (100.0%)     | 2/2 (100.0%)     |
| iso-2022-jp      |   3 | 3/3 (100.0%)     | 3/3 (100.0%)     | 3/3 (100.0%)     |
| iso-2022-jp-2004 |   3 | 3/3 (100.0%)     | 3/3 (100.0%)     | 3/3 (100.0%)     |
| iso-2022-jp-ext  |   1 | 1/1 (100.0%)     | 1/1 (100.0%)     | 1/1 (100.0%)     |
| iso-2022-kr      |   5 | 5/5 (100.0%)     | 5/5 (100.0%)     | 5/5 (100.0%)     |
| iso-8859-1       |  34 | 22/34 (64.7%)    | 34/34 (100.0%)   | 34/34 (100.0%)   |
| iso-8859-10      |   6 | 3/6 (50.0%)      | 6/6 (100.0%)     | 6/6 (100.0%)     |
| iso-8859-13      |  11 | 1/11 (9.1%)      | 11/11 (100.0%)   | 11/11 (100.0%)   |
| iso-8859-14      |  10 | 7/10 (70.0%)     | 10/10 (100.0%)   | 10/10 (100.0%)   |
| iso-8859-15      |  30 | 18/30 (60.0%)    | 29/30 (96.7%)    | 29/30 (96.7%)    |
| iso-8859-16      |  18 | 0/18 (0.0%)      | 16/18 (88.9%)    | 16/18 (88.9%)    |
| iso-8859-2       |  46 | 15/46 (32.6%)    | 46/46 (100.0%)   | 46/46 (100.0%)   |
| iso-8859-3       |  11 | 0/11 (0.0%)      | 11/11 (100.0%)   | 11/11 (100.0%)   |
| iso-8859-4       |   7 | 0/7 (0.0%)       | 7/7 (100.0%)     | 7/7 (100.0%)     |
| iso-8859-5       |  51 | 51/51 (100.0%)   | 51/51 (100.0%)   | 51/51 (100.0%)   |
| iso-8859-6       |   9 | 0/9 (0.0%)       | 9/9 (100.0%)     | 9/9 (100.0%)     |
| iso-8859-7       |  17 | 10/17 (58.8%)    | 17/17 (100.0%)   | 17/17 (100.0%)   |
| iso-8859-8       |  21 | 21/21 (100.0%)   | 21/21 (100.0%)   | 21/21 (100.0%)   |
| iso-8859-9       |  10 | 0/10 (0.0%)      | 10/10 (100.0%)   | 10/10 (100.0%)   |
| johab            |   7 | 0/7 (0.0%)       | 7/7 (100.0%)     | 7/7 (100.0%)     |
| koi8-r           |  25 | 25/25 (100.0%)   | 25/25 (100.0%)   | 25/25 (100.0%)   |
| koi8-t           |   3 | 0/3 (0.0%)       | 3/3 (100.0%)     | 3/3 (100.0%)     |
| koi8-u           |   3 | 0/3 (0.0%)       | 3/3 (100.0%)     | 3/3 (100.0%)     |
| kz1048           |   4 | 0/4 (0.0%)       | 4/4 (100.0%)     | 4/4 (100.0%)     |
| maccyrillic      |  38 | 34/38 (89.5%)    | 38/38 (100.0%)   | 38/38 (100.0%)   |
| macgreek         |   3 | 0/3 (0.0%)       | 3/3 (100.0%)     | 3/3 (100.0%)     |
| maciceland       |   3 | 0/3 (0.0%)       | 3/3 (100.0%)     | 3/3 (100.0%)     |
| maclatin2        |  21 | 0/21 (0.0%)      | 21/21 (100.0%)   | 21/21 (100.0%)   |
| macroman         |  41 | 0/41 (0.0%)      | 39/41 (95.1%)    | 39/41 (95.1%)    |
| macturkish       |   3 | 0/3 (0.0%)       | 3/3 (100.0%)     | 3/3 (100.0%)     |
| ptcp154          |   4 | 0/4 (0.0%)       | 4/4 (100.0%)     | 4/4 (100.0%)     |
| shift-jis        |   3 | 3/3 (100.0%)     | 3/3 (100.0%)     | 3/3 (100.0%)     |
| shift_jis        |  31 | 31/31 (100.0%)   | 31/31 (100.0%)   | 31/31 (100.0%)   |
| tis-620          |   8 | 8/8 (100.0%)     | 8/8 (100.0%)     | 8/8 (100.0%)     |
| utf-16           | 152 | 152/152 (100.0%) | 152/152 (100.0%) | 152/152 (100.0%) |
| utf-16be         | 149 | 0/149 (0.0%)     | 148/149 (99.3%)  | 148/149 (99.3%)  |
| utf-16le         | 149 | 0/149 (0.0%)     | 148/149 (99.3%)  | 148/149 (99.3%)  |
| utf-32           | 150 | 150/150 (100.0%) | 150/150 (100.0%) | 150/150 (100.0%) |
| utf-32be         | 149 | 0/149 (0.0%)     | 149/149 (100.0%) | 149/149 (100.0%) |
| utf-32le         | 149 | 0/149 (0.0%)     | 149/149 (100.0%) | 149/149 (100.0%) |
| utf-7            | 143 | 0/143 (0.0%)     | 143/143 (100.0%) | 143/143 (100.0%) |
| utf-8            | 170 | 170/170 (100.0%) | 169/170 (99.4%)  | 169/170 (99.4%)  |
| utf-8-sig        | 145 | 0/145 (0.0%)     | 145/145 (100.0%) | 145/145 (100.0%) |
| windows-1250     |  37 | 3/37 (8.1%)      | 37/37 (100.0%)   | 37/37 (100.0%)   |
| windows-1251     |  62 | 58/62 (93.5%)    | 62/62 (100.0%)   | 62/62 (100.0%)   |
| windows-1252     |  31 | 20/31 (64.5%)    | 30/31 (96.8%)    | 30/31 (96.8%)    |
| windows-1253     |   2 | 0/2 (0.0%)       | 2/2 (100.0%)     | 2/2 (100.0%)     |
| windows-1254     |   1 | 0/1 (0.0%)       | 1/1 (100.0%)     | 1/1 (100.0%)     |
| windows-1255     |   7 | 7/7 (100.0%)     | 6/7 (85.7%)      | 6/7 (85.7%)      |
| windows-1256     |   9 | 0/9 (0.0%)       | 9/9 (100.0%)     | 9/9 (100.0%)     |
| windows-1257     |   4 | 0/4 (0.0%)       | 4/4 (100.0%)     | 4/4 (100.0%)     |
| windows-1258     |   5 | 0/5 (0.0%)       | 5/5 (100.0%)     | 5/5 (100.0%)     |

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
