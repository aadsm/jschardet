// Port of chardet/tests/test_koi8t.py.
//
// Regression for KOI8-T vs KOI8-R disambiguation using Tajik-specific bytes.

import { detect } from '../src/chardet.js';
import { EncodingEra } from '../src/enums.js';
import tajikSample from './fixtures/koi8t/tajik.txt?uint8array';
import russianSample from './fixtures/koi8t/russian.html?uint8array';

test('koi8t with tajik bytes', () => {
  const result = detect(tajikSample, { encodingEra: EncodingEra.ALL });
  expect(result.encoding).toBe('koi8-t');
});

test('russian text stays koi8r', () => {
  const result = detect(russianSample, { encodingEra: EncodingEra.ALL });
  expect(result.encoding).not.toBe('koi8-t');
});
