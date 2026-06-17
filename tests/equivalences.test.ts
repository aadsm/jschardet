import {
  applyLegacyRename,
  isCorrect,
  isLanguageEquivalent,
  _COMPAT_NAMES,
} from '../src/equivalences.js';
import { isEquivalentDetection } from './utils.js';
import { DetectionResult } from '../src/pipeline/index.js';

function makeResult(encoding: string | null): DetectionResult {
  return { encoding, confidence: 1.0, language: null, mimeType: null };
}

describe('isEquivalentDetection', () => {
  test('identical decode returns true', () => {
    const data = new TextEncoder().encode('Hello, world!');
    expect(isEquivalentDetection(data, 'ascii', 'utf-8')).toBe(true);
  });

  test('base letter match returns true', () => {
    // 0xC3 is A-tilde in iso-8859-1, A-breve in iso-8859-2; both strip to "A"
    const data = new Uint8Array([0xc3]);
    expect(isEquivalentDetection(data, 'iso-8859-1', 'iso-8859-2')).toBe(true);
  });

  test('completely different decode returns false', () => {
    const data = new Uint8Array([0xc0, 0xc1, 0xc2, 0xc3, 0xc4]);
    expect(isEquivalentDetection(data, 'iso-8859-1', 'iso-8859-5')).toBe(false);
  });

  test('null detected returns false', () => {
    const data = new TextEncoder().encode('Hello');
    expect(isEquivalentDetection(data, 'utf-8', null)).toBe(false);
  });

  test('decode error returns false', () => {
    // 0x81 is not a valid UTF-8 lead byte
    const data = new Uint8Array([0x81, 0x82, 0x83]);
    expect(isEquivalentDetection(data, 'iso-8859-1', 'utf-8')).toBe(false);
  });

  test('empty data returns true', () => {
    expect(isEquivalentDetection(new Uint8Array(), 'utf-8', 'iso-8859-1')).toBe(true);
  });

  test('normalized name match returns true', () => {
    const data = new TextEncoder().encode('Hello');
    expect(isEquivalentDetection(data, 'UTF-8', 'utf8')).toBe(true);
  });

  test('unknown encoding returns false', () => {
    const data = new TextEncoder().encode('Hello');
    expect(isEquivalentDetection(data, 'utf-8', 'not-a-real-encoding')).toBe(false);
  });

  test('currency sign vs euro sign accepted', () => {
    // 0xA4 = ¤ in iso-8859-1, € in iso-8859-15
    const data = new Uint8Array([0xa4]);
    expect(isEquivalentDetection(data, 'iso-8859-1', 'iso-8859-15')).toBe(true);
  });

  test('symbol vs letter difference returns false', () => {
    // 0xD7 = × in iso-8859-1, Ч in iso-8859-5
    const data = new Uint8Array([0xd7]);
    expect(isEquivalentDetection(data, 'iso-8859-1', 'iso-8859-5')).toBe(false);
  });

  test('expected null, detected null returns true', () => {
    expect(isEquivalentDetection(new Uint8Array([0x00, 0x01]), null, null)).toBe(true);
  });

  test('expected null, detected encoding returns false', () => {
    expect(isEquivalentDetection(new Uint8Array([0x00, 0x01]), null, 'utf-8')).toBe(false);
  });
});

describe('isCorrect', () => {
  test('exact match', () => {
    expect(isCorrect('utf-8', 'utf-8')).toBe(true);
  });

  test('null detected returns false', () => {
    expect(isCorrect('utf-8', null)).toBe(false);
  });

  test('superset is correct', () => {
    expect(isCorrect('ascii', 'utf-8')).toBe(true);
  });

  test('superset reversed is wrong', () => {
    expect(isCorrect('utf-8', 'ascii')).toBe(false);
  });

  test('expected null, detected null returns true', () => {
    expect(isCorrect(null, null)).toBe(true);
  });

  test('expected null, detected encoding returns false', () => {
    expect(isCorrect(null, 'utf-8')).toBe(false);
  });

  test('superset equivalences for renamed encodings', () => {
    expect(isCorrect('big5', 'big5hkscs')).toBe(true);
    expect(isCorrect('euc-jp', 'euc-jis-2004')).toBe(true);
    expect(isCorrect('shift_jis', 'shift_jis_2004')).toBe(true);
    expect(isCorrect('cp037', 'cp1140')).toBe(true);
    expect(isCorrect('iso-2022-jp', 'iso2022-jp-2')).toBe(true);
    expect(isCorrect('iso-2022-jp', 'iso2022-jp-2004')).toBe(true);
    expect(isCorrect('iso-2022-jp', 'iso2022-jp-ext')).toBe(true);
  });

  test('iso2022-jp branches are bidirectional', () => {
    expect(isCorrect('iso2022-jp-2', 'iso2022-jp-2004')).toBe(true);
    expect(isCorrect('iso2022-jp-2004', 'iso2022-jp-ext')).toBe(true);
    expect(isCorrect('iso2022-jp-ext', 'iso2022-jp-2')).toBe(true);
  });
});

describe('applyLegacyRename', () => {
  test('renames ascii to cp1252', () => {
    const d = makeResult('ascii');
    applyLegacyRename(d);
    expect(d.encoding).toBe('cp1252');
  });

  test('no match passes through', () => {
    const d = makeResult('utf-8');
    applyLegacyRename(d);
    expect(d.encoding).toBe('utf-8');
  });

  test('null encoding passes through', () => {
    const d = makeResult(null);
    applyLegacyRename(d);
    expect(d.encoding).toBeNull();
  });
});

describe('isLanguageEquivalent', () => {
  test('exact match', () => {
    expect(isLanguageEquivalent('ru', 'ru')).toBe(true);
  });

  test('East Slavic + Bulgarian group', () => {
    expect(isLanguageEquivalent('uk', 'ru')).toBe(true);
    expect(isLanguageEquivalent('ru', 'bg')).toBe(true);
    expect(isLanguageEquivalent('bg', 'be')).toBe(true);
  });

  test('Scandinavian group', () => {
    expect(isLanguageEquivalent('no', 'da')).toBe(true);
    expect(isLanguageEquivalent('da', 'sv')).toBe(true);
    expect(isLanguageEquivalent('sv', 'no')).toBe(true);
  });

  test('Malay / Indonesian', () => {
    expect(isLanguageEquivalent('ms', 'id')).toBe(true);
    expect(isLanguageEquivalent('id', 'ms')).toBe(true);
  });

  test('Czech / Slovak', () => {
    expect(isLanguageEquivalent('sk', 'cs')).toBe(true);
    expect(isLanguageEquivalent('cs', 'sk')).toBe(true);
  });

  test('different groups are not equivalent', () => {
    expect(isLanguageEquivalent('ru', 'da')).toBe(false);
    expect(isLanguageEquivalent('sk', 'sv')).toBe(false);
  });

  test('unknown language codes return false', () => {
    expect(isLanguageEquivalent('xx', 'yy')).toBe(false);
    expect(isLanguageEquivalent('en', 'fr')).toBe(false);
  });
});

describe('_COMPAT_NAMES', () => {
  test('maps codec names to display names', () => {
    expect(_COMPAT_NAMES['big5hkscs']).toBe('Big5');
    expect(_COMPAT_NAMES['cp855']).toBe('IBM855');
    expect(_COMPAT_NAMES['euc_jis_2004']).toBe('EUC-JP');
    expect(_COMPAT_NAMES['iso2022_jp_2']).toBe('ISO-2022-JP');
    expect(_COMPAT_NAMES['shift_jis_2004']).toBe('SHIFT_JIS');
    expect(_COMPAT_NAMES['cp1252']).toBe('Windows-1252');
    expect(_COMPAT_NAMES['cp1251']).toBe('Windows-1251');
    expect(_COMPAT_NAMES['iso8859-1']).toBe('ISO-8859-1');
    expect('ascii' in _COMPAT_NAMES).toBe(false);
    expect('utf-8' in _COMPAT_NAMES).toBe(false);
  });
});
