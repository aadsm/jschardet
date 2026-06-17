// Smoke test for the IIFE bundle (dist/jschardet.js). Loads the script
// via a <script> tag so we exercise the same path a browser <script
// src=...> consumer takes, and asserts the global has the expected
// shape and works on a trivial input.

import jschardetUrl from '../dist/jschardet.js?url';
import pkg from '../package.json' with { type: 'json' };

declare global {
  interface Window {
    jschardet?: {
      detect: (input: string | Uint8Array) => { encoding: string | null; confidence: number; language: string | null; mimeType: string | null };
      detectAll: (input: string | Uint8Array) => Array<{ encoding: string | null; confidence: number }>;
      enableDebug: () => void;
      VERSION: string;
    };
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

describe('IIFE global build (dist/jschardet.js)', () => {
  beforeAll(async () => {
    await loadScript(jschardetUrl);
  });

  test('attaches jschardet to window with the public API surface', () => {
    expect(window.jschardet).toBeDefined();
    expect(typeof window.jschardet!.detect).toBe('function');
    expect(typeof window.jschardet!.detectAll).toBe('function');
    expect(typeof window.jschardet!.enableDebug).toBe('function');
  });

  test('detect returns a result with the expected shape', () => {
    const result = window.jschardet!.detect('hello world');
    expect(result).toBeDefined();
    expect(typeof result.encoding === 'string' || result.encoding === null).toBe(true);
    expect(typeof result.confidence).toBe('number');
  });

  test('exposes VERSION matching package.json', () => {
    expect(window.jschardet!.VERSION).toBe(pkg.version);
  });
});
