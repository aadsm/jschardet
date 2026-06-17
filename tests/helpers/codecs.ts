// Test-only codec oracle. Exposes a TS surface modelled on Python's
// `bytes.decode(name)` / `str.encode(name)` / `codecs.lookup(name)`,
// including the matching error classes (`UnicodeDecodeError`,
// `UnicodeEncodeError`, `LookupError`).
//
// The API is implementation-agnostic on purpose: tests should depend on this
// module, not on whatever backs it. The contract is "behave the same as
// Python's codec layer." A future implementation that doesn't shell out is
// free to replace the internals as long as it preserves that contract.
//
// Why a codec oracle exists at all (vs. iconv-lite / TextDecoder):
//
// - Coverage gap. iconv-lite and TextDecoder together do not cover ~16 of the
//   86 encodings in REGISTRY, including utf-8-sig, hz, the iso2022_jp_*
//   family, iso2022_kr, johab, kz1048, the EBCDIC family (cp1140, cp273,
//   cp424, cp500, cp875, cp1026), cp1006, and mac-latin2. Empirically
//   verified.
// - Wrong oracle. The tests that use this module exist to assert "the
//   encoding name chardet returns is a valid Python codec name and decodes
//   cleanly." Substituting a weaker codec library for the assertion oracle
//   defeats the test's purpose — a name that fails through iconv-lite could
//   still be a perfectly good Python codec name (and vice versa). The ground
//   truth must match Python's codec layer.
// - Asymmetric WHATWG map. Routing through whatwgLabelFor looks tempting but
//   lies: chardet's WHATWG map is detection-direction only (e.g.
//   cp932 → shift_jis because they're treated equivalent for detection), so
//   decoding cp932 bytes as shift_jis would silently produce wrong output
//   rather than catching the bug we're testing for.
// - Mirroring Python's API. Modelling the wrapper on Python's decode /
//   encode / codecs.lookup (plus the matching error classes) keeps line-by-
//   line ports of Python tests mechanical, and insulates tests from changes
//   to the backing implementation.
//
// ---
// Current implementation: long-lived `python3` subprocess.
//
// `codecs_python_bridge.py` (in this directory) is spawned lazily on first
// call and kept open until `_shutdown()` is invoked from `afterAll`.
// Communication is
// JSON-line on stdin/stdout, with bytes encoded as base64. The script reports
// exception classes by name so this module can re-throw the matching TS
// error class.
//
// Why a long-lived subprocess instead of `python3 -c` per call: callers
// issue thousands of codec calls. At ~25 ms cold-start per execFileSync,
// the naive approach adds 30–60 s to the test suite — roughly 30–60× the
// rest of the suite combined. A single persistent subprocess keeps total
// overhead under a second.

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

export class UnicodeDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnicodeDecodeError';
  }
}

export class UnicodeEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnicodeEncodeError';
  }
}

export class LookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LookupError';
  }
}

interface OkResponse {
  ok: true;
  data: string;
}

interface ErrResponse {
  ok: false;
  error: string;
  message: string;
}

type Response = OkResponse | ErrResponse;

const _BRIDGE_PATH = path.resolve(
  fileURLToPath(import.meta.url),
  '..',
  'codecs_python_bridge.py',
);

let _proc: ChildProcessWithoutNullStreams | null = null;
let _stdoutBuf = '';
const _queue: Array<(resp: Response) => void> = [];
let _spawnError: Error | null = null;

function _ensureSpawned(): ChildProcessWithoutNullStreams {
  if (_proc !== null) return _proc;
  if (_spawnError !== null) throw _spawnError;
  const proc = spawn('python3', [_BRIDGE_PATH], { stdio: ['pipe', 'pipe', 'inherit'] });
  proc.on('error', err => {
    _spawnError = new Error(`failed to spawn python3 for codec bridge: ${err.message}`);
    while (_queue.length > 0) _queue.shift()!({ ok: false, error: 'SpawnError', message: _spawnError.message });
  });
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk: string) => {
    _stdoutBuf += chunk;
    let nl: number;
    while ((nl = _stdoutBuf.indexOf('\n')) !== -1) {
      const line = _stdoutBuf.slice(0, nl);
      _stdoutBuf = _stdoutBuf.slice(nl + 1);
      const cb = _queue.shift();
      if (cb === undefined) {
        throw new Error(`codec bridge: unexpected stdout line with no pending request: ${line}`);
      }
      cb(JSON.parse(line) as Response);
    }
  });
  _proc = proc;
  return proc;
}

function _request(req: { op: 'encode' | 'decode' | 'lookup'; encoding: string; data: string }): Promise<Response> {
  const proc = _ensureSpawned();
  return new Promise<Response>((resolve, reject) => {
    _queue.push(resolve);
    proc.stdin.write(JSON.stringify(req) + '\n', err => {
      if (err) reject(err);
    });
  });
}

function _throwForError(resp: ErrResponse): never {
  switch (resp.error) {
    case 'UnicodeDecodeError': throw new UnicodeDecodeError(resp.message);
    case 'UnicodeEncodeError': throw new UnicodeEncodeError(resp.message);
    case 'LookupError': throw new LookupError(resp.message);
    default: throw new Error(`codec bridge: ${resp.error}: ${resp.message}`);
  }
}

export async function decode(bytes: Uint8Array, encoding: string): Promise<string> {
  const data = Buffer.from(bytes).toString('base64');
  const resp = await _request({ op: 'decode', encoding, data });
  if (!resp.ok) _throwForError(resp);
  return resp.data;
}

export async function encode(text: string, encoding: string): Promise<Uint8Array> {
  const resp = await _request({ op: 'encode', encoding, data: text });
  if (!resp.ok) _throwForError(resp);
  return new Uint8Array(Buffer.from(resp.data, 'base64'));
}

export const codecs = {
  async lookup(encoding: string): Promise<{ name: string }> {
    const resp = await _request({ op: 'lookup', encoding, data: '' });
    if (!resp.ok) _throwForError(resp);
    return { name: resp.data };
  },
};

export async function _shutdown(): Promise<void> {
  if (_proc === null) return;
  const proc = _proc;
  _proc = null;
  proc.stdin.end();
  await new Promise<void>(resolve => {
    proc.on('exit', () => resolve());
  });
}
