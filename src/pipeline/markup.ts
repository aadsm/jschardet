import { DETERMINISTIC_CONFIDENCE, DetectionResult } from './index.js';
import { lookupEncoding, EncodingName } from '../registry.js';
import { decoderForLabel, whatwgLabelFor } from '../text-decoder.js';

const _SCAN_LIMIT = 4096;

const _XML_ENCODING_RE       = /<\?xml[^>]+encoding\s*=\s*['"]([^'"]+)['"]/i;
const _HTML5_CHARSET_RE      = /<meta[^>]+charset\s*=\s*['"]?\s*([^\s'">;]+)/i;
const _HTML4_CONTENT_TYPE_RE = /<meta[^>]+content\s*=\s*['"][^'"]*charset=([^\s'">;]+)/i;
const _PEP263_RE             = /^[ \t\f]*#.*?coding[:=][ \t]*([-\w.]+)/m;

function _isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) >= 0x80) return false;
  }
  return true;
}

// Replaces Python's bytes.decode(encoding, errors='strict'). Python supports
// ~90 codecs; TextDecoder only supports WHATWG labels. Encodings without a
// label fall through to a pass — accepted parity drift, see Issue 3 in
// docs/chardet-ts-port-reference.md.
function _validateBytes(data: Uint8Array, encoding: EncodingName): boolean {
  const label = whatwgLabelFor(encoding);
  if (!label) return true;
  try {
    decoderForLabel(label).decode(data.subarray(0, _SCAN_LIMIT));
    return true;
  } catch {
    return false;
  }
}

function _detectPep263(data: Uint8Array): DetectionResult | null {
  // Python _detect_pep263 short-circuits if no '#' is in the first 200 bytes.
  if (!data.subarray(0, 200).includes(0x23)) return null;

  // Python uses a byte-regex (rb"...") on raw bytes. JS RegExp needs a string,
  // so decode as latin1 — a 1:1 byte→codepoint mapping (0xNN → U+00NN) that
  // never raises, preserving byte values for the ASCII guard below.
  const text = new TextDecoder('latin1').decode(data);
  const lines = text.split('\n');
  const firstTwo = lines.slice(0, 2).join('\n');

  const m = _PEP263_RE.exec(firstTwo);
  if (!m) return null;

  const rawName = m[1].trim();
  // Extra step with no Python equivalent. Python relies on .decode("ascii")
  // raising UnicodeDecodeError to bail on non-ASCII charset names. Our latin1
  // decode is total (never raises) and preserves bytes 0x80..0xFF as
  // U+0080..U+00FF, so non-ASCII bytes survive into rawName. Guard explicitly
  // before handing off to lookupEncoding to match Python's control flow.
  if (!_isAscii(rawName)) return null;

  const encoding = lookupEncoding(rawName);
  if (encoding === null || !_validateBytes(data, encoding)) return null;

  return {
    encoding,
    confidence: DETERMINISTIC_CONFIDENCE,
    language: null,
    mimeType: 'text/x-python',
  };
}

export function detectMarkupCharset(data: Uint8Array): DetectionResult | null {
  if (data.length === 0) return null;

  const head = data.subarray(0, _SCAN_LIMIT);
  // latin1 decode for byte-preserving regex (see _detectPep263 for rationale).
  const headStr = new TextDecoder('latin1').decode(head);

  const patterns: Array<[RegExp, string]> = [
    [_XML_ENCODING_RE, 'text/xml'],
    [_HTML5_CHARSET_RE, 'text/html'],
    [_HTML4_CONTENT_TYPE_RE, 'text/html'],
  ];

  for (const [re, mimeType] of patterns) {
    const m = re.exec(headStr);
    if (!m) continue;
    const rawName = m[1].trim();
    // Extra step with no Python equivalent — see _detectPep263 for the full
    // rationale. Latin1 decode never raises, so non-ASCII bytes survive into
    // rawName; this guard reproduces Python's UnicodeDecodeError bail-out.
    if (!_isAscii(rawName)) continue;
    const encoding = lookupEncoding(rawName);
    if (encoding === null) continue;
    if (!_validateBytes(data, encoding)) continue;
    return { encoding, confidence: DETERMINISTIC_CONFIDENCE, language: null, mimeType };
  }

  return _detectPep263(data);
}
