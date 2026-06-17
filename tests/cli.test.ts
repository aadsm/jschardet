// Port of chardet/tests/test_cli.py.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { main, type MainOptions } from '../src/cli.js';
import type { DetectionResult } from '../src/chardet.js';
import { VERSION } from '../src/version.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'jschardet-cli-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeBytes(name: string, data: Uint8Array | string): string {
  const path = join(tmpDir, name);
  writeFileSync(path, data);
  return path;
}

function captured(extra: Partial<MainOptions> = {}): {
  opts: MainOptions;
  stdout: () => string;
  stderr: () => string;
} {
  const out: string[] = [];
  const err: string[] = [];
  const opts: MainOptions = {
    write: (s: string) => { out.push(s); },
    writeErr: (s: string) => { err.push(s); },
    ...extra,
  };
  return {
    opts,
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  };
}

describe('jschardet CLI — subprocess smoke tests', () => {
  test('detects file', () => {
    const f = writeBytes('test.txt', 'Hello world');
    const r = spawnSync('node', ['build/cli.js', f], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout.toLowerCase()).toContain('ascii');
  });

  test('detects utf-8 file', () => {
    const f = writeBytes('test.txt', 'Héllo wörld');
    const r = spawnSync('node', ['build/cli.js', f], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout.toLowerCase()).toContain('utf-8');
  });

  test('stdin', () => {
    const r = spawnSync('node', ['build/cli.js'], {
      input: 'Hello world',
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout.toLowerCase()).toContain('ascii');
  });

  test('--version', () => {
    const r = spawnSync('node', ['build/cli.js', '--version'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const output = r.stdout.trim();
    expect(output.startsWith('jschardet ')).toBe(true);
    expect(output).toBe(`jschardet ${VERSION}`);
  });
});

describe('jschardet CLI — in-process', () => {
  test('--minimal prints only the encoding name', async () => {
    const f = writeBytes('test.txt', 'Hello world');
    const c = captured();
    const code = await main(['--minimal', f], c.opts);
    expect(code).toBe(0);
    expect(c.stdout().trim()).toBe('ascii');
  });

  test('multiple files produce one line each', async () => {
    const f1 = writeBytes('a.txt', 'Hello');
    const f2 = writeBytes('b.txt', 'Héllo');
    const c = captured();
    const code = await main([f1, f2], c.opts);
    expect(code).toBe(0);
    const lines = c.stdout().trim().split('\n');
    expect(lines.length).toBe(2);
  });

  test('nonexistent file exits 1 with stderr', async () => {
    const c = captured();
    const code = await main(['nonexistent_file_xyz.txt'], c.opts);
    expect(code).toBe(1);
    expect(c.stderr()).toContain('nonexistent_file_xyz.txt');
  });

  test('-e modern_web works', async () => {
    const f = writeBytes('test.txt', 'Hello world, enough text for detection. '.repeat(3));
    const c = captured();
    const code = await main(['-e', 'modern_web', f], c.opts);
    expect(code).toBe(0);
    expect(c.stdout()).toContain('with confidence');
  });

  test('partial failure (some files succeed) exits 0', async () => {
    const good = writeBytes('good.txt', 'Hello world');
    const c = captured();
    const code = await main([good, 'nonexistent_file_xyz.txt'], c.opts);
    expect(code).toBe(0);
    expect(c.stderr()).toContain('nonexistent_file_xyz.txt');
    expect(c.stdout()).toContain('with confidence');
  });

  test('detection failure on file exits 1', async () => {
    const f = writeBytes('test.txt', 'Hello world');
    const c = captured({
      detectFn: () => { throw new Error('boom'); },
    });
    const code = await main([f], c.opts);
    expect(code).toBe(1);
    expect(c.stderr()).toContain('detection failed');
    expect(c.stderr()).toContain('boom');
  });

  test('detection failure on stdin exits 1', async () => {
    const c = captured({
      stdin: new TextEncoder().encode('Hello'),
      detectFn: () => { throw new Error('boom'); },
    });
    const code = await main([], c.opts);
    expect(code).toBe(1);
    expect(c.stderr()).toContain('detection failed');
    expect(c.stderr()).toContain('stdin');
  });

  test('stdin success prints "with confidence"', async () => {
    const c = captured({ stdin: new TextEncoder().encode('Hello world') });
    const code = await main([], c.opts);
    expect(code).toBe(0);
    expect(c.stdout()).toContain('with confidence');
  });

  test('--language adds parenthesized language name', async () => {
    const f = writeBytes('test.txt', 'Héllo wörld café résumé naïve');
    const c = captured();
    const code = await main(['--language', f], c.opts);
    expect(code).toBe(0);
    expect(c.stdout()).toContain('with confidence');
    expect(c.stdout()).toContain('(');
    expect(c.stdout()).toContain(')');
  });

  test('-l short flag works', async () => {
    const f = writeBytes('test.txt', 'Héllo wörld café résumé naïve');
    const c = captured();
    const code = await main(['-l', f], c.opts);
    expect(code).toBe(0);
    expect(c.stdout()).toContain('(');
    expect(c.stdout()).toContain('with confidence');
  });

  test('--language --minimal prints encoding and language code', async () => {
    const f = writeBytes('test.txt', 'Héllo wörld café résumé naïve');
    const c = captured();
    const code = await main(['--minimal', '--language', f], c.opts);
    expect(code).toBe(0);
    const parts = c.stdout().trim().split(/\s+/);
    expect(parts.length).toBe(2);
    expect(c.stdout()).not.toContain('with confidence');
    expect(c.stdout()).not.toContain('(');
  });

  test('--language --minimal on stdin prints two tokens', async () => {
    const c = captured({ stdin: new TextEncoder().encode('Héllo wörld café résumé naïve') });
    const code = await main(['--minimal', '--language'], c.opts);
    expect(code).toBe(0);
    const parts = c.stdout().trim().split(/\s+/);
    expect(parts.length).toBe(2);
    expect(c.stdout()).not.toContain('with confidence');
  });

  test('language=null displays "und (Undetermined)"', async () => {
    const f = writeBytes('test.txt', 'Hello world');
    const fakeResult: DetectionResult = {
      encoding: 'ascii',
      confidence: 1.0,
      language: null,
      mimeType: null,
    };
    const c = captured({ detectFn: () => fakeResult });
    const code = await main(['--language', f], c.opts);
    expect(code).toBe(0);
    expect(c.stdout()).toContain('und (Undetermined)');
  });

  test('language=null --minimal displays "encoding und"', async () => {
    const f = writeBytes('test.txt', 'Hello world');
    const fakeResult: DetectionResult = {
      encoding: 'ascii',
      confidence: 1.0,
      language: null,
      mimeType: null,
    };
    const c = captured({ detectFn: () => fakeResult });
    const code = await main(['--minimal', '--language', f], c.opts);
    expect(code).toBe(0);
    expect(c.stdout().trim()).toBe('ascii und');
  });

  test('--language on stdin includes language', async () => {
    const c = captured({ stdin: new TextEncoder().encode('Héllo wörld café résumé naïve') });
    const code = await main(['--language'], c.opts);
    expect(code).toBe(0);
    expect(c.stdout()).toContain('with confidence');
    expect(c.stdout()).toContain('(');
  });

  test('without --language, no parenthesized language', async () => {
    const f = writeBytes('test.txt', 'Héllo wörld café résumé naïve');
    const c = captured();
    const code = await main([f], c.opts);
    expect(code).toBe(0);
    expect(c.stdout()).toContain('with confidence');
    expect(c.stdout()).not.toContain('(');
  });

  test('-i restricts candidates', async () => {
    const f = writeBytes('test.txt', 'Hello world');
    const c = captured();
    const code = await main(['-i', 'utf-8,ascii', '--minimal', f], c.opts);
    expect(code).toBe(0);
    expect(c.stdout().trim().toLowerCase()).toBe('ascii');
  });

  test('-x excludes candidates', async () => {
    const f = writeBytes('test.txt', 'Hello world');
    const c = captured();
    const code = await main(['-x', 'ascii', '--minimal', f], c.opts);
    expect(code).toBe(0);
    expect(c.stdout().trim().toLowerCase()).not.toBe('ascii');
  });

  test('--no-match-encoding is returned when no candidate survives', async () => {
    const f = writeBytes('test.txt', new Uint8Array([0x80, 0x81, 0x82, 0x83, 0x84, 0x85]));
    const c = captured();
    const code = await main(
      ['--no-match-encoding', 'ascii', '-i', 'ascii', '--minimal', f],
      c.opts,
    );
    expect(code).toBe(0);
    expect(c.stdout().trim().toLowerCase()).toBe('ascii');
  });

  test('--empty-input-encoding on empty file', async () => {
    const f = writeBytes('test.txt', new Uint8Array(0));
    const c = captured();
    const code = await main(['--empty-input-encoding', 'ascii', f], c.opts);
    expect(code).toBe(0);
    expect(c.stdout().toLowerCase()).toContain('ascii');
  });

  test('-i with spaces after commas is stripped', async () => {
    const f = writeBytes('test.txt', 'Hello world');
    const c = captured();
    const code = await main(['-i', 'utf-8, ascii', '--minimal', f], c.opts);
    expect(code).toBe(0);
    expect(c.stdout().trim().toLowerCase()).toBe('ascii');
  });

  test('-i with invalid encoding reports detection failure', async () => {
    const f = writeBytes('test.txt', 'Hello');
    const c = captured();
    const code = await main(['-i', 'not-a-real-encoding', f], c.opts);
    expect(code).toBe(1);
    expect(c.stderr()).toContain('detection failed');
  });

  test('--help prints usage and exits 0', async () => {
    const c = captured();
    const code = await main(['--help'], c.opts);
    expect(code).toBe(0);
    expect(c.stdout()).toContain('Detect character encoding of files.');
    expect(c.stdout()).toContain('--minimal');
    expect(c.stdout()).toContain('Output only the encoding name');
  });

  test('-h short flag behaves like --help', async () => {
    const long = captured();
    const short = captured();
    expect(await main(['--help'], long.opts)).toBe(0);
    expect(await main(['-h'], short.opts)).toBe(0);
    expect(short.stdout()).toBe(long.stdout());
  });

  test('--help takes precedence over --version', async () => {
    const c = captured();
    const code = await main(['--help', '--version'], c.opts);
    expect(code).toBe(0);
    expect(c.stdout()).toContain('Usage:');
    expect(c.stdout()).not.toBe(`jschardet ${VERSION}\n`);
  });

  test('--help lists --encoding-era and the derived era names', async () => {
    const c = captured();
    const code = await main(['--help'], c.opts);
    expect(code).toBe(0);
    expect(c.stdout()).toContain('--encoding-era');
    expect(c.stdout()).toContain('Encoding era filter');
  });
});
