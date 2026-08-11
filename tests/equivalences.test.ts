// Port of chardet/tests/test_equivalences.py — backward-compatibility shim
// tests for src/equivalences.ts.
//
// The module's contents were split into src/evaluation.ts and
// src/output_names.ts, mirroring the upstream split. Python's shim test also
// asserts a DeprecationWarning fires on import; the TS shim is deliberately
// silent (no ESM import-time warning idiom), so only re-export identity is
// verified here.

import * as equivalences from '../src/equivalences.js';
import * as evaluation from '../src/evaluation.js';
import * as outputNames from '../src/output_names.js';

test('re-exports resolve to the new modules', () => {
  // Evaluation seam
  expect(equivalences.isCorrect).toBe(evaluation.isCorrect);
  expect(equivalences.isLanguageEquivalent).toBe(evaluation.isLanguageEquivalent);
  expect(equivalences.SUPERSETS).toBe(evaluation.SUPERSETS);
  // Output-names seam
  expect(equivalences.applyCompatNames).toBe(outputNames.applyCompatNames);
  expect(equivalences.applyPreferredSuperset).toBe(outputNames.applyPreferredSuperset);
  expect(equivalences.applyLegacyRename).toBe(outputNames.applyLegacyRename);
  expect(equivalences._COMPAT_NAMES).toBe(outputNames._COMPAT_NAMES);
  expect(equivalences.PREFERRED_SUPERSET).toBe(outputNames.PREFERRED_SUPERSET);
});
