import { EncodingEra } from './enums.js';
import { codecsLookup } from './codecs-lookup.js';

export type EncodingName =
  | "ascii"
  | "big5hkscs"
  | "cp1006"
  | "cp1026"
  | "cp1125"
  | "cp1140"
  | "cp1250"
  | "cp1251"
  | "cp1252"
  | "cp1253"
  | "cp1254"
  | "cp1255"
  | "cp1256"
  | "cp1257"
  | "cp1258"
  | "cp273"
  | "cp424"
  | "cp437"
  | "cp500"
  | "cp720"
  | "cp737"
  | "cp775"
  | "cp850"
  | "cp852"
  | "cp855"
  | "cp856"
  | "cp857"
  | "cp858"
  | "cp860"
  | "cp861"
  | "cp862"
  | "cp863"
  | "cp864"
  | "cp865"
  | "cp866"
  | "cp869"
  | "cp874"
  | "cp875"
  | "cp932"
  | "cp949"
  | "euc_jis_2004"
  | "euc_kr"
  | "gb18030"
  | "hp-roman8"
  | "hz"
  | "iso2022_jp_2"
  | "iso2022_jp_2004"
  | "iso2022_jp_ext"
  | "iso2022_kr"
  | "iso8859-1"
  | "iso8859-10"
  | "iso8859-13"
  | "iso8859-14"
  | "iso8859-15"
  | "iso8859-16"
  | "iso8859-2"
  | "iso8859-3"
  | "iso8859-4"
  | "iso8859-5"
  | "iso8859-6"
  | "iso8859-7"
  | "iso8859-8"
  | "iso8859-9"
  | "johab"
  | "koi8-r"
  | "koi8-t"
  | "koi8-u"
  | "kz1048"
  | "mac-cyrillic"
  | "mac-greek"
  | "mac-iceland"
  | "mac-latin2"
  | "mac-roman"
  | "mac-turkish"
  | "ptcp154"
  | "shift_jis_2004"
  | "tis-620"
  | "utf-16"
  | "utf-16-be"
  | "utf-16-le"
  | "utf-32"
  | "utf-32-be"
  | "utf-32-le"
  | "utf-7"
  | "utf-8"
  | "utf-8-sig"
  ;

export interface EncodingInfo {
  readonly name: EncodingName;
  readonly aliases: readonly string[];
  readonly era: number;
  readonly isMultibyte: boolean;
  readonly languages: readonly string[];
}

const _WESTERN = ["br","cy","da","de","en","es","fi","fr","ga","id","is","it","ms","nl","no","pt","sv"] as const;
const _WESTERN_TR = [..._WESTERN, "tr"] as const;
const _CYRILLIC = ["ru","bg","uk","sr","mk","be"] as const;
const _CENTRAL_EU = ["pl","cs","hu","hr","ro","sk","sl"] as const;
const _CENTRAL_EU_NO_RO = ["pl","cs","hu","hr","sk","sl"] as const;
const _BALTIC = ["et","lt","lv"] as const;
const _ARABIC = ["ar","fa"] as const;

const _REGISTRY_ENTRIES: EncodingInfo[] = [
  // === MODERN_WEB ===
  Object.freeze({ name: "ascii", aliases: ["us-ascii"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: [] }),
  Object.freeze({ name: "utf-8", aliases: ["utf-8","utf8","csutf8","unicode-1-1-utf-8","unicode11utf8","unicode20utf8","x-unicode20utf8"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: [] }),
  Object.freeze({ name: "utf-8-sig", aliases: ["UTF-8-SIG","utf-8-bom"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: [] }),
  Object.freeze({ name: "utf-16", aliases: ["UTF-16","utf16","csutf16"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: [] }),
  Object.freeze({ name: "utf-16-be", aliases: ["UTF-16-BE","utf-16be","csutf16be"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: [] }),
  Object.freeze({ name: "utf-16-le", aliases: ["UTF-16-LE","utf-16le","csutf16le"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: [] }),
  Object.freeze({ name: "utf-32", aliases: ["UTF-32","utf32","csutf32"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: [] }),
  Object.freeze({ name: "utf-32-be", aliases: ["UTF-32-BE","utf-32be","csutf32be"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: [] }),
  Object.freeze({ name: "utf-32-le", aliases: ["UTF-32-LE","utf-32le","csutf32le"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: [] }),
  Object.freeze({ name: "utf-7", aliases: ["UTF-7","utf7","csutf7"], era: EncodingEra.LEGACY_REGIONAL, isMultibyte: false, languages: [] }),
  // CJK - Modern Web
  Object.freeze({ name: "big5hkscs", aliases: ["Big5-HKSCS","Big5HKSCS","big5","big5-tw","csbig5","cp950","cn-big5","x-x-big5","csbig5hkscs"], era: EncodingEra.MODERN_WEB, isMultibyte: true, languages: ["zh"] }),
  Object.freeze({ name: "cp932", aliases: ["CP932","ms932","mskanji","ms-kanji","cswindows31j","windows-31j"], era: EncodingEra.MODERN_WEB, isMultibyte: true, languages: ["ja"] }),
  Object.freeze({ name: "cp949", aliases: ["CP949","ms949","uhc","windows-949","csksc56011987","iso-ir-149","ks_c_5601-1987","ks_c_5601-1989","ksc5601","ksc_5601"], era: EncodingEra.MODERN_WEB, isMultibyte: true, languages: ["ko"] }),
  Object.freeze({ name: "euc_jis_2004", aliases: ["EUC-JIS-2004","euc-jp","eucjp","ujis","u-jis","euc-jisx0213","cseucpkdfmtjapanese","x-euc-jp"], era: EncodingEra.MODERN_WEB, isMultibyte: true, languages: ["ja"] }),
  Object.freeze({ name: "euc_kr", aliases: ["EUC-KR","euckr","cseuckr"], era: EncodingEra.MODERN_WEB, isMultibyte: true, languages: ["ko"] }),
  Object.freeze({ name: "gb18030", aliases: ["GB18030","gb-18030","gb2312","gbk","csgb2312","gb_2312","gb_2312-80","x-gbk","csiso58gb231280","iso-ir-58","csgb18030","csgbk","cp936","ms936","windows-936"], era: EncodingEra.MODERN_WEB, isMultibyte: true, languages: ["zh"] }),
  Object.freeze({ name: "hz", aliases: ["HZ-GB-2312","hz"], era: EncodingEra.LEGACY_REGIONAL, isMultibyte: true, languages: ["zh"] }),
  Object.freeze({ name: "iso2022_jp_2", aliases: ["ISO-2022-JP-2","iso-2022-jp","csiso2022jp","iso2022-jp-1","csiso2022jp2"], era: EncodingEra.MODERN_WEB, isMultibyte: true, languages: ["ja"] }),
  Object.freeze({ name: "iso2022_jp_2004", aliases: ["ISO-2022-JP-2004","iso2022-jp-3"], era: EncodingEra.MODERN_WEB, isMultibyte: true, languages: ["ja"] }),
  Object.freeze({ name: "iso2022_jp_ext", aliases: ["ISO-2022-JP-EXT"], era: EncodingEra.MODERN_WEB, isMultibyte: true, languages: ["ja"] }),
  Object.freeze({ name: "iso2022_kr", aliases: ["ISO-2022-KR","csiso2022kr"], era: EncodingEra.LEGACY_REGIONAL, isMultibyte: true, languages: ["ko"] }),
  Object.freeze({ name: "shift_jis_2004", aliases: ["Shift-JIS-2004","Shift_JIS_2004","shift_jis","sjis","shiftjis","s_jis","shift-jisx0213","x-sjis","csshiftjis","ms_kanji"], era: EncodingEra.MODERN_WEB, isMultibyte: true, languages: ["ja"] }),
  // Windows code pages - Modern Web
  Object.freeze({ name: "cp874", aliases: ["CP874","windows-874","dos-874"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: ["th"] }),
  Object.freeze({ name: "cp1250", aliases: ["Windows-1250","cp1250","x-cp1250","cswindows1250"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: [..._CENTRAL_EU,"sr"] }),
  Object.freeze({ name: "cp1251", aliases: ["Windows-1251","cp1251","x-cp1251","cswindows1251"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: [..._CYRILLIC] }),
  Object.freeze({ name: "cp1252", aliases: ["Windows-1252","cp1252","x-cp1252","cswindows1252"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: [..._WESTERN] }),
  Object.freeze({ name: "cp1253", aliases: ["Windows-1253","cp1253","x-cp1253","cswindows1253"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: ["el"] }),
  Object.freeze({ name: "cp1254", aliases: ["Windows-1254","cp1254","x-cp1254","cswindows1254"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: ["tr"] }),
  Object.freeze({ name: "cp1255", aliases: ["Windows-1255","cp1255","x-cp1255","cswindows1255"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: ["he"] }),
  Object.freeze({ name: "cp1256", aliases: ["Windows-1256","cp1256","x-cp1256","cswindows1256"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: [..._ARABIC] }),
  Object.freeze({ name: "cp1257", aliases: ["Windows-1257","cp1257","x-cp1257","cswindows1257"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: [..._BALTIC] }),
  Object.freeze({ name: "cp1258", aliases: ["Windows-1258","cp1258","x-cp1258","cswindows1258"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: ["vi"] }),
  // KOI8 - Modern Web
  Object.freeze({ name: "koi8-r", aliases: ["KOI8-R","koi8r","koi","koi8","cskoi8r"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: ["ru"] }),
  Object.freeze({ name: "koi8-u", aliases: ["KOI8-U","koi8u","koi8-ru","cskoi8u"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: ["uk"] }),
  // TIS-620 - Modern Web
  Object.freeze({ name: "tis-620", aliases: ["TIS-620","tis620","iso-8859-11","iso8859-11","iso885911","cstis620"], era: EncodingEra.MODERN_WEB, isMultibyte: false, languages: ["th"] }),
  // === LEGACY_ISO ===
  Object.freeze({ name: "iso8859-1", aliases: ["ISO-8859-1","latin-1","latin1","iso8859-1","iso88591"], era: EncodingEra.LEGACY_ISO, isMultibyte: false, languages: [..._WESTERN] }),
  Object.freeze({ name: "iso8859-2", aliases: ["ISO-8859-2","latin-2","latin2","iso8859-2","iso88592"], era: EncodingEra.LEGACY_ISO, isMultibyte: false, languages: [..._CENTRAL_EU] }),
  Object.freeze({ name: "iso8859-3", aliases: ["ISO-8859-3","latin-3","latin3","iso8859-3","iso88593"], era: EncodingEra.LEGACY_ISO, isMultibyte: false, languages: ["eo","mt","tr"] }),
  Object.freeze({ name: "iso8859-4", aliases: ["ISO-8859-4","latin-4","latin4","iso8859-4","iso88594"], era: EncodingEra.LEGACY_ISO, isMultibyte: false, languages: [..._BALTIC] }),
  Object.freeze({ name: "iso8859-5", aliases: ["ISO-8859-5","iso8859-5","cyrillic","iso88595"], era: EncodingEra.LEGACY_ISO, isMultibyte: false, languages: [..._CYRILLIC] }),
  Object.freeze({ name: "iso8859-6", aliases: ["ISO-8859-6","iso8859-6","arabic","iso88596","iso-8859-6-e","iso-8859-6-i","csiso88596e","csiso88596i"], era: EncodingEra.LEGACY_ISO, isMultibyte: false, languages: [..._ARABIC] }),
  Object.freeze({ name: "iso8859-7", aliases: ["ISO-8859-7","iso8859-7","greek","iso88597","sun_eu_greek"], era: EncodingEra.LEGACY_ISO, isMultibyte: false, languages: ["el"] }),
  Object.freeze({ name: "iso8859-8", aliases: ["ISO-8859-8","iso8859-8","hebrew","iso88598","iso-8859-8-e","iso-8859-8-i","csiso88598e","csiso88598i","visual","logical"], era: EncodingEra.LEGACY_ISO, isMultibyte: false, languages: ["he"] }),
  Object.freeze({ name: "iso8859-9", aliases: ["ISO-8859-9","latin-5","latin5","iso8859-9","iso88599"], era: EncodingEra.LEGACY_ISO, isMultibyte: false, languages: ["tr"] }),
  Object.freeze({ name: "iso8859-10", aliases: ["ISO-8859-10","latin-6","latin6","iso8859-10","iso885910"], era: EncodingEra.LEGACY_ISO, isMultibyte: false, languages: ["is","fi"] }),
  Object.freeze({ name: "iso8859-13", aliases: ["ISO-8859-13","latin-7","latin7","iso8859-13","iso885913","csiso885913"], era: EncodingEra.LEGACY_ISO, isMultibyte: false, languages: [..._BALTIC] }),
  Object.freeze({ name: "iso8859-14", aliases: ["ISO-8859-14","latin-8","latin8","iso8859-14","iso885914","csiso885914","iso-ir-199","iso-celtic","l8"], era: EncodingEra.LEGACY_ISO, isMultibyte: false, languages: ["cy","ga","br","gd"] }),
  Object.freeze({ name: "iso8859-15", aliases: ["ISO-8859-15","latin-9","latin9","iso8859-15","iso885915","csisolatin9","csiso885915","l9"], era: EncodingEra.LEGACY_ISO, isMultibyte: false, languages: [..._WESTERN] }),
  Object.freeze({ name: "iso8859-16", aliases: ["ISO-8859-16","latin-10","latin10","iso8859-16","iso885916","csiso885916","iso-ir-226","l10"], era: EncodingEra.LEGACY_ISO, isMultibyte: false, languages: ["ro","pl","hr","hu","sk","sl"] }),
  Object.freeze({ name: "johab", aliases: ["Johab"], era: EncodingEra.LEGACY_ISO, isMultibyte: true, languages: ["ko"] }),
  // === LEGACY_MAC ===
  Object.freeze({ name: "mac-cyrillic", aliases: ["Mac-Cyrillic","MacCyrillic","maccyrillic","x-mac-cyrillic","x-mac-ukrainian"], era: EncodingEra.LEGACY_MAC, isMultibyte: false, languages: [..._CYRILLIC] }),
  Object.freeze({ name: "mac-greek", aliases: ["Mac-Greek","MacGreek","macgreek"], era: EncodingEra.LEGACY_MAC, isMultibyte: false, languages: ["el"] }),
  Object.freeze({ name: "mac-iceland", aliases: ["Mac-Iceland","MacIceland","maciceland"], era: EncodingEra.LEGACY_MAC, isMultibyte: false, languages: ["is"] }),
  Object.freeze({ name: "mac-latin2", aliases: ["Mac-Latin2","MacLatin2","maclatin2","maccentraleurope"], era: EncodingEra.LEGACY_MAC, isMultibyte: false, languages: [..._CENTRAL_EU_NO_RO] }),
  Object.freeze({ name: "mac-roman", aliases: ["Mac-Roman","MacRoman","macroman","macintosh","csmacintosh","mac","x-mac-roman"], era: EncodingEra.LEGACY_MAC, isMultibyte: false, languages: [..._WESTERN] }),
  Object.freeze({ name: "mac-turkish", aliases: ["Mac-Turkish","MacTurkish","macturkish"], era: EncodingEra.LEGACY_MAC, isMultibyte: false, languages: ["tr"] }),
  // === LEGACY_REGIONAL ===
  Object.freeze({ name: "cp720", aliases: ["CP720"], era: EncodingEra.LEGACY_REGIONAL, isMultibyte: false, languages: [..._ARABIC] }),
  Object.freeze({ name: "cp1006", aliases: ["CP1006"], era: EncodingEra.LEGACY_REGIONAL, isMultibyte: false, languages: ["ur"] }),
  Object.freeze({ name: "cp1125", aliases: ["CP1125"], era: EncodingEra.LEGACY_REGIONAL, isMultibyte: false, languages: ["uk"] }),
  Object.freeze({ name: "koi8-t", aliases: ["KOI8-T"], era: EncodingEra.LEGACY_REGIONAL, isMultibyte: false, languages: ["tg"] }),
  Object.freeze({ name: "kz1048", aliases: ["KZ-1048","kz1048","strk1048-2002","rk1048"], era: EncodingEra.LEGACY_REGIONAL, isMultibyte: false, languages: ["kk"] }),
  Object.freeze({ name: "ptcp154", aliases: ["PTCP154","pt154","cp154"], era: EncodingEra.LEGACY_REGIONAL, isMultibyte: false, languages: ["kk"] }),
  Object.freeze({ name: "hp-roman8", aliases: ["HP-Roman8","roman8","r8","csHPRoman8"], era: EncodingEra.LEGACY_REGIONAL, isMultibyte: false, languages: [..._WESTERN] }),
  // === DOS ===
  Object.freeze({ name: "cp437", aliases: ["CP437"], era: EncodingEra.DOS, isMultibyte: false, languages: ["en","fr","de","es","pt","it","nl","da","sv","fi","ga"] }),
  Object.freeze({ name: "cp737", aliases: ["CP737"], era: EncodingEra.DOS, isMultibyte: false, languages: ["el"] }),
  Object.freeze({ name: "cp775", aliases: ["CP775"], era: EncodingEra.DOS, isMultibyte: false, languages: [..._BALTIC] }),
  Object.freeze({ name: "cp850", aliases: ["CP850"], era: EncodingEra.DOS, isMultibyte: false, languages: [..._WESTERN] }),
  Object.freeze({ name: "cp852", aliases: ["CP852"], era: EncodingEra.DOS, isMultibyte: false, languages: [..._CENTRAL_EU] }),
  Object.freeze({ name: "cp855", aliases: ["CP855"], era: EncodingEra.DOS, isMultibyte: false, languages: [..._CYRILLIC] }),
  Object.freeze({ name: "cp856", aliases: ["CP856"], era: EncodingEra.DOS, isMultibyte: false, languages: ["he"] }),
  Object.freeze({ name: "cp857", aliases: ["CP857"], era: EncodingEra.DOS, isMultibyte: false, languages: ["tr"] }),
  Object.freeze({ name: "cp858", aliases: ["CP858"], era: EncodingEra.DOS, isMultibyte: false, languages: [..._WESTERN] }),
  Object.freeze({ name: "cp860", aliases: ["CP860"], era: EncodingEra.DOS, isMultibyte: false, languages: ["pt"] }),
  Object.freeze({ name: "cp861", aliases: ["CP861"], era: EncodingEra.DOS, isMultibyte: false, languages: ["is"] }),
  Object.freeze({ name: "cp862", aliases: ["CP862"], era: EncodingEra.DOS, isMultibyte: false, languages: ["he"] }),
  Object.freeze({ name: "cp863", aliases: ["CP863"], era: EncodingEra.DOS, isMultibyte: false, languages: ["fr"] }),
  Object.freeze({ name: "cp864", aliases: ["CP864"], era: EncodingEra.DOS, isMultibyte: false, languages: ["ar"] }),
  Object.freeze({ name: "cp865", aliases: ["CP865"], era: EncodingEra.DOS, isMultibyte: false, languages: ["da","no"] }),
  Object.freeze({ name: "cp866", aliases: ["CP866"], era: EncodingEra.DOS, isMultibyte: false, languages: [..._CYRILLIC] }),
  Object.freeze({ name: "cp869", aliases: ["CP869"], era: EncodingEra.DOS, isMultibyte: false, languages: ["el"] }),
  // === MAINFRAME ===
  Object.freeze({ name: "cp1140", aliases: ["CP1140","cp037","cp01140","ibm01140","ibm1140","csibm01140"], era: EncodingEra.MAINFRAME, isMultibyte: false, languages: [..._WESTERN_TR] }),
  Object.freeze({ name: "cp424", aliases: ["CP424"], era: EncodingEra.MAINFRAME, isMultibyte: false, languages: ["he"] }),
  Object.freeze({ name: "cp500", aliases: ["CP500"], era: EncodingEra.MAINFRAME, isMultibyte: false, languages: [..._WESTERN] }),
  Object.freeze({ name: "cp875", aliases: ["CP875"], era: EncodingEra.MAINFRAME, isMultibyte: false, languages: ["el"] }),
  Object.freeze({ name: "cp1026", aliases: ["CP1026"], era: EncodingEra.MAINFRAME, isMultibyte: false, languages: ["tr"] }),
  Object.freeze({ name: "cp273", aliases: ["CP273"], era: EncodingEra.MAINFRAME, isMultibyte: false, languages: ["de"] }),
];

export const REGISTRY: Readonly<Record<EncodingName, EncodingInfo>> = Object.freeze(
  Object.fromEntries(_REGISTRY_ENTRIES.map(e => [e.name, e]))
) as Readonly<Record<EncodingName, EncodingInfo>>;

const _candidatesCache = new Map<string, readonly EncodingInfo[]>();

export function getCandidates(
  era: number,
  includeEncodings?: ReadonlySet<string>,
  excludeEncodings?: ReadonlySet<string>,
): readonly EncodingInfo[] {
  const incKey = includeEncodings ? [...includeEncodings].sort().join(',') : '';
  const excKey = excludeEncodings ? [...excludeEncodings].sort().join(',') : '';
  const cacheKey = `${era}|${incKey}|${excKey}`;
  const cached = _candidatesCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let candidates = Object.values(REGISTRY).filter(enc => enc.era & era);
  if (includeEncodings !== undefined) candidates = candidates.filter(enc => includeEncodings.has(enc.name));
  if (excludeEncodings !== undefined) candidates = candidates.filter(enc => !excludeEncodings.has(enc.name));
  const result = Object.freeze(candidates);
  _candidatesCache.set(cacheKey, result);
  return result;
}

const _lookupCache = new Map<string, EncodingName | null>();

function _lookupUncached(name: string): EncodingName | null {
  const lowered = name.toLowerCase();
  for (const entry of Object.values(REGISTRY)) {
    if (entry.name === lowered) return entry.name;
    for (const alias of entry.aliases) {
      if (alias.toLowerCase() === lowered) return entry.name;
    }
  }
  // Fallback: resolve through codec registry (replaces Python's codecs.lookup())
  const codecName = codecsLookup(name);
  if (codecName === null) return null;
  if (codecName !== lowered) return lookupEncoding(codecName);
  return null;
}

export function lookupEncoding(name: string): EncodingName | null {
  const cached = _lookupCache.get(name);
  if (cached !== undefined) return cached;
  const result = _lookupUncached(name);
  _lookupCache.set(name, result);
  return result;
}

export function _validateEncoding(name: string, paramName: string): EncodingName {
  const canonical = lookupEncoding(name);
  if (canonical === null) throw new Error(`Unknown encoding ${JSON.stringify(name)} in ${paramName}`);
  return canonical;
}

export function normalizeEncodings(
  encodings: Iterable<string> | null | undefined,
  paramName: string,
): ReadonlySet<EncodingName> | null {
  if (encodings == null) return null;
  const result = new Set<EncodingName>([...encodings].map(name => _validateEncoding(name, paramName)));
  if (result.size === 0) {
    throw new Error(`${paramName} must not be empty; omit the argument or pass null to disable filtering`);
  }
  return result;
}
