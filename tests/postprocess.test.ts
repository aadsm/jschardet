// Port of chardet/tests/test_postprocess.py.

import { DetectionResult } from '../src/pipeline/index.js';
import { _demoteNicheLatin, _promoteKoi8t } from '../src/pipeline/postprocess.js';

describe('_demoteNicheLatin', () => {
  test('iso-8859-10 at top demoted when no distinguishing bytes', () => {
    const results: DetectionResult[] = [
      { encoding: 'iso8859-10', confidence: 0.90, language: null, mimeType: null },
      { encoding: 'cp1252', confidence: 0.85, language: null, mimeType: null },
    ];
    // Data with only bytes shared between iso-8859-10 and iso-8859-1: é ö ü
    const data = new Uint8Array([0xE9, 0xF6, 0xFC]);
    const demoted = _demoteNicheLatin(data, results);
    expect(demoted[0].encoding).toBe('cp1252');
  });

  test('iso-8859-10 NOT demoted when distinguishing bytes present', () => {
    const results: DetectionResult[] = [
      { encoding: 'iso8859-10', confidence: 0.90, language: null, mimeType: null },
      { encoding: 'cp1252', confidence: 0.85, language: null, mimeType: null },
    ];
    // 0xA1 differs between iso-8859-10 and iso-8859-1
    const data = new Uint8Array([0xA1, 0xE9, 0xF6]);
    const demoted = _demoteNicheLatin(data, results);
    expect(demoted[0].encoding).toBe('iso8859-10');
  });

  test('iso-8859-14 at top demoted when no distinguishing bytes', () => {
    const results: DetectionResult[] = [
      { encoding: 'iso8859-14', confidence: 0.90, language: null, mimeType: null },
      { encoding: 'cp1252', confidence: 0.85, language: null, mimeType: null },
    ];
    const data = new Uint8Array([0xC0, 0xC1, 0xC2]);
    const demoted = _demoteNicheLatin(data, results);
    expect(demoted[0].encoding).toBe('cp1252');
  });

  test('windows-1254 at top demoted when no distinguishing bytes', () => {
    const results: DetectionResult[] = [
      { encoding: 'cp1254', confidence: 0.90, language: null, mimeType: null },
      { encoding: 'cp1252', confidence: 0.85, language: null, mimeType: null },
    ];
    const data = new Uint8Array([0xC0, 0xC1, 0xE9]);
    const demoted = _demoteNicheLatin(data, results);
    expect(demoted[0].encoding).toBe('cp1252');
  });
});

describe('_promoteKoi8t', () => {
  test('promote when Tajik-specific bytes present', () => {
    const results: DetectionResult[] = [
      { encoding: 'koi8-r', confidence: 0.90, language: 'ru', mimeType: null },
      { encoding: 'koi8-t', confidence: 0.88, language: 'tg', mimeType: null },
    ];
    // 0x80 is a Tajik-specific byte in KOI8-T
    const data = new Uint8Array([0x41, 0x80, 0x42]);
    const promoted = _promoteKoi8t(data, results);
    expect(promoted[0].encoding).toBe('koi8-t');
  });

  test('no promote without Tajik-specific bytes', () => {
    const results: DetectionResult[] = [
      { encoding: 'koi8-r', confidence: 0.90, language: 'ru', mimeType: null },
      { encoding: 'koi8-t', confidence: 0.88, language: 'tg', mimeType: null },
    ];
    // Only Cyrillic-range bytes shared between KOI8-R and KOI8-T
    const data = new Uint8Array([0xC0, 0xC1, 0xC2]);
    const promoted = _promoteKoi8t(data, results);
    expect(promoted[0].encoding).toBe('koi8-r');
  });

  test('returns early when KOI8-T absent', () => {
    const results: DetectionResult[] = [
      { encoding: 'koi8-r', confidence: 0.90, language: 'ru', mimeType: null },
      { encoding: 'cp1251', confidence: 0.85, language: 'ru', mimeType: null },
    ];
    const data = new Uint8Array([0x80, 0xC0, 0xC1]);
    const returned = _promoteKoi8t(data, results);
    expect(returned).toBe(results);
    expect(returned[0].encoding).toBe('koi8-r');
  });
});
