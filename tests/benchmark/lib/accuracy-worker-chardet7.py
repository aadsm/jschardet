#!/usr/bin/env python3
# Accuracy benchmark worker for chardet 7.
# Walks the test corpus in the same order as the JS harness and emits
# a JSON array of {encoding, language} (one entry per file).
# Usage: python3 accuracy-worker-chardet7.py <data-dir>
# PYTHONPATH must include chardet/src.
import sys
import os
import json

import chardet

data_dir = sys.argv[1]

results = []
for name in sorted(os.listdir(data_dir)):
    sub = os.path.join(data_dir, name)
    if not os.path.isdir(sub) or '-' not in name:
        continue
    for fname in sorted(os.listdir(sub)):
        fp = os.path.join(sub, fname)
        if not os.path.isfile(fp):
            continue
        with open(fp, 'rb') as f:
            r = chardet.detect(f.read())
        results.append({
            'encoding': r.get('encoding'),
            'language': r.get('language'),
        })

print(json.dumps(results))
