// Port of chardet/tests/test_language.py.

import { vi } from 'vitest';
import { DetectionResult } from '../src/pipeline/index.js';
import { _internal as languageInternal, _toUtf8, fillLanguages } from '../src/pipeline/language.js';
import { detect, detectAll } from '../src/chardet.js';
import { RARE_LANGUAGES, scoreBestLanguage } from '../src/models/index.js';

// Plain French, ASCII-safe apart from the accents cp1252 carries. Long enough
// to score decisively, so the tier tests turn on which tier ran.
// ("Le chat noir de mon voisin traverse la cour chaque matin pour aller "
//  "chercher un peu de lait chez la boulangère du village.").encode("cp1252")
const FRENCH_CP1252 = new Uint8Array([0x4c,0x65,0x20,0x63,0x68,0x61,0x74,0x20,0x6e,0x6f,0x69,0x72,0x20,0x64,0x65,0x20,0x6d,0x6f,0x6e,0x20,0x76,0x6f,0x69,0x73,0x69,0x6e,0x20,0x74,0x72,0x61,0x76,0x65,0x72,0x73,0x65,0x20,0x6c,0x61,0x20,0x63,0x6f,0x75,0x72,0x20,0x63,0x68,0x61,0x71,0x75,0x65,0x20,0x6d,0x61,0x74,0x69,0x6e,0x20,0x70,0x6f,0x75,0x72,0x20,0x61,0x6c,0x6c,0x65,0x72,0x20,0x63,0x68,0x65,0x72,0x63,0x68,0x65,0x72,0x20,0x75,0x6e,0x20,0x70,0x65,0x75,0x20,0x64,0x65,0x20,0x6c,0x61,0x69,0x74,0x20,0x63,0x68,0x65,0x7a,0x20,0x6c,0x61,0x20,0x62,0x6f,0x75,0x6c,0x61,0x6e,0x67,0xe8,0x72,0x65,0x20,0x64,0x75,0x20,0x76,0x69,0x6c,0x6c,0x61,0x67,0x65,0x2e]);

describe('fillLanguages', () => {
  test('tier 1 fills a single-language encoding on its own', () => {
    // Model scoring off, so only the hardcoded map can supply the answer.
    const spy = vi.spyOn(languageInternal, 'hasModelVariants').mockReturnValue(false);
    const filled = fillLanguages(new TextEncoder().encode('test data'), [
      { encoding: 'koi8-r', confidence: 0.90, language: null, mimeType: null },
    ]);
    spy.mockRestore();
    expect(filled[0].language).toBe('ru');
  });

  test('tier 2 labels a multi-language encoding without the utf-8 fallback', () => {
    const spy = vi.spyOn(languageInternal, 'hasModelVariants').mockImplementation(enc => enc !== 'utf-8');
    const filled = fillLanguages(FRENCH_CP1252, [
      { encoding: 'cp1252', confidence: 0.90, language: null, mimeType: null },
    ]);
    spy.mockRestore();
    expect(filled[0].language).toBe('fr');
  });

  test('tier 3 falls back to the utf-8 models', () => {
    const spy = vi.spyOn(languageInternal, 'hasModelVariants').mockImplementation(enc => enc === 'utf-8');
    const filled = fillLanguages(FRENCH_CP1252, [
      { encoding: 'cp1252', confidence: 0.90, language: null, mimeType: null },
    ]);
    spy.mockRestore();
    expect(filled[0].language).toBe('fr');
  });

  test('leaves language unset when no tier applies', () => {
    const spy = vi.spyOn(languageInternal, 'hasModelVariants').mockReturnValue(false);
    const filled = fillLanguages(FRENCH_CP1252, [
      { encoding: 'cp1252', confidence: 0.90, language: null, mimeType: null },
    ]);
    spy.mockRestore();
    expect(filled[0].language).toBeNull();
  });

  test('a thin rare label survives when no tier can score', () => {
    const rare = [...RARE_LANGUAGES].sort()[0];
    const result: DetectionResult = { encoding: 'not-a-codec', confidence: 0.5, language: rare, mimeType: 'text/plain' };
    expect(fillLanguages(new TextEncoder().encode('ab'), [result])).toEqual([result]);
  });

  test('passes through existing language', () => {
    const results: DetectionResult[] = [
      { encoding: 'koi8-r', confidence: 0.90, language: 'ru', mimeType: null },
    ];
    const filled = fillLanguages(new TextEncoder().encode('test data'), results);
    expect(filled[0]).toBe(results[0]);
  });

  test('passes through binary results', () => {
    const results: DetectionResult[] = [
      { encoding: null, confidence: 0.95, language: null, mimeType: 'application/octet-stream' },
    ];
    const filled = fillLanguages(new TextEncoder().encode('test data'), results);
    expect(filled[0]).toBe(results[0]);
  });
});

describe('_toUtf8', () => {
  test('unknown encoding returns null', () => {
    expect(_toUtf8(new TextEncoder().encode('Hello world'), 'not-a-real-encoding')).toBeNull();
  });

  test('utf-8 returns data unchanged (same reference)', () => {
    const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0xc3, 0xa9]);
    const result = _toUtf8(data, 'utf-8');
    expect(result).toBe(data);
  });
});

// The calibrated mislabel snippet: plain argmax fills it as Scottish
// Gaelic (measured margin under 0.021 over English). Shared by every band
// test so they all certify the same input.
const MISLABEL_SNIPPET = 'It’s a lovely day, so let’s grab coffee and chat.';

describe('thin-rare band', () => {
  // Apostrophe-rich English snippets must not fill as Scottish Gaelic:
  // curly apostrophes score well in the Celtic models, and on inputs this
  // short the bigram cosine stops discriminating.
  test('demotes short English snippet', () => {
    const result = detect(new TextEncoder().encode(MISLABEL_SNIPPET));
    expect(result.language).toBe('en');
  });

  // In a single-byte encoding the snippet's language arrives on the result
  // already set (by the statistical stage, with the band off by design), so
  // fillLanguages must re-derive thin rare labels rather than pass them
  // through — otherwise every detectAll tail result keeps the mislabel.
  test('rechecks statistically attached labels', () => {
    // MISLABEL_SNIPPET.encode("cp1252") — curly apostrophes are 0x92.
    const cp1252 = Uint8Array.from(
      ('497492732061206c6f76656c79206461792c20736f206c65749273206772616220636f66666565' +
       '20616e6420636861742e').match(/../g)!.map(h => parseInt(h, 16)),
    );
    for (const result of detectAll(cp1252)) {
      expect(result.language === null || !RARE_LANGUAGES.has(result.language)).toBe(true);
    }
  });

  // Genuine short Celtic text keeps its language: measured gd/cy snippets
  // win by 0.07+ even at 40 characters, and Breton clears the band from
  // about 60 characters.
  test('keeps genuine Celtic snippets', () => {
    const enc = new TextEncoder();
    const gaelic = 'Tha mi a’ dol dhan bhùth an-diugh còmhla ri mo charaid.';
    const welsh = 'Mae’r tywydd yn braf heddiw ac rydw i’n mynd i’r traeth.';
    const breton = 'Deuet eo an amzer vrav ha me a ya da bourmen war an aod gant ma mignoned.';
    const irish = 'Is maith liom an aimsir bhreá agus téim ag siúl cois farraige.';
    expect(detect(enc.encode(gaelic)).language).toBe('gd');
    expect(detect(enc.encode(welsh)).language).toBe('cy');
    expect(detect(enc.encode(breton)).language).toBe('br');
    expect(detect(enc.encode(irish)).language).toBe('ga');
  });

  // The band's accepted casualty: thin-margin Irish at snippet length. This
  // snippet is genuine Irish that the plain argmax labels ga by a margin
  // under 0.03, so the band demotes it — the trade ADR-0005's addendum
  // accepts on prevalence grounds. Pinned so any widening of the band's
  // margin or length bounds surfaces here as a deliberate decision instead
  // of a silent shift in who gets demoted.
  test('casualty class is pinned', () => {
    const irish =
      'Beidh mé ar ais amárach agus tabharfaidh mé an leabhar duit ansin.';
    const data = new TextEncoder().encode(irish);
    const [, plain] = scoreBestLanguage(data, 'utf-8');
    expect(plain).toBe('ga'); // the models do recognize it ...
    const detected = detect(data).language;
    expect(detected === null || !RARE_LANGUAGES.has(detected)).toBe(true); // ... band demotes
  });

  // The encoding-ranking caller relies on the default being a plain argmax,
  // and on the returned score being the true best either way — candidate
  // ordering must stay byte-identical.
  test('is opt-in and score-preserving', () => {
    const data = new TextEncoder().encode(MISLABEL_SNIPPET);
    const [plainScore, plainLang] = scoreBestLanguage(data, 'utf-8');
    const [bandedScore, bandedLang] = scoreBestLanguage(data, 'utf-8', undefined, {
      demoteThinRare: true,
    });
    expect(plainLang !== null && RARE_LANGUAGES.has(plainLang)).toBe(true);
    expect(bandedLang === null || !RARE_LANGUAGES.has(bandedLang)).toBe(true);
    expect(bandedScore).toBe(plainScore);
  });
});
