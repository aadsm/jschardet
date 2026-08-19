// Port of chardet/tests/test_postprocess.py.

import { DetectionResult } from '../src/pipeline/index.js';
import { _demoteNicheLatin, _promoteKoi8t } from '../src/pipeline/postprocess.js';

describe('_demoteNicheLatin', () => {
  test('iso-8859-10 at top demoted when no distinguishing bytes', () => {
    const results: DetectionResult[] = [
      { encoding: 'iso8859-10', confidence: 0.90, language: null, mimeType: null },
      { encoding: 'cp1252', confidence: 0.85, language: null, mimeType: null },
    ];
    // Data with only bytes shared between iso-8859-10 and iso-8859-1: é ö ü
    const data = new Uint8Array([0xE9, 0xF6, 0xFC]);
    const demoted = _demoteNicheLatin(data, results);
    expect(demoted[0].encoding).toBe('cp1252');
  });

  // iso-8859-10 stays when its distinguishing bytes carry real evidence.
  // The sample is Icelandic prose (with a leading Ą for the distinguishing
  // set) whose non-ASCII letters give the winning model an evidence
  // contribution far above the dead-heat epsilon — presence of
  // distinguishing bytes alone is no longer enough (see the noise-level
  // test below). Python: "Ąsta Þetta er íslenskur..." x3 in iso-8859-10.
  test('iso-8859-10 NOT demoted when distinguishing bytes carry evidence', () => {
    const results: DetectionResult[] = [
      { encoding: 'iso8859-10', confidence: 0.90, language: null, mimeType: null },
      { encoding: 'cp1252', confidence: 0.85, language: null, mimeType: null },
    ];
    const hex =
      'a173746120de6574746120657220ed736c656e736b7572207465787469206d65f0206df6726775' +
      '6d2073e972ed736c656e736b756d207374f666756d2c20e6f06920fee667696c6567742061f020' +
      '6c6573612e20a173746120de6574746120657220ed736c656e736b7572207465787469206d65f0' +
      '206df67267756d2073e972ed736c656e736b756d207374f666756d2c20e6f06920fee667696c65' +
      '67742061f0206c6573612e20a173746120de6574746120657220ed736c656e736b757220746578' +
      '7469206d65f0206df67267756d2073e972ed736c656e736b756d207374f666756d2c20e6f06920' +
      'fee667696c6567742061f0206c6573612e20';
    const data = new Uint8Array(hex.length / 2);
    for (let i = 0; i < data.length; i++) data[i] = parseInt(hex.substr(i * 2, 2), 16);
    const demoted = _demoteNicheLatin(data, results);
    expect(demoted[0].encoding).toBe('iso8859-10');
  });

  // A distinguishing byte whose contribution is noise does not veto. A
  // mostly-ASCII Windows-1252 file whose only non-ASCII bytes are one
  // 0xD6/0xF6 pair carries 0xD6 — in hp-roman8's distinguishing set —
  // while the winning model's whole high-byte contribution is under the
  // dead-heat epsilon. The demotion must fire: the "real HP-Roman8 text
  // contains these bytes" premise assumes evidence, not a costume.
  test('hp-roman8 demoted when the distinguishing byte is noise-level', () => {
    const enc = new TextEncoder();
    const body = enc.encode('plain ascii text that goes on and on, filling space. '.repeat(40));
    const umlauts = Uint8Array.from('St\xd6rung? s\xf6mething. ', c => c.charCodeAt(0));
    const data = new Uint8Array(body.length * 2 + umlauts.length);
    data.set(body, 0);
    data.set(umlauts, body.length);
    data.set(body, body.length + umlauts.length);
    const results: DetectionResult[] = [
      { encoding: 'hp-roman8', confidence: 0.39, language: 'en', mimeType: null },
      { encoding: 'cp1252', confidence: 0.39, language: 'en', mimeType: null },
    ];
    const demoted = _demoteNicheLatin(data, results);
    expect(demoted[0].encoding).toBe('cp1252');
  });

  // Era prevalence picks the swap target among tied common Latin candidates.
  // Inside the dead-heat band the confidence order between iso8859-1 and
  // cp1252 is noise (the demotion's own premise), so the replacement must
  // not depend on it: cp1252 (era rank 1) wins over iso8859-1 (era rank 2)
  // even though iso8859-1 ranks higher.
  test('swap target picked by prevalence within the dead-heat band', () => {
    const results: DetectionResult[] = [
      { encoding: 'hp-roman8', confidence: 0.39, language: 'en', mimeType: null },
      { encoding: 'cp437', confidence: 0.389995, language: 'en', mimeType: null },
      { encoding: 'iso8859-1', confidence: 0.38999, language: 'en', mimeType: null },
      { encoding: 'cp1252', confidence: 0.38998, language: 'en', mimeType: null },
    ];
    const data = new Uint8Array([0xE9]);  // no hp-roman8-distinguishing byte
    const demoted = _demoteNicheLatin(data, results);
    expect(demoted[0].encoding).toBe('cp1252');
    expect(demoted[demoted.length - 1].encoding).toBe('hp-roman8');
  });

  // A real margin between the common Latin rivals still decides: cp1252
  // trails the best common Latin candidate (iso8859-1) by 0.04 — far
  // outside the band — so it lost on real evidence and prevalence must
  // not resurrect it.
  test('swap target picked by confidence outside the dead-heat band', () => {
    const results: DetectionResult[] = [
      { encoding: 'hp-roman8', confidence: 0.90, language: 'en', mimeType: null },
      { encoding: 'iso8859-1', confidence: 0.89, language: 'en', mimeType: null },
      { encoding: 'cp1252', confidence: 0.85, language: 'en', mimeType: null },
    ];
    const data = new Uint8Array([0xE9]);  // no hp-roman8-distinguishing byte
    const demoted = _demoteNicheLatin(data, results);
    expect(demoted[0].encoding).toBe('iso8859-1');
    expect(demoted[demoted.length - 1].encoding).toBe('hp-roman8');
  });

  // The tie band is anchored at the best common Latin, not the demoted
  // top: both commons sit far below the top (0.05, outside its band) but
  // only 5e-6 apart from each other — separable from the top, not from
  // each other. Whether two rivals are separable is a fact about their
  // own gap, so era prevalence must still pick cp1252.
  test('swap band anchors on the best common Latin candidate', () => {
    const results: DetectionResult[] = [
      { encoding: 'hp-roman8', confidence: 0.90, language: 'en', mimeType: null },
      { encoding: 'iso8859-1', confidence: 0.85, language: 'en', mimeType: null },
      { encoding: 'cp1252', confidence: 0.849995, language: 'en', mimeType: null },
    ];
    const data = new Uint8Array([0xE9]);  // no hp-roman8-distinguishing byte
    const demoted = _demoteNicheLatin(data, results);
    expect(demoted[0].encoding).toBe('cp1252');
    expect(demoted[demoted.length - 1].encoding).toBe('hp-roman8');
  });

  test('iso-8859-14 at top demoted when no distinguishing bytes', () => {
    const results: DetectionResult[] = [
      { encoding: 'iso8859-14', confidence: 0.90, language: null, mimeType: null },
      { encoding: 'cp1252', confidence: 0.85, language: null, mimeType: null },
    ];
    const data = new Uint8Array([0xC0, 0xC1, 0xC2]);
    const demoted = _demoteNicheLatin(data, results);
    expect(demoted[0].encoding).toBe('cp1252');
  });

  test('windows-1254 at top demoted when no distinguishing bytes', () => {
    const results: DetectionResult[] = [
      { encoding: 'cp1254', confidence: 0.90, language: null, mimeType: null },
      { encoding: 'cp1252', confidence: 0.85, language: null, mimeType: null },
    ];
    const data = new Uint8Array([0xC0, 0xC1, 0xE9]);
    const demoted = _demoteNicheLatin(data, results);
    expect(demoted[0].encoding).toBe('cp1252');
  });
});

describe('_promoteKoi8t', () => {
  test('promote when Tajik-specific bytes present', () => {
    const results: DetectionResult[] = [
      { encoding: 'koi8-r', confidence: 0.90, language: 'ru', mimeType: null },
      { encoding: 'koi8-t', confidence: 0.88, language: 'tg', mimeType: null },
    ];
    // 0x80 is a Tajik-specific byte in KOI8-T
    const data = new Uint8Array([0x41, 0x80, 0x42]);
    const promoted = _promoteKoi8t(data, results);
    expect(promoted[0].encoding).toBe('koi8-t');
  });

  test('no promote without Tajik-specific bytes', () => {
    const results: DetectionResult[] = [
      { encoding: 'koi8-r', confidence: 0.90, language: 'ru', mimeType: null },
      { encoding: 'koi8-t', confidence: 0.88, language: 'tg', mimeType: null },
    ];
    // Only Cyrillic-range bytes shared between KOI8-R and KOI8-T
    const data = new Uint8Array([0xC0, 0xC1, 0xC2]);
    const promoted = _promoteKoi8t(data, results);
    expect(promoted[0].encoding).toBe('koi8-r');
  });

  test('returns early when KOI8-T absent', () => {
    const results: DetectionResult[] = [
      { encoding: 'koi8-r', confidence: 0.90, language: 'ru', mimeType: null },
      { encoding: 'cp1251', confidence: 0.85, language: 'ru', mimeType: null },
    ];
    const data = new Uint8Array([0x80, 0xC0, 0xC1]);
    const returned = _promoteKoi8t(data, results);
    expect(returned).toBe(results);
    expect(returned[0].encoding).toBe('koi8-r');
  });
});
