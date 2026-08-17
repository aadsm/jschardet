// Port of chardet/tests/test_confusion.py.

import { DetectionResult } from '../src/pipeline/index.js';
import {
  _bestVariantScore,
  _comparableLanguages,
  _deserializeConfusionDataFromBytes,
  _modelledLanguages,
  _testHooks,
  confusionPairWinner,
  loadConfusionMaps,
  resolveByBigramRescore,
  resolveByCategoryVoting,
  resolveConfusionGroups,
} from '../src/pipeline/confusion.js';
import { BigramProfile } from '../src/models/index.js';

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

// Real encoding names are required (the vote reads per-encoding letter
// tables), and the distinguishing byte needs lowercase letter neighbors so
// the letter reading forms a plausible word shape.
test('category voting prefers letter (Ll) over symbol (So)', () => {
  const diffBytes = new Set([0xd5]);
  const categories = new Map<number, [string, string]>([[0xd5, ['Ll', 'So']]]);
  const data = new Uint8Array([0x61, 0xd5, 0x62]);
  expect(resolveByCategoryVoting(data, 'latin-1', 'mac-roman', diffBytes, categories)).toBe('latin-1');
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
  const data = new Uint8Array([0x61, 0xd5, 0x62]);
  expect(resolveByCategoryVoting(data, 'latin-1', 'mac-roman', diffBytes, categories)).toBe('mac-roman');
});

// Punctuation legitimately borders letters (paths like KRB\ZUNI under EBCDIC
// read as KRBÖZUNI by a sibling), so the vote must return null rather than
// promote the letter interpretation.
test('category voting: letter over punctuation is not evidence', () => {
  const diffBytes = new Set([0xd5]);
  const categories = new Map<number, [string, string]>([[0xd5, ['Ll', 'Po']]]);
  const data = new Uint8Array([0x61, 0xd5, 0x62]);
  expect(resolveByCategoryVoting(data, 'latin-1', 'mac-roman', diffBytes, categories)).toBeNull();
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

// Hungarian text whose u-double-acute letters land on 0xF8 in iso8859-16 —
// the one position separating it from iso8859-2, which reads that byte as
// the Czech r-hacek. Python: _HUNGARIAN_ISO8859_16 ("A műszerfal és a
// hűtőrács..." x4), bytes generated with Python's iso8859-16 codec.
const HUNGARIAN_ISO8859_16 = hexToBytes(
  '41206df8737a657266616c20e97320612068f874f572e16373206b6974f86e74206120737afc726b' +
  '6573e96762f56c2c206b72f36d626574f86b6b656c2064ed737aed7476652c2066f874f6747420fc' +
  '6ce97373656c2e2041206df8737a657266616c20e97320612068f874f572e16373206b6974f86e74' +
  '206120737afc726b6573e96762f56c2c206b72f36d626574f86b6b656c2064ed737aed7476652c20' +
  '66f874f6747420fc6ce97373656c2e2041206df8737a657266616c20e97320612068f874f572e163' +
  '73206b6974f86e74206120737afc726b6573e96762f56c2c206b72f36d626574f86b6b656c2064ed' +
  '737aed7476652c2066f874f6747420fc6ce97373656c2e2041206df8737a657266616c20e9732061' +
  '2068f874f572e16373206b6974f86e74206120737afc726b6573e96762f56c2c206b72f36d626574' +
  'f86b6b656c2064ed737aed7476652c2066f874f6747420fc6ce97373656c2e20',
);

test('_comparableLanguages: unrestricted without languages', () => {
  expect(_comparableLanguages('iso8859-2', 'iso8859-16', new Set())).toBeNull();
});

// iso8859-2 models Czech and iso8859-16 does not, so a pair judged on
// Hungarian must not be scored against a Czech model.
test('_comparableLanguages excludes what one side cannot model', () => {
  const shared = _comparableLanguages('iso8859-2', 'iso8859-16', new Set(['hu']));
  expect(shared).not.toBeNull();
  expect(shared!.has('hu')).toBe(true);
  expect(shared!.has('cs')).toBe(false);
});

// cp1125 models only Ukrainian, so a Belarusian cp866 document shares just
// uk with it. Restricting there would score the right encoding under the
// wrong language, so the pair is compared unrestricted.
test('_comparableLanguages falls back when a language is unshared', () => {
  expect(_comparableLanguages('cp866', 'cp1125', new Set(['uk', 'be']))).toBeNull();
});

test('_comparableLanguages restricts when every language is shared', () => {
  const shared = _comparableLanguages('cp866', 'cp1125', new Set(['uk']));
  expect(shared).not.toBeNull();
  expect([...shared!]).toEqual(['uk']);
});

test('bigram rescore judges Hungarian under Hungarian', () => {
  const maps = loadConfusionMaps();
  const entry = maps.get('iso8859-2\x00iso8859-16')!;
  expect(entry).toBeDefined();
  expect(
    resolveByBigramRescore(
      HUNGARIAN_ISO8859_16, 'iso8859-2', 'iso8859-16', entry.diffBytes, new Set(['hu']),
    ),
  ).toBe('iso8859-16');
});

// cp437 is the only encoding with a zxx model, so a plain intersection
// would strip box-drawing evidence from every restricted rescore cp437
// takes part in.
test('_comparableLanguages keeps the art model', () => {
  const shared = _comparableLanguages('cp850', 'cp437', new Set(['en']));
  expect(shared).not.toBeNull();
  expect(shared!.has('zxx')).toBe(true);
  expect(_modelledLanguages('cp850').has('zxx')).toBe(false);
});

// null scores every variant; a restriction can only score lower. Also pins
// the score-0 branch: a language the encoding does not model scores
// nothing, which loses the comparison rather than abstaining — the reason
// callers must not use it as an abstention.
test('_bestVariantScore: null means every variant', () => {
  const profile = new BigramProfile(HUNGARIAN_ISO8859_16);
  const every = _bestVariantScore(profile, 'iso8859-2', null);
  const one = _bestVariantScore(profile, 'iso8859-2', new Set(['cs']));
  expect(one).toBeGreaterThan(0);
  expect(every).toBeGreaterThanOrEqual(one);
  expect(_bestVariantScore(profile, 'iso8859-2', new Set(['vi']))).toBe(0);
});

test('resolveConfusionGroups promotes on the restricted rescore', () => {
  const results: DetectionResult[] = [
    { encoding: 'iso8859-2', confidence: 0.50, language: 'hu', mimeType: null },
    { encoding: 'iso8859-16', confidence: 0.50, language: 'hu', mimeType: null },
  ];
  const resolved = resolveConfusionGroups(HUNGARIAN_ISO8859_16, results);
  expect(resolved[0].encoding).toBe('iso8859-16');
});

// Both focused-profile scans build the same profile. The rescore locates
// distinguishing bytes with indexOf when they are sparse and walks every
// byte when they are not. Forcing each path over identical data pins the
// claim that they are interchangeable: a huge divisor makes the density
// test fail for any input, selecting the straight scan; the shipped value
// selects the sparse one.
test('rescore dense and sparse paths agree', () => {
  const maps = loadConfusionMaps();
  const entry = maps.get('koi8-r\x00koi8-u')!;
  const enc = new TextEncoder();
  // Distinguishing bytes interleaved with plain ASCII: dense enough to
  // exercise the straight scan's skip branch, sparse enough that the
  // find-based path has non-hits to step over.
  const diffRun = Uint8Array.from([...entry.diffBytes].sort((a, b) => a - b));
  const ascii = enc.encode(' plain ascii text ');
  const mixed = new Uint8Array((diffRun.length + ascii.length) * 12);
  for (let i = 0, off = 0; i < 12; i++) {
    mixed.set(diffRun, off); off += diffRun.length;
    mixed.set(ascii, off); off += ascii.length;
  }
  const samples = [mixed, UKRAINIAN_KOI8U, enc.encode('no distinguishing bytes here at all')];

  const runs: Record<string, Array<string | null>> = {};
  const shipped = _testHooks.denseHitDivisor;
  try {
    for (const [label, divisor] of [['sparse', 4], ['dense', 1e9]] as const) {
      _testHooks.denseHitDivisor = divisor;
      runs[label] = samples.map(data =>
        resolveByBigramRescore(data, 'koi8-r', 'koi8-u', entry.diffBytes),
      );
    }
  } finally {
    _testHooks.denseHitDivisor = shipped;
  }
  expect(runs.sparse).toEqual(runs.dense);
});

test('rescore dense path skips non-distinguishing bigrams', () => {
  const maps = loadConfusionMaps();
  const entry = maps.get('koi8-r\x00koi8-u')!;
  const enc = new TextEncoder();
  const diffRun = Uint8Array.from([...entry.diffBytes].sort((a, b) => a - b));
  const ascii = enc.encode(' plain ascii text ');
  const data = new Uint8Array((diffRun.length + ascii.length) * 12);
  for (let i = 0, off = 0; i < 12; i++) {
    data.set(diffRun, off); off += diffRun.length;
    data.set(ascii, off); off += ascii.length;
  }
  const shipped = _testHooks.denseHitDivisor;
  try {
    _testHooks.denseHitDivisor = 1e9;
    expect(['koi8-r', 'koi8-u', null]).toContain(
      resolveByBigramRescore(data, 'koi8-r', 'koi8-u', entry.diffBytes),
    );
    // No distinguishing byte at all -> empty profile -> no verdict.
    expect(
      resolveByBigramRescore(
        enc.encode('ordinary ascii, nothing to arbitrate'),
        'koi8-r', 'koi8-u', entry.diffBytes,
      ),
    ).toBeNull();
  } finally {
    _testHooks.denseHitDivisor = shipped;
  }
});

// postprocess calls this for the classic-Mac line-ending promotion, and
// with only sibling-tier pairs shipped no corpus file reaches it, so it is
// exercised here directly.
test('confusionPairWinner reads distinguishing bytes', () => {
  expect(['koi8-r', 'koi8-u', null]).toContain(
    confusionPairWinner(UKRAINIAN_KOI8U, 'koi8-r', 'koi8-u'),
  );
});

test('confusionPairWinner without a map declines', () => {
  expect(confusionPairWinner(UKRAINIAN_KOI8U, 'utf-8', 'koi8-u')).toBeNull();
});
