import { DETERMINISTIC_CONFIDENCE, DetectionResult, PipelineContext } from './index.js';
import { lookupEncoding, EncodingName, REGISTRY } from '../registry.js';
import { decodesWithoutError, whatwgLabelFor } from '../text-decoder.js';
import { computeStructuralScore } from './structural.js';

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

// Port of Python's _validate_bytes: decodes_without_error over the first
// _SCAN_LIMIT bytes. Python supports ~90 codecs; TextDecoder only supports
// WHATWG labels. Encodings without a label fall through to a pass — accepted
// parity drift, see "bytes.decode() validity filtering" in
// docs/architecture.md.
function _validateBytes(data: Uint8Array, encoding: EncodingName): boolean {
  const label = whatwgLabelFor(encoding);
  if (!label) return true;
  return decodesWithoutError(label, data.subarray(0, _SCAN_LIMIT));
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

// Markup charset declarations that commonly refer to a Windows superset
// encoding rather than the strict standard encoding. Japanese web content
// almost universally declares "Shift_JIS" but actually uses CP932 extensions;
// similarly, Korean web content declares "EUC-KR" but uses CP949/UHC. When the
// declared encoding resolves to the base (left), we check whether the superset
// (right) is a better structural match.
//
// Python's promote_markup_superset also has a decode-safety promotion: when
// the codec the *reported* name resolves to (shift_jis, euc_kr) cannot decode
// the data but the superset can, it promotes unconditionally, so Python
// callers can always .decode() with the reported name. That branch is not
// ported: WHATWG collapses each pair onto one decoder (its shift_jis is
// cp932, its euc-kr is cp949 — see "bytes.decode() validity filtering" in
// docs/architecture.md), so the reported codec decodes whenever the superset
// does and the condition can never hold; the failure mode it guards against —
// an undecodable reported name — cannot happen for TextDecoder callers.
// Expect compare-detect DIFFs where Python promotes on decode-safety alone
// (e.g. cp932-ja/y-moto.com.xml: SHIFT_JIS here, CP932 in Python). See
// "Markup superset decode-safety promotion" in docs/port-notes.md.
const _MARKUP_SUPERSET_PROMOTIONS: Readonly<Record<string, string>> = Object.freeze({
  shift_jis_2004: 'cp932',
  euc_kr: 'cp949',
});

export function promoteMarkupSuperset(
  data: Uint8Array,
  markupResult: DetectionResult,
  allowed: ReadonlySet<string>,
): DetectionResult {
  if (markupResult.encoding === null) {
    return markupResult;
  }
  const supersetName = _MARKUP_SUPERSET_PROMOTIONS[markupResult.encoding];
  if (supersetName === undefined || !allowed.has(supersetName)) {
    return markupResult;
  }
  const supersetInfo = REGISTRY[supersetName as keyof typeof REGISTRY];
  if (supersetInfo === undefined) {
    return markupResult;
  }
  // Validate: superset must be able to decode the data. decodesWithoutError is
  // fatal:true (Python errors="strict"), tolerating only a truncated tail.
  const label = whatwgLabelFor(supersetName);
  if (label === null) {
    return markupResult;
  }
  if (!decodesWithoutError(label, data)) {
    return markupResult;
  }
  // Compare structural scores
  const ctx = new PipelineContext();
  const baseInfo = REGISTRY[markupResult.encoding as keyof typeof REGISTRY];
  if (baseInfo === undefined) {
    return markupResult;
  }
  const baseScore = computeStructuralScore(data, baseInfo, ctx);
  const supersetScore = computeStructuralScore(data, supersetInfo, ctx);
  if (supersetScore > baseScore) {
    return {
      encoding: supersetName,
      confidence: markupResult.confidence,
      language: markupResult.language,
      mimeType: markupResult.mimeType,
    };
  }
  return markupResult;
}

export { _MARKUP_SUPERSET_PROMOTIONS };
