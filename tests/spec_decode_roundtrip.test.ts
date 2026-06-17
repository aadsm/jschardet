// Port of chardet/tests/test_spec_decode_roundtrip.py.
//
// Verifies that every encoding name chardet can return decodes cleanly
// through Python's bytes.decode() without leaking a U+FEFF character or
// raising UnicodeDecodeError. This is the regression guard for the class of
// bug closed by upstream chardet PR #365 (chardet/chardet#365), where
// returning utf-16-le/utf-16-be for BOM-prefixed input produced a leading
// U+FEFF in the user's decoded string.
//
// For each entry in REGISTRY the test verifies:
//
// 1. Clean decode: bytes.decode(name) does not raise.
// 2. No BOM leak: decoded text does not contain U+FEFF.
// 3. Byte-level round-trip: decoded.encode(name) == sample_bytes.
// 4. Alias parity: every alias in REGISTRY[name].aliases resolves to
//    the same canonical via lookupEncoding.
// 5. detect() top-pick parity: detect(sample) returns a name that also
//    satisfies (1)-(2).
// 6. compatNames=true parity: same, with the chardet 6.x drop-in names.
// 7. detectAll() narrow parity: every candidate is a valid Python codec
//    name and none leak U+FEFF on decode.
//
// Codec ground truth comes from a Python codec oracle (see
// tests/helpers/codecs.ts for why neither iconv-lite nor TextDecoder is
// adequate as the oracle here).

import { detect, detectAll } from '../src/chardet.js';
import { REGISTRY, lookupEncoding } from '../src/registry.js';
import {
  decode,
  encode,
  codecs,
  UnicodeDecodeError,
  LookupError,
  _shutdown,
} from './helpers/codecs.js';

// ---------------------------------------------------------------------------
// Sample-text strategy
// ---------------------------------------------------------------------------

// Explicit sample text for encodings where the default "Hello, world!" is
// too trivial -- specifically the CJK family, where we want to exercise
// multi-byte sequences with language-native text. All 86 registry encodings
// can successfully encode "Hello, world!" (including the EBCDIC family), so
// we only override where we want a richer sample.
const _ZH_SAMPLE = '你好,世界!';
const _JA_SAMPLE = 'こんにちは、世界!';
const _KO_SAMPLE = '안녕하세요, 세계!';

const _ENCODING_TEXT: Record<string, string> = {
  // Chinese
  'gb18030': _ZH_SAMPLE,
  'big5hkscs': _ZH_SAMPLE,
  'hz': _ZH_SAMPLE,
  // Japanese
  'cp932': _JA_SAMPLE,
  'shift_jis_2004': _JA_SAMPLE,
  'euc_jis_2004': _JA_SAMPLE,
  'iso2022_jp_2': _JA_SAMPLE,
  'iso2022_jp_2004': _JA_SAMPLE,
  'iso2022_jp_ext': _JA_SAMPLE,
  // Korean
  'cp949': _KO_SAMPLE,
  'euc_kr': _KO_SAMPLE,
  'johab': _KO_SAMPLE,
  'iso2022_kr': _KO_SAMPLE,
  // UTF-7: mixed ASCII + CJK exercises the +...- escape run, which is what
  // chardet's detector actually looks for. Pure ASCII would make detect()
  // return "ascii" and the detect-side tests would be tautological.
  'utf-7': 'Hello, 世界!',
};

const _DEFAULT_TEXT = 'Hello, world!';

interface Sample { bytes: Uint8Array; text: string; }

async function _makeSample(encodingName: string): Promise<Sample> {
  const text = _ENCODING_TEXT[encodingName] ?? _DEFAULT_TEXT;
  const bytes = await encode(text, encodingName);
  return { bytes, text };
}

function _bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function _hex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Parametrised tests
// ---------------------------------------------------------------------------

const ALL_ENCODINGS: string[] = Object.keys(REGISTRY).sort();
const ROWS: Array<[string]> = ALL_ENCODINGS.map(name => [name]);

afterAll(async () => {
  await _shutdown();
});

describe('decode sample is clean', () => {
  test.each(ROWS)('%s', async (encodingName) => {
    const { bytes, text } = await _makeSample(encodingName);
    const decoded = await decode(bytes, encodingName);
    expect(decoded.includes('﻿')).toBe(false);
    expect(decoded).toBe(text);
  });
});

describe('bytes round-trip', () => {
  test.each(ROWS)('%s', async (encodingName) => {
    const { bytes } = await _makeSample(encodingName);
    const decoded = await decode(bytes, encodingName);
    const reencoded = await encode(decoded, encodingName);
    if (!_bytesEqual(reencoded, bytes)) {
      throw new Error(
        `${encodingName}: re-encode ${_hex(reencoded)} != original ${_hex(bytes)}`,
      );
    }
  });
});

describe('aliases resolve to same canonical', () => {
  test.each(ROWS)('%s', (encodingName) => {
    const entry = REGISTRY[encodingName as keyof typeof REGISTRY];
    const failures: string[] = [];
    for (const alias of entry.aliases) {
      const resolved = lookupEncoding(alias);
      if (resolved === null) {
        failures.push(`  ${JSON.stringify(alias)}: lookupEncoding returned null`);
        continue;
      }
      if (resolved !== encodingName) {
        failures.push(
          `  ${JSON.stringify(alias)}: resolves to ${JSON.stringify(resolved)}, expected ${JSON.stringify(encodingName)}`,
        );
      }
    }
    if (failures.length > 0) {
      throw new Error(`${encodingName} alias parity failed:\n${failures.join('\n')}`);
    }
  });
});

describe('detect top pick decodes cleanly', () => {
  test.each(ROWS)('%s', async (encodingName) => {
    const { bytes } = await _makeSample(encodingName);
    const result = detect(bytes, { compatNames: false });
    const detected = result.encoding;
    expect(detected).not.toBeNull();
    let decoded: string;
    try {
      decoded = await decode(bytes, detected!);
    } catch (exc) {
      if (exc instanceof UnicodeDecodeError || exc instanceof LookupError) {
        throw new Error(
          `${encodingName}: detect returned ${JSON.stringify(detected)}, which raised on decode: ${exc.name}: ${exc.message}`,
        );
      }
      throw exc;
    }
    if (decoded.includes('﻿')) {
      throw new Error(
        `${encodingName}: detect returned ${JSON.stringify(detected)}, whose decode leaks U+FEFF: ${JSON.stringify(decoded)}`,
      );
    }
  });
});

describe('detect compat names decodes cleanly', () => {
  test.each(ROWS)('%s', async (encodingName) => {
    const { bytes } = await _makeSample(encodingName);
    const result = detect(bytes, { compatNames: true });
    const detected = result.encoding;
    expect(detected).not.toBeNull();
    let decoded: string;
    try {
      decoded = await decode(bytes, detected!);
    } catch (exc) {
      if (exc instanceof UnicodeDecodeError || exc instanceof LookupError) {
        throw new Error(
          `${encodingName}: compat name ${JSON.stringify(detected)} is not Python-decodable (breaks chardet 6.x drop-in contract): ${exc.name}: ${exc.message}`,
        );
      }
      throw exc;
    }
    if (decoded.includes('﻿')) {
      throw new Error(
        `${encodingName}: compat name ${JSON.stringify(detected)} decodes to leaked U+FEFF: ${JSON.stringify(decoded)}`,
      );
    }
  });
});

describe('detectAll candidates are safe', () => {
  test.each(ROWS)('%s', async (encodingName) => {
    const { bytes } = await _makeSample(encodingName);
    const candidates = detectAll(bytes, { compatNames: false, ignoreThreshold: true });
    const failures: string[] = [];
    for (const candidate of candidates) {
      const name = candidate.encoding;
      if (name === null) continue;
      try {
        await codecs.lookup(name);
      } catch (exc) {
        if (exc instanceof LookupError) {
          failures.push(`  detectAll returned ${JSON.stringify(name)} which is not a valid Python codec`);
          continue;
        }
        throw exc;
      }
      let decoded: string;
      try {
        decoded = await decode(bytes, name);
      } catch (exc) {
        if (exc instanceof UnicodeDecodeError) {
          // A runner-up that can't decode the bytes is an expected outcome
          // for a wrong encoding guess; not a failure.
          continue;
        }
        throw exc;
      }
      if (decoded.includes('﻿')) {
        failures.push(`  detectAll candidate ${JSON.stringify(name)} decodes to leaked U+FEFF: ${JSON.stringify(decoded)}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`${encodingName}:\n${failures.join('\n')}`);
    }
  });
});
