import { vi } from 'vitest';
import jschardet, { detect, detectAll, enableDebug, VERSION } from '../src/index.js';
import pkg from '../package.json' with { type: 'json' };
import charsetTestFile from './fixtures/charset_test_file.php.txt?uint8array';
import windows1252De from './fixtures/windows-1252-de_DE.txt?uint8array';
import shiftJisJaJp from './fixtures/Shift_JIS-ja_JP.txt?uint8array';
import shiftJisJaJpShort from './fixtures/Shift_JIS-ja_JP-short.txt?uint8array';
import windows1250 from './fixtures/windows-1250.txt?uint8array';
import windows1250Ro from './fixtures/windows-1250-ro.srt?uint8array';
import shiftJisCp932Rare from './fixtures/Shift_JIS-cp932-rare.txt?uint8array';
import shiftJisParticleSakura from './fixtures/Shift_JIS-particle_sakura.txt?uint8array';
import gb2312Untitled from './fixtures/gb2312-untitled.txt?uint8array';
import gb18030UserdbPanda from './fixtures/gb18030-userdb_panda.yar.txt?uint8array';
import iso88591Pt from './fixtures/iso-8859-1-pt.txt?uint8array';
import utf8StripSh from './fixtures/utf-8-strip.sh.txt?uint8array';

describe('detectEncodings', () => {
  test("shouldn't accept unknown encodings", () => {
    expect(() => detect(windows1252De, { detectEncodings: ['UTF-14'] }))
      .toThrow('Unknown encoding "UTF-14"');
  });

  test('locks down which encodings to detect', () => {
    const possible = detectAll(windows1252De, { detectEncodings: ['UTF-8', 'windows-1252'] });
    const single = detect(windows1252De, { detectEncodings: ['UTF-8', 'windows-1252'] });
    expect(possible.length).toBe(1);
    expect(possible[0].encoding).toBe('Windows-1252');
    expect(single.encoding).toBe('Windows-1252');
  });

  test('locks down which encodings to detect (SHIFT_JIS)', () => {
    const possible = detectAll(shiftJisJaJp, { detectEncodings: ['UTF-8', 'SHIFT_JIS', 'EUC-JP'] });
    const single = detect(shiftJisJaJp, { detectEncodings: ['UTF-8', 'SHIFT_JIS', 'EUC-JP'] });
    expect(possible.length).toBe(1);
    expect(possible[0].encoding).toBe('SHIFT_JIS');
    expect(single.encoding).toBe('SHIFT_JIS');

    const shortResult = detect(shiftJisJaJpShort, {
      detectEncodings: ['UTF-8', 'SHIFT_JIS', 'EUC-JP'],
    });
    expect(shortResult.encoding).toBe('SHIFT_JIS');
  });
});

describe('Bug regressions', () => {
  // no issue — Latin1Prober skipped content inside angle brackets, causing the
  // entire PHP file body to score zero confidence; the new port has no such
  // heuristic so PHP files are scored like any other byte stream.
  test('Windows-1252 (inside PHP tags)', () => {
    const result = detect(charsetTestFile, { detectEncodings: ['UTF-8', 'windows-1252'] });
    expect(result.encoding).toBe('Windows-1252');
    expect(result.confidence).toBeGreaterThan(0);
  });

  // issue #18 — Romanian cp1250 was misdetected as Windows-1252. With the
  // candidate pool locked to those two encodings, Windows-1250 wins.
  test('Romanian Windows-1250 beats Windows-1252 (issue #18)', () => {
    const result = detect(windows1250Ro, {
      detectEncodings: ['Windows-1250', 'Windows-1252'],
    });
    expect(result.encoding).toBe('Windows-1250');
  });

  // Unconstrained: top candidates should be Latin-2 family encodings flagged as
  // Romanian, with Windows-1252 demoted out of the top tier.
  test('Romanian Windows-1250 ranks above Windows-1252 unconstrained (issue #18)', () => {
    const all = detectAll(windows1250Ro);
    expect(all[0].language).toBe('ro');
    const top3 = all.slice(0, 3).map((r) => r.encoding);
    expect(top3).toContain('Windows-1250');
    expect(top3).not.toContain('Windows-1252');
  });

  // issue #29 — short windows-1252 string with German umlaut was misdetected
  // as EUC-JP; now the CJK structural gate eliminates EUC-JP before scoring.
  test('Windows-1252 short string (issue #29)', () => {
    // <string>Martin Kühl</string>
    const str = '\x3c\x73\x74\x72\x69\x6e\x67\x3e\x4d\x61\x72\x74\x69\x6e\x20\x4b\xfc\x68\x6c\x3c\x2f\x73\x74\x72\x69\x6e\x67\x3e';
    expect(detect(str).encoding).toBe('Windows-1252');
  });

  // issue #30 — known shortcomings on the reporter samples. Both behave
  // identically to upstream chardet 7.4.3, so these are upstream-equivalent
  // gaps rather than port regressions. Marked .fails so they document the
  // ideal outcome and will alert us if the underlying detector ever improves.

  // Sample 1 (bpasero, 2017): 47 bytes of rare CP932 kanji separated by
  // spaces. Ideal: a Japanese encoding wins. Current top 3:
  //   1. Windows-1255 / he   conf 0.0309
  //   2. ISO-8859-8   / he   conf 0.0308
  //   3. iso8859-16   / sk   conf 0.0272
  // All below the 0.20 threshold, so detect() returns null.
  test.fails('Shift-JIS short rare-kanji sample detects as Japanese (issue #30)', () => {
    const all = detectAll(shiftJisCp932Rare);
    expect(all[0].language).toBe('ja');
  });

  // Sample 2 (jyrkive, 2020): 2 KB of real Shift-JIS Japanese. Ideal: a
  // Japanese encoding wins. Current top 3:
  //   1. cp1006    / ur   conf 0.1705
  //   2. cp932     / ja   conf 0.1174
  //   3. SHIFT_JIS / ja   conf 0.1162
  // Japanese candidates are present but cp1006 (Urdu) wrongly takes #1.
  test.fails('Shift-JIS Japanese text ranks above Urdu cp1006 (issue #30)', () => {
    const all = detectAll(shiftJisParticleSakura);
    expect(all[0].language).toBe('ja');
  });

  // issue #34 (bpasero, 2017): 1860 bytes of GB2312 — but only two distinct
  // codepoints (`呵呵哒` repeated). The CJK structural gate eliminates ALL
  // CJK candidates due to the lack of byte-pattern variety, so neither GBK
  // nor GB2312 nor GB18030 appears anywhere in detectAll(). Even passing
  // detectEncodings: ['gb18030'] cannot recover them. Ideal: a Chinese
  // encoding wins. Current top 3 (all 11 surviving candidates are SBCS):
  //   1. cp864      / ar   conf 0.0271
  //   2. ISO-8859-5 / uk   conf 0.0140
  //   3. cp874      / th   conf 0.0081
  // Behaviour matches upstream chardet 7.4.3 exactly.
  test.fails('GB2312 repeated kanji detects as a Chinese encoding (issue #34)', () => {
    const all = detectAll(gb2312Untitled);
    expect(all[0].language).toBe('zh');
  });

  // issue #47 (2018, via discord-irc): short windows-1252 strings with
  // Portuguese/Finnish diacritics were misdetected as Cyrillic encodings
  // (windows-1251 / IBM855), turning "ção" into "згo"; short UTF-8 input
  // ("kyllä") was also misdetected, producing "kyllÃ¤" mojibake. All now
  // resolve correctly. ("ça me fait rire" from the same thread ranks cp850
  // first instead, but identically to upstream chardet 7.4.3, so it is an
  // upstream-equivalent gap and is not pinned here.)
  test('short accented windows-1252 strings (issue #47)', () => {
    // windows-1252: informações
    expect(detect('informa\xe7\xf5es').encoding).toBe('Windows-1252');
    // windows-1252: eu não gosto de diferenciação
    expect(detect('eu n\xe3o gosto de diferencia\xe7\xe3o').encoding).toBe('Windows-1252');
    // windows-1252: çã
    expect(detect('\xe7\xe3').encoding).toBe('Windows-1252');
    // windows-1252: mä en ota riskiä että tää selkä pahenee
    expect(detect('m\xe4 en ota riski\xe4 ett\xe4 t\xe4\xe4 selk\xe4 pahenee').encoding)
      .toBe('Windows-1252');
  });

  test('short UTF-8 string with diacritics (issue #47)', () => {
    const result = detect(new TextEncoder().encode('kyllä'));
    expect(result.encoding).toBe('utf-8');
    expect(result.confidence).toBeGreaterThan(0.20);
  });

  // issue #49 (2018, via Atom): the reporter's userdb_panda.yar — GB-encoded
  // yara rules whose Chinese descriptions use characters beyond GB2312 — was
  // labeled GB2312 @0.99 by jschardet 3.x, so `iconv -f GB2312` failed on it.
  // The fixture is the file's Chinese description lines (GB18030-encoded,
  // undecodable as GB2312). The rewrite unifies the GB family and only reports
  // the GB18030 superset; confidence is low (~0.04, matching upstream chardet)
  // because the sample is short, so encoding + language is the regression
  // surface.
  test('GB text beyond GB2312 reports GB18030, never GB2312 (issue #49)', () => {
    const result = detect(gb18030UserdbPanda);
    expect(result.encoding).toBe('GB18030');
    expect(result.language).toBe('zh');
  });

  // issue #64 (bpasero, 2020): the reporter's strip.sh — UTF-8 shell output
  // with emoji and ANSI escape sequences — was misdetected as ISO-8859-2.
  // Now UTF-8 wins outright and is the only candidate above the threshold.
  test('UTF-8 with emoji and ANSI escapes detects as UTF-8 (issue #64)', () => {
    const result = detect(utf8StripSh);
    expect(result.encoding).toBe('utf-8');
    expect(result.confidence).toBeGreaterThan(0.20);
  });

  // issue #66 — 4 bytes of Big5 ('小七') were misdetected as windows-1252.
  test('detect() returns top candidate on sub-threshold Big5 input (issue #66)', () => {
    const bytes = new Uint8Array([0xa4, 0x70, 0xa4, 0x43]);
    const result = detect(bytes);
    expect(result.encoding).toBe('Big5');
    expect(result.language).toBe('zh');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(0.20);
  });

  // issue #69 — small Portuguese ISO-8859-1 file was misdetected as Windows-1251
  // (Cyrillic). Now ISO-8859-1 wins outright; no Cyrillic candidate appears.
  test('Portuguese ISO-8859-1 detects correctly (issue #69)', () => {
    expect(detect(iso88591Pt).encoding).toBe('ISO-8859-1');
  });

  // issue #70 — reporter wanted windows-1250 detection; detectEncodings narrows
  // candidates and the threshold automatically drops to 0, so the constrained
  // call reliably returns Windows-1250.
  test('Windows-1250 with detectEncodings (issue #70)', () => {
    const possible = detectAll(windows1250, { detectEncodings: ['windows-1250'] });
    expect(possible.length).toBe(1);
    expect(possible[0].encoding).toBe('Windows-1250');
  });

  // issue #88 — the bytes 0x7E 0x7B (`~{`, the HZ-GB-2312 escape sequence)
  // detect as ASCII: both bytes are pure ASCII, so the ASCII stage claims the
  // result before the HZ prober can interfere.
  test('~{ HZ-GB-2312 escape detects as ASCII (issue #88)', () => {
    const result = detect(new Uint8Array([0x7e, 0x7b]));
    expect(result.encoding).toBe('ascii');
    expect(result.confidence).toBe(1);
  });
});

// enableDebug flips a module-level flag that's never reset, so this block
// must run last in the file. The 'before' test must precede the 'after' test
// so the default-off case is observed before enableDebug() is called.
describe('enableDebug', () => {
  test('detect() and detectAll() do not log by default', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    detect(new Uint8Array([0x68, 0x69]));
    detectAll(new Uint8Array([0x68, 0x69]));
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  test('detect() and detectAll() log candidates after enableDebug()', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    enableDebug();

    detect(new Uint8Array([0x68, 0x69])); // 'hi'
    expect(logSpy).toHaveBeenCalledWith('[jschardet] detect candidates:', expect.any(Array));

    logSpy.mockClear();
    detectAll(new Uint8Array([0x68, 0x69]));
    expect(logSpy).toHaveBeenCalledWith('[jschardet] detectAll candidates:', expect.any(Array));

    logSpy.mockRestore();
  });
});

describe('VERSION', () => {
  test('named export matches package.json', () => {
    expect(VERSION).toBe(pkg.version);
  });

  test('default export carries the same value', () => {
    expect(jschardet.VERSION).toBe(pkg.version);
    expect(jschardet.VERSION).toBe(VERSION);
  });
});
