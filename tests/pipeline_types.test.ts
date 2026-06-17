// Port of chardet/tests/test_pipeline_types.py.
//
// Validates the shape and mutability of DetectionResult and PipelineContext.
//
// Key differences from Python:
//   - DetectionResult is a plain interface (not a frozen dataclass); freeze
//     manually with Object.freeze() to test immutability.
//   - No toDict() method — fields are accessed directly on the object.
//   - PipelineContext fields (analysisCache, mbScores, mbCoverage) are Map,
//     not plain objects; use .size and .set()/.get() instead of {} and [].
//   - Field names are camelCase: mimeType, analysisCache, nonAsciiCount, etc.

import { DetectionResult, PipelineContext } from '../src/pipeline/index.js';

// ---------------------------------------------------------------------------
// DetectionResult
// ---------------------------------------------------------------------------

test('detection result fields', () => {
  const r: DetectionResult = { encoding: 'UTF-8', confidence: 0.99, language: 'en', mimeType: null };
  expect(r.encoding).toBe('UTF-8');
  expect(r.confidence).toBe(0.99);
  expect(r.language).toBe('en');
});

test('detection result shape', () => {
  const r: DetectionResult = { encoding: 'UTF-8', confidence: 0.99, language: null, mimeType: null };
  expect(r).toEqual({ encoding: 'UTF-8', confidence: 0.99, language: null, mimeType: null });
});

test('detection result null encoding', () => {
  const r: DetectionResult = { encoding: null, confidence: 0.0, language: null, mimeType: null };
  expect(r).toEqual({ encoding: null, confidence: 0.0, language: null, mimeType: null });
});

test('detection result is frozen', () => {
  const r = Object.freeze<DetectionResult>({
    encoding: 'UTF-8',
    confidence: 0.99,
    language: null,
    mimeType: null,
  });
  expect(() => {
    (r as Record<string, unknown>)['encoding'] = 'ASCII';
  }).toThrow();
});

// ---------------------------------------------------------------------------
// PipelineContext
// ---------------------------------------------------------------------------

test('pipeline context defaults', () => {
  const ctx = new PipelineContext();
  expect(ctx.analysisCache.size).toBe(0);
  expect(ctx.nonAsciiCount).toBeNull();
  expect(ctx.mbScores.size).toBe(0);
});

test('pipeline context is not frozen', () => {
  const ctx = new PipelineContext();
  ctx.nonAsciiCount = 42;
  expect(ctx.nonAsciiCount).toBe(42);
});

test('pipeline context mb coverage', () => {
  const ctx = new PipelineContext();
  expect(ctx.mbCoverage.size).toBe(0);
  ctx.mbCoverage.set('shift_jis', 0.95);
  expect(ctx.mbCoverage.get('shift_jis')).toBe(0.95);
});

// ---------------------------------------------------------------------------
// DetectionResult mimeType field
// ---------------------------------------------------------------------------

test('detection result mime type default', () => {
  const r: DetectionResult = { encoding: 'UTF-8', confidence: 0.99, language: 'en', mimeType: null };
  expect(r.mimeType).toBeNull();
});

test('detection result mime type explicit', () => {
  const r: DetectionResult = { encoding: null, confidence: 1.0, language: null, mimeType: 'image/png' };
  expect(r.mimeType).toBe('image/png');
});

test('detection result includes mime type field', () => {
  const r: DetectionResult = { encoding: 'UTF-8', confidence: 0.99, language: null, mimeType: 'text/plain' };
  expect(r).toEqual({ encoding: 'UTF-8', confidence: 0.99, language: null, mimeType: 'text/plain' });
});
