// Shared TextDecoder helpers. See "bytes.decode() validity filtering" in
// docs/architecture.md: chardet candidates use Python codec names but
// TextDecoder only accepts WHATWG labels, and decoders should be cached for
// the process/page lifetime.

import { ENCODING_WHATWG_MAP } from './encoding-whatwg-map.js';

// Static WHATWG map represents the spec; not all runtimes implement every
// label (Node's TextDecoder rejects iso-8859-16). Probe at first lookup so
// unsupported labels surface as null.
const _runtimeSupportedLabels = new Map<string, string | null>();

export function whatwgLabelFor(encoding: string): string | null {
  if (_runtimeSupportedLabels.has(encoding)) {
    return _runtimeSupportedLabels.get(encoding)!;
  }
  const label = ENCODING_WHATWG_MAP[encoding] ?? null;
  if (label === null) {
    _runtimeSupportedLabels.set(encoding, null);
    return null;
  }
  try {
    new TextDecoder(label, { fatal: true });
    _runtimeSupportedLabels.set(encoding, label);
    return label;
  } catch {
    _runtimeSupportedLabels.set(encoding, null);
    return null;
  }
}

const decoderCache = new Map<string, TextDecoder>();

export function decoderForLabel(label: string): TextDecoder {
  let decoder = decoderCache.get(label);
  if (decoder === undefined) {
    decoder = new TextDecoder(label, { fatal: true });
    decoderCache.set(label, decoder);
  }
  return decoder;
}

// Port of Python's decodes_without_error — "could these bytes be text in this
// encoding?", the validity question asked by filter_by_validity,
// _validate_bytes and promote_markup_superset.
//
// Detection input is routinely a prefix of a larger whole: callers hand over
// the first N bytes of a file (e.g. 4096 / 65536), and _validateBytes slices
// its own 4096-byte head. For a 2-byte encoding either cut lands mid-character
// about half the time. A trailing partial sequence is a truncation artefact,
// not invalid data, and a one-shot fatal decode cannot tell the two apart — it
// throws either way, and the candidate is dropped, eliminating every CJK
// encoding from detection on odd-length input.
//
// Python defers the partial tail with an incremental decoder and final=False;
// { stream: true } is TextDecoder's equivalent. TextDecoder already knows each
// encoding's sequence structure, so this covers every encoding with no
// per-encoding code, and genuine corruption — an illegal trail byte, a byte
// with no mapping — is mid-buffer and still throws. See "Truncation-tolerant
// validity decoding" in docs/port-notes.md before changing this or calling
// decoderForLabel directly for a validity check.
export function decodesWithoutError(label: string, data: Uint8Array): boolean {
  const decoder = decoderForLabel(label);
  try {
    decoder.decode(data, { stream: true });
    return true;
  } catch {
    return false;
  } finally {
    // Streaming leaves the decoder holding any partial tail, and the cache
    // hands the same instance to the next caller. An argument-less decode()
    // clears "do not flush", so the decoder resets on its next use. It throws
    // when a partial sequence is pending — that is the flush reporting the tail
    // we deliberately ignored, and the reset happens regardless.
    try { decoder.decode(); } catch { /* pending partial tail — expected */ }
  }
}
