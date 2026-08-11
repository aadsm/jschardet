// Port of chardet/tests/test_output_names.py.

import {
  applyLegacyRename,
  _COMPAT_NAMES,
  PREFERRED_SUPERSET,
} from '../src/output_names.js';
import { DetectionResult } from '../src/pipeline/index.js';

function makeResult(encoding: string | null): DetectionResult {
  return { encoding, confidence: 1.0, language: null, mimeType: null };
}

describe('applyLegacyRename', () => {
  test('renames ascii to cp1252', () => {
    const d = makeResult('ascii');
    applyLegacyRename(d);
    expect(d.encoding).toBe('cp1252');
  });

  test('no match passes through', () => {
    const d = makeResult('utf-8');
    applyLegacyRename(d);
    expect(d.encoding).toBe('utf-8');
  });

  test('null encoding passes through', () => {
    const d = makeResult(null);
    applyLegacyRename(d);
    expect(d.encoding).toBeNull();
  });
});

describe('_COMPAT_NAMES', () => {
  test('maps codec names to display names', () => {
    expect(_COMPAT_NAMES['big5hkscs']).toBe('Big5');
    expect(_COMPAT_NAMES['cp855']).toBe('IBM855');
    expect(_COMPAT_NAMES['euc_jis_2004']).toBe('EUC-JP');
    expect(_COMPAT_NAMES['iso2022_jp_2']).toBe('ISO-2022-JP');
    expect(_COMPAT_NAMES['shift_jis_2004']).toBe('SHIFT_JIS');
    expect(_COMPAT_NAMES['cp1252']).toBe('Windows-1252');
    expect(_COMPAT_NAMES['cp1251']).toBe('Windows-1251');
    expect(_COMPAT_NAMES['iso8859-1']).toBe('ISO-8859-1');
    expect('ascii' in _COMPAT_NAMES).toBe(false);
    expect('utf-8' in _COMPAT_NAMES).toBe(false);
  });

  // Regression guard for the seven entries restored upstream in chardet#374.
  // cp1250/1256/1257, cp874 and iso8859-2/6/13 were absent, so the default
  // compatNames=true path leaked their internal codec spelling instead of the
  // 5.x/6.x display name.
  test('covers the Windows and ISO families', () => {
    expect(_COMPAT_NAMES['cp1250']).toBe('Windows-1250');
    expect(_COMPAT_NAMES['cp1256']).toBe('Windows-1256');
    expect(_COMPAT_NAMES['cp1257']).toBe('Windows-1257');
    expect(_COMPAT_NAMES['cp874']).toBe('CP874');
    expect(_COMPAT_NAMES['iso8859-2']).toBe('ISO-8859-2');
    expect(_COMPAT_NAMES['iso8859-6']).toBe('ISO-8859-6');
    expect(_COMPAT_NAMES['iso8859-13']).toBe('ISO-8859-13');
  });

  // Regression guard for the cp932 entry restored upstream in chardet#375.
  // Without it the default compatNames=true path leaks the internal cp932
  // codec name instead of the display name CP932 used by its siblings
  // (e.g. shift_jis_2004 → SHIFT_JIS, cp949 → CP949).
  test('covers cp932', () => {
    expect(_COMPAT_NAMES['cp932']).toBe('CP932');
  });

  // Every preferSuperset target must have a _COMPAT_NAMES entry, or the
  // superset remap leaves a raw codec name on the default path.
  test('every preferSuperset target has a compat name', () => {
    const leaked = Object.values(PREFERRED_SUPERSET)
      .filter(target => !(target in _COMPAT_NAMES))
      .sort();
    expect(leaked).toEqual([]);
  });
});
