import { REGISTRY, lookupEncoding } from '../src/registry.js';
import { ENCODING_WHATWG_MAP } from '../src/encoding-whatwg-map.js';

// Port of test_whatwg_equivalence_map_references_real_canonicals from
// chardet/tests/test_spec_whatwg.py.
// Verifies that every Python codec name in ENCODING_WHATWG_MAP exists in
// the chardet registry, guarding against silent drift if a canonical is
// ever renamed without updating the generated map.
test('ENCODING_WHATWG_MAP references real registry canonicals', () => {
  const unknown: [string, string][] = [];
  for (const [canonical, label] of Object.entries(ENCODING_WHATWG_MAP)) {
    if (!(canonical in REGISTRY)) {
      unknown.push([canonical, label]);
    }
  }
  expect(unknown).toEqual([]);
});

