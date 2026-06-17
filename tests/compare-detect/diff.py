#!/usr/bin/env python3
"""Diff two detect-output JSONL files (Python vs TypeScript) and emit a Markdown report.

Compares records by `id`. Classifies each common id as:
  - exact match
  - encoding divergence (raw `encoding` differs case-insensitively)
  - confidence-only divergence (encoding+language match, |delta| > 0.001)
  - language-only divergence (encoding matches, language differs)

Encoding divergences are listed in full. Confidence- and language-only
divergences are summarised by encoding family.
"""

import argparse
import json
import sys
from collections import Counter, defaultdict


def load(path):
    out = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            out[r['id']] = r
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--py', default='/tmp/py_detect.jsonl')
    ap.add_argument('--ts', default='/tmp/ts_detect.jsonl')
    ap.add_argument('--out', default='-', help='Markdown report path, or - for stdout')
    args = ap.parse_args()

    py = load(args.py)
    ts = load(args.ts)
    common = sorted(set(py) & set(ts))
    only_py = sorted(set(py) - set(ts))
    only_ts = sorted(set(ts) - set(py))

    exact = []
    enc_diff = []
    conf_diff = []
    lang_diff = []

    for fid in common:
        p, t = py[fid], ts[fid]
        enc_eq = (p['encoding'] or '').lower() == (t['encoding'] or '').lower()
        lang_eq = (p['language'] or '').lower() == (t['language'] or '').lower()
        cd = abs((p['confidence'] or 0.0) - (t['confidence'] or 0.0)) > 0.001

        if not enc_eq:
            enc_diff.append((fid, p, t))
        elif not lang_eq:
            lang_diff.append((fid, p, t))
        elif cd:
            conf_diff.append((fid, p, t))
        else:
            exact.append(fid)

    lines = []
    add = lines.append
    add('# Python chardet vs TypeScript port: detect() comparison')
    add('')
    add(f'- Python records: {len(py)}')
    add(f'- TypeScript records: {len(ts)}')
    add(f'- Common ids: {len(common)}')
    if only_py:
        add(f'- Only in Python ({len(only_py)}): first 5 = {only_py[:5]}')
    if only_ts:
        add(f'- Only in TypeScript ({len(only_ts)}): first 5 = {only_ts[:5]}')
    add('')
    add('## Summary')
    add('')
    add('| Category | Count |')
    add('| --- | --- |')
    add(f'| Exact matches (encoding + confidence + language) | {len(exact)} |')
    add(f'| Encoding divergences | **{len(enc_diff)}** |')
    add(f'| Confidence divergences (>0.001, encoding matches) | {len(conf_diff)} |')
    add(f'| Language-only divergences | {len(lang_diff)} |')
    add('')

    if enc_diff:
        add('## Encoding divergences')
        add('')
        add('| id | Python | TS |')
        add('| --- | --- | --- |')
        for fid, p, t in enc_diff:
            add(f"| `{fid}` | `{p['encoding']}` ({p['confidence']:.3f}, lang={p['language']}) "
                f"| `{t['encoding']}` ({t['confidence']:.3f}, lang={t['language']}) |")
        add('')

    # Confidence divergences — all files where encoding matches but |conf_delta| > 0.001,
    # regardless of whether language also differs.
    by_enc_conf = defaultdict(list)
    for fid, p, t in lang_diff + conf_diff:
        delta = abs((p['confidence'] or 0.0) - (t['confidence'] or 0.0))
        if delta > 0.001:
            enc = p['encoding'] or 'null'
            by_enc_conf[enc].append(delta)
    conf_total = sum(len(v) for v in by_enc_conf.values())
    if conf_total > 0:
        add('## Confidence divergences')
        add('')
        add(f'{conf_total} files where encoding matches and |conf_py − conf_ts| > 0.001. By encoding:')
        add('')
        add('| Encoding | Files | Mean Δ | Max Δ |')
        add('| --- | --- | --- | --- |')
        for enc, deltas in sorted(by_enc_conf.items(), key=lambda kv: -len(kv[1])):
            mean_d = sum(deltas) / len(deltas)
            max_d = max(deltas)
            add(f'| `{enc}` | {len(deltas)} | {mean_d:.4f} | {max_d:.4f} |')
        add('')

    if lang_diff:
        add('## Language-only divergences')
        add('')
        by_enc = Counter((p['encoding'] or 'null') for _, p, _ in lang_diff)
        add(f'{len(lang_diff)} files where encoding matches but `language` differs.')
        add('')
        add('### By encoding')
        add('')
        add('| Encoding | Files |')
        add('| --- | --- |')
        for enc, n in by_enc.most_common():
            add(f'| `{enc}` | {n} |')
        add('')
        ts_null = sum(1 for _, _, t in lang_diff if t['language'] is None)
        py_null = sum(1 for _, p, _ in lang_diff if p['language'] is None)
        add(f'- TS returned `null` language: {ts_null}')
        add(f'- Python returned `null` language: {py_null}')
        add('')

        add('### By Python-detected language')
        add('')
        by_py_lang = Counter(p['language'] or 'null' for _, p, _ in lang_diff)
        add('| Python language | Files |')
        add('| --- | --- |')
        for lang, n in by_py_lang.most_common():
            add(f'| `{lang}` | {n} |')
        add('')

        add('### By encoding × Python language')
        add('')
        by_enc_lang = Counter(
            (p['encoding'] or 'null', p['language'] or 'null')
            for _, p, _ in lang_diff
        )
        samples = defaultdict(list)
        for fid, p, _ in lang_diff:
            key = (p['encoding'] or 'null', p['language'] or 'null')
            if len(samples[key]) < 3:
                samples[key].append(fid)
        add('| Encoding | Language | Files | Sample IDs |')
        add('| --- | --- | --- | --- |')
        for (enc, lang), n in by_enc_lang.most_common():
            sample_ids = ', '.join(f'`{s}`' for s in samples[(enc, lang)])
            add(f'| `{enc}` | `{lang}` | {n} | {sample_ids} |')
        add('')

    body = '\n'.join(lines) + '\n'
    if args.out == '-':
        sys.stdout.write(body)
    else:
        with open(args.out, 'w') as f:
            f.write(body)
        print(f'Wrote {args.out}', file=sys.stderr)


if __name__ == '__main__':
    main()
