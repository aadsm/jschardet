// Port of chardet/tests/test_language.py.

import { DetectionResult } from '../src/pipeline/index.js';
import { _toUtf8, fillLanguages } from '../src/pipeline/language.js';

describe('fillLanguages', () => {
  test('populates language for single-language encoding', () => {
    const results: DetectionResult[] = [
      { encoding: 'koi8-r', confidence: 0.90, language: null, mimeType: null },
    ];
    const filled = fillLanguages(new TextEncoder().encode('test data'), results);
    expect(filled[0].language).not.toBeNull();
  });

  test('passes through existing language', () => {
    const results: DetectionResult[] = [
      { encoding: 'koi8-r', confidence: 0.90, language: 'ru', mimeType: null },
    ];
    const filled = fillLanguages(new TextEncoder().encode('test data'), results);
    expect(filled[0]).toBe(results[0]);
  });

  test('passes through binary results', () => {
    const results: DetectionResult[] = [
      { encoding: null, confidence: 0.95, language: null, mimeType: 'application/octet-stream' },
    ];
    const filled = fillLanguages(new TextEncoder().encode('test data'), results);
    expect(filled[0]).toBe(results[0]);
  });
});

describe('_toUtf8', () => {
  test('unknown encoding returns null', () => {
    expect(_toUtf8(new TextEncoder().encode('Hello world'), 'not-a-real-encoding')).toBeNull();
  });

  test('utf-8 returns data unchanged (same reference)', () => {
    const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0xc3, 0xa9]);
    const result = _toUtf8(data, 'utf-8');
    expect(result).toBe(data);
  });
});
