#!/usr/bin/env bash
# Run the full Python-vs-TypeScript detect comparison and emit a Markdown report.
#
# Usage: tests/compare-detect/run.sh [report.md]
# Writes the report to stdout by default; pass a path to write to a file instead.
# Progress messages go to stderr, so `tests/compare-detect/run.sh > report.md`
# captures a clean report.
#
# Requires: python3 (with the chardet submodule checked out), npx tsx, and a
# populated tests/data/ corpus (run `npm run test:accuracy` once if missing).

set -euo pipefail

cd "$(dirname "$0")/../.."

REPORT="${1:--}"
PY_OUT=/tmp/py_detect.jsonl
TS_OUT=/tmp/ts_detect.jsonl

if [ ! -d tests/data ] || [ -z "$(ls -A tests/data 2>/dev/null)" ]; then
  echo "tests/data is empty — run 'npm run test:accuracy' once to populate it." >&2
  exit 1
fi

echo "[1/3] Running Python chardet…" >&2
python3 tests/compare-detect/python.py --out "$PY_OUT"

echo "[2/3] Running TypeScript port…" >&2
npx tsx tests/compare-detect/typescript.mjs --out "$TS_OUT"

echo "[3/3] Diffing and writing report…" >&2
python3 tests/compare-detect/diff.py --py "$PY_OUT" --ts "$TS_OUT" --out "$REPORT"
