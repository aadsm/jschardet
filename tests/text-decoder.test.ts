import { whatwgLabelFor } from '../src/text-decoder.js';
import { ENCODING_WHATWG_MAP } from '../src/encoding-whatwg-map.js';

test('whatwgLabelFor never returns a label the runtime cannot decode with', () => {
  // Regression: the static WHATWG map represents the spec, but runtimes vary
  // in coverage (Node's TextDecoder rejects iso-8859-16). Without runtime
  // probing, callers got a label that broke at TextDecoder construction and
  // validity silently dropped the candidate from statistical scoring.
  for (const encoding of Object.keys(ENCODING_WHATWG_MAP)) {
    const label = whatwgLabelFor(encoding);
    if (label !== null) {
      expect(() => new TextDecoder(label, { fatal: true })).not.toThrow();
    }
  }
});
