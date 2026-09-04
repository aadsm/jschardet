// Shared TextDecoder helpers. See "bytes.decode() validity filtering" in
// docs/architecture.md: chardet candidates use Python codec names but
// TextDecoder only accepts WHATWG labels, and decoders should be cached for
// the process/page lifetime.
//
// The whatwg-prefixed functions decode by WHATWG label with WHATWG's rules:
// single-byte decoders that gap-fill positions CPython leaves undefined, and
// a subset and its superset collapsed onto one decoder. The port of chardet's
// decode questions, keyed by chardet name and answering single-byte
// encodings from the byte tables, is src/decode.ts; these are its
// TextDecoder path, and nothing else in the pipeline calls them.

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
export function whatwgDecodesWithoutError(label: string, data: Uint8Array): boolean {
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

// Port of chardet's decodes_completely — the strict sibling of
// whatwgDecodesWithoutError: a one-shot fatal decode, so an incomplete multi-byte
// sequence at the end is an error rather than a deferred tail. This is the
// question that matters when the data is the caller's entire input —
// data.decode(encoding) in Python, or a fatal TextDecoder over the whole
// buffer, makes exactly this judgment.
export function whatwgDecodesCompletely(label: string, data: Uint8Array): boolean {
  const decoder = decoderForLabel(label);
  try {
    decoder.decode(data);
    return true;
  } catch {
    return false;
  }
}

const ASCII_ONLY_RE = /^[\x00-\x7F]*$/;

// The WHATWG-label half of chardet's dangling_tail_with_ascii_prefix (the
// port by encoding name is in src/decode.ts). One decode pass answers
// both halves of the decode-safety question: the tolerant ({ stream: true })
// decode yields the text before any deferred tail, and flushing the decoder
// afterwards throws exactly when a deferred tail existed. True means the
// candidate decoded real ASCII characters and then hit an incomplete
// multi-byte sequence at the end — its only non-ASCII evidence is the
// undecodable tail itself.
//
// Deliberately false when the tolerant decode yields nothing at all (the
// entire input is one dangling sequence): that candidate has zero decoded
// evidence, not ASCII evidence, and a clipped multi-byte fragment is better
// served by the ranking's own judgment.
export function whatwgDanglingTailWithAsciiPrefix(label: string, data: Uint8Array): boolean {
  const decoder = decoderForLabel(label);
  let text: string;
  try {
    text = decoder.decode(data, { stream: true });
  } catch {
    // Corrupt before the tail, not tail-truncated. Reset the cached decoder.
    try { decoder.decode(); } catch { /* pending partial tail — expected */ }
    return false;
  }
  // Flush before evaluating so the cached decoder is always reset; the
  // throw is the deferred tail reporting itself.
  let hadDanglingTail = false;
  try {
    decoder.decode();
  } catch {
    hadDanglingTail = true;
  }
  if (!text || !ASCII_ONLY_RE.test(text)) return false;
  return hadDanglingTail;
}

// data.decode(label, errors="ignore") by WHATWG label: a non-fatal decode,
// so undefined bytes become U+FFFD rather than an error.
export function whatwgDecodeText(label: string, data: Uint8Array): string {
  return new TextDecoder(label, { fatal: false }).decode(data);
}
