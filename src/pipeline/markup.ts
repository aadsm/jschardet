import { DETERMINISTIC_CONFIDENCE, DetectionResult, PipelineContext } from './index.js';
import { lookupEncoding, EncodingName, REGISTRY } from '../registry.js';
import { computeStructuralScore } from './structural.js';
import { EncodingEra } from '../enums.js';
import { decodesWithoutError } from '../decode.js';
import { byteDecodeTable, decodeSingleByteText } from './byte-decode.js';

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

// Port of chardet's _validate_bytes: decodes_without_error over the first
// _SCAN_LIMIT bytes. A declared single-byte charset is judged by Python's
// codec (a declared windows-1252 page carrying 0x81 is not honoured, as in
// chardet); a multi-byte one with no WHATWG decoder passes unchecked — see
// "bytes.decode() validity filtering" in docs/architecture.md.
function _validateBytes(data: Uint8Array, encoding: EncodingName): boolean {
  return decodesWithoutError(encoding, data.subarray(0, _SCAN_LIMIT));
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

// cp037, the EBCDIC page whose letter and digit positions are shared by all
// variants. chardet decodes the head with bytes.decode("cp037",
// errors="replace") at runtime; TextDecoder has no EBCDIC decoders, so the
// decode comes from the build-time byte tables, which carry cp037 itself
// (the registry files it under cp1140, which differs at one byte).
const _CP037 = byteDecodeTable('cp037')!;

// Look for a charset declaration in EBCDIC-encoded markup (chardet's
// _detect_ebcdic_declaration). The ASCII regexes cannot see declarations
// in EBCDIC bytes, so when the head looks like EBCDIC text (dominated by
// high bytes), decode it through cp037 and scan the decoded text. Only
// declarations naming a MAINFRAME-era encoding are honoured, and the
// declared encoding must actually decode the head — chardet's honour-check
// is decodes_without_error(head, declared), which is the validity stage's
// own predicate (every MAINFRAME-era encoding is a single-byte EBCDIC page,
// answered from the byte tables; cp424 is the only one with undefined
// positions, the rest map all 256 bytes and always pass).
function _detectEbcdicDeclaration(head: Uint8Array): DetectionResult | null {
  let highCount = 0;
  for (let i = 0; i < head.length; i++) {
    if (head[i] >= 0x80) highCount++;
  }
  if (highCount < head.length * _EBCDIC_SCAN_MIN_HIGH_FRACTION) return null;
  const decoded = decodeSingleByteText(_CP037, head);
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
        decodesWithoutError(encoding, head)
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
  // so decode with WHATWG's 'latin1', which never raises and maps every ASCII
  // byte to itself; that is all the regexes need, since they match ASCII
  // structure only. It is not a 1:1 byte mapping — WHATWG's 'latin1' is an
  // alias of windows-1252, so 0x80..0x9F become characters like U+20AC — but
  // a high byte lands on a non-ASCII character under either mapping, which
  // is all the ASCII guard below needs. Not a decode of the data in any
  // encoding's sense, so it stays out of src/decode.ts.
  const text = new TextDecoder('latin1').decode(data);
  const lines = text.split('\n');
  const firstTwo = lines.slice(0, 2).join('\n');

  const m = _PEP263_RE.exec(firstTwo);
  if (!m) return null;

  const rawName = m[1].trim();
  // Extra step with no Python equivalent. Python relies on .decode("ascii")
  // raising UnicodeDecodeError to bail on non-ASCII charset names. Our decode
  // is total (never raises) and turns every high byte into a non-ASCII
  // character, so such bytes survive into rawName. Guard explicitly before
  // handing off to lookupEncoding to match Python's control flow.
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
  // ASCII-preserving decode for the byte regexes (see _detectPep263).
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
    // rationale. The decode never raises, so non-ASCII bytes survive into
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
  // Validate: superset must be able to decode the data (Python
  // errors="strict", tolerating only a truncated tail).
  if (!decodesWithoutError(supersetName, data)) {
    return markupResult;
  }
  // Compare structural scores on the head only. Multi-byte structure is
  // uniform enough that the ranking converges long before _SCAN_LIMIT, and
  // this is the expensive half: two full-buffer passes on every declared page,
  // where _validateBytes caps the same kind of scan at _SCAN_LIMIT. The decode
  // check above stays whole-input — what a caller can .decode() is a fact about
  // their entire input.
  const head = data.subarray(0, _SCAN_LIMIT);
  const ctx = new PipelineContext();
  const baseInfo = REGISTRY[markupResult.encoding as keyof typeof REGISTRY];
  if (baseInfo === undefined) {
    return markupResult;
  }
  const baseScore = _internal.computeStructuralScore(head, baseInfo, ctx);
  const supersetScore = _internal.computeStructuralScore(head, supersetInfo, ctx);
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

// Test-spy seam: the structural-promotion test patches the scorer to force
// the one regime the mutually-decodable corpus inputs never reach. See
// orchestrator.ts's _internal for the pattern.
export const _internal = { computeStructuralScore };

export { _MARKUP_SUPERSET_PROMOTIONS };
