import { detectBom } from '../src/pipeline/bom.js';

describe('detectBom', () => {
  test('UTF-8 BOM', () => {
    const data = new Uint8Array([0xef, 0xbb, 0xbf, 0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    expect(detectBom(data)).toEqual({ encoding: 'utf-8-sig', confidence: 1.0, language: null, mimeType: null });
  });

  test('UTF-16 LE BOM', () => {
    const data = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x65, 0x00, 0x6c, 0x00, 0x6c, 0x00, 0x6f, 0x00]);
    expect(detectBom(data)).toEqual({ encoding: 'utf-16', confidence: 1.0, language: null, mimeType: null });
  });

  test('UTF-16 BE BOM', () => {
    const data = new Uint8Array([0xfe, 0xff, 0x00, 0x48, 0x00, 0x65, 0x00, 0x6c, 0x00, 0x6c, 0x00, 0x6f]);
    expect(detectBom(data)).toEqual({ encoding: 'utf-16', confidence: 1.0, language: null, mimeType: null });
  });

  test('UTF-32 LE BOM', () => {
    const data = new Uint8Array([0xff, 0xfe, 0x00, 0x00, 0x48, 0x00, 0x00, 0x00]);
    expect(detectBom(data)).toEqual({ encoding: 'utf-32', confidence: 1.0, language: null, mimeType: null });
  });

  test('UTF-32 BE BOM', () => {
    const data = new Uint8Array([0x00, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x00, 0x48]);
    expect(detectBom(data)).toEqual({ encoding: 'utf-32', confidence: 1.0, language: null, mimeType: null });
  });

  test('no BOM', () => {
    expect(detectBom(new TextEncoder().encode('Hello, world!'))).toBeNull();
  });

  test('empty input', () => {
    expect(detectBom(new Uint8Array([]))).toBeNull();
  });

  test('too short for BOM', () => {
    expect(detectBom(new Uint8Array([0xef]))).toBeNull();
    expect(detectBom(new Uint8Array([0xef, 0xbb]))).toBeNull();
  });

  test('UTF-32 LE checked before UTF-16 LE', () => {
    const data = new Uint8Array([0xff, 0xfe, 0x00, 0x00, 0x48, 0x00, 0x00, 0x00]);
    const result = detectBom(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-32');
  });

  test('UTF-32 LE BOM only (no payload)', () => {
    const result = detectBom(new Uint8Array([0xff, 0xfe, 0x00, 0x00]));
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-32');
  });

  test('UTF-32 LE BOM falls through to UTF-16 when payload not aligned', () => {
    // FF FE 00 00 30 00 — 2-byte payload, not a multiple of 4 → falls back to UTF-16
    const data = new Uint8Array([0xff, 0xfe, 0x00, 0x00, 0x30, 0x00]);
    const result = detectBom(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBe('utf-16');
  });

  test('UTF-32 BE BOM falls through when payload not aligned', () => {
    // 2-byte payload, not aligned, and no UTF-16 fallback for this sequence
    const data = new Uint8Array([0x00, 0x00, 0xfe, 0xff, 0x00, 0x48]);
    expect(detectBom(data)).toBeNull();
  });
});
