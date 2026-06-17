#!/usr/bin/env python3
"""Run Python chardet detect() on every corpus file in tests/data/.

Writes one JSON record per line to the output file: {id, encoding, confidence, language}.
The chardet submodule's gitignored _version.py is created and removed automatically.
"""

import argparse
import json
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DATA_DIR = os.path.join(REPO_ROOT, 'tests', 'data')
CHARDET_SRC = os.path.join(REPO_ROOT, 'chardet', 'src')
VERSION_FILE = os.path.join(CHARDET_SRC, 'chardet', '_version.py')


def collect_files(data_dir):
    results = []
    for dir_name in sorted(os.listdir(data_dir)):
        dir_path = os.path.join(data_dir, dir_name)
        if not os.path.isdir(dir_path):
            continue
        if dir_name.rfind('-') == -1:
            continue
        for fname in sorted(os.listdir(dir_path)):
            fp = os.path.join(dir_path, fname)
            if os.path.isfile(fp):
                results.append((f"{dir_name}/{fname}", fp))
    return results


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--out', default='/tmp/py_detect.jsonl')
    args = ap.parse_args()

    created_version = False
    if not os.path.exists(VERSION_FILE):
        with open(VERSION_FILE, 'w') as f:
            f.write('__version__ = "0.0.0+dev"\n')
        created_version = True

    try:
        sys.path.insert(0, CHARDET_SRC)
        import chardet
        from chardet.enums import EncodingEra

        files = collect_files(DATA_DIR)
        print(f"Detecting {len(files)} files with Python chardet {chardet.__version__}", file=sys.stderr)

        with open(args.out, 'w') as out:
            for i, (file_id, fp) in enumerate(files):
                if i and i % 500 == 0:
                    print(f"  {i}/{len(files)}", file=sys.stderr)
                with open(fp, 'rb') as f:
                    data = f.read()
                r = chardet.detect(data, encoding_era=EncodingEra.ALL, prefer_superset=True)
                out.write(json.dumps({
                    'id': file_id,
                    'encoding': r.get('encoding'),
                    'confidence': r.get('confidence'),
                    'language': r.get('language'),
                }) + '\n')

        print(f"Wrote {args.out}", file=sys.stderr)
    finally:
        if created_version:
            os.remove(VERSION_FILE)


if __name__ == '__main__':
    main()
