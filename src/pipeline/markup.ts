import { DETERMINISTIC_CONFIDENCE, DetectionResult, PipelineContext } from './index.js';
import { lookupEncoding, EncodingName, REGISTRY } from '../registry.js';
import { computeStructuralScore } from './structural.js';
import { EncodingEra } from '../enums.js';
import { decodesWithoutError } from '../decode.js';
import { byteDecodeTable, decodeSingleByteText } from './byte-decode.js';

const _SCAN_LIMIT = 4096;

// Labels that cannot describe a document whose declaration was read as
// ASCII bytes: UTF-16 and UTF-32 text would have put null bytes between the
// letters of the tag. The WHATWG prescan reads such a label as UTF-8, and
// x-user-defined as windows-1252, so the declared page still has a chance of
// decoding under the name it is given.
const _SELF_CONTRADICTING_LABELS: ReadonlySet<string> = new Set([
  'utf-16', 'utf-16-be', 'utf-16-le', 'utf-32', 'utf-32-be', 'utf-32-le',
]);

// The regexes below run over a latin1 decode of the head (see
// detectMarkupCharset) and stand in for chardet's byte regexes, so they spell
// out what a byte regex means where JS differs: whitespace is the six ASCII
// whitespace bytes (JS \s also matches U+00A0, the decode of byte 0xA0), and
// "any byte but newline" is [^\n] (JS . also excludes \r).
//
// A tag scan stops at the next < as well as at >. A tag that never closes is
// not a declaration either way, but with [^>] every unclosed <meta ran to the
// end of the head before failing, and a head made of nothing else cost a
// thousand times a normal one. The price is a literal < inside an attribute
// value, which hides that one tag.
const _XML_ENCODING_RE = /<\?xml[\t\n\v\f\r ][^<>]*encoding[\t\n\v\f\r ]*=[\t\n\v\f\r ]*['"]([^'"]+)['"]/i;
const _META_TAG_RE = /<meta\b([^<>]*)>/gi;
// [^] rather than . so a quoted value may span lines (chardet's DOTALL).
const _ATTR_RE = /([^\t\n\v\f\r =/>]+)(?:[\t\n\v\f\r ]*=[\t\n\v\f\r ]*(?:(["'])([^]*?)\2|([^\t\n\v\f\r >"']+)))?/gi;
const _CONTENT_CHARSET_RE = /charset[\t\n\f\r ]*=[\t\n\f\r ]*(?:(["'])([^"']+)\1|([^\t\n\v\f\r ;"']+))/i;

// PEP 263: encoding declaration in the first two lines of a Python file.
// https://peps.python.org/pep-0263/ Each line is matched on its own.
const _PEP263_RE = /^[ \t\f]*#[^\n]*?coding[:=][ \t]*([-\w.]+)/;
const _PEP263_BLANK_RE = /^[ \t\f]*(?:[#\r]|$)/;

function _isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) >= 0x80) return false;
  }
  return true;
}

// bytes.lower() and bytes.strip() on the latin1-decoded head: ASCII letters
// and ASCII whitespace only, where String's toLowerCase and trim also touch
// the non-ASCII characters high bytes decode to.
function _asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x20));
}

function _asciiStrip(s: string): string {
  return s.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, '');
}

// Port of chardet's _validate_bytes: does the whole of data decode under
// encoding? A declaration is an answer only if the caller can decode what was
// examined with it. The decoder stops at the first bad sequence, so a
// declaration that lies about the header fails as fast as a head-only check
// would, and a cut multi-byte sequence at the very end is tolerated as
// everywhere else. A declared single-byte charset is judged by Python's codec
// (a declared windows-1252 page carrying 0x81 is not honoured, as in
// chardet); a multi-byte one with no WHATWG decoder passes unchecked — see
// "bytes.decode() validity filtering" in docs/architecture.md.
function _validateBytes(data: Uint8Array, encoding: EncodingName): boolean {
  return _internal.decodesWithoutError(encoding, data);
}

// Port of chardet's _declared_encoding: the name to report for a declaration
// of encoding, or null when the declaration does not decode the window.
// chardet then tries the declared encoding's Windows superset; that fallback
// is not ported, for the reason the decode-safety promotion below is not (see
// _MARKUP_SUPERSET_PROMOTIONS): each pair shares one WHATWG decoder, so the
// superset fails whenever the declared encoding does.
function _declaredEncoding(data: Uint8Array, encoding: EncodingName | null): EncodingName | null {
  if (encoding === null) return null;
  return _validateBytes(data, encoding) ? encoding : null;
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
// optional single junk character stands in for the opening quote. That junk
// character is grouped with its own trailing whitespace rather than left
// between two \s* runs: \s*X?\s* lets a whitespace character land in either
// run, so a value that never arrives (charset= followed by a long space run)
// backtracks over every split and makes the match quadratic in the
// whitespace length. \s*(?:X\s*)? matches the same strings with one way to
// place each space.
const _EBCDIC_TAG_RE = /<(?:meta|\?xml)[^<>]*/gi;
const _EBCDIC_DECL_RE = /(?:charset|encoding)\s*=\s*(?:[^\sA-Za-z0-9._-]\s*)?([A-Za-z][A-Za-z0-9._-]+)/gi;

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
// declared encoding must decode the whole window — the validity stage's own
// predicate (every MAINFRAME-era encoding is a single-byte EBCDIC page,
// answered from the byte tables; cp424 is the only one with undefined
// positions, the rest map all 256 bytes and always pass). The MIME type
// follows the tag the declaration sits in.
function _detectEbcdicDeclaration(data: Uint8Array): DetectionResult | null {
  const head = data.subarray(0, _SCAN_LIMIT);
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
        _validateBytes(data, encoding)
      ) {
        const isXml = tag[0][1] === '?';
        return {
          encoding,
          confidence: DETERMINISTIC_CONFIDENCE,
          language: null,
          mimeType: isXml ? 'text/xml' : 'text/html',
        };
      }
    }
  }
  return null;
}

// Resolve a coding cookie the way Python's tokenize.detect_encoding does
// (chardet's _pep263_encoding). Python folds the utf-8-* spellings to UTF-8
// and latin-1, iso-8859-1, and iso-latin-1 (with or without a suffix) to
// Latin-1 before it consults the codec registry, so iso-latin-1 is a valid
// cookie even though no codec answers to it, and utf-8-sig names plain UTF-8
// rather than a file that starts with a mark.
function _pep263Encoding(rawName: string): EncodingName | null {
  const name = rawName.slice(0, 12).toLowerCase().replaceAll('_', '-');
  if (name === 'utf-8' || name.startsWith('utf-8-')) return 'utf-8';
  if (
    name === 'latin-1' || name === 'iso-8859-1' || name === 'iso-latin-1' ||
    name.startsWith('latin-1-') || name.startsWith('iso-8859-1-') || name.startsWith('iso-latin-1-')
  ) {
    return 'iso8859-1';
  }
  return lookupEncoding(rawName);
}

// Check the first two lines of data for a PEP 263 encoding declaration
// (e.g. # -*- coding: utf-8 -*-), which is only valid on line 1 or line 2 of
// a Python source file. Both lines have to start inside the first
// _SCAN_LIMIT bytes, the same bound the markup scan uses.
function _detectPep263(data: Uint8Array): DetectionResult | null {
  const head = data.subarray(0, _SCAN_LIMIT);
  // PEP 263 requires a '#' comment marker on line 1 or 2.
  if (!head.includes(0x23)) return null;

  // Python uses a byte-regex (rb"...") on raw bytes. JS RegExp needs a string,
  // so decode with WHATWG's 'latin1', which never raises and maps every ASCII
  // byte to itself; that is all the regexes need, since they match ASCII
  // structure only. It is not a 1:1 byte mapping — WHATWG's 'latin1' is an
  // alias of windows-1252, so 0x80..0x9F become characters like U+20AC — but
  // a high byte lands on a non-ASCII character under either mapping, which
  // is all the ASCII guard below needs. Not a decode of the data in any
  // encoding's sense, so it stays out of src/decode.ts.
  const lines = new TextDecoder('latin1').decode(head).split('\n');
  // Python only examines line 2 when line 1 is a comment or blank.
  let m = _PEP263_RE.exec(lines[0]);
  if (m === null && lines.length > 1 && _PEP263_BLANK_RE.test(lines[0])) {
    m = _PEP263_RE.exec(lines[1]);
  }
  if (m === null) return null;

  const rawName = m[1].trim();
  // Extra step with no Python equivalent. Python relies on .decode("ascii")
  // raising UnicodeDecodeError to bail on non-ASCII charset names. Our decode
  // is total (never raises) and turns every high byte into a non-ASCII
  // character, so such bytes survive into rawName. Guard explicitly before
  // resolving the name to match Python's control flow.
  if (!_isAscii(rawName)) return null;

  const encoding = _declaredEncoding(data, _pep263Encoding(rawName));
  if (encoding === null) return null;
  return {
    encoding,
    confidence: DETERMINISTIC_CONFIDENCE,
    language: null,
    mimeType: 'text/x-python',
  };
}

// Return head without its <!-- --> comments (chardet's _strip_comments). A
// declaration inside a comment is not a declaration, and the WHATWG prescan
// skips comments for that reason. As in the prescan, the dashes that open a
// comment may also close it (<!--> is a whole comment), and a comment that
// never closes runs to the end of the head.
function _stripComments(head: string): string {
  let start = head.indexOf('<!--');
  if (start < 0) return head;
  const parts: string[] = [];
  let pos = 0;
  while (start >= 0) {
    parts.push(head.slice(pos, start));
    const end = head.indexOf('-->', start + 2);
    if (end < 0) return parts.join('');
    pos = end + 3;
    start = head.indexOf('<!--', pos);
  }
  parts.push(head.slice(pos));
  return parts.join('');
}

// Resolve a charset label found in ASCII-compatible markup (chardet's
// _markup_encoding).
function _markupEncoding(rawName: string): EncodingName | null {
  if (rawName.toLowerCase() === 'x-user-defined') return 'cp1252';
  const encoding = lookupEncoding(rawName);
  if (encoding !== null && _SELF_CONTRADICTING_LABELS.has(encoding)) return 'utf-8';
  return encoding;
}

// The attributes of one meta tag, keyed by lowercased name; the first
// occurrence of a repeated attribute wins (chardet's _meta_attributes).
function _metaAttributes(body: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of body.matchAll(_ATTR_RE)) {
    const name = _asciiLower(m[1]);
    if (attrs.has(name)) continue;
    const value = m[3] ?? m[4];
    if (value !== undefined) attrs.set(name, value);
  }
  return attrs;
}

// Charset labels from real meta declarations, in document order (chardet's
// _iter_html_charsets). charset= inside some other attribute (a refresh URL,
// a description) is not a declaration. A declaration is a charset attribute,
// or the charset parameter of an http-equiv="content-type" tag.
// name="content-type" is wrong by the spec but common enough in the wild
// that it counts too.
function* _iterHtmlCharsets(head: string): Generator<string> {
  for (const tag of head.matchAll(_META_TAG_RE)) {
    const attrs = _metaAttributes(tag[1]);
    const charset = attrs.get('charset');
    if (charset !== undefined && _asciiStrip(charset) !== '') {
      yield charset;
      continue;
    }
    const equiv = attrs.get('http-equiv') ?? attrs.get('name');
    const content = attrs.get('content');
    if (
      equiv !== undefined &&
      content !== undefined &&
      _asciiLower(_asciiStrip(equiv)) === 'content-type'
    ) {
      const found = _CONTENT_CHARSET_RE.exec(content);
      if (found !== null) yield found[1] !== undefined ? found[2] : found[3];
    }
  }
}

// Scan the first bytes of data for a charset declaration, in this order:
//
//   1. <?xml ... encoding="..."?>
//   2. <meta charset="...">
//   3. <meta http-equiv="Content-Type" content="...; charset=..."> (also with
//      name in place of http-equiv)
//   4. an EBCDIC <meta>/<?xml declaration
//   5. PEP 263 # -*- coding: ... -*- (first two lines only)
//
// Markup inside <!-- --> comments is not scanned. A UTF-16 or UTF-32 label
// is read as UTF-8 and x-user-defined as windows-1252, as in the WHATWG
// prescan, since a declaration found in ASCII bytes cannot be describing
// UTF-16 text. A declaration counts only if the declared encoding decodes
// the whole of data; one that fails is skipped and the next one is tried, so
// a stale prolog does not hide a correct meta.
export function detectMarkupCharset(data: Uint8Array): DetectionResult | null {
  if (data.length === 0) return null;

  // ASCII-preserving decode for the byte regexes (see _detectPep263).
  const head = _stripComments(new TextDecoder('latin1').decode(data.subarray(0, _SCAN_LIMIT)));

  const xml = _XML_ENCODING_RE.exec(head);
  if (xml !== null) {
    // Extra step with no Python equivalent — see _detectPep263 for the full
    // rationale. The decode never raises, so non-ASCII bytes survive into
    // the name; this guard reproduces Python's UnicodeDecodeError fallback.
    const rawName = _isAscii(xml[1]) ? xml[1].trim() : '';
    const encoding = _declaredEncoding(data, rawName ? _markupEncoding(rawName) : null);
    if (encoding !== null) {
      return { encoding, confidence: DETERMINISTIC_CONFIDENCE, language: null, mimeType: 'text/xml' };
    }
  }

  for (const raw of _iterHtmlCharsets(head)) {
    if (!_isAscii(raw)) continue;
    const encoding = _declaredEncoding(data, _markupEncoding(raw.trim()));
    if (encoding !== null) {
      return { encoding, confidence: DETERMINISTIC_CONFIDENCE, language: null, mimeType: 'text/html' };
    }
  }

  const ebcdicResult = _detectEbcdicDeclaration(data);
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
  const baseInfo = REGISTRY[markupResult.encoding as keyof typeof REGISTRY];
  if (supersetInfo === undefined || baseInfo === undefined) {
    return markupResult;
  }
  // The structural comparison reads only the first _SCAN_LIMIT bytes, since
  // multi-byte structure is uniform enough that the ranking has converged by
  // then. It runs first because it is cheap and settles whether a decode is
  // needed at all. The decode check reads the whole input: what a caller can
  // actually .decode() is a fact about their entire input.
  const head = data.subarray(0, _SCAN_LIMIT);
  const ctx = new PipelineContext();
  const baseScore = _internal.computeStructuralScore(head, baseInfo, ctx);
  const supersetScore = _internal.computeStructuralScore(head, supersetInfo, ctx);
  if (supersetScore > baseScore && _internal.decodesWithoutError(supersetName, data)) {
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
// the one regime the mutually-decodable corpus inputs never reach, and the
// decode-budget test counts the window decodes a declared page costs. See
// orchestrator.ts's _internal for the pattern.
export const _internal = { computeStructuralScore, decodesWithoutError };

export { _EBCDIC_DECL_RE, _MARKUP_SUPERSET_PROMOTIONS, _SCAN_LIMIT };
