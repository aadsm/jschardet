// Guards the module-format contract of the published package.
//
// jschardet 3 documented two entry points — `require("jschardet")` and a
// <script src> that leaves a global behind — and, via browserify --standalone,
// happened to register with AMD loaders as well. v4 is ESM-first, which makes
// all three easy to regress. These tests run against the committed dist/
// bundles, so a source change that is not followed by `npm run build:bundles`
// fails here.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const req = createRequire(import.meta.url);
const abs = (p: string) => fileURLToPath(new URL(p, import.meta.url));

interface PublicApi {
  detect: (input: string | Uint8Array) => { encoding: string | null; confidence: number };
  detectAll: (input: string | Uint8Array) => Array<{ encoding: string | null }>;
  enableDebug: () => void;
  VERSION: string;
}

// The bundles are built for the browser, so the sandbox gets the browser
// globals they rely on rather than all of Node's.
function browserGlobals(): Record<string, unknown> {
  return { console, TextDecoder, TextEncoder, atob, btoa };
}

function assertPublicApi(api: PublicApi): void {
  expect(typeof api.detect).toBe('function');
  expect(typeof api.detectAll).toBe('function');
  expect(typeof api.enableDebug).toBe('function');
  expect(typeof api.VERSION).toBe('string');
  expect(api.detect('Python is a great programming language.').encoding).toBe('ascii');
}

describe.each([
  ['dist/jschardet.js', abs('../dist/jschardet.js')],
  ['dist/jschardet.min.js', abs('../dist/jschardet.min.js')],
])('browser bundle (%s)', (_name, path) => {
  const code = readFileSync(path, 'utf8');

  test('leaves a global behind for <script src> consumers', () => {
    const context = createContext(browserGlobals()) as { jschardet?: PublicApi };
    runInContext(code, context as object);
    expect(context.jschardet).toBeDefined();
    assertPublicApi(context.jschardet!);
  });

  test('registers with an AMD loader', () => {
    let exported: PublicApi | null = null;
    const define = (_deps: string[], factory: () => PublicApi) => { exported = factory(); };
    define.amd = {};
    runInContext(code, createContext({ ...browserGlobals(), define }));
    expect(exported).not.toBeNull();
    assertPublicApi(exported!);
  });
});

describe('CommonJS entry (build/index.cjs)', () => {
  test('require() exposes the public API', () => {
    const api = req('../build/index.cjs') as PublicApi & { chardet: unknown; default: PublicApi };
    assertPublicApi(api);
    expect(api.chardet).toBeDefined();
    // Named and default exports both work, mirroring the ESM entry.
    assertPublicApi(api.default);
  });

  test('uses node:zlib rather than the browser decoder', () => {
    expect(readFileSync(abs('../build/index.cjs'), 'utf8')).toContain('node:zlib');
  });
});

// Resolving the package by name needs it to sit in a node_modules directory —
// otherwise Node never reads the "exports" map and these would only be
// restating package.json back to itself. A scratch project with a symlink to
// the repo root puts the real manifest on the real resolution path.
describe('package resolution through node_modules', () => {
  let projectDir: string;

  beforeAll(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'jschardet-resolve-'));
    mkdirSync(join(projectDir, 'node_modules'));
    symlinkSync(abs('..'), join(projectDir, 'node_modules', 'jschardet'), 'dir');
    writeFileSync(join(projectDir, 'package.json'), '{"name":"scratch","version":"0.0.0"}');
  });

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  // Each case runs in its own process so a resolution failure surfaces as an
  // error code rather than taking the test runner down with it.
  function run(filename: string, source: string): { status: number; stdout: string; stderr: string } {
    const file = join(projectDir, filename);
    writeFileSync(file, source);
    const r = spawnSync(process.execPath, [file], { cwd: projectDir, encoding: 'utf8' });
    return { status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
  }

  test('require("jschardet") resolves to the CommonJS build and works', () => {
    const r = run('r.cjs', `
      const js = require('jschardet');
      if (typeof js.detect !== 'function') throw new Error('no detect export');
      console.log(JSON.stringify({
        resolved: require.resolve('jschardet'),
        encoding: js.detect('Python is a great programming language.').encoding,
      }));
    `);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.resolved).toMatch(/build[\\/]index\.cjs$/);
    expect(out.encoding).toBe('ascii');
  });

  test('import "jschardet" resolves to the ESM build and works', () => {
    const r = run('i.mjs', `
      import { detect, VERSION } from 'jschardet';
      if (typeof detect !== 'function') throw new Error('no detect export');
      console.log(JSON.stringify({
        resolved: import.meta.resolve('jschardet'),
        encoding: detect('Python is a great programming language.').encoding,
        VERSION,
      }));
    `);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.resolved).toMatch(/build[\\/]index\.js$/);
    expect(out.encoding).toBe('ascii');
    expect(out.VERSION).toBe((req('../package.json') as { version: string }).version);
  });

  // The declarations are found by adjacency — TypeScript resolves the specifier
  // to a JS entry point and reads the .d.ts / .d.cts sitting next to it. There
  // is no "types" field or condition pointing the way, so nothing but this
  // catches a missing or misnamed twin.
  test.each([
    ['ESM', 'ts.mts', `import { detect } from 'jschardet'; detect('x');`],
    ['CommonJS', 'ts.cts', `import js = require('jschardet'); js.detect('x');`],
  ])('TypeScript resolves declarations for a %s consumer', (_label, filename, source) => {
    writeFileSync(join(projectDir, filename), source);
    const tsc = req.resolve('typescript/bin/tsc');
    const r = spawnSync(
      process.execPath,
      [tsc, '--noEmit', '--module', 'node16', '--moduleResolution', 'node16', filename],
      { cwd: projectDir, encoding: 'utf8' },
    );
    expect(r.stdout.trim()).toBe('');
    expect(r.status).toBe(0);
  });

});
