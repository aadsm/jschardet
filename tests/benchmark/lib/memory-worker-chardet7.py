#!/usr/bin/env python3
# Memory benchmark worker for chardet 7.
# Reports RSS at three points: before import, after import, after running
# detect() over the full corpus. Output is a single JSON line on stdout.
# Mirrors the methodology of chardet/scripts/benchmark_memory.py but
# reports RSS only (no tracemalloc) so numbers are directly comparable to
# the Node workers, which have no tracemalloc equivalent.
# Usage: python3 memory-worker-chardet7.py <data-dir>
# PYTHONPATH must include chardet/src.
import sys
import os
import json
import gc
import resource


def rss_bytes():
    # ru_maxrss is KiB on Linux, bytes on macOS. We're a Linux container.
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024


def snapshot():
    return {'rss': rss_bytes()}


data_dir = sys.argv[1]

# Pre-load corpus before measuring baseline, matching memory-worker.js.
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

gc.collect()
baseline = snapshot()

import chardet  # noqa: E402

gc.collect()
after_import = snapshot()

for data in corpus:
    chardet.detect(data)

gc.collect()
after_detect = snapshot()

print(json.dumps({
    'baseline': baseline,
    'afterImport': after_import,
    'afterDetect': after_detect,
}))
