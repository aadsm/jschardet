// Port of chardet/tests/test_confusion.py.

import { DetectionResult } from '../src/pipeline/index.js';
import {
  _deserializeConfusionDataFromBytes,
  loadConfusionMaps,
  resolveByBigramRescore,
  resolveByCategoryVoting,
  resolveConfusionGroups,
} from '../src/pipeline/confusion.js';

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// Ukrainian text in koi8-u, repeated 5x. Bytes 0xa6/0xa7 are in the koi8-r vs
// koi8-u distinguishing set.
const UKRAINIAN_KOI8U = hexToBytes(
  'f0d2c9d7a6d42c20d120da20f5cbd2c1a7cec92e20e3c520c4d5d6c520c7c1d2cecf2e20e2d5c4d8' +
  '20ccc1d3cbc12ef0d2c9d7a6d42c20d120da20f5cbd2c1a7cec92e20e3c520c4d5d6c520c7c1d2ce' +
  'cf2e20e2d5c4d820ccc1d3cbc12ef0d2c9d7a6d42c20d120da20f5cbd2c1a7cec92e20e3c520c4d5' +
  'd6c520c7c1d2cecf2e20e2d5c4d820ccc1d3cbc12ef0d2c9d7a6d42c20d120da20f5cbd2c1a7cec9' +
  '2e20e3c520c4d5d6c520c7c1d2cecf2e20e2d5c4d820ccc1d3cbc12ef0d2c9d7a6d42c20d120da20' +
  'f5cbd2c1a7cec92e20e3c520c4d5d6c520c7c1d2cecf2e20e2d5c4d820ccc1d3cbc12e',
);

// Turkish text in iso8859-9, repeated 5x.
const TURKISH_ISO8859_9 = hexToBytes(
  '54fc726be76520dd7374616e62756c20de656b657220c769e7656b20d0fcfefdf6e754fc726be765' +
  '20dd7374616e62756c20de656b657220c769e7656b20d0fcfefdf6e754fc726be76520dd73746' +
  '16e62756c20de656b657220c769e7656b20d0fcfefdf6e754fc726be76520dd7374616e62756c' +
  '20de656b657220c769e7656b20d0fcfefdf6e754fc726be76520dd7374616e62756c20de656b6' +
  '57220c769e7656b20d0fcfefdf6e7',
);

test('loadConfusionMaps returns valid pair maps including ebcdic', () => {
  const maps = loadConfusionMaps();
  expect(maps.size).toBeGreaterThan(0);
  let found = false;
  for (const key of maps.keys()) {
    const sep = key.indexOf('\x00');
    const a = key.slice(0, sep);
    const b = key.slice(sep + 1);
    if ((a.includes('cp1140') && b.includes('cp500')) ||
        (a.includes('cp500') && b.includes('cp1140'))) {
      found = true;
      break;
    }
  }
  expect(found).toBe(true);
});

test('category voting prefers letter (Ll) over symbol (So)', () => {
  const diffBytes = new Set([0xd5]);
  const categories = new Map<number, [string, string]>([[0xd5, ['Ll', 'So']]]);
  const data = new Uint8Array([0x41, 0xd5, 0x42]);
  expect(resolveByCategoryVoting(data, 'enc_a', 'enc_b', diffBytes, categories)).toBe('enc_a');
});

test('category voting returns null when no distinguishing bytes are in data', () => {
  const diffBytes = new Set([0xd5]);
  const categories = new Map<number, [string, string]>([[0xd5, ['Ll', 'So']]]);
  const data = new Uint8Array([0x41, 0x42, 0x43]);
  expect(resolveByCategoryVoting(data, 'enc_a', 'enc_b', diffBytes, categories)).toBeNull();
});

test('category voting returns enc_b when its categories are stronger', () => {
  const diffBytes = new Set([0xd5]);
  const categories = new Map<number, [string, string]>([[0xd5, ['So', 'Ll']]]);
  const data = new Uint8Array([0x41, 0xd5, 0x42]);
  expect(resolveByCategoryVoting(data, 'enc_a', 'enc_b', diffBytes, categories)).toBe('enc_b');
});

test('bigram rescore returns one of the encodings or null', () => {
  const diffBytes = new Set([0xd5]);
  const data = new Uint8Array([0x41, 0xd5, 0x42, 0xd5, 0x43]);
  const result = resolveByBigramRescore(data, 'cp850', 'cp858', diffBytes);
  expect(['cp850', 'cp858', null]).toContain(result);
});

test('bigram rescore short data returns null', () => {
  const diffBytes = new Set([0xfe]);
  expect(resolveByBigramRescore(new Uint8Array([0x78]), 'enc_a', 'enc_b', diffBytes)).toBeNull();
});

test('bigram rescore with no distinguishing bytes returns null', () => {
  const diffBytes = new Set([0xfe]);
  const data = new TextEncoder().encode(
    'Hello world, this is plain ASCII text without any high bytes at all.',
  );
  expect(resolveByBigramRescore(data, 'enc_a', 'enc_b', diffBytes)).toBeNull();
});

test('bigram rescore picks koi8-u for Ukrainian text (enc_a wins)', () => {
  const maps = loadConfusionMaps();
  const key = 'koi8-r\x00koi8-u';
  const entry = maps.get(key)!;
  expect(entry).toBeDefined();
  const result = resolveByBigramRescore(UKRAINIAN_KOI8U, 'koi8-u', 'koi8-r', entry.diffBytes);
  expect(result).toBe('koi8-u');
});

test('bigram rescore picks koi8-u for Ukrainian text (enc_b wins)', () => {
  const maps = loadConfusionMaps();
  const entry = maps.get('koi8-r\x00koi8-u')!;
  const result = resolveByBigramRescore(UKRAINIAN_KOI8U, 'koi8-r', 'koi8-u', entry.diffBytes);
  expect(result).toBe('koi8-u');
});

test('bigram rescore: encoding without model variants scores 0', () => {
  const maps = loadConfusionMaps();
  const entry = maps.get('koi8-r\x00koi8-u')!;
  const result = resolveByBigramRescore(UKRAINIAN_KOI8U, 'koi8-u', 'ascii', entry.diffBytes);
  expect(result).toBe('koi8-u');
});

test('resolveConfusionGroups: unrelated encodings are not reordered', () => {
  const results: DetectionResult[] = [
    { encoding: 'utf-8', confidence: 0.95, language: null, mimeType: null },
    { encoding: 'koi8-r', confidence: 0.80, language: 'Russian', mimeType: null },
  ];
  const data = new TextEncoder().encode('Hello world');
  const resolved = resolveConfusionGroups(data, results);
  expect(resolved[0].encoding).toBe('utf-8');
});

test('resolveConfusionGroups preserves all results, only reorders', () => {
  const results: DetectionResult[] = [
    { encoding: 'cp1140', confidence: 0.95, language: 'English', mimeType: null },
    { encoding: 'cp500', confidence: 0.94, language: 'English', mimeType: null },
    { encoding: 'cp1252', confidence: 0.50, language: 'English', mimeType: null },
  ];
  const allBytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) allBytes[i] = i;
  const resolved = resolveConfusionGroups(allBytes, results);
  expect(resolved.length).toBe(results.length);
  const encs = new Set(resolved.map(r => r.encoding));
  expect(encs).toEqual(new Set(['cp1140', 'cp500', 'cp1252']));
});

test('resolveConfusionGroups: single result passes through unchanged', () => {
  const results: DetectionResult[] = [
    { encoding: 'utf-8', confidence: 0.95, language: null, mimeType: null },
  ];
  const resolved = resolveConfusionGroups(new TextEncoder().encode('Hello'), results);
  expect(resolved).toBe(results);
});

test('resolveConfusionGroups: top encoding=null skips resolution', () => {
  const results: DetectionResult[] = [
    { encoding: null, confidence: 0.95, language: null, mimeType: null },
    { encoding: 'utf-8', confidence: 0.90, language: null, mimeType: null },
  ];
  const resolved = resolveConfusionGroups(new TextEncoder().encode('Hello'), results);
  expect(resolved).toBe(results);
});

test('resolveConfusionGroups skips candidate with encoding=null', () => {
  const results: DetectionResult[] = [
    { encoding: 'cp1140', confidence: 0.95, language: 'en', mimeType: null },
    { encoding: null, confidence: 0.94, language: null, mimeType: null },
    { encoding: 'cp500', confidence: 0.93, language: 'en', mimeType: null },
  ];
  const allBytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) allBytes[i] = i;
  const resolved = resolveConfusionGroups(allBytes, results);
  expect(resolved.length).toBe(results.length);
});

test('resolveConfusionGroups respects the confidence band', () => {
  const results: DetectionResult[] = [
    { encoding: 'cp1140', confidence: 0.95, language: 'en', mimeType: null },
    { encoding: 'cp500', confidence: 0.94, language: 'en', mimeType: null },
    { encoding: 'cp273', confidence: 0.50, language: 'de', mimeType: null },
  ];
  const allBytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) allBytes[i] = i;
  const resolved = resolveConfusionGroups(allBytes, results);
  expect(resolved.length).toBe(results.length);
});

test('resolveConfusionGroups swaps top and second when second wins', () => {
  const results: DetectionResult[] = [
    { encoding: 'koi8-r', confidence: 0.95, language: 'Russian', mimeType: null },
    { encoding: 'koi8-u', confidence: 0.90, language: 'Ukrainian', mimeType: null },
    { encoding: 'utf-8', confidence: 0.50, language: null, mimeType: null },
  ];
  const resolved = resolveConfusionGroups(UKRAINIAN_KOI8U, results);
  expect(resolved[0].encoding).toBe('koi8-u');
  expect(resolved[1].encoding).toBe('koi8-r');
  expect(resolved[2].encoding).toBe('utf-8');
});

test('resolveConfusionGroups: bigram wins over category voting', () => {
  // Turkish text — distinguishing bytes share Unicode categories in iso8859-1
  // and iso8859-9, so category voting returns null. Bigram re-scoring picks
  // iso8859-9 from Turkish patterns.
  const results: DetectionResult[] = [
    { encoding: 'iso8859-1', confidence: 0.95, language: 'English', mimeType: null },
    { encoding: 'iso8859-9', confidence: 0.90, language: 'Turkish', mimeType: null },
  ];
  const resolved = resolveConfusionGroups(TURKISH_ISO8859_9, results);
  expect(resolved[0].encoding).toBe('iso8859-9');
  expect(resolved[1].encoding).toBe('iso8859-1');
});

test('_deserializeConfusionDataFromBytes throws on truncated data', () => {
  // num_pairs=1 but no pair bytes follow.
  const truncated = new Uint8Array([0x00, 0x01]);
  expect(() => _deserializeConfusionDataFromBytes(truncated)).toThrow();
});
