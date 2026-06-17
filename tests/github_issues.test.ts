// Port of chardet/tests/test_github_issues.py.
//
// Regression tests from chardet/chardet GitHub issues. Each test corresponds
// to a specific bug report with a reproducible test case.

import { detect } from '../src/chardet.js';
import { EncodingEra } from '../src/enums.js';
import { isCorrect } from '../src/equivalences.js';
import { isEquivalentDetection } from './utils.js';

function bytes(s: string): Uint8Array {
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

function assertDetection(data: Uint8Array, expected: string, era = EncodingEra.ALL): void {
  const result = detect(data, { encodingEra: era, preferSuperset: true });
  const detected = result.encoding;
  if (!isCorrect(expected, detected) && !isEquivalentDetection(data, expected, detected)) {
    throw new Error(`expected=${expected}, got=${detected} (confidence=${result.confidence.toFixed(2)})`);
  }
}

// ==========================================================================
// SHORT INPUT / SINGLE CHARACTER UTF-8 DETECTION
// ==========================================================================

describe('TestShortUtf8', () => {
  test('single eacute — issue #37', () => {
    assertDetection(bytes('\xc3\xa9'), 'utf-8');
  });

  test('double eacute — issue #37', () => {
    assertDetection(bytes('\xc3\xa9\xc3\xa9'), 'utf-8');
  });

  test('foo eacute — issue #134', () => {
    assertDetection(bytes('foo \xc3\xa9'), 'utf-8');
  });

  test('degree symbol — issue #305', () => {
    assertDetection(bytes('\xc2\xb0'), 'utf-8');
  });

  test('german umlaut in sentence — issue #288', () => {
    assertDetection(bytes('Sch\xc3\xb6ne gesunde Pflanzen'), 'utf-8');
  });

  test('pokemon slogan — issue #308', () => {
    assertDetection(bytes('___!" (Pok\xc3\xa9mon slogan)'), 'utf-8');
  });

  test('bullet character — issue #61', () => {
    assertDetection(bytes('FAHR\xe2\x80\xa2WERK'), 'utf-8');
  });

  test('right single quotation — issue #185', () => {
    assertDetection(bytes('Carter\xe2\x80\x99s Janitorial'), 'utf-8');
  });

  test('python file with umlaut — issue #75', () => {
    assertDetection(
      concat(
        bytes('#!/usr/bin/env python3\n# coding: utf-8\n#\n'),
        bytes('#'.repeat(45) + '\n\n'),
        bytes("__version__ = '1.0'\n__author__ = '\xc3\xbc'\n"),
      ),
      'utf-8',
    );
  });

  test('csv with umlaut — issue #138', () => {
    assertDetection(
      concat(
        bytes('"Companyname","Prename","Surename","Streetname","ZIP","City",'),
        bytes('"Phone","Fax","Email","Website","Category"\n'),
        bytes('"Whatever GmbH","Mike","H\xc3\xa4n","Burger Str 8C","39925",'),
        bytes('"Bonn","+49 511 123432","+49 511 1234312",'),
        bytes('"bonn@whatever.com","http://www.whatever.de","Business"\n'),
      ),
      'utf-8',
    );
  });

  test('gebuehrenfrei — issue #28', () => {
    assertDetection(bytes('geb\xc3\xbchrenfrei'), 'utf-8');
  });

  test('example aacute — issue #28', () => {
    assertDetection(bytes('ex\xc3\xa1mple'), 'utf-8');
  });

  test('naive idiaeresis — issue #28', () => {
    assertDetection(bytes('na\xc3\xafve'), 'utf-8');
  });

  test('sie hoeren — issue #28', () => {
    assertDetection(bytes('sie h\xc3\xb6ren'), 'utf-8');
  });

  test('section sign — issue #308', () => {
    assertDetection(bytes('42 CFR \xc2\xa7 400.200\n'), 'utf-8');
  });

  test('cinecitta agrave — issue #60', () => {
    assertDetection(bytes('Cinecitt\xc3\xa0 Make'), 'utf-8');
  });

  test('utf8 extended latin — issue #292', () => {
    assertDetection(
      concat(
        bytes('# test data with some utf-8 sequences\n'),
        bytes('\xc4\x80\xc4\x81\xc4\x82\xc4\x83'),
        bytes('\xc3\x90'),
        bytes(' some more ascii text here\n'),
      ),
      'utf-8',
    );
  });

  test('utf8 abcapitalia — issue #160', () => {
    assertDetection(bytes('\x61\x62\xc3\x8f\x61'), 'utf-8');
  });
});

// ==========================================================================
// UTF-8 WITH EMOJI / 4-BYTE SEQUENCES
// ==========================================================================

describe('TestUtf8Emoji', () => {
  test('purple heart emoji — issue #128', () => {
    assertDetection(
      concat(
        bytes('scriptencoding utf-8\n" \xf0\x9f\x92\x9c\n'),
        bytes('" set list listchars=tab:\xc2\xbb\xc2\xb7,trail:\xc2\xb7,'),
        bytes('eol:\xc2\xac,nbsp:_,extends:\xe2\x9d\xaf,precedes:\xe2\x9d\xae\n'),
      ),
      'utf-8',
    );
  });

  test('cat emoji — issue #28', () => {
    assertDetection(bytes('This is a cat \xf0\x9f\x98\xb8'), 'utf-8');
  });
});

// ==========================================================================
// UTF-8 BOM
// ==========================================================================

describe('TestUtf8Bom', () => {
  test('bom with crlf — issue #34', () => {
    assertDetection(bytes('\xef\xbb\xbf\r\n#include <stdio.h>\r\n'), 'utf-8-sig');
  });

  test('bom hello world — issue #30', () => {
    assertDetection(bytes('\xef\xbb\xbfHello World'), 'utf-8-sig');
  });
});

// ==========================================================================
// ESCAPE SEQUENCE / HZ-GB-2312 FALSE POSITIVES
// ==========================================================================

describe('TestEscapeSequences', () => {
  test('tilde brace not hz — issue #82', () => {
    assertDetection(bytes('~{,\n~},\n'), 'ascii');
  });

  test('tilde brace inline — issue #290', () => {
    assertDetection(bytes('xxx~{xxx'), 'ascii');
  });

  test('esc in utf8 — issue #65', () => {
    assertDetection(bytes('\xc8\x8d\x1b'), 'utf-8');
  });

  test('esc in ascii long — issue #63', () => {
    assertDetection(concat(bytes('0'.repeat(100)), bytes('\x1b')), 'ascii');
  });
});

// ==========================================================================
// UTF-16 / UTF-32 ISSUES
// ==========================================================================

describe('TestUtf1632', () => {
  test('utf16 with null after bom — issue #62', () => {
    assertDetection(bytes('\xff\xfe\x00\x000\x00'), 'utf-16');
  });

  test('utf16 le bom returns utf16 — issue #364', () => {
    assertDetection(bytes('\xff\xfeH\x00e\x00l\x00l\x00o\x00'), 'utf-16');
  });

  test('utf16 be bom returns utf16 — issue #364', () => {
    assertDetection(bytes('\xfe\xff\x00H\x00e\x00l\x00l\x00o'), 'utf-16');
  });

  test('utf32 le bom returns utf32 — issue #364', () => {
    assertDetection(bytes('\xff\xfe\x00\x00H\x00\x00\x00'), 'utf-32');
  });

  test('utf32 be bom returns utf32 — issue #364', () => {
    assertDetection(bytes('\x00\x00\xfe\xff\x00\x00\x00H'), 'utf-32');
  });

  test('utf16le no bom — issue #105', () => {
    assertDetection(
      bytes('H\x00e\x00l\x00l\x00o\x00 \x00W\x00o\x00r\x00l\x00d\x00'),
      'utf-16-le',
    );
  });
});

// ==========================================================================
// CJK ENCODING ISSUES (short inputs)
// ==========================================================================

describe('TestCjkShortInputs', () => {
  test('single chinese char gb2312 — issue #219', () => {
    assertDetection(bytes('\xd6\xd0'), 'gb2312');
  });

  test('korean name euckr — issue #161', () => {
    assertDetection(bytes('\xb1\xe8\xbc\xba\xbd\xc4'), 'euc-kr');
  });

  test('chinese in ascii path — issue #294', () => {
    assertDetection(bytes('*file_import {D:/\xc9\xe8\xbc\xc6-1.step} {Step Files}'), 'gb2312');
  });

  test('chinese gb2312 text — issue #247', () => {
    assertDetection(bytes('\xb0\xb2\xbb\xd5\xb9\xe3\xcc\xb6\xb3\xa1'), 'gb2312');
  });
});

// ==========================================================================
// GB18030 / BOM ISSUES
// ==========================================================================

describe('TestGb18030', () => {
  test('gb18030 with bom — issue #178', () => {
    assertDetection(
      concat(
        bytes('\x841\x953'),  // GB18030 encoding of U+FEFF (BOM)
        bytes('\xce\xd2\xc3\xbb\xd3\xd0\xc2\xf1\xd4\xb9\xa3\xac'),
        bytes('\xb4\xe8\xc5\xe8\xb5\xc4\xd6\xbb\xca\xc7\xd2\xbb'),
        bytes('\xd0\xa9\xca\xb1\xbc\xe4\xa1\xa3'),
      ),
      'gb18030',
    );
  });
});

// ==========================================================================
// WRONG ENCODING WITH MODERN_WEB ERA
// ==========================================================================

describe('TestWrongEncodingModernWeb', () => {
  test('portuguese iso88591 — issue #24', () => {
    assertDetection(
      concat(
        bytes('"ULTIMA ATUALIZACAO";"17/03/2014 04:01"\r\n'),
        bytes('"ANO";"MES";"SENADOR";"TIPO_DESPESA";"CNPJ_CPF";'),
        bytes('"FORNECEDOR";"DOCUMENTO";"DATA";"DETALHAMENTO";'),
        bytes('"VALOR_REEMBOLSADO"\r\n'),
        bytes('"2011";"1";"ACIR GURGACZ";"Aluguel de im\xf3veis para '),
        bytes('escrit\xf3rio pol\xedtico, compreendendo despesas '),
        bytes('concernentes a eles.";"05.914.650/0001-66";"CERON - '),
        bytes('CENTRAIS EL\xc9TRICAS DE ROND\xd4NIA '),
        bytes('S.A.";"45216633";"11/01/11";"";"47,65"\r\n'),
      ),
      'iso-8859-1',
    );
  });

  test('smart apostrophe win1252 — issue #53', () => {
    assertDetection(bytes("today\x92s research"), 'windows-1252', EncodingEra.MODERN_WEB);
  });

  test('latin1 accented chars — issue #242', () => {
    assertDetection(
      bytes('latin-1 encoded string > \xe9\xe1\xfb'),
      'iso-8859-1',
      EncodingEra.MODERN_WEB,
    );
  });

  test('subtitle acute apostrophes — issue #279', () => {
    assertDetection(
      concat(
        bytes('y!\r\n- We\xb4re going to get him.\r\n- He was here.\r\n'),
        bytes("Don\xb4t worry, we\xb4ll find him.\r\n"),
        bytes("I\xb4m sure he\xb4s around here somewhere.\r\n"),
        bytes("Let\xb4s keep looking.\r\n"),
      ),
      'iso-8859-1',
      EncodingEra.MODERN_WEB,
    );
  });

  test('iso88591 pound middot — issue #170', () => {
    assertDetection(
      concat(
        bytes('OTE up to \xa350K first year!. to emergency situations '),
        bytes('\xb7 perform all activities with children, i.e. jump, '),
        bytes('dance, walk, run, etc. for extended periods of time '),
        bytes('\xb7 must possess acceptable hearing... . oh. '),
        bytes('to emergency situations \xb7 perform all activities '),
        bytes('with children, i.e. jump, dance, walk, run, etc. for '),
        bytes('extended periods of time \xb7 both indoor and outdoor...'),
        bytes(' . ok. for the public including lectures, concerts, '),
        bytes('recitals, dramatic productions, dance performances, '),
        bytes('films, and art exhibits. laurens county renowned '),
        bytes('quality of... . sc.'),
      ),
      'iso-8859-1',
      EncodingEra.MODERN_WEB,
    );
  });
});

// ==========================================================================
// REMAINING KNOWN FAILURES
// ==========================================================================

describe('TestKnownFailures', () => {
  // Issue #96: French windows-1252 text was previously detected as windows-1251; now fixed.
  test('french win1252 anonymized — issue #96', () => {
    assertDetection(
      concat(
        bytes('xxxx), xx xxxxxx xx xxxxxx xx\xe9\xe9x \xe0 xxxxx x xxxx \n'),
        bytes('xxxxx\xe9 xx xx xxx xxxxxxx\xe9.\n\n*__*\n\n'),
        bytes('xx *xxx, x. xxxxx*, xxxxx xxxxxxx xx xxxxxx xxxx '),
        bytes('x\xe9xxxxxx \xe0 xxxxxxxx \n'),
        bytes('xxxx xxx xxxxxxxxx xxxxxx\xe9xx xxx xxx '),
        bytes('xxxxxxxxxxxxxxx xxxx xx xx xx xx \n'),
        bytes('xxxxxxx xx\xe9x\xe9xxxxx :\n\n'),
        bytes('- xx xxxxxx x\\xxxxxxxxxxxx xxxxxxxxxx \xe0 '),
        bytes('x\\xxxxxxxxxxxxxx\xe9 xx xxxx xx xxxx : xxx \n'),
        bytes('xx ; xxx (xxxx) / xxx (xxxx) xxxxxx.\n\n'),
        bytes('- xxx x\xe9xxxxxx xxx xxxxxxxxxxxx xxxx xxxx : '),
        bytes('xx xxxx\xe9xxxxxxx xxxxxxxxx \n'),
        bytes('(xx xxx xxx \\xxxxx) / xxxxxxxxx (xx xxx xxx \\xxxxx) '),
        bytes('xxx xxxxxxx x\\xxxxxxxx xxxxxxxxx\xe9 \n'),
        bytes('xx xxx.\n\n'),
        bytes('- xxx x\xe9xxxxxx xxx xxxxxx xx xxxxxxxxx xxxx xxxx : '),
        bytes('xx xxxx\xe9xxxxx xxxxx \n'),
        bytes('xxx x\xe9xxxxxx xxxx xx xxxxxxx (xx xxx xxx \\xxxxx) '),
        bytes('xx xxxxxx xxxx xx xxxxxx (xx \n'),
        bytes('xxx xxx \\xxxxx) x\\xxxxxxxxxxxxx xxx xx xx\xfbx xxxx '),
        bytes('xxxxxxxxx xxx xxxxxx (xxxxxxxxx \n'),
        bytes('xxxx xxxxxx, xxxxx xx xxxxxxxxx xxxx xxxxxxxxx ...) '),
        bytes('xx x\\xxxxxxxxxxx xx \n'),
        bytes('xxxxxxxxxx xxx\xe9xxxxxxx xxxx xxxxxxxx xxxxxxx.\n\n'),
        bytes('- xxx xxxxxx x\\xxxxxxxxxxxxxxxx : xx xxxx\xe9xxxxx '),
        bytes('xx xxxxxxxx xx\xe9xxxx xxxxx \n'),
        bytes('xxxx xx xxxx xxxxxxx\xe9x xx xxxxxxx xxxxx\xe8'),
      ),
      'windows-1252',
    );
  });
});

// ==========================================================================
// WINDOWS-1252 SPECIFIC BYTE DETECTION
// ==========================================================================

describe('TestWindows1252Bytes', () => {
  test('euro sign win1252 — issue #317', () => {
    assertDetection(bytes('\x80'), 'windows-1252');
  });
});

// ==========================================================================
// ISO-8859-7 (GREEK) ISSUES
// ==========================================================================

describe('TestGreek', () => {
  test('nbsp with angle bracket — issue #64', () => {
    assertDetection(bytes('<\xa0'), 'iso-8859-7');
  });

  test('greek text omilia — issue #124', () => {
    assertDetection(bytes('\xcc\xe5 \xef\xec\xe9\xeb\xdf\xe1 \xf4\xe7\xf2'), 'iso-8859-7');
  });
});

// ==========================================================================
// NO-CRASH TESTS
// ==========================================================================

describe('TestNoCrash', () => {
  test('issue #67 no crash', () => {
    const result = detect(bytes('\xfe\xcf'), { encodingEra: EncodingEra.ALL });
    expect(typeof result).toBe('object');
    expect('encoding' in result).toBe(true);
  });

  test('issue #367 short two-byte runtime error', () => {
    const result = detect(bytes('\xf9\x92'));
    expect(typeof result).toBe('object');
    expect('encoding' in result).toBe(true);
    expect(result.encoding).not.toBeNull();
  });

  test('issue #367 additional two-byte sequences', () => {
    const samples: Uint8Array[] = [
      bytes('\x81\x40'),  // cp932 lead byte + valid trail
      bytes('\xf0\x80'),  // cp932 high lead byte
      bytes('\xe0\xa0'),  // cp932 lead byte
      bytes('\x84\x41'),  // johab lead byte
      bytes('\xd9\xfe'),  // johab high lead byte
      bytes('\xf9\x92'),  // original report
    ];
    for (const data of samples) {
      const result = detect(data);
      expect(typeof result).toBe('object');
      expect('encoding' in result).toBe(true);
    }
  });
});

// ==========================================================================
// NULL SEPARATOR ISSUES
// ==========================================================================

describe('TestNullSeparators', () => {
  test('null separated ascii — issue #346', () => {
    const data = concat(
      bytes('master:README.md\x002\x00For support slack to #kodiak-support\n'),
      bytes('master:support.txt\x001\x00For support slack to #kodiak-support\n'),
    );
    const result = detect(data);
    expect(result.encoding).toBe('ascii');
    expect(result.confidence).toBe(0.99);
  });

  test('find print0 output', () => {
    const data = concat(
      bytes('/home/user/documents/report.txt\x00'),
      bytes('/home/user/documents/notes.txt\x00'),
      bytes('/home/user/downloads/image.png\x00'),
      bytes('/home/user/music/song.mp3\x00'),
    );
    const result = detect(data);
    expect(result.encoding).toBe('ascii');
    expect(result.confidence).toBe(0.99);
  });
});
