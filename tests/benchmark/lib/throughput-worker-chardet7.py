#!/usr/bin/env python3
# Throughput benchmark worker for chardet 7.
# Runs the full corpus benchmark RUNS times and prints JSON stats over
# the element-wise median of per-file times. Median-of-N aggregation
# matches chardet's _run_timing_with_median in scripts/compare_detectors.py
# but runs in-process — chardet upstream isolates each pass in a fresh
# subprocess.
# Usage: python3 throughput-worker-chardet7.py <data-dir> <runs>
# PYTHONPATH must include chardet/src.
import sys
import os
import json
import time
import statistics

import chardet

data_dir = sys.argv[1]
n_runs = int(sys.argv[2]) if len(sys.argv) > 2 else 1

files = []
for name in sorted(os.listdir(data_dir)):
    sub = os.path.join(data_dir, name)
    if not os.path.isdir(sub) or '-' not in name:
        continue
    for fname in sorted(os.listdir(sub)):
        fp = os.path.join(sub, fname)
        if os.path.isfile(fp):
            files.append(fp)

corpus = [open(fp, 'rb').read() for fp in files]

chardet.detect(corpus[0])  # warm-up

all_runs = []
for _ in range(n_runs):
    times = []
    for data in corpus:
        t0 = time.perf_counter()
        chardet.detect(data)
        times.append((time.perf_counter() - t0) * 1000)
    all_runs.append(times)

# Element-wise median across passes.
median_times = [statistics.median(run[j] for run in all_runs) for j in range(len(corpus))]

n = len(median_times)
s = sorted(median_times)
total = sum(median_times)
# ~p90 / ~p95: nearest sample by index, no linear interpolation.
# At n=2517 the difference from true p90 / p95 is well below table
# precision. Matches the JS quantile in throughput.js.
print(json.dumps({
    'mean':       sum(median_times) / n,
    'median':     s[n // 2],
    'p90':        s[min(int(0.90 * n), n - 1)],
    'p95':        s[min(int(0.95 * n), n - 1)],
    'total':      total,
    'filesPerSec': round(n / (total / 1000)),
}))
