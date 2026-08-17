import { DETERMINISTIC_CONFIDENCE, DetectionResult, PipelineContext } from './index.js';
import { lookupEncoding, EncodingName, REGISTRY } from '../registry.js';
import { decodesWithoutError, whatwgLabelFor } from '../text-decoder.js';
import { computeStructuralScore } from './structural.js';
import { EncodingEra } from '../enums.js';
import { SBCS_UNDEFINED_BYTES } from '../sbcs-undefined-bytes.js';

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

// Charset declarations in EBCDIC-encoded markup, matched against a cp037
// decode of the head. Letters, digits, and the anchor characters <, >, ?,
// =, and / sit at the same code points in every supported EBCDIC code
// page, so the <meta>/<?xml tag anchor, the charset=/encoding= label, and
// the encoding name itself decode correctly through cp037 regardless of
// which EBCDIC variant the data actually uses. The tag anchor is required
// so plain EBCDIC prose that merely mentions encoding=NAME is not treated
// as a declaration; the tag span and the declaration tokens are matched by
// separate regexes so a bogus earlier encoding= token inside the same tag
// cannot consume the anchor away from the genuine charset= that follows
// it. Quote characters are NOT invariant (e.g. cp1026 moves "), so an
// optional single junk character stands in for the opening quote.
const _EBCDIC_TAG_RE = /<(?:meta|\?xml)[^>]*/gi;
const _EBCDIC_DECL_RE = /(?:charset|encoding)\s*=\s*[^\sA-Za-z0-9._-]?\s*([A-Za-z][A-Za-z0-9._-]+)/gi;

// Minimum fraction of high bytes (>= 0x80) in the head for an EBCDIC scan
// to be worth attempting: EBCDIC text is dominated by high bytes (Latin
// lowercase letters all sit at 0x81+), ASCII-compatible markup is not.
const _EBCDIC_SCAN_MIN_HIGH_FRACTION = 0.25;

// byte -> character table for cp037, the EBCDIC page whose letter and
// digit positions are shared by all variants. chardet decodes the head with
// bytes.decode("cp037", errors="replace") at runtime; TextDecoder has no
// EBCDIC decoders, so the table is precomputed from Python's codec (the
// source of truth) via:
//   python3 -c "print(bytes(range(256)).decode('cp037', errors='replace'))"
const _CP037_TABLE = "\u0000\u0001\u0002\u0003\u009c\u0009\u0086\u007f\u0097\u008d\u008e\u000b\u000c\u000d\u000e\u000f\u0010\u0011\u0012\u0013\u009d\u0085\u0008\u0087\u0018\u0019\u0092\u008f\u001c\u001d\u001e\u001f\u0080\u0081\u0082\u0083\u0084\u000a\u0017\u001b\u0088\u0089\u008a\u008b\u008c\u0005\u0006\u0007\u0090\u0091\u0016\u0093\u0094\u0095\u0096\u0004\u0098\u0099\u009a\u009b\u0014\u0015\u009e\u001a \u00a0\u00e2\u00e4\u00e0\u00e1\u00e3\u00e5\u00e7\u00f1\u00a2.<(+|&\u00e9\u00ea\u00eb\u00e8\u00ed\u00ee\u00ef\u00ec\u00df!$*);\u00ac-/\u00c2\u00c4\u00c0\u00c1\u00c3\u00c5\u00c7\u00d1\u00a6,%_>?\u00f8\u00c9\u00ca\u00cb\u00c8\u00cd\u00ce\u00cf\u00cc`:#@'=\"\u00d8abcdefghi\u00ab\u00bb\u00f0\u00fd\u00fe\u00b1\u00b0jklmnopqr\u00aa\u00ba\u00e6\u00b8\u00c6\u00a4\u00b5~stuvwxyz\u00a1\u00bf\u00d0\u00dd\u00de\u00ae^\u00a3\u00a5\u00b7\u00a9\u00a7\u00b6\u00bc\u00bd\u00be[]\u00af\u00a8\u00b4\u00d7{ABCDEFGHI\u00ad\u00f4\u00f6\u00f2\u00f3\u00f5}JKLMNOPQR\u00b9\u00fb\u00fc\u00f9\u00fa\u00ff\\\u00f7STUVWXYZ\u00b2\u00d4\u00d6\u00d2\u00d3\u00d50123456789\u00b3\u00db\u00dc\u00d9\u00da\u009f";

// chardet's honor-check is decodes_without_error(head, declared). Every
// MAINFRAME-era encoding is a single-byte EBCDIC page with no WHATWG
// decoder, and for a single-byte encoding "decodes without error" reduces
// exactly to "contains no undefined byte" — which SBCS_UNDEFINED_BYTES
// records (cp424 is the only EBCDIC page with undefined positions; the
// rest map all 256 bytes and always pass).
function _decodesAsMainframe(head: Uint8Array, encoding: EncodingName): boolean {
  const label = whatwgLabelFor(encoding);
  if (label !== null) return decodesWithoutError(label, head);
  const undefSet = SBCS_UNDEFINED_BYTES[encoding];
  if (undefSet === undefined) return true;
  for (let i = 0; i < head.length; i++) {
    if (undefSet.has(head[i])) return false;
  }
  return true;
}

// Look for a charset declaration in EBCDIC-encoded markup (chardet's
// _detect_ebcdic_declaration). The ASCII regexes cannot see declarations
// in EBCDIC bytes, so when the head looks like EBCDIC text (dominated by
// high bytes), decode it through cp037 and scan the decoded text. Only
// declarations naming a MAINFRAME-era encoding are honoured, and the
// declared encoding must actually decode the head.
function _detectEbcdicDeclaration(head: Uint8Array): DetectionResult | null {
  let highCount = 0;
  for (let i = 0; i < head.length; i++) {
    if (head[i] >= 0x80) highCount++;
  }
  if (highCount < head.length * _EBCDIC_SCAN_MIN_HIGH_FRACTION) return null;
  let decoded = '';
  for (let i = 0; i < head.length; i++) decoded += _CP037_TABLE[head[i]];
  // Scan every declaration token inside every anchor tag: an unrelated
  // earlier charset=/encoding= token (a query string in an href, a bogus
  // attribute in the same tag) must not mask a genuine EBCDIC declaration
  // after it.
  for (const tag of decoded.matchAll(_EBCDIC_TAG_RE)) {
    for (const m of tag[0].matchAll(_EBCDIC_DECL_RE)) {
      const encoding = lookupEncoding(m[1].trim());
      if (
        encoding !== null &&
        (REGISTRY[encoding].era & EncodingEra.MAINFRAME) !== 0 &&
        _decodesAsMainframe(head, encoding)
      ) {
        return {
          encoding,
          confidence: DETERMINISTIC_CONFIDENCE,
          language: null,
          mimeType: 'text/html',
        };
      }
    }
  }
  return null;
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

  const ebcdicResult = _detectEbcdicDeclaration(head);
  if (ebcdicResult !== null) return ebcdicResult;

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
