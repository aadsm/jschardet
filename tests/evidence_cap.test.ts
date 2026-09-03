// Port of chardet/tests/test_evidence_cap.py.
//
// The evidence cap (ADR-0006): the filtering, gating, probing, and
// rank-correction stages converge on at most EVIDENCE_CAP_BYTES of the
// examination window. The cap sits above DEFAULT_MAX_BYTES so every default
// call is unaffected; for larger windows, bytes past the cap cannot change what
// those stages conclude. One thing survives the cap: the answer decodes the
// whole window, held by a winner-first decode of the ranking after the bounded
// stages settle.

import { detect, detectAll, DEFAULT_MAX_BYTES, EVIDENCE_CAP_BYTES } from '../src/chardet.js';
import { DetectionResult } from '../src/pipeline/index.js';
import { _holdValidityPastCap } from '../src/pipeline/orchestrator.js';

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
function bytes(s: string): Uint8Array {
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
// Build a body a bit larger than the evidence cap. Whole repetitions only: the
// body must end on a character boundary, or an appended garbage byte hides
// inside the tolerated truncated-tail overrun instead of being seen as invalid.
function beyondCap(filler: Uint8Array): Uint8Array {
  const reps = Math.floor((EVIDENCE_CAP_BYTES + 50_000) / filler.length) + 1;
  return repeat(filler, reps);
}

// "Le cœur a ses raisons que la raison ne connaît point. ".encode("cp1252")
const FRENCH_CP1252 = new Uint8Array([76,101,32,99,156,117,114,32,97,32,115,101,115,32,114,97,105,115,111,110,115,32,113,117,101,32,108,97,32,114,97,105,115,111,110,32,110,101,32,99,111,110,110,97,238,116,32,112,111,105,110,116,46,32]);
// "吾輩は猫である。名前はまだ無い。".encode("shift_jis")
const SHIFT_JIS_JP = new Uint8Array([140,225,148,121,130,205,148,76,130,197,130,160,130,233,129,66,150,188,145,79,130,205,130,220,130,190,150,179,130,162,129,66]);
// "こんにちは".encode("utf-7")
const UTF7_KONNICHIWA = new Uint8Array([43,77,70,77,119,107,122,66,114,77,71,69,119,98,119,45]);
// "こんにちは世界".encode("utf-7")
const UTF7_KONNICHIWA_SEKAI = new Uint8Array([43,77,70,77,119,107,122,66,114,77,71,69,119,98,48,52,87,100,85,119,45]);
// "héllo wörld —日本語 ".encode("utf-8")
const UTF8_MIXED = new Uint8Array([104,195,169,108,108,111,32,119,195,182,114,108,100,32,226,128,148,230,151,165,230,156,172,232,170,158,32]);

const GARBAGE_C1 = repeat(new Uint8Array([0x81, 0x8d, 0x9d]), 50);

test('the cap covers the default window', () => {
  expect(EVIDENCE_CAP_BYTES).toBeGreaterThanOrEqual(DEFAULT_MAX_BYTES);
});

test('the winner decodes the whole window past the cap', () => {
  const body = beyondCap(FRENCH_CP1252);
  const withGarbage = concat(body, GARBAGE_C1);

  expect(detect(body, { maxBytes: body.length }).encoding).toBe('Windows-1252');

  const dirty = detect(withGarbage, { maxBytes: withGarbage.length });
  expect(dirty.encoding).not.toBe('Windows-1252');
  const ranking = detectAll(withGarbage, { maxBytes: withGarbage.length });
  expect(ranking[0].encoding).toBe(dirty.encoding);
  expect(ranking.map(r => r.encoding)).not.toContain('Windows-1252');
});

test('when nothing in the ranking decodes the window, the fallback answers', () => {
  const body = beyondCap(FRENCH_CP1252);
  const withGarbage = concat(body, GARBAGE_C1);
  const result = detect(withGarbage, {
    maxBytes: withGarbage.length,
    includeEncodings: ['cp1252', 'cp1250'],
    noMatchEncoding: 'cp1252',
  });
  expect([result.encoding, result.confidence]).toEqual(['Windows-1252', 0.10]);
});

test('the validity hold skips entries without an encoding', () => {
  const data = new Uint8Array(EVIDENCE_CAP_BYTES + 1).fill(0x78);
  const results: DetectionResult[] = [
    { encoding: null, confidence: 0.0, language: null, mimeType: null },
    { encoding: 'ascii', confidence: 0.5, language: null, mimeType: null },
  ];
  const held = _holdValidityPastCap(
    data, data.subarray(0, EVIDENCE_CAP_BYTES), results, new Set(['ascii']), 'ascii',
  );
  expect(held.map(r => r.encoding)).toEqual(['ascii']);
});

test('structure-breaking bytes past the cap yield a decodable answer', () => {
  const body = beyondCap(SHIFT_JIS_JP);
  const garbage = repeat(new Uint8Array([0x82, 0x39]), 100);
  const withGarbage = concat(body, garbage);

  const clean = detect(body, { maxBytes: body.length });
  expect(['SHIFT_JIS', 'CP932']).toContain(clean.encoding);

  const dirty = detect(withGarbage, { maxBytes: withGarbage.length });
  expect(['SHIFT_JIS', 'CP932']).not.toContain(dirty.encoding);
  expect(dirty.confidence).toBeLessThan(clean.confidence);
});

test('the UTF-7 validator converges on the cap', () => {
  const blob = beyondCap(bytes('+abc123def456ghi789jkl012mno345pqr678stu901vwx234yz\n'));
  expect(detect(blob, { maxBytes: blob.length }).encoding).toBe('ascii');
});

test('escape evidence sitting entirely past the cap is not consulted', () => {
  const body = beyondCap(bytes('plain ascii filler text, nothing special here.\n'));
  const utf7Tail = repeat(UTF7_KONNICHIWA, 20);
  const data = concat(body, utf7Tail);
  expect(detect(data, { maxBytes: data.length }).encoding).not.toBe('utf-7');
  const head = concat(utf7Tail, body);
  expect(detect(head, { maxBytes: head.length }).encoding).toBe('utf-7');
});

test('a sequence straddling the cap is still seen', () => {
  const prefix = new Uint8Array(EVIDENCE_CAP_BYTES - 100).fill(0x61); // "a"
  const region = concat(bytes('~{'), repeat(new Uint8Array([0x3b, 0x3c]), 200), bytes('~}'));
  const straddle = concat(prefix, region, bytes(' tail text'));
  expect(detect(straddle, { maxBytes: straddle.length }).encoding).toBe('HZ-GB-2312');

  // A UTF-7 shift whose base64 run crosses the boundary. The padding must end
  // on a non-base64 byte, or the '+' reads as embedded in a base64 stream.
  const pad = concat(
    bytes('plain ascii text '.repeat(20_000)).subarray(0, EVIDENCE_CAP_BYTES - 5),
    bytes(' '),
  );
  const utf7Straddle = concat(pad, UTF7_KONNICHIWA_SEKAI, bytes(' trailing ascii'));
  expect(detect(utf7Straddle, { maxBytes: utf7Straddle.length }).encoding).toBe('utf-7');
});

test('a utf-7 accept stays exhaustive', () => {
  const unit = UTF7_KONNICHIWA_SEKAI;
  const body = repeat(unit, Math.floor((EVIDENCE_CAP_BYTES + 20_000) / unit.length) + 1);
  expect(body.length).toBeGreaterThan(EVIDENCE_CAP_BYTES);
  const broken = concat(body, bytes('+|illegal+|shift+|'));
  expect(detect(broken, { maxBytes: broken.length }).encoding).not.toBe('utf-7');
  expect(detect(body, { maxBytes: body.length }).encoding).toBe('utf-7');
});

test('valid ASCII past the cap keeps the utf-8 candidate', () => {
  const body = beyondCap(bytes('plain ascii log line, nothing special here.\n'));
  expect(
    detect(body, { maxBytes: body.length, includeEncodings: ['utf-8'] }).encoding,
  ).toBe('utf-8');
  const dangling = concat(body, new Uint8Array([0xc3]));
  expect(detect(dangling, { maxBytes: dangling.length }).encoding).not.toBeNull();
  const invalid = concat(body, new Uint8Array([0xff, 0xfe, 0xff]));
  expect(detect(invalid, { maxBytes: invalid.length }).encoding).not.toBe('utf-8');
});

test('the exhaustive UTF-8 check still sees everything past the cap', () => {
  const body = beyondCap(UTF8_MIXED);
  expect(detect(body, { maxBytes: body.length }).encoding).toBe('utf-8');
  const broken = concat(body, new Uint8Array([0xff]));
  expect(detect(broken, { maxBytes: broken.length }).encoding).not.toBe('utf-8');
});
