import { EncodingEra } from '../src/enums.js';
import {
  REGISTRY,
  EncodingInfo,
  getCandidates,
  lookupEncoding,
} from '../src/registry.js';

describe('REGISTRY', () => {
  test('entry is frozen', () => {
    const info = REGISTRY['ascii'];
    expect(() => { (info as Record<string, unknown>)['name'] = 'something'; }).toThrow(TypeError);
  });

  test('registry is frozen', () => {
    expect(Object.isFrozen(REGISTRY)).toBe(true);
  });

  test('has more than 50 entries', () => {
    expect(Object.keys(REGISTRY).length).toBeGreaterThan(50);
  });

  test('utf-8 is MODERN_WEB', () => {
    expect(REGISTRY['utf-8'].era & EncodingEra.MODERN_WEB).not.toBe(0);
  });

  test('iso8859-1 is LEGACY_ISO', () => {
    expect(REGISTRY['iso8859-1'].era & EncodingEra.LEGACY_ISO).not.toBe(0);
  });

  test('cp1140 is MAINFRAME and has cp037 alias', () => {
    const cp1140 = REGISTRY['cp1140'];
    expect(cp1140.era & EncodingEra.MAINFRAME).not.toBe(0);
    expect(cp1140.aliases).toContain('cp037');
  });

  test('mac-roman is LEGACY_MAC', () => {
    expect(REGISTRY['mac-roman'].era & EncodingEra.LEGACY_MAC).not.toBe(0);
  });

  test('cp437 is DOS', () => {
    expect(REGISTRY['cp437'].era & EncodingEra.DOS).not.toBe(0);
  });

  test('kz1048 is LEGACY_REGIONAL', () => {
    expect(REGISTRY['kz1048'].era & EncodingEra.LEGACY_REGIONAL).not.toBe(0);
  });

  test('cp273 is MAINFRAME', () => {
    const cp273 = REGISTRY['cp273'];
    expect(cp273.era & EncodingEra.MAINFRAME).not.toBe(0);
    expect(cp273.isMultibyte).toBe(false);
    expect(cp273.name).toBe('cp273');
  });

  test('hp-roman8 is LEGACY_REGIONAL', () => {
    const hp = REGISTRY['hp-roman8'];
    expect(hp.era & EncodingEra.LEGACY_REGIONAL).not.toBe(0);
    expect(hp.isMultibyte).toBe(false);
    expect(hp.name).toBe('hp-roman8');
  });

  test('multibyte encodings flagged correctly', () => {
    expect(REGISTRY['shift_jis_2004'].isMultibyte).toBe(true);
    expect(REGISTRY['iso8859-1'].isMultibyte).toBe(false);
  });

  test('every registry name resolves to itself via lookupEncoding', () => {
    for (const enc of Object.values(REGISTRY)) {
      expect(lookupEncoding(enc.name)).toBe(enc.name);
    }
  });

  test('no alias claimed by two different entries', () => {
    const claims = new Map<string, Set<string>>();
    for (const entry of Object.values(REGISTRY)) {
      const nameKey = entry.name.toLowerCase();
      if (!claims.has(nameKey)) claims.set(nameKey, new Set());
      claims.get(nameKey)!.add(entry.name);
      for (const alias of entry.aliases) {
        const aliasKey = alias.toLowerCase();
        if (aliasKey === nameKey) continue; // self-alias
        if (!claims.has(aliasKey)) claims.set(aliasKey, new Set());
        claims.get(aliasKey)!.add(entry.name);
      }
    }
    const collisions: Record<string, string[]> = {};
    for (const [name, owners] of claims) {
      if (owners.size > 1) collisions[name] = [...owners].sort();
    }
    expect(collisions).toEqual({});
  });

  test('every entry has a valid languages tuple', () => {
    for (const enc of Object.values(REGISTRY)) {
      expect(Array.isArray(enc.languages)).toBe(true);
      for (const lang of enc.languages) {
        expect(typeof lang).toBe('string');
        expect(lang.length).toBe(2);
      }
    }
  });

  test('single-language encodings spot-check', () => {
    expect(REGISTRY['shift_jis_2004'].languages).toEqual(['ja']);
    expect(REGISTRY['euc_kr'].languages).toEqual(['ko']);
    expect(REGISTRY['gb18030'].languages).toEqual(['zh']);
    expect(REGISTRY['cp273'].languages).toEqual(['de']);
    expect(REGISTRY['koi8-r'].languages).toEqual(['ru']);
  });

  test('multi-language encodings spot-check', () => {
    expect(REGISTRY['cp1252'].languages).toContain('en');
    expect(REGISTRY['cp1252'].languages).toContain('fr');
    expect(REGISTRY['cp1251'].languages).toContain('ru');
    expect(REGISTRY['cp1251'].languages).toContain('bg');
  });

  test('unicode and ASCII encodings have empty languages', () => {
    expect(REGISTRY['ascii'].languages).toEqual([]);
    expect(REGISTRY['utf-8'].languages).toEqual([]);
    expect(REGISTRY['utf-7'].languages).toEqual([]);
    expect(REGISTRY['utf-16'].languages).toEqual([]);
  });

  test('utf-7 is LEGACY_REGIONAL, not MODERN_WEB', () => {
    expect(REGISTRY['utf-7'].era & EncodingEra.LEGACY_REGIONAL).not.toBe(0);
    expect(REGISTRY['utf-7'].era & EncodingEra.MODERN_WEB).toBe(0);
  });

  test('big5hkscs is the primary name with big5 as alias', () => {
    const entry = REGISTRY['big5hkscs'];
    expect(entry.name).toBe('big5hkscs');
    expect(entry.aliases).toContain('big5');
    expect(entry.aliases).toContain('big5-tw');
    expect(entry.aliases).toContain('csbig5');
    expect(entry.aliases).toContain('cp950');
    expect(entry.isMultibyte).toBe(true);
    expect(entry.languages).toEqual(['zh']);
  });

  test('gb18030 has gb2312 and gbk aliases', () => {
    const entry = REGISTRY['gb18030'];
    expect(entry.aliases).toContain('gb2312');
    expect(entry.aliases).toContain('gbk');
    expect(entry.aliases).toContain('gb-18030');
  });

  test('euc_jis_2004 is primary with euc-jp as alias', () => {
    const entry = REGISTRY['euc_jis_2004'];
    expect(entry.name).toBe('euc_jis_2004');
    expect(entry.aliases).toContain('euc-jp');
    expect(entry.aliases).toContain('eucjp');
    expect(entry.aliases).toContain('ujis');
    expect(entry.aliases).toContain('u-jis');
    expect(entry.aliases).toContain('euc-jisx0213');
    expect(entry.isMultibyte).toBe(true);
    expect(entry.languages).toEqual(['ja']);
  });

  test('shift_jis_2004 is primary with shift_jis as alias', () => {
    const entry = REGISTRY['shift_jis_2004'];
    expect(entry.name).toBe('shift_jis_2004');
    expect(entry.aliases).toContain('shift_jis');
    expect(entry.aliases).toContain('sjis');
    expect(entry.aliases).toContain('shiftjis');
    expect(entry.aliases).toContain('s_jis');
    expect(entry.aliases).toContain('shift-jisx0213');
    expect(entry.isMultibyte).toBe(true);
    expect(entry.languages).toEqual(['ja']);
  });

  test('iso-2022-jp split into three branches', () => {
    expect('iso-2022-jp' in REGISTRY).toBe(false);
    const jp2 = REGISTRY['iso2022_jp_2'];
    expect(jp2.aliases).toContain('iso-2022-jp');
    expect(jp2.aliases).toContain('csiso2022jp');
    expect(jp2.aliases).toContain('iso2022-jp-1');
    expect(jp2.isMultibyte).toBe(true);

    const jp2004 = REGISTRY['iso2022_jp_2004'];
    expect(jp2004.aliases).toContain('iso2022-jp-3');
    expect(jp2004.isMultibyte).toBe(true);

    const jpext = REGISTRY['iso2022_jp_ext'];
    expect(jpext.aliases).toEqual(['ISO-2022-JP-EXT']);
    expect(jpext.isMultibyte).toBe(true);
  });

  test('cp1140 is primary with cp037 as alias', () => {
    expect('cp1140' in REGISTRY).toBe(true);
    const entry = REGISTRY['cp1140'];
    expect(entry.aliases).toContain('cp037');
    expect(entry.name).toBe('cp1140');
    expect(entry.era & EncodingEra.MAINFRAME).not.toBe(0);
    // cp500 is its own separate entry
    expect('cp500' in REGISTRY).toBe(true);
    expect(REGISTRY['cp500'].name).toBe('cp500');
  });

  test('tis-620 has iso-8859-11 alias', () => {
    const entry = REGISTRY['tis-620'];
    expect(entry.aliases).toContain('iso-8859-11');
    expect(entry.aliases).toContain('tis620');
  });
});

describe('getCandidates', () => {
  test('filters by era', () => {
    const modern = getCandidates(EncodingEra.MODERN_WEB);
    for (const enc of modern) {
      expect(enc.era & EncodingEra.MODERN_WEB).not.toBe(0);
    }
  });

  test('ALL returns all registry entries', () => {
    const all = getCandidates(EncodingEra.ALL);
    expect(all.length).toBe(Object.keys(REGISTRY).length);
  });

  test('combined eras', () => {
    const combined = getCandidates(EncodingEra.MODERN_WEB | EncodingEra.LEGACY_ISO);
    const names = new Set(combined.map(e => e.name));
    expect(names.has('utf-8')).toBe(true);
    expect(names.has('iso8859-1')).toBe(true);
  });
});

describe('lookupEncoding', () => {
  test('returns canonical for windows-1252 variants', () => {
    expect(lookupEncoding('windows-1252')).toBe('cp1252');
    expect(lookupEncoding('WINDOWS-1252')).toBe('cp1252');
    expect(lookupEncoding('Windows-1252')).toBe('cp1252');
  });

  test('resolves aliases', () => {
    expect(lookupEncoding('us-ascii')).toBe('ascii');
    expect(lookupEncoding('utf8')).toBe('utf-8');
    expect(lookupEncoding('big5')).toBe('big5hkscs');
    expect(lookupEncoding('gb2312')).toBe('gb18030');
  });

  test('resolves canonical name to itself', () => {
    expect(lookupEncoding('cp1252')).toBe('cp1252');
  });

  test('returns null for unknown encoding', () => {
    expect(lookupEncoding('not-a-real-encoding')).toBeNull();
  });

  test('case-insensitive canonical names', () => {
    expect(lookupEncoding('ASCII')).toBe('ascii');
    expect(lookupEncoding('UTF-8')).toBe('utf-8');
    expect(lookupEncoding('UTF-7')).toBe('utf-7');
  });

  test('falls back to codec alias map for Python-specific aliases', () => {
    // latin_1 (underscore) is not in registry aliases but Python knows it
    expect(lookupEncoding('latin_1')).toBe('iso8859-1');
  });

  test('returns null for completely unknown names', () => {
    expect(lookupEncoding('no_such_codec_xyz')).toBeNull();
  });

  test('returns null for names with embedded null bytes', () => {
    expect(lookupEncoding('\x00utf-8')).toBeNull();
    expect(lookupEncoding('utf-8\x00')).toBeNull();
    expect(lookupEncoding('\x00')).toBeNull();
  });

  test('returns null for Python-only codecs not in chardet registry', () => {
    for (const name of ['idna', 'punycode', 'rot_13']) {
      expect(lookupEncoding(name)).toBeNull();
    }
  });
});
