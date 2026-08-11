// Port of chardet/src/chardet/equivalences.py — a backward-compatibility shim.
//
// The module's contents are split into src/evaluation.ts (test-time accuracy
// predicates) and src/output_names.ts (runtime public-API name remapping),
// mirroring the upstream split. Python's shim emits a DeprecationWarning on
// import and is scheduled for removal in chardet 8.0; ESM has no import-time
// warning idiom that wouldn't fire for every transitive consumer, so this
// shim is silent — new code should import from the two real modules.

/** @deprecated Import from './evaluation.js' or './output_names.js' instead. */
export * from './evaluation.js';
export * from './output_names.js';
