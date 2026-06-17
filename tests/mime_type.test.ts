// Port of chardet/tests/test_mime_type.py.
//
// Verifies the mimeType field on DetectionResult across detect(), detectAll(),
// and UniversalDetector.

import { detect, detectAll } from '../src/chardet.js';
import { UniversalDetector } from '../src/detector.js';
import { detectMarkupCharset } from '../src/pipeline/markup.js';
import sampleGif from './fixtures/mime_type/sample-1.gif?uint8array';
import sampleJpg from './fixtures/mime_type/sample-1.jpg?uint8array';
import sampleMp4 from './fixtures/mime_type/sample-1.mp4?uint8array';
import samplePng1 from './fixtures/mime_type/sample-1.png?uint8array';
import sampleWebp from './fixtures/mime_type/sample-1.webp?uint8array';
import sampleXlsx from './fixtures/mime_type/sample-1.xlsx?uint8array';
import samplePng2 from './fixtures/mime_type/sample-2.png?uint8array';
import samplePng3 from './fixtures/mime_type/sample-3.png?uint8array';

// ---------------------------------------------------------------------------
// Markup stage — mimeType from charset declarations
// ---------------------------------------------------------------------------

test('markup xml mime type', () => {
  const data = new TextEncoder().encode('<?xml version="1.0" encoding="iso-8859-1"?><root/>');
  const result = detectMarkupCharset(data);
  expect(result).not.toBeNull();
  expect(result!.mimeType).toBe('text/xml');
});

test('markup html5 mime type', () => {
  const data = new TextEncoder().encode('<meta charset="utf-8"><html><body>Hello</body></html>');
  const result = detectMarkupCharset(data);
  expect(result).not.toBeNull();
  expect(result!.mimeType).toBe('text/html');
});

test('markup html4 mime type', () => {
  const data = new TextEncoder().encode(
    '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
  );
  const result = detectMarkupCharset(data);
  expect(result).not.toBeNull();
  expect(result!.mimeType).toBe('text/html');
});

test('markup pep263 mime type', () => {
  const data = new TextEncoder().encode("# -*- coding: utf-8 -*-\nprint('hello')\n");
  const result = detectMarkupCharset(data);
  expect(result).not.toBeNull();
  expect(result!.mimeType).toBe('text/x-python');
});

test('markup no match returns null', () => {
  const result = detectMarkupCharset(new TextEncoder().encode('Hello, world!'));
  expect(result).toBeNull();
});

// ---------------------------------------------------------------------------
// Magic stage — mimeType from file signatures
// ---------------------------------------------------------------------------

test('detect png returns mime type', () => {
  const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(100).fill(0)]);
  const result = detect(data);
  expect(result.encoding).toBeNull();
  expect(result.mimeType).toBe('image/png');
});

test('detect jpeg returns mime type', () => {
  const data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(0)]);
  const result = detect(data);
  expect(result.encoding).toBeNull();
  expect(result.mimeType).toBe('image/jpeg');
});

test('detect pdf returns mime type', () => {
  const data = new Uint8Array([
    ...new TextEncoder().encode('%PDF-1.4 '),
    ...new Array(100).fill(0),
  ]);
  const result = detect(data);
  expect(result.encoding).toBeNull();
  expect(result.mimeType).toBe('application/pdf');
});

// ---------------------------------------------------------------------------
// Text result defaults
// ---------------------------------------------------------------------------

test('text result defaults to text/plain', () => {
  const result = detect(new TextEncoder().encode('Hello world'));
  expect(result.mimeType).toBe('text/plain');
});

test('binary result defaults to application/octet-stream', () => {
  // Control bytes that trigger binary detection but don't match any magic number.
  // Mix of control chars (no nulls to avoid UTF-16 detection) with high bytes.
  const chunk = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x0e, 0x0f, 0x10, 0x11]);
  const data = new Uint8Array(chunk.length * 20);
  for (let i = 0; i < 20; i++) data.set(chunk, i * chunk.length);
  const result = detect(data);
  expect(result.encoding).toBeNull();
  expect(result.mimeType).toBe('application/octet-stream');
});

test('utf8 result has text/plain', () => {
  const data = new TextEncoder().encode('Héllo wörld café');
  const result = detect(data);
  expect(result.mimeType).toBe('text/plain');
});

test('empty input has text/plain', () => {
  const result = detect(new Uint8Array(0));
  expect(result.mimeType).toBe('text/plain');
});

// ---------------------------------------------------------------------------
// detectAll() — mimeType on every candidate
// ---------------------------------------------------------------------------

test('detect all includes mime type', () => {
  const data = new TextEncoder().encode('Héllo wörld café résumé');
  const results = detectAll(data, { ignoreThreshold: true });
  for (const r of results) {
    expect('mimeType' in r).toBe(true);
    expect(r.mimeType).toBe('text/plain');
  }
});

test('detect all binary mime type', () => {
  const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(100).fill(0)]);
  const results = detectAll(data);
  expect(results[0].mimeType).toBe('image/png');
});

// ---------------------------------------------------------------------------
// UniversalDetector — mimeType on result
// ---------------------------------------------------------------------------

test('universal detector mime type', () => {
  const det = new UniversalDetector();
  det.feed(new TextEncoder().encode('Hello world'));
  const result = det.close();
  expect(result.mimeType).toBe('text/plain');
});

test('universal detector binary mime type', () => {
  const det = new UniversalDetector();
  det.feed(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(100).fill(0)]));
  const result = det.close();
  expect(result.mimeType).toBe('image/png');
});

test('universal detector pre-close mime type is null', () => {
  const det = new UniversalDetector();
  expect(det.result.mimeType).toBeNull();
});

// ---------------------------------------------------------------------------
// Real binary corpus files
// ---------------------------------------------------------------------------

test.each<[string, Uint8Array, string]>([
  ['sample-1.gif',  sampleGif,  'image/gif'],
  ['sample-1.jpg',  sampleJpg,  'image/jpeg'],
  ['sample-1.mp4',  sampleMp4,  'video/mp4'],
  ['sample-1.png',  samplePng1, 'image/png'],
  ['sample-1.webp', sampleWebp, 'image/webp'],
  ['sample-1.xlsx', sampleXlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['sample-2.png',  samplePng2, 'image/png'],
  ['sample-3.png',  samplePng3, 'image/png'],
])('None-None fixture %s detects as %s', (_name, data, expectedMime) => {
  const result = detect(data);
  expect(result.encoding).toBeNull();
  expect(result.mimeType).toBe(expectedMime);
});
