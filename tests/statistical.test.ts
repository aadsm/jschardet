// Port of chardet/tests/test_statistical.py.

import { EncodingEra } from '../src/enums.js';
import { getEncIndex } from '../src/models/index.js';
import { scoreCandidates } from '../src/pipeline/statistical.js';
import { getCandidates } from '../src/registry.js';

// Bytes generated from Python's str.encode() to match the parity tests.
// "Héllo wörld" encoded as windows-1252.
const HELLO_WORLD_CP1252 = new Uint8Array([
  0x48, 0xe9, 0x6c, 0x6c, 0x6f, 0x20, 0x77, 0xf6, 0x72, 0x6c, 0x64,
]);
// "Привет мир, как дела? Это тестовый текст на русском языке." in windows-1251.
const RUSSIAN_TEXT_CP1251 = new Uint8Array([
  0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x20, 0xec, 0xe8, 0xf0, 0x2c, 0x20, 0xea, 0xe0, 0xea,
  0x20, 0xe4, 0xe5, 0xeb, 0xe0, 0x3f, 0x20, 0xdd, 0xf2, 0xee, 0x20, 0xf2, 0xe5, 0xf1, 0xf2,
  0xee, 0xe2, 0xfb, 0xe9, 0x20, 0xf2, 0xe5, 0xea, 0xf1, 0xf2, 0x20, 0xed, 0xe0, 0x20, 0xf0,
  0xf3, 0xf1, 0xf1, 0xea, 0xee, 0xec, 0x20, 0xff, 0xe7, 0xfb, 0xea, 0xe5, 0x2e,
]);

test('returns results sorted by confidence descending', () => {
  const candidates = getCandidates(EncodingEra.MODERN_WEB);
  const results = scoreCandidates(HELLO_WORLD_CP1252, candidates);
  const confidences = results.map(r => r.confidence);
  const sorted = [...confidences].sort((a, b) => b - a);
  expect(confidences).toEqual(sorted);
});

test('returns DetectionResult objects', () => {
  const candidates = getCandidates(EncodingEra.MODERN_WEB);
  const results = scoreCandidates(new TextEncoder().encode('Hello world'), candidates);
  for (const r of results) {
    expect(r).toHaveProperty('encoding');
    expect(r).toHaveProperty('confidence');
    expect(r).toHaveProperty('language');
    expect(r).toHaveProperty('mimeType');
  }
});

test('empty data returns empty list', () => {
  const candidates = getCandidates(EncodingEra.MODERN_WEB);
  const results = scoreCandidates(new Uint8Array(0), candidates);
  expect(results.length).toBe(0);
});

test('empty candidates returns empty list', () => {
  const results = scoreCandidates(new TextEncoder().encode('Hello'), []);
  expect(results.length).toBe(0);
});

test('small candidate set, no panic', () => {
  const candidates = getCandidates(EncodingEra.MODERN_WEB).filter(e => e.name === 'utf-8');
  const results = scoreCandidates(new TextEncoder().encode('Hello'), candidates);
  expect(results.length).toBeLessThanOrEqual(candidates.length);
});

test('candidate with no statistical model is dropped', () => {
  const index = getEncIndex();
  const noModel = getCandidates(EncodingEra.ALL).filter(e => !index.has(e.name));
  if (noModel.length === 0) return; // skip — every candidate has a model.
  const data = new Uint8Array(50);
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 5; j++) data[i * 5 + j] = 0xc1 + j;
  }
  const results = scoreCandidates(data, [noModel[0]]);
  expect(results).toEqual([]);
});

test('correct encoding (cp1251) scores in the top 3 for Russian text', () => {
  const candidates = getCandidates(EncodingEra.MODERN_WEB);
  const results = scoreCandidates(RUSSIAN_TEXT_CP1251, candidates);
  expect(results.length).toBeGreaterThan(0);
  const topNames = results.slice(0, 3).map(r => r.encoding);
  expect(topNames).toContain('cp1251');
});
