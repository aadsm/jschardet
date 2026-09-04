// Debug gate shared by the public jschardet wrapper (src/index.ts) and the
// ported chardet pipeline. enableDebug() turns on two things: the candidate
// logging in the public detect()/detectAll(), and the deprecation notices the
// pipeline emits when a caller passes a deprecated option. Off by default, so a
// normal detect() writes nothing to the console.
//
// This is jschardet's stand-in for Python's warnings filter. Python hides
// DeprecationWarning by default and lets callers re-enable it (-W,
// PYTHONWARNINGS, filterwarnings); console.warn has no such filter, so the
// deprecation notices ride this opt-in flag instead of printing unconditionally.

let _debug = false;

export function isDebug(): boolean {
  return _debug;
}

export function enableDebug(): void {
  _debug = true;
}

// The one way the pipeline emits a deprecation notice: gated behind the debug
// flag and stamped with the "DEPRECATION:" prefix the suite filters on. This is
// the JS counterpart to Python's warnings.warn(..., DeprecationWarning) — the
// category Python hides by default — so callers own the *condition* and this
// owns *how* it surfaces. UserWarning and RuntimeWarning, which Python shows by
// default, stay as unconditional console.warn at their call sites.
export function warnDeprecated(message: string): void {
  if (_debug) console.warn(`DEPRECATION: ${message}`);
}

// Test-only reset. enableDebug() has no public off-switch; the suite uses this
// to scope the flag around a single case.
export function _setDebug(value: boolean): void {
  _debug = value;
}
