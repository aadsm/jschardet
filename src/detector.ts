// Streaming character encoding detector. Port of
// chardet/src/chardet/detector.py.

import {
  DEFAULT_MAX_BYTES,
  MINIMUM_THRESHOLD,
  _resolvePreferSuperset,
  _validateMaxBytes,
} from './utils.js';
import { EncodingEra, LanguageFilter } from './enums.js';
import {
  PREFERRED_SUPERSET,
  applyCompatNames,
  applyPreferredSuperset,
} from './equivalences.js';
import { _NONE_RESULT, DetectionResult } from './pipeline/index.js';
import { runPipeline } from './pipeline/orchestrator.js';
import { _validateEncoding, normalizeEncodings } from './registry.js';

export interface UniversalDetectorOptions {
  langFilter?: number;
  shouldRenameLegacy?: boolean;
  encodingEra?: number;
  maxBytes?: number;
  preferSuperset?: boolean;
  compatNames?: boolean;
  includeEncodings?: Iterable<string> | null;
  excludeEncodings?: Iterable<string> | null;
  noMatchEncoding?: string;
  emptyInputEncoding?: string;
}

export class UniversalDetector {
  static readonly MINIMUM_THRESHOLD = MINIMUM_THRESHOLD;

  // Python uses MappingProxyType for read-only proxy semantics; TS gets the
  // same with Object.freeze + Readonly<...>.
  static readonly LEGACY_MAP: Readonly<Record<string, string>> = PREFERRED_SUPERSET;

  private readonly _preferSuperset: boolean;
  private readonly _compatNames: boolean;
  private readonly _encodingEra: number;
  private readonly _maxBytes: number;
  private readonly _includeEncodings: ReadonlySet<string> | null;
  private readonly _excludeEncodings: ReadonlySet<string> | null;
  private readonly _noMatchEncoding: string;
  private readonly _emptyInputEncoding: string;

  // Python accumulates into a bytearray (resizable). Uint8Array is fixed-length,
  // so we keep a chunk list and concatenate once on close().
  // Pre-allocating Uint8Array(maxBytes) was rejected: maxBytes defaults to 200
  // KB and the buffer is allocated once per detector even for tiny streams.
  private _chunks: Uint8Array[] = [];
  private _bufferLength = 0;
  private _done = false;
  private _closed = false;
  private _detection: DetectionResult | null = null;

  constructor(options: UniversalDetectorOptions = {}) {
    const langFilter = options.langFilter ?? LanguageFilter.ALL;
    const shouldRenameLegacy = options.shouldRenameLegacy ?? false;
    const encodingEra = options.encodingEra ?? EncodingEra.ALL;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const preferSuperset = options.preferSuperset ?? false;
    const compatNames = options.compatNames ?? true;
    const includeEncodings = options.includeEncodings ?? null;
    const excludeEncodings = options.excludeEncodings ?? null;
    const noMatchEncoding = options.noMatchEncoding ?? 'cp1252';
    const emptyInputEncoding = options.emptyInputEncoding ?? 'utf-8';

    // langFilter has no effect; kept for API parity with chardet 6.x. Same
    // shape as Python's lang_filter deprecation.
    if (langFilter !== LanguageFilter.ALL) {
      console.warn(
        'DEPRECATION: lang_filter is not implemented in this version of chardet and will be ignored',
      );
    }
    this._preferSuperset = _resolvePreferSuperset(shouldRenameLegacy, preferSuperset);
    this._compatNames = compatNames;
    _validateMaxBytes(maxBytes);
    this._encodingEra = encodingEra;
    this._maxBytes = maxBytes;
    this._includeEncodings = normalizeEncodings(includeEncodings, 'include_encodings');
    this._excludeEncodings = normalizeEncodings(excludeEncodings, 'exclude_encodings');
    this._noMatchEncoding = _validateEncoding(noMatchEncoding, 'no_match_encoding');
    this._emptyInputEncoding = _validateEncoding(emptyInputEncoding, 'empty_input_encoding');
  }

  feed(byteStr: Uint8Array): void {
    if (this._closed) {
      throw new Error('feed() called after close() without reset()');
    }
    if (this._done) return;
    const remaining = this._maxBytes - this._bufferLength;
    if (remaining > 0) {
      const take = Math.min(byteStr.length, remaining);
      const chunk = take === byteStr.length ? byteStr : byteStr.subarray(0, take);
      this._chunks.push(chunk);
      this._bufferLength += take;
    }
    if (this._bufferLength >= this._maxBytes) {
      this._done = true;
    }
  }

  close(): DetectionResult {
    if (!this._closed) {
      this._closed = true;
      const data = new Uint8Array(this._bufferLength);
      let offset = 0;
      for (const chunk of this._chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
      }
      const results = runPipeline(data, this._encodingEra, {
        maxBytes: this._maxBytes,
        includeEncodings: this._includeEncodings,
        excludeEncodings: this._excludeEncodings,
        noMatchEncoding: this._noMatchEncoding,
        emptyInputEncoding: this._emptyInputEncoding,
      });
      this._detection = results[0];
      this._done = true;
    }
    return this.result;
  }

  reset(): void {
    this._chunks = [];
    this._bufferLength = 0;
    this._done = false;
    this._closed = false;
    this._detection = null;
  }

  get done(): boolean {
    return this._done;
  }

  get result(): DetectionResult {
    if (this._detection === null) {
      return { ..._NONE_RESULT };
    }
    // Defensive copy: applyPreferredSuperset / applyCompatNames mutate the
    // result in place (see src/equivalences.ts _remapEncoding). Python's
    // DetectionResult is a frozen dataclass and to_dict() always allocates a
    // new dict, sidestepping this.
    const d: DetectionResult = { ...this._detection };
    if (this._preferSuperset) applyPreferredSuperset(d);
    if (this._compatNames) applyCompatNames(d);
    return d;
  }
}
