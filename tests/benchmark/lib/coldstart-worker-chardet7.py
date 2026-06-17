#!/usr/bin/env python3
# Cold start worker for chardet 7. Spawned in a fresh subprocess per measurement.
# Prints JSON {importTime, firstDetectTime} (ms) to stdout.
# PYTHONPATH must include chardet/src.
import json
import time

t0 = time.perf_counter()
import chardet
import_time = (time.perf_counter() - t0) * 1000

t1 = time.perf_counter()
chardet.detect(b'Hello, world!')
first_detect_time = (time.perf_counter() - t1) * 1000

print(json.dumps({'importTime': import_time, 'firstDetectTime': first_detect_time}))
