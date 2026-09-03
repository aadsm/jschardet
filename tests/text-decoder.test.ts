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

import { danglingTailWithAsciiPrefix, decodesCompletely, decodesWithoutError, decoderForLabel } from '../src/text-decoder.js';

// Port of the applicable chardet test_internal_utils.py cases. The port's
// helpers take a resolved WHATWG label (unknown *names* are handled upstream by
// whatwgLabelFor, tested above), so the ported cases feed real labels and pin
// the behaviour on genuine input.
test('danglingTailWithAsciiPrefix: genuine corruption before the tail is false', () => {
  expect(danglingTailWithAsciiPrefix('utf-8', new Uint8Array([0xff]))).toBe(false);
});

test('decodesCompletely rejects a truncated multi-byte tail', () => {
  // A lone UTF-8 lead byte at the end: tolerated by the streaming check,
  // rejected by the complete one.
  const dangling = new Uint8Array([0x61, 0xc3]);
  expect(decodesWithoutError('utf-8', dangling)).toBe(true);
  expect(decodesCompletely('utf-8', dangling)).toBe(false);
  // Reset the cached streaming decoder so the label is clean for later tests.
  try { decoderForLabel('utf-8').decode(); } catch { /* expected */ }
});
