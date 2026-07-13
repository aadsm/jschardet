import * as chardet from './chardet.js';
export { chardet };
import { VERSION } from './version.js';
export { VERSION };

export interface IDetectedMap {
  encoding: string | null;
  confidence: number;
  language: string | null;
  mimeType: string | null;
}

export interface IOptionsMap {
  minimumThreshold?: number;
  detectEncodings?: Array<string>;
  excludeEncodings?: Array<string>;
}

let _debug = false;

export function enableDebug(): void {
  _debug = true;
}

function toBytes(input: string | Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (typeof input === 'string') {
    const bytes = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) bytes[i] = input.charCodeAt(i) & 0xFF;
    return bytes;
  }
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return new Uint8Array(input);
}

export function detect(buffer: string | Uint8Array | ArrayBuffer | ArrayBufferView, options: IOptionsMap = {}): IDetectedMap {
  const bytes = toBytes(buffer);
  const chardetOptions = {
    includeEncodings: options.detectEncodings ?? null,
    excludeEncodings: options.excludeEncodings ?? null,
  };
  if (_debug) {
    const all = chardet.detectAll(bytes, { ...chardetOptions, ignoreThreshold: true });
    console.log('[jschardet] detect candidates:', all);
    return all[0];
  }
  return chardet.detect(bytes, chardetOptions);
}

export function detectAll(buffer: string | Uint8Array | ArrayBuffer | ArrayBufferView, options: IOptionsMap = {}): IDetectedMap[] {
  const bytes = toBytes(buffer);
  const chardetOptions = {
    includeEncodings: options.detectEncodings ?? null,
    excludeEncodings: options.excludeEncodings ?? null,
  };
  const hasCustomThreshold = options.minimumThreshold !== undefined;
  const threshold = options.minimumThreshold ?? chardet.MINIMUM_THRESHOLD;
  // When debug is on or a custom threshold is requested, fetch all results so we
  // can log and/or filter ourselves; otherwise let chardet's built-in 0.20
  // threshold run (it also guarantees at least one result).
  const ignoreThreshold = _debug || hasCustomThreshold;
  const all = chardet.detectAll(bytes, { ...chardetOptions, ignoreThreshold });
  if (_debug) console.log('[jschardet] detectAll candidates:', all);
  if (!hasCustomThreshold) return all;
  const filtered = all.filter(r => r.confidence >= threshold);
  return filtered.length > 0 ? filtered : all;
}

export default { detect, detectAll, enableDebug, VERSION };
