import { isBinary } from '../src/pipeline/binary.js';

describe('isBinary', () => {
  test('empty input is not binary', () => {
    expect(isBinary(new Uint8Array([]))).toBe(false);
  });

  test('plain ASCII is not binary', () => {
    expect(isBinary(new TextEncoder().encode('Hello, world!'))).toBe(false);
  });

  test('text with newlines and tabs is not binary', () => {
    expect(isBinary(new TextEncoder().encode('Hello\n\tworld\r\n'))).toBe(false);
  });

  test('all null bytes is binary', () => {
    expect(isBinary(new Uint8Array(100).fill(0))).toBe(true);
  });

  test('high null concentration is binary', () => {
    // >1% null bytes
    const hello = new TextEncoder().encode('Hello');
    const nulls = new Uint8Array(10);
    const world = new TextEncoder().encode('world'.repeat(10));
    const data = new Uint8Array(hello.length + nulls.length + world.length);
    data.set(hello); data.set(nulls, hello.length); data.set(world, hello.length + nulls.length);
    expect(isBinary(data)).toBe(true);
  });

  test('single null in large text is not binary', () => {
    // <1% null bytes
    const data = new Uint8Array(1001);
    data.fill(0x61, 0, 500);    // 'a' * 500
    data[500] = 0x00;
    data.fill(0x62, 501, 1001); // 'b' * 500
    expect(isBinary(data)).toBe(false);
  });

  test('control characters indicate binary', () => {
    // Bytes 0x01-0x08 (excluding \t=0x09, \n=0x0A, \r=0x0D)
    const chunk = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    const data = new Uint8Array(chunk.length * 20);
    for (let i = 0; i < 20; i++) data.set(chunk, i * chunk.length);
    expect(isBinary(data)).toBe(true);
  });

  test('few control chars in large text is not binary', () => {
    const normal = new TextEncoder().encode('Normal text '.repeat(100));
    const data = new Uint8Array(normal.length + 1);
    data.set(normal);
    data[normal.length] = 0x01;
    expect(isBinary(data)).toBe(false);
  });

  test('JPEG header is binary', () => {
    const jpeg = new Uint8Array(4 + 50 + 256);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
    for (let i = 0; i < 256; i++) jpeg[54 + i] = i;
    expect(isBinary(jpeg)).toBe(true);
  });

  test('UTF-8 text is not binary', () => {
    expect(isBinary(new TextEncoder().encode('Héllo wörld'))).toBe(false);
  });

  test('max_bytes respected', () => {
    const text = new TextEncoder().encode('clean text '.repeat(100));
    const binary = new Uint8Array(1000).fill(0x00);
    const data = new Uint8Array(text.length + binary.length);
    data.set(text); data.set(binary, text.length);
    expect(isBinary(data, text.length)).toBe(false);
  });

  test('exactly at threshold is not binary', () => {
    // 1 binary byte in 100 = exactly 1%, which is NOT > 0.01
    const data = new Uint8Array(100).fill(0x61);
    data[99] = 0x01;
    expect(isBinary(data)).toBe(false);
  });

  test('just above threshold is binary', () => {
    // 2 binary bytes in 100 = 2% > 0.01
    const data = new Uint8Array(100).fill(0x61);
    data[98] = 0x01;
    data[99] = 0x02;
    expect(isBinary(data)).toBe(true);
  });
});
