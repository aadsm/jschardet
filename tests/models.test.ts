import {
  loadModels,
  getEncIndex,
  scoreBestLanguage,
  scoreWithProfile,
  BigramProfile,
  _parseModelsBin,
  _buildEncIndex,
} from '../src/models/index.js';

// ---------------------------------------------------------------------------
// Helpers for building synthetic models.bin payloads. Mirrors Python's
// struct.pack("!I", ...) and struct.pack("!d", ...). Phase 1 trailing blob is
// raw bytes (no zlib wrapper).
// ---------------------------------------------------------------------------

function packU32(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, n, false);
  return buf;
}

function packF64(n: number): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setFloat64(0, n, false);
  return buf;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const CMD2 = new Uint8Array([0x43, 0x4D, 0x44, 0x32]);

function encodeUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// ---------------------------------------------------------------------------
// load_models / get_enc_index
// ---------------------------------------------------------------------------

describe('loadModels', () => {
  test('returns a Map', () => {
    expect(loadModels()).toBeInstanceOf(Map);
  });

  test('has entries', () => {
    expect(loadModels().size).toBeGreaterThan(0);
  });

  test('keys are strings', () => {
    for (const key of loadModels().keys()) {
      expect(typeof key).toBe('string');
    }
  });
});

describe('getEncIndex', () => {
  test('resolves aliases — canonical names accessible', () => {
    const index = getEncIndex();
    // Models keyed by old names should be accessible under new primary names.
    expect(index.has('big5hkscs')).toBe(true);
    expect(index.has('euc_jis_2004')).toBe(true);
    expect(index.has('shift_jis_2004')).toBe(true);
    expect(index.has('cp1140')).toBe(true);
  });
});

describe('_buildEncIndex', () => {
  test('non-canonical key gets canonical alias added', () => {
    // "utf8" is a non-canonical alias for "utf-8".
    const fakeModel = new Uint8Array(65536);
    fakeModel[(0xC3 << 8) | 0xA9] = 100;
    const fakeModels = new Map<string, Uint8Array>([['French/utf8', fakeModel]]);

    const index = _buildEncIndex(fakeModels);

    expect(index.has('utf8')).toBe(true);
    expect(index.has('utf-8')).toBe(true);
    // Both should point to the same entries.
    expect(index.get('utf-8')).toBe(index.get('utf8'));
  });
});

// ---------------------------------------------------------------------------
// score_best_language
// ---------------------------------------------------------------------------

describe('scoreBestLanguage', () => {
  test('returns a number in (0, 1] for English text against cp1252', () => {
    const data = new TextEncoder().encode('Hello world this is a test');
    const [score] = scoreBestLanguage(data, 'cp1252');
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  test('unknown encoding returns 0', () => {
    const data = new TextEncoder().encode('Hello');
    const [score] = scoreBestLanguage(data, 'not-a-real-encoding');
    expect(score).toBe(0);
  });

  test('empty data returns 0', () => {
    // Mirrors Python: passes the first model key (lang/enc form), relying on
    // the empty-data early-return to short-circuit before any lookup.
    const encoding = loadModels().keys().next().value!;
    const [score] = scoreBestLanguage(new Uint8Array(0), encoding);
    expect(score).toBe(0);
  });

  test('high-byte and ASCII inputs both produce valid scores', () => {
    const models = loadModels();
    // Pick the first model and parse out its encoding.
    const firstKey = models.keys().next().value!;
    const encoding = firstKey.split('/')[1];
    const model = models.get(firstKey)!;

    // Build data from high-byte pairs that exist in the model.
    const highPairs: Array<[number, number]> = [];
    for (let idx = 0; idx < 65536 && highPairs.length < 20; idx++) {
      if (model[idx] > 0) {
        const b1 = idx >> 8;
        const b2 = idx & 0xFF;
        if (b1 > 0x7F || b2 > 0x7F) {
          highPairs.push([b1, b2]);
        }
      }
    }

    if (highPairs.length === 0) return; // pathological, but mirror Python's guard

    const highData = new Uint8Array(highPairs.flatMap(([a, b]) => [a, b]));
    const asciiData = new TextEncoder().encode('the quick brown fox jumps over the lazy dog');

    const [highScore] = scoreBestLanguage(highData, encoding);
    const [asciiScore] = scoreBestLanguage(asciiData, encoding);

    expect(typeof highScore).toBe('number');
    expect(typeof asciiScore).toBe('number');
    expect(highScore).toBeGreaterThanOrEqual(0);
    expect(highScore).toBeLessThanOrEqual(1);
    expect(asciiScore).toBeGreaterThanOrEqual(0);
    expect(asciiScore).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// BigramProfile
// ---------------------------------------------------------------------------

describe('BigramProfile', () => {
  test('empty input → weightSum 0, no nonzero indices', () => {
    const p = new BigramProfile(new Uint8Array(0));
    expect(p.weightSum).toBe(0);
    expect(p.nonzero.length).toBe(0);
  });

  test('single byte → weightSum 0 (no bigram)', () => {
    const p = new BigramProfile(new Uint8Array([0x41]));
    expect(p.weightSum).toBe(0);
  });

  test('ASCII bigram → weightSum > 0', () => {
    const p = new BigramProfile(new Uint8Array([0x41, 0x42]));
    expect(p.weightSum).toBeGreaterThan(0);
  });

  test('high-byte bigram → weightSum >= 1', () => {
    const p = new BigramProfile(new Uint8Array([0xC3, 0xA9]));
    expect(p.weightSum).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// scoreWithProfile
// ---------------------------------------------------------------------------

describe('scoreWithProfile', () => {
  test('empty modelKey → norm computed on the fly', () => {
    const profile = new BigramProfile(new Uint8Array([0xC3, 0xA9, 0xC3, 0xA4]));
    const model = new Uint8Array(65536);
    model[(0xC3 << 8) | 0xA9] = 100;
    model[(0xC3 << 8) | 0xA4] = 80;
    const score = scoreWithProfile(profile, model, '');
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThan(0);
  });

  test('all-zeros model → 0 (model norm is 0)', () => {
    const profile = new BigramProfile(new Uint8Array([0xC3, 0xA9, 0xC3, 0xA4]));
    const model = new Uint8Array(65536);
    const score = scoreWithProfile(profile, model, '');
    expect(score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// _parseModelsBin — error paths and a synthetic happy path
// ---------------------------------------------------------------------------

// Tests deferred from chardet/tests/test_models.py because they require module
// mocking (Python's unittest.mock.patch.object on importlib.resources). ESM
// module mocking is awkward; revisit when we have a reason — these check
// user-facing warnings, not core logic.
describe('deferred — module mocking required', () => {
  test.todo('test_get_idf_weights_wrong_size — wrong-size idf.bin warns and returns uniform weights');
  test.todo('test_load_models_empty_file — empty models.bin warns and returns empty Map');
});

// Deferred to Step 9 (accuracy suite): test_all_test_data_pairs_have_models
// depends on the chardet/test-data clone and asserts every encoding-language
// pair in the corpus has a bigram model. Lands alongside tests/accuracy.test.ts.
describe('deferred — Step 9 corpus dependency', () => {
  test.todo('test_all_test_data_pairs_have_models — every test-data pair has a model');
});

describe('_parseModelsBin', () => {
  test('missing CMD2 magic → throws', () => {
    const data = packU32(1); // 4 bytes that are not "CMD2"
    expect(() => _parseModelsBin(data)).toThrow(/missing CMD2 magic/);
  });

  test('num_models > 10000 → throws', () => {
    const data = concat(CMD2, packU32(10001));
    expect(() => _parseModelsBin(data)).toThrow(/num_models=10001 exceeds limit/);
  });

  test('name_len > 256 → throws', () => {
    const data = concat(CMD2, packU32(1), packU32(300));
    expect(() => _parseModelsBin(data)).toThrow(/name_len=300 exceeds 256/);
  });

  test('truncated header → throws', () => {
    // CMD2 + num_models=1 but no name/norm bytes.
    const data = concat(CMD2, packU32(1));
    expect(() => _parseModelsBin(data)).toThrow(/corrupt models\.bin/);
  });

  test('invalid UTF-8 in model name → throws', () => {
    const invalidName = new Uint8Array([0xFF, 0xFE]);
    const data = concat(CMD2, packU32(1), packU32(invalidName.length), invalidName);
    expect(() => _parseModelsBin(data)).toThrow(/corrupt models\.bin/);
  });

  test('blob size mismatch → throws', () => {
    // Header claims 2 models but blob only has 1 model's worth of bytes.
    const name1 = encodeUtf8('a/enc1');
    const name2 = encodeUtf8('b/enc2');
    const header = concat(
      CMD2, packU32(2),
      packU32(name1.length), name1, packF64(0),
      packU32(name2.length), name2, packF64(0),
    );
    const blob = new Uint8Array(65536); // only 1 model
    const data = concat(header, blob);
    expect(() => _parseModelsBin(data)).toThrow(/blob size .* expected decompressed size/);
  });

  // Phase 2 (Step 10): port test_load_models_v2_corrupt_zlib once _parseModelsBin
  // calls inflate() on the trailing blob. Phase 1 ships raw bytes so corrupt-zlib
  // has no equivalent here.
  test.todo('Phase 2: corrupt zlib data → throws');

  test('happy path — single synthetic model parses correctly', () => {
    const name = encodeUtf8('fr/cp1252');
    const table = new Uint8Array(65536);
    table[(0xE9 << 8) | 0x20] = 200; // é followed by space
    table[(0x6C << 8) | 0x65] = 50;  // "le"
    const sqSum = 200 * 200 + 50 * 50;
    const norm = Math.sqrt(sqSum);

    const data = concat(
      CMD2, packU32(1),
      packU32(name.length), name, packF64(norm),
      table,
    );
    const { models, norms } = _parseModelsBin(data);
    expect(models.has('fr/cp1252')).toBe(true);
    expect(models.get('fr/cp1252')![(0xE9 << 8) | 0x20]).toBe(200);
    expect(models.get('fr/cp1252')![(0x6C << 8) | 0x65]).toBe(50);
    expect(norms.get('fr/cp1252')).toBe(norm);
  });
});
