// Shared TextDecoder helpers. See Issue 3 in
// docs/chardet-ts-port-reference.md: chardet candidates use Python codec
// names but TextDecoder only accepts WHATWG labels, and decoders should be
// cached for the process/page lifetime.

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
