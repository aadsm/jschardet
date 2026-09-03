// Port of chardet/tests/test_postprocess.py.

import { vi } from 'vitest';
import { DetectionResult } from '../src/pipeline/index.js';
import { detect } from '../src/chardet.js';
import {
  ART_LANGUAGE,
  _decodesUnderPublicNames,
  _demoteNicheLatin,
  _eraRank,
  _hasHighByteEvidence,
  _internal,
  _preferDecodableOnTie,
  _preferPrevalentOnDeadHeat,
  _promoteKoi8t,
  _promoteMacOnCrLineEndings,
  _promoteSupersetOnDeadHeat,
  _arbitrateRareLanguage,
  forcedEncodings,
  postprocessResults,
  scoringFloor,
} from '../src/pipeline/postprocess.js';
import {
  CONFUSION_BAND,
  CONFUSION_FLOOR_RATIO,
  STRICT_TIER_MAX_CONF,
} from '../src/pipeline/confusion.js';
import welshSparse from './fixtures/sparse_evidence/welsh_iso8859_14.txt?uint8array';
import frenchHproman8 from './fixtures/sparse_evidence/french_hproman8.txt?uint8array';
import englishHproman8 from './fixtures/sparse_evidence/english_hproman8.txt?uint8array';
import kvenSparse from './fixtures/sparse_evidence/kven_iso8859_10.txt?uint8array';

// b'...' with hex escapes and ASCII → Uint8Array (docs/port-notes.md).
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
function repeat(arr: Uint8Array, times: number): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < times; i++) parts.push(arr);
  return concat(...parts);
}
const R = (
  encoding: string | null,
  confidence: number,
  language: string | null = null,
): DetectionResult => ({ encoding, confidence, language, mimeType: null });

// "Mae dŵr yn llifo drwy'r dref.".encode("iso8859-14")
const WELSH_ISO8859_14 = new Uint8Array([
  0x4d, 0x61, 0x65, 0x20, 0x64, 0xf0, 0x72, 0x20, 0x79, 0x6e, 0x20, 0x6c, 0x6c,
  0x69, 0x66, 0x6f, 0x20, 0x64, 0x72, 0x77, 0x79, 0x27, 0x72, 0x20, 0x64, 0x72,
  0x65, 0x66, 0x2e,
]);
// "Mae dŵr yn llifo drwy'r dref. ".encode("iso8859-14") — trailing space
const WELSH_ISO8859_14_SP = new Uint8Array([
  0x4d, 0x61, 0x65, 0x20, 0x64, 0xf0, 0x72, 0x20, 0x79, 0x6e, 0x20, 0x6c, 0x6c,
  0x69, 0x66, 0x6f, 0x20, 0x64, 0x72, 0x77, 0x79, 0x27, 0x72, 0x20, 0x64, 0x72,
  0x65, 0x66, 0x2e, 0x20,
]);
// "Die Österreicher und die Ärzte in München.".encode("cp1252")
const GERMAN_CP1252 = new Uint8Array([
  0x44, 0x69, 0x65, 0x20, 0xd6, 0x73, 0x74, 0x65, 0x72, 0x72, 0x65, 0x69, 0x63,
  0x68, 0x65, 0x72, 0x20, 0x75, 0x6e, 0x64, 0x20, 0x64, 0x69, 0x65, 0x20, 0xc4,
  0x72, 0x7a, 0x74, 0x65, 0x20, 0x69, 0x6e, 0x20, 0x4d, 0xfc, 0x6e, 0x63, 0x68,
  0x65, 0x6e, 0x2e,
]);

describe('_demoteNicheLatin', () => {
  test('iso-8859-10 at top demoted when no distinguishing bytes', () => {
    const results = [R('iso8859-10', 0.90, null), R('cp1252', 0.85, null)];
    const data = new Uint8Array([0xE9, 0xF6, 0xFC]);
    expect(_demoteNicheLatin(data, results)[0].encoding).toBe('cp1252');
  });

  test('keeps the reading the models prefer (Welsh w-circumflex)', () => {
    const results = [R('iso8859-14', 0.39, 'cy'), R('cp1252', 0.39, 'cy')];
    expect(_demoteNicheLatin(WELSH_ISO8859_14, results)[0].encoding).toBe('iso8859-14');
  });

  test('keeps the reading word shape prefers (Kven d-stroke)', () => {
    const results = [R('iso8859-10', 0.39, 'fi'), R('cp1252', 0.39, 'fi')];
    const data = bytes(
      '- Mie uskoma, ette se oon mah\xb9olista rakenttaat omaksi tuo m\xf6kki.',
    );
    expect(_demoteNicheLatin(data, results)[0].encoding).toBe('iso8859-10');
  });

  test('demotes an evidence-free tie (lone umlaut pair)', () => {
    const body = bytes(
      'plain ascii text that goes on and on, filling space. '.repeat(40),
    );
    const data = concat(body, bytes('St\xd6rung? s\xf6mething. '), body);
    const results = [R('hp-roman8', 0.39, 'en'), R('cp1252', 0.39, 'en')];
    expect(_demoteNicheLatin(data, results)[0].encoding).toBe('cp1252');
  });

  test('demotes when the target reads the bytes better (German umlauts)', () => {
    const results = [R('hp-roman8', 0.39, 'de'), R('cp1252', 0.39, 'de')];
    expect(_demoteNicheLatin(GERMAN_CP1252, results)[0].encoding).toBe('cp1252');
  });

  test('does not second-guess a decided win (lead beyond the band)', () => {
    const results = [R('hp-roman8', 0.39 + 2 * CONFUSION_BAND, 'en'), R('cp1252', 0.39, 'en')];
    expect(_demoteNicheLatin(bytes('St\xd6rung? s\xf6mething.'), results)[0].encoding)
      .toBe('hp-roman8');
  });

  test('swap prefers prevalent in a dead heat', () => {
    const results = [
      R('hp-roman8', 0.39, 'en'),
      R('cp437', 0.389995, 'en'),
      R('iso8859-1', 0.38999, 'en'),
      R('cp1252', 0.38998, 'en'),
    ];
    const demoted = _demoteNicheLatin(new Uint8Array([0xE9]), results);
    expect(demoted[0].encoding).toBe('cp1252');
    expect(demoted[demoted.length - 1].encoding).toBe('hp-roman8');
  });

  test('swap confidence wins outside the band', () => {
    const results = [
      R('hp-roman8', 0.90, 'en'),
      R('iso8859-1', 0.89, 'en'),
      R('cp1252', 0.85, 'en'),
    ];
    const demoted = _demoteNicheLatin(new Uint8Array([0xE9]), results);
    expect(demoted[0].encoding).toBe('iso8859-1');
    expect(demoted[demoted.length - 1].encoding).toBe('hp-roman8');
  });

  test('swap band anchors on the best common Latin', () => {
    const results = [
      R('hp-roman8', 0.90, 'en'),
      R('iso8859-1', 0.85, 'en'),
      R('cp1252', 0.849995, 'en'),
    ];
    const demoted = _demoteNicheLatin(new Uint8Array([0xE9]), results);
    expect(demoted[0].encoding).toBe('cp1252');
    expect(demoted[demoted.length - 1].encoding).toBe('hp-roman8');
  });

  test('iso-8859-14 at top demoted when no distinguishing bytes', () => {
    const results = [R('iso8859-14', 0.90, null), R('cp1252', 0.85, null)];
    expect(_demoteNicheLatin(new Uint8Array([0xC0, 0xC1, 0xC2]), results)[0].encoding)
      .toBe('cp1252');
  });

  test('windows-1254 at top demoted when no distinguishing bytes', () => {
    const results = [R('cp1254', 0.90, null), R('cp1252', 0.85, null)];
    expect(_demoteNicheLatin(new Uint8Array([0xC0, 0xC1, 0xE9]), results)[0].encoding)
      .toBe('cp1252');
  });

  test('ignores a common Latin top', () => {
    const results = [R('cp1252', 0.90, 'en'), R('hp-roman8', 0.85, 'en')];
    expect(_demoteNicheLatin(new Uint8Array([0xE9]), results)).toBe(results);
    const tail = results.slice(1);
    expect(_demoteNicheLatin(new Uint8Array([0xE9]), tail)).toEqual(tail);
  });

  test('needs a common Latin target', () => {
    const results = [R('hp-roman8', 0.90, 'en'), R('cp437', 0.85, 'en')];
    expect(_demoteNicheLatin(new Uint8Array([0xE9]), results)).toBe(results);
  });

  test('swap keeps confidence order among equal era ranks', () => {
    let results = [
      R('hp-roman8', 0.39, 'en'),
      R('iso8859-15', 0.38999, 'en'),
      R('iso8859-1', 0.389989, 'en'),
    ];
    expect(_demoteNicheLatin(new Uint8Array([0xE9]), results)[0].encoding).toBe('iso8859-15');
    results = [
      R('hp-roman8', 0.39, 'en'),
      R('iso8859-1', 0.38999, 'en'),
      R('iso8859-15', 0.389989, 'en'),
    ];
    expect(_demoteNicheLatin(new Uint8Array([0xE9]), results)[0].encoding).toBe('iso8859-1');
  });

  test('single-byte input forms no bigram: demoted', () => {
    const results = [R('hp-roman8', 0.39, 'en'), R('cp1252', 0.39, 'en')];
    expect(_demoteNicheLatin(bytes('\xd6'), results)[0].encoding).toBe('cp1252');
  });

  test('end to end: a lone umlaut pair resolves to Windows-1252', () => {
    const sentence = bytes(
      'This is a mostly ASCII file with plain sentences that go on ' +
      'and on, describing nothing in particular, just filling space ' +
      'the way source files and configuration files usually do. ',
    );
    const data = concat(repeat(sentence, 6), bytes('St\xd6rung? s\xf6mething. '), repeat(sentence, 6));
    expect(detect(data).encoding).toBe('Windows-1252');
  });

  test('survives a confidence re-sort', () => {
    const results = [
      R('iso8859-14', 0.1803, null),
      R('iso8859-1', 0.1803, null),
      R('cp1252', 0.1803, null),
      R('hp-roman8', 0.1136, null),
    ];
    const demoted = _demoteNicheLatin(new Uint8Array([0xC0, 0xC1, 0xC2]), results);
    expect(demoted[0].encoding).toBe('cp1252');
    expect(demoted[demoted.length - 1].encoding).toBe('iso8859-14');
    const confidences = demoted.map(r => r.confidence);
    expect(confidences).toEqual([...confidences].sort((a, b) => b - a));
    const resorted = [...demoted].sort((a, b) => b.confidence - a.confidence);
    expect(resorted.map(r => r.encoding)).toEqual(demoted.map(r => r.encoding));
  });
});

// Corpus inputs whose distinguishing bytes are sparse but real, where the
// demotion must stand down. Fixtures committed via update-test-fixtures.
describe('_demoteNicheLatin stands down on sparse evidence', () => {
  const stripMeta = (data: Uint8Array): Uint8Array =>
    Uint8Array.from(
      data.reduce((s, b) => s + String.fromCharCode(b), '').replace(/<meta[^>]*charset[^>]*>/gi, ''),
      c => c.charCodeAt(0),
    );
  const cases: Array<[Uint8Array, number | null, boolean, string]> = [
    [welshSparse, 768, false, 'iso8859-14'],
    [welshSparse, 2048, false, 'iso8859-14'],
    [frenchHproman8, 512, false, 'hp-roman8'],
    [frenchHproman8, 1024, false, 'hp-roman8'],
    [englishHproman8, null, true, 'hp-roman8'],
    [kvenSparse, null, false, 'iso8859-10'],
  ];
  test.each(cases)('%#: keeps its encoding', (fixture, limit, strip, expected) => {
    let data = strip ? stripMeta(fixture) : fixture;
    if (limit !== null) data = data.subarray(0, limit);
    expect(detect(data, { compatNames: false }).encoding).toBe(expected);
  });
});

describe('_promoteKoi8t', () => {
  test('promote when Tajik-specific bytes present', () => {
    const results = [R('koi8-r', 0.90, 'ru'), R('koi8-t', 0.88, 'tg')];
    expect(_promoteKoi8t(new Uint8Array([0x41, 0x80, 0x42]), results)[0].encoding).toBe('koi8-t');
  });
  test('no promote without Tajik-specific bytes', () => {
    const results = [R('koi8-r', 0.90, 'ru'), R('koi8-t', 0.88, 'tg')];
    expect(_promoteKoi8t(new Uint8Array([0xC0, 0xC1, 0xC2]), results)[0].encoding).toBe('koi8-r');
  });
  test('returns early when KOI8-T absent', () => {
    const results = [R('koi8-r', 0.90, 'ru'), R('cp1251', 0.85, 'ru')];
    expect(_promoteKoi8t(new Uint8Array([0x80, 0xC0, 0xC1]), results)).toBe(results);
  });
});

describe('the correction chain', () => {
  const CHAIN = [
    '_promoteSupersetOnDeadHeat',
    '_preferPrevalentOnDeadHeat',
    '_arbitrateRareLanguage',
    'resolveConfusionGroups',
    '_demoteNicheLatin',
    '_promoteKoi8t',
    '_promoteMacOnCrLineEndings',
    '_preferDecodableOnTie',
  ] as const;

  test('runs every correction in order', () => {
    const calls: string[] = [];
    const spies = CHAIN.map(name => {
      const orig = (_internal as Record<string, (...a: unknown[]) => unknown>)[name];
      return vi
        .spyOn(_internal as Record<string, (...a: unknown[]) => unknown>, name)
        .mockImplementation((...args: unknown[]) => { calls.push(name); return orig(...args); });
    });
    postprocessResults(new Uint8Array([0xC0, 0xC1, 0xC2]), [
      R('iso8859-14', 0.90, null),
      R('cp1252', 0.85, null),
    ]);
    expect(calls).toEqual([...CHAIN]);
    spies.forEach(s => s.mockRestore());
  });

  test('the public entry point carries the corrections', () => {
    const processed = postprocessResults(new Uint8Array([0xC0, 0xC1, 0xC2]), [
      R('iso8859-14', 0.90, null),
      R('cp1252', 0.85, null),
    ]);
    expect(processed[0].encoding).toBe('cp1252');
  });
});

describe('the pruning contract', () => {
  test('scoringFloor trails the second-best', () => {
    const floor = scoringFloor(0.9, 0.85);
    expect(floor).toBeLessThan(0.85);
    expect(0.85 - floor).toBeGreaterThan(0.005);
  });
  test('scoringFloor ignores top1 when the strict tier is closed', () => {
    expect(scoringFloor(0.9, 0.5)).toBe(scoringFloor(STRICT_TIER_MAX_CONF, 0.5));
  });
  test('scoringFloor extends to the strict tier', () => {
    const top1 = STRICT_TIER_MAX_CONF / 2;
    expect(scoringFloor(top1, top1)).toBeCloseTo(top1 * CONFUSION_FLOOR_RATIO, 10);
  });
  test('forcedEncodings empty without triggers', () => {
    expect(forcedEncodings(['cp1251', 'koi8-u', 'cp1252'])).toEqual([]);
  });
  test('a demotion candidate forces the Latin trio', () => {
    expect(new Set(forcedEncodings(['iso8859-10']))).toEqual(
      new Set(['iso8859-1', 'iso8859-15', 'cp1252']),
    );
  });
  test('koi8-r forces koi8-t', () => {
    expect(forcedEncodings(['koi8-r'])).toEqual(['koi8-t']);
  });
  test('triggers combine', () => {
    expect(new Set(forcedEncodings(['cp1254', 'koi8-r']))).toEqual(
      new Set(['iso8859-1', 'iso8859-15', 'cp1252', 'koi8-t']),
    );
  });
});

describe('helpers', () => {
  test('an unknown encoding ranks last for era prevalence', () => {
    expect(_eraRank('not-a-codec')).toBe(1 << 30);
  });
  test('no model variants means no high-byte evidence', () => {
    expect(_hasHighByteEvidence(bytes('\xe9ab'), 'not-a-codec', null)).toBe(false);
  });
});

describe('_preferPrevalentOnDeadHeat', () => {
  test('arbitrates a top that carries some evidence (MacRoman ellipsis)', () => {
    const english = bytes('plain english sentences filling the file '.repeat(8));
    const data = concat(english, bytes('the \xc9cole normale. '), english);
    const results = [R('mac-roman', 0.3889, 'en'), R('cp1252', 0.38885, 'en')];
    const promoted = _preferPrevalentOnDeadHeat(data, results);
    expect(promoted[0].encoding).toBe('cp1252');
    expect(promoted[0].confidence).toBe(0.3889);
  });
  test('keeps a top the arbitration cannot fault (no C1 bytes)', () => {
    const data = bytes('la fen\xeatre \xe9tait ferm\xe9e '.repeat(8));
    const results = [R('iso8859-1', 0.5, 'fr'), R('cp1252', 0.5 - 1e-5, 'fr')];
    expect(_preferPrevalentOnDeadHeat(data, results)).toBe(results);
  });
  test('keeps a top that wins the arbitration (Welsh dŵr)', () => {
    const data = repeat(WELSH_ISO8859_14_SP, 8);
    const results = [R('iso8859-14', 0.5, 'cy'), R('cp1252', 0.5 - 1e-5, 'cy')];
    expect(_preferPrevalentOnDeadHeat(data, results)).toBe(results);
  });
  test('skips binary entries inside the dead heat', () => {
    const results = [R('cp500', 0.30, null), R(null, 0.30, null), R('cp1252', 0.29995, null)];
    const resolved = _preferPrevalentOnDeadHeat(bytes('hello'), results);
    expect(resolved[0].encoding).toBe('cp1252');
    expect(resolved[0].confidence).toBe(0.30);
  });
  test('end to end: one capital accent in English is Windows-1252', () => {
    const sentence = bytes(
      'This is a mostly ASCII file with plain sentences that go on ' +
      'and on, describing nothing in particular, just filling space ' +
      'the way source files and configuration files usually do. ',
    );
    for (const insert of ['the \xc9cole normale. ', 'by \xc9tienne. ', '\xc0 Paris. ']) {
      const data = concat(repeat(sentence, 6), bytes(insert), repeat(sentence, 6));
      expect(detect(data).encoding).toBe('Windows-1252');
    }
  });
});

describe('_promoteSupersetOnDeadHeat', () => {
  test('promotes a decoding superset within the epsilon', () => {
    const results = [R('shift_jis_2004', 0.30, 'ja'), R('cp932', 0.29995, 'ja')];
    const resolved = _promoteSupersetOnDeadHeat(bytes('hello world'), results);
    expect(resolved[0].encoding).toBe('cp932');
    expect(resolved[0].confidence).toBe(0.30);
  });
  test('stops at the epsilon', () => {
    const results = [
      R('shift_jis_2004', 0.30, 'ja'),
      R('euc_jis_2004', 0.2999, 'ja'),
      R('cp932', 0.10, 'ja'),
    ];
    expect(_promoteSupersetOnDeadHeat(bytes('hello world'), results)).toEqual(results);
  });
  test('no superset in band leaves the ranking untouched', () => {
    const results = [R('shift_jis_2004', 0.30, 'ja'), R('euc_jis_2004', 0.29999, 'ja')];
    expect(_promoteSupersetOnDeadHeat(bytes('hello world'), results)).toEqual(results);
  });
});

describe('_arbitrateRareLanguage', () => {
  test('stops past the margin', () => {
    const results = [R('iso8859-14', 0.10, 'br'), R('cp1252', 0.05, 'fr')];
    expect(_arbitrateRareLanguage(results)).toEqual(results);
  });
  test('skips unlabelled rivals', () => {
    const results = [
      R('iso8859-14', 0.10, 'br'),
      R('cp1250', 0.099, null),
      R('cp1252', 0.098, 'fr'),
    ];
    const resolved = _arbitrateRareLanguage(results);
    expect(resolved[0].encoding).toBe('cp1252');
    expect(resolved[0].confidence).toBe(0.10);
  });
  test('needs a prevalent rival', () => {
    const results = [R('iso8859-14', 0.10, 'br'), R('iso8859-15', 0.099, 'cy')];
    expect(_arbitrateRareLanguage(results)).toEqual(results);
  });
});

describe('_promoteMacOnCrLineEndings', () => {
  const CR_ONLY = bytes('line one\rline two\rline three\rline four\r');

  test('skips an art-model top', () => {
    const results = [R('cp437', 0.30, ART_LANGUAGE), R('mac-roman', 0.299, null)];
    expect(_promoteMacOnCrLineEndings(CR_ONLY, results)).toEqual(results);
  });
  test('promotes the in-band classic-Mac candidate', () => {
    const results = [R('koi8-r', 0.30, 'ru'), R('mac-roman', 0.299, null)];
    const resolved = _promoteMacOnCrLineEndings(CR_ONLY, results);
    expect(resolved[0].encoding).toBe('mac-roman');
    expect(resolved[0].confidence).toBe(0.30);
  });
  test('stops at the band', () => {
    const results = [R('koi8-r', 0.30, 'ru'), R('mac-roman', 0.20, null)];
    expect(_promoteMacOnCrLineEndings(CR_ONLY, results)).toEqual(results);
  });
  test('vetoed by byte evidence', () => {
    const results = [
      R('koi8-r', 0.30, 'ru'),
      R('mac-cyrillic', 0.299, 'ru'),
      R('mac-roman', 0.298, null),
    ];
    const spy = vi.spyOn(_internal, 'confusionPairWinner').mockReturnValue('koi8-r');
    expect(_promoteMacOnCrLineEndings(CR_ONLY, results)).toEqual(results);
    spy.mockRestore();
  });
});

describe('the decode-safety tiebreak', () => {
  test('_decodesUnderPublicNames rejects undecodable data', () => {
    expect(_decodesUnderPublicNames(new Uint8Array([0xff]), 'ascii')).toBe(false);
  });
  test('a dangling-tail winner stays on top when no rival decodes', () => {
    const results = [R('euc_kr', 0.30, 'ko'), R('ascii', 0.29, null)];
    expect(_preferDecodableOnTie(bytes('hello \xb0'), results, false)).toEqual(results);
  });
});
