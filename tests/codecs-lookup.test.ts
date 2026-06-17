import { codecsLookup } from '../src/codecs-lookup.js';

// Regression: Python's encodings.normalize_encoding() treats '.' as
// alphanumeric-equivalent, so names like ANSI_X3.4-1986 normalise to
// ansi_x3.4_1986 (dot preserved). The TS port previously collapsed dots
// into '_' along with other punctuation, missing dot-bearing keys in
// ENCODING_ALIAS_MAP (e.g. "ansi_x3.4_1986" exists; "ansi_x3_4_1986"
// does not).
test.each([
  ['ANSI_X3.4-1986', 'ascii'],
  ['ISO_646.irv:1991', 'ascii'],
  ['ansi_x3.4_1986', 'ascii'],
])('codecsLookup preserves dots when normalising (%s -> %s)', (input, expected) => {
  expect(codecsLookup(input)).toBe(expected);
});
