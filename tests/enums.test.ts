import { EncodingEra } from '../src/enums.js';

describe('EncodingEra', () => {
  test('all expected members exist', () => {
    const expected = new Set(['MODERN_WEB', 'LEGACY_ISO', 'LEGACY_MAC', 'LEGACY_REGIONAL', 'DOS', 'MAINFRAME', 'ALL']);
    expect(new Set(Object.keys(EncodingEra))).toEqual(expected);
  });

  test('bitwise OR combines flags', () => {
    const combined = EncodingEra.MODERN_WEB | EncodingEra.LEGACY_ISO;
    expect(combined & EncodingEra.MODERN_WEB).not.toBe(0);
    expect(combined & EncodingEra.LEGACY_ISO).not.toBe(0);
    expect(combined & EncodingEra.DOS).toBe(0);
  });

  test('ALL contains every member', () => {
    for (const [name, value] of Object.entries(EncodingEra)) {
      if (name !== 'ALL') {
        expect(EncodingEra.ALL & value).not.toBe(0);
      }
    }
  });

  test('non-ALL values are powers of two', () => {
    for (const [name, value] of Object.entries(EncodingEra)) {
      if (name !== 'ALL') {
        expect(value & (value - 1)).toBe(0);
      }
    }
  });
});
