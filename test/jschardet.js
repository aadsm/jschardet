const test = require('ava')
const jschardet = require('../')

test('ASCII', function (t) {
  const str = 'Normal ascii letters.'
  t.is(jschardet.detect(str).encoding, 'ascii')
})

test('UTF-8 w/o BOM', function (t) {
  // àíàçã
  const str = '\xc3\xa0\xc3\xad\xc3\xa0\xc3\xa7\xc3\xa3'
  t.is(jschardet.detect(str).encoding, 'UTF-8')
})

test('UTF-8', function (t) {
  const str = '\xEF\xBB\xBFutf8 string'
  t.is(jschardet.detect(str).encoding, 'UTF-8')
})

test('UTF-8 stream', function (t) {
  const u = new jschardet.UniversalDetector()
  u.reset()
  u.feed('\xEF')
  u.feed('\xBB\xBFutf8 string')
  u.close()
  t.is(u.result.encoding, 'UTF-8')
})

test('UTF-16BE', function (t) {
  const str = '\xFE\xFFutf16be string'
  t.is(jschardet.detect(str).encoding, 'UTF-16BE')
})

test('UTF-16LE', function (t) {
  const str = '\xFF\xFEutf16le string'
  t.is(jschardet.detect(str).encoding, 'UTF-16LE')
})

test('UTF-32BE', function (t) {
  const str = '\x00\x00\xFE\xFFutf32be string'
  t.is(jschardet.detect(str).encoding, 'UTF-32BE')
})

test('UTF-32LE', function (t) {
  const str = '\xFF\xFE\x00\x00utf32le string'
  t.is(jschardet.detect(str).encoding, 'UTF-32LE')
})

test('X-ISO-10646-UCS-4-3412', function (t) {
  const str = '\xFE\xFF\x00\x00ucs4 3412 string'
  t.is(jschardet.detect(str).encoding, 'X-ISO-10646-UCS-4-3412')
})

test('X-ISO-10646-UCS-4-2143', function (t) {
  const str = '\x00\x00\xFF\xFEucs4 2143 string'
  t.is(jschardet.detect(str).encoding, 'X-ISO-10646-UCS-4-2143')
})

test('ISO-8859-2 (Hungarian)', function (t) {
  // A kódolás szinte minden adatátviteli és kommunikációs rendszerben használható, és a következő európai nyelvek megjelenítésére alkalmas: bosnyák, cseh, horvát, lengyel, magyar, román, szerb (a latinbetűs írásmóddal), szerbhorvát, szlovák, szlovén, alsó-szorb és felső-szorb.
  const str = '\x41\x20\x6B\xF3\x64\x6F\x6C\xE1\x73\x20\x73\x7A\x69\x6E\x74\x65\x20\x6D\x69\x6E\x64\x65\x6E\x20\x61\x64\x61\x74\xE1\x74\x76\x69\x74\x65\x6C\x69\x20\xE9\x73\x20\x6B\x6F\x6D\x6D\x75\x6E\x69\x6B\xE1\x63\x69\xF3\x73\x20\x72\x65\x6E\x64\x73\x7A\x65\x72\x62\x65\x6E\x20\x68\x61\x73\x7A\x6E\xE1\x6C\x68\x61\x74\xF3\x2C\x20\xE9\x73\x20\x61\x20\x6B\xF6\x76\x65\x74\x6B\x65\x7A\xF5\x20\x65\x75\x72\xF3\x70\x61\x69\x20\x6E\x79\x65\x6C\x76\x65\x6B\x20\x6D\x65\x67\x6A\x65\x6C\x65\x6E\xED\x74\xE9\x73\xE9\x72\x65\x20\x61\x6C\x6B\x61\x6C\x6D\x61\x73\x3A\x20\x62\x6F\x73\x6E\x79\xE1\x6B\x2C\x20\x63\x73\x65\x68\x2C\x20\x68\x6F\x72\x76\xE1\x74\x2C\x20\x6C\x65\x6E\x67\x79\x65\x6C\x2C\x20\x6D\x61\x67\x79\x61\x72\x2C\x20\x72\x6F\x6D\xE1\x6E\x2C\x20\x73\x7A\x65\x72\x62\x20\x28\x61\x20\x6C\x61\x74\x69\x6E\x62\x65\x74\xFB\x73\x20\xED\x72\xE1\x73\x6D\xF3\x64\x64\x61\x6C\x29\x2C\x20\x73\x7A\x65\x72\x62\x68\x6F\x72\x76\xE1\x74\x2C\x20\x73\x7A\x6C\x6F\x76\xE1\x6B\x2C\x20\x73\x7A\x6C\x6F\x76\xE9\x6E\x2C\x20\x61\x6C\x73\xF3\x2D\x73\x7A\x6F\x72\x62\x20\xE9\x73\x20\x66\x65\x6C\x73\xF5\x2D\x73\x7A\x6F\x72\x62\x2E'
  t.is(jschardet.detect(str).encoding, 'ISO-8859-2')
})

test('ISO-8859-5 (Russian)', function (t) {
  // ISO 8859-5 широко применяется в Сербии и Болгарии на юниксоподобных системах. В России эта кодировка почти не употребляется (взамен на юниксоподобных системах широкое применение нашла КОИ-8) тем не менее на некоторых иностранных системах для русского языка по умолчанию ставится ISO 8859-5
  const str = '\x49\x53\x4F\x20\x38\x38\x35\x39\x2D\x35\x20\xE8\xD8\xE0\xDE\xDA\xDE\x20\xDF\xE0\xD8\xDC\xD5\xDD\xEF\xD5\xE2\xE1\xEF\x20\xD2\x20\xC1\xD5\xE0\xD1\xD8\xD8\x20\xD8\x20\xB1\xDE\xDB\xD3\xD0\xE0\xD8\xD8\x20\xDD\xD0\x20\xEE\xDD\xD8\xDA\xE1\xDE\xDF\xDE\xD4\xDE\xD1\xDD\xEB\xE5\x20\xE1\xD8\xE1\xE2\xD5\xDC\xD0\xE5\x2E\x20\xB2\x20\xC0\xDE\xE1\xE1\xD8\xD8\x20\xED\xE2\xD0\x20\xDA\xDE\xD4\xD8\xE0\xDE\xD2\xDA\xD0\x20\xDF\xDE\xE7\xE2\xD8\x20\xDD\xD5\x20\xE3\xDF\xDE\xE2\xE0\xD5\xD1\xDB\xEF\xD5\xE2\xE1\xEF\x20\x28\xD2\xD7\xD0\xDC\xD5\xDD\x20\xDD\xD0\x20\xEE\xDD\xD8\xDA\xE1\xDE\xDF\xDE\xD4\xDE\xD1\xDD\xEB\xE5\x20\xE1\xD8\xE1\xE2\xD5\xDC\xD0\xE5\x20\xE8\xD8\xE0\xDE\xDA\xDE\xD5\x20\xDF\xE0\xD8\xDC\xD5\xDD\xD5\xDD\xD8\xD5\x20\xDD\xD0\xE8\xDB\xD0\x20\xBA\xBE\xB8\x2D\x38\x29\x3B\x20\xE2\xD5\xDC\x20\xDD\xD5\x20\xDC\xD5\xDD\xD5\xD5\x20\xDD\xD0\x20\xDD\xD5\xDA\xDE\xE2\xDE\xE0\xEB\xE5\x20\xD8\xDD\xDE\xE1\xE2\xE0\xD0\xDD\xDD\xEB\xE5\x20\xE1\xD8\xE1\xE2\xD5\xDC\xD0\xE5\x20\xD4\xDB\xEF\x20\xE0\xE3\xE1\xE1\xDA\xDE\xD3\xDE\x20\xEF\xD7\xEB\xDA\xD0\x20\xDF\xDE\x20\xE3\xDC\xDE\xDB\xE7\xD0\xDD\xD8\xEE\x20\xE1\xE2\xD0\xD2\xD8\xE2\xE1\xEF\x20\x49\x53\x4F\x20\x38\x38\x35\x39\x2D\x35'
  t.is(jschardet.detect(str).encoding, 'ISO-8859-5')
})

test('ISO-8859-5 (Bulgarian)', function (t) {
  // Първата статия в Уикипедия на български език е създадена в началото на декември 2003 г., а в момента се работи по 91 318 статии, защитени с лиценза Криейтив Комънс - Признание - Споделяне на споделеното и Лиценза за свободна документация на ГНУ. Това означава, че те са свободни и винаги ще бъдат такива!
  const str = '\xBF\xEA\xE0\xD2\xD0\xE2\xD0\x20\xE1\xE2\xD0\xE2\xD8\xEF\x20\xD2\x20\xC3\xD8\xDA\xD8\xDF\xD5\xD4\xD8\xEF\x20\xDD\xD0\x20\xD1\xEA\xDB\xD3\xD0\xE0\xE1\xDA\xD8\x20\xD5\xD7\xD8\xDA\x20\xD5\x20\xE1\xEA\xD7\xD4\xD0\xD4\xD5\xDD\xD0\x20\xD2\x20\xDD\xD0\xE7\xD0\xDB\xDE\xE2\xDE\x20\xDD\xD0\x20\xD4\xD5\xDA\xD5\xDC\xD2\xE0\xD8\x20\x32\x30\x30\x33\x20\xD3\x2E\x2C\x20\xD0\x20\xD2\x20\xDC\xDE\xDC\xD5\xDD\xE2\xD0\x20\xE1\xD5\x20\xE0\xD0\xD1\xDE\xE2\xD8\x20\xDF\xDE\x20\x39\x31\x20\x33\x31\x38\x20\xE1\xE2\xD0\xE2\xD8\xD8\x2C\x20\xD7\xD0\xE9\xD8\xE2\xD5\xDD\xD8\x20\xE1\x20\xDB\xD8\xE6\xD5\xDD\xD7\xD0\x20\xBA\xE0\xD8\xD5\xD9\xE2\xD8\xD2\x20\xBA\xDE\xDC\xEA\xDD\xE1\x20\x2D\x20\xBF\xE0\xD8\xD7\xDD\xD0\xDD\xD8\xD5\x20\x2D\x20\xC1\xDF\xDE\xD4\xD5\xDB\xEF\xDD\xD5\x20\xDD\xD0\x20\xE1\xDF\xDE\xD4\xD5\xDB\xD5\xDD\xDE\xE2\xDE\x20\xD8\x20\xBB\xD8\xE6\xD5\xDD\xD7\xD0\x20\xD7\xD0\x20\xE1\xD2\xDE\xD1\xDE\xD4\xDD\xD0\x20\xD4\xDE\xDA\xE3\xDC\xD5\xDD\xE2\xD0\xE6\xD8\xEF\x20\xDD\xD0\x20\xB3\xBD\xC3\x2E\x20\xC2\xDE\xD2\xD0\x20\xDE\xD7\xDD\xD0\xE7\xD0\xD2\xD0\x2C\x20\xE7\xD5\x20\xE2\xD5\x20\xE1\xD0\x20\xE1\xD2\xDE\xD1\xDE\xD4\xDD\xD8\x20\xD8\x20\xD2\xD8\xDD\xD0\xD3\xD8\x20\xE9\xD5\x20\xD1\xEA\xD4\xD0\xE2\x20\xE2\xD0\xDA\xD8\xD2\xD0\x21'
  t.is(jschardet.detect(str).encoding, 'ISO-8859-5')
})

test('ISO-8859-7 (Greek)', function (t) {
  // Η τυποποιημένη κωδικοποίηση χαρακτήρων του διεθνούς οργανισμού τυποποιήσεων με το όνομα ISO 8859-7, γνωστή και σαν Ελληνικά, είναι μια 8-μπιτη κωδικοποίηση χαρακτήρων, μέρος του προτύπου ISO 8859. Σχεδιάστηκε με τον σκοπό να καλύπτει τη σύγχρονη ελληνική γλώσσα καθώς και μαθηματικά σύμβολα προερχόμενα από τα ελληνικά.
  const str = '\xC7\x20\xF4\xF5\xF0\xEF\xF0\xEF\xE9\xE7\xEC\xDD\xED\xE7\x20\xEA\xF9\xE4\xE9\xEA\xEF\xF0\xEF\xDF\xE7\xF3\xE7\x20\xF7\xE1\xF1\xE1\xEA\xF4\xDE\xF1\xF9\xED\x20\xF4\xEF\xF5\x20\xE4\xE9\xE5\xE8\xED\xEF\xFD\xF2\x20\xEF\xF1\xE3\xE1\xED\xE9\xF3\xEC\xEF\xFD\x20\xF4\xF5\xF0\xEF\xF0\xEF\xE9\xDE\xF3\xE5\xF9\xED\x20\xEC\xE5\x20\xF4\xEF\x20\xFC\xED\xEF\xEC\xE1\x20\x49\x53\x4F\x20\x38\x38\x35\x39\x2D\x37\x2C\x20\xE3\xED\xF9\xF3\xF4\xDE\x20\xEA\xE1\xE9\x20\xF3\xE1\xED\x20\xC5\xEB\xEB\xE7\xED\xE9\xEA\xDC\x2C\x20\xE5\xDF\xED\xE1\xE9\x20\xEC\xE9\xE1\x20\x38\x2D\xEC\xF0\xE9\xF4\xE7\x20\xEA\xF9\xE4\xE9\xEA\xEF\xF0\xEF\xDF\xE7\xF3\xE7\x20\xF7\xE1\xF1\xE1\xEA\xF4\xDE\xF1\xF9\xED\x2C\x20\xEC\xDD\xF1\xEF\xF2\x20\xF4\xEF\xF5\x20\xF0\xF1\xEF\xF4\xFD\xF0\xEF\xF5\x20\x49\x53\x4F\x20\x38\x38\x35\x39\x2E\x20\xD3\xF7\xE5\xE4\xE9\xDC\xF3\xF4\xE7\xEA\xE5\x20\xEC\xE5\x20\xF4\xEF\xED\x20\xF3\xEA\xEF\xF0\xFC\x20\xED\xE1\x20\xEA\xE1\xEB\xFD\xF0\xF4\xE5\xE9\x20\xF4\xE7\x20\xF3\xFD\xE3\xF7\xF1\xEF\xED\xE7\x20\xE5\xEB\xEB\xE7\xED\xE9\xEA\xDE\x20\xE3\xEB\xFE\xF3\xF3\xE1\x20\xEA\xE1\xE8\xFE\xF2\x20\xEA\xE1\xE9\x20\xEC\xE1\xE8\xE7\xEC\xE1\xF4\xE9\xEA\xDC\x20\xF3\xFD\xEC\xE2\xEF\xEB\xE1\x20\xF0\xF1\xEF\xE5\xF1\xF7\xFC\xEC\xE5\xED\xE1\x20\xE1\xF0\xFC\x20\xF4\xE1\x20\xE5\xEB\xEB\xE7\xED\xE9\xEA\xDC\x2E'
  t.is(jschardet.detect(str).encoding, 'ISO-8859-7')
})

test('ISO-8859-8 (Visual Hebrew)', function (t) {
  // First paragraph of: http://www.cs.bgu.ac.il/~elad/noa_v.html
  const str = '\xE5\xE9\xE4\x20\x20\xED\xE9\xE9\xEE\xF9\xE4\x20\x20\x2E\xE8\xEE\xE5\xF4\xF1\xEB\xEC\x20\xF8\xE5\xFA\xE1\x20\x2C\xE3\xE7\xE0\x20\xF1\xF4\xF1\xE5\xE7\xEE\x20\xE1\xF8\xF2\x20\xE9\xFA\xF9\xE2\xF4\x20\x20\xE4\xF2\xE5\xF0\x20\x20\xFA\xE0\x20\x0D\x0A\x20\xED\xE9\xEC\xE5\xFA\xE7\xE5\x20\xED\xE9\xE1\xEC\xEB\xEC\x20\x20\xED\xF8\xE5\xE2\xF9\x20\x20\xE2\xE5\xF1\xE4\xEE\x20\xE7\xE5\xF8\x20\x20\xE4\xFA\xE9\xE4\xE5\x20\x20\xEF\xE5\xF2\xE2\xE9\xF9\x20\x20\xE3\xF2\x20\xED\xE9\xE3\xE5\xF8\xE5\x20\x0D\x0A\x20\xE0\xE5\xE4\xF9\x20\xE1\xE4\xE1\xE4\xEC\x20\xEC\xE9\xE7\xFA\xE4\x20\x20\xE0\xE5\xE4\x20\xE6\xE0\xE5\x20\xE8\xEE\xE5\xF4\xF1\xEB\xE4\xEE\x20\xF3\xF1\xEB\x20\x20\xE9\xFA\xE0\xF6\xE5\xE4\x20\xE9\xF0\xE0\x20\x2E\xF9\xE8\xF2\xFA\xE4\xEC\x20\x0D\x0A\x20\xE9\xE3\xE9\xF6\xEE\x20\xE4\xF4\xE9\x20\xE0\xEC\x20\xE4\xE6\xF9\x20\x20\xE4\xF8\xEE\xE0\x20\xE0\xE9\xE4\x20\x2E\xF9\xE5\xEE\xE9\xF9\xE1\x20\xE0\xEC\x20\x20\xE0\xE5\xE4\x20\xFA\xE9\xF0\xEE\xE6\x20\xEC\xE1\xE0\x20\xF8\xF2\xE8\xF6\xEE\x20\x0D\x0A\x20\xE4\xEC\x20\x20\xED\xE9\xE0\xF8\xE5\xF7\xF9\x20\xE4\xF8\xEE\xE0\x20\x20\xE0\xE9\xE4\xE5\x20\xE4\xE3\xE9\xEC\xE2\x20\x20\xE5\xF0\xEC\xEB\xE0\x20\x2E\xE4\xFA\xE5\xE0\x20\xFA\xE5\xF6\xF4\xEC\x20\xE9\xFA\xF2\xF6\xE4\x20\xE9\xF0\xE0\xE5\x20'
  t.is(jschardet.detect(str).encoding, 'ISO-8859-8')
})

test.failing('ISO-2022-CN', function (t) {
  // 情人节为每年的2月14日，是西方的传统节日之一。这节日原来纪念两位同是名叫华伦泰的基督宗教初期教会殉道圣人。
  const str = ''
  t.is(jschardet.detect(str).encoding, 'ISO-2022-CN', '')
})

test('ISO-2022-KR', function (t) {
  // 화성 기후 탐사선 마스 클라이미트 오비터(사진)는 화성 궤도에 진입했으나, 우주선 제작사 록히드 마틴과 미항공우주국이 다른 단위를 써서 폭발하고 말았습니다.
  const str = '\x1B\x24\x29\x43\x0E\x48\x2D\x3C\x3A\x0F\x20\x0E\x31\x62\x48\x44\x0F\x20\x0E\x45\x3D\x3B\x67\x3C\x31\x0F\x20\x0E\x38\x36\x3D\x3A\x0F\x20\x0E\x45\x2C\x36\x73\x40\x4C\x39\x4C\x46\x2E\x0F\x20\x0E\x3F\x40\x3A\x71\x45\x4D\x0F\x28\x0E\x3B\x67\x41\x78\x0F\x29\x0E\x34\x42\x0F\x20\x0E\x48\x2D\x3C\x3A\x0F\x20\x0E\x31\x4B\x35\x35\x3F\x21\x0F\x20\x0E\x41\x78\x40\x54\x47\x5F\x40\x38\x33\x2A\x0F\x2C\x20\x0E\x3F\x6C\x41\x56\x3C\x31\x0F\x20\x0E\x41\x26\x40\x5B\x3B\x67\x0F\x20\x0E\x37\x4F\x48\x77\x35\x65\x0F\x20\x0E\x38\x36\x46\x3E\x30\x7A\x0F\x20\x0E\x39\x4C\x47\x57\x30\x78\x3F\x6C\x41\x56\x31\x39\x40\x4C\x0F\x20\x0E\x34\x59\x38\x25\x0F\x20\x0E\x34\x5C\x40\x27\x38\x26\x0F\x20\x0E\x3D\x61\x3C\x2D\x0F\x20\x0E\x46\x78\x39\x5F\x47\x4F\x30\x6D\x0F\x20\x0E\x38\x3B\x3E\x52\x3D\x40\x34\x4F\x34\x59\x0F\x2E'
  t.is(jschardet.detect(str).encoding, 'ISO-2022-KR')
})

test('ISO-2022-JP', function (t) {
  // ウィキペディアはオープンコンテントの百科事典です。基本方針に賛同していただけるなら、誰でも記事を編集したり新しく作成したりできます。ガイドブックを読んでから、サンドボックスで練習してみましょう。質問は利用案内でどうぞ。
  const str = '\x1B\x24\x42\x25\x26\x25\x23\x25\x2D\x25\x5A\x25\x47\x25\x23\x25\x22\x24\x4F\x25\x2A\x21\x3C\x25\x57\x25\x73\x25\x33\x25\x73\x25\x46\x25\x73\x25\x48\x24\x4E\x49\x34\x32\x4A\x3B\x76\x45\x35\x24\x47\x24\x39\x21\x23\x34\x70\x4B\x5C\x4A\x7D\x3F\x4B\x24\x4B\x3B\x3F\x46\x31\x24\x37\x24\x46\x24\x24\x24\x3F\x24\x40\x24\x31\x24\x6B\x24\x4A\x24\x69\x21\x22\x43\x2F\x24\x47\x24\x62\x35\x2D\x3B\x76\x24\x72\x4A\x54\x3D\x38\x24\x37\x24\x3F\x24\x6A\x3F\x37\x24\x37\x24\x2F\x3A\x6E\x40\x2E\x24\x37\x24\x3F\x24\x6A\x24\x47\x24\x2D\x24\x5E\x24\x39\x21\x23\x25\x2C\x25\x24\x25\x49\x25\x56\x25\x43\x25\x2F\x24\x72\x46\x49\x24\x73\x24\x47\x24\x2B\x24\x69\x21\x22\x25\x35\x25\x73\x25\x49\x25\x5C\x25\x43\x25\x2F\x25\x39\x24\x47\x4E\x7D\x3D\x2C\x24\x37\x24\x46\x24\x5F\x24\x5E\x24\x37\x24\x67\x24\x26\x21\x23\x3C\x41\x4C\x64\x24\x4F\x4D\x78\x4D\x51\x30\x46\x46\x62\x24\x47\x24\x49\x24\x26\x24\x3E\x21\x23\x1B\x28\x42'
  t.is(jschardet.detect(str).encoding, 'ISO-2022-JP')
})

test.failing('windows-1250 (Hungarian)', function (t) {
  // A kódolás szinte minden adatátviteli és kommunikációs rendszerben használható, és a következő európai nyelvek megjelenítésére alkalmas: bosnyák, cseh, horvát, lengyel, magyar, román, szerb (a latinbetűs írásmóddal), szerbhorvát, szlovák, szlovén, alsó-szorb és felső-szorb.
  const str = ''
  t.is(jschardet.detect(str).encoding, 'windows-1250')
})

test('windows-1251 (Russian)', function (t) {
  // ISO 8859-5 широко применяется в Сербии и Болгарии на юниксоподобных системах. В России эта кодировка почти не употребляется (взамен на юниксоподобных системах широкое применение нашла КОИ-8) тем не менее на некоторых иностранных системах для русского языка по умолчанию ставится ISO 8859-5
  const str = '\x49\x53\x4F\x20\x38\x38\x35\x39\x2D\x35\x20\xF8\xE8\xF0\xEE\xEA\xEE\x20\xEF\xF0\xE8\xEC\xE5\xED\xFF\xE5\xF2\xF1\xFF\x20\xE2\x20\xD1\xE5\xF0\xE1\xE8\xE8\x20\xE8\x20\xC1\xEE\xEB\xE3\xE0\xF0\xE8\xE8\x20\xED\xE0\x20\xFE\xED\xE8\xEA\xF1\xEE\xEF\xEE\xE4\xEE\xE1\xED\xFB\xF5\x20\xF1\xE8\xF1\xF2\xE5\xEC\xE0\xF5\x2E\x20\xC2\x20\xD0\xEE\xF1\xF1\xE8\xE8\x20\xFD\xF2\xE0\x20\xEA\xEE\xE4\xE8\xF0\xEE\xE2\xEA\xE0\x20\xEF\xEE\xF7\xF2\xE8\x20\xED\xE5\x20\xF3\xEF\xEE\xF2\xF0\xE5\xE1\xEB\xFF\xE5\xF2\xF1\xFF\x20\x28\xE2\xE7\xE0\xEC\xE5\xED\x20\xED\xE0\x20\xFE\xED\xE8\xEA\xF1\xEE\xEF\xEE\xE4\xEE\xE1\xED\xFB\xF5\x20\xF1\xE8\xF1\xF2\xE5\xEC\xE0\xF5\x20\xF8\xE8\xF0\xEE\xEA\xEE\xE5\x20\xEF\xF0\xE8\xEC\xE5\xED\xE5\xED\xE8\xE5\x20\xED\xE0\xF8\xEB\xE0\x20\xCA\xCE\xC8\x2D\x38\x29\x3B\x20\xF2\xE5\xEC\x20\xED\xE5\x20\xEC\xE5\xED\xE5\xE5\x20\xED\xE0\x20\xED\xE5\xEA\xEE\xF2\xEE\xF0\xFB\xF5\x20\xE8\xED\xEE\xF1\xF2\xF0\xE0\xED\xED\xFB\xF5\x20\xF1\xE8\xF1\xF2\xE5\xEC\xE0\xF5\x20\xE4\xEB\xFF\x20\xF0\xF3\xF1\xF1\xEA\xEE\xE3\xEE\x20\xFF\xE7\xFB\xEA\xE0\x20\xEF\xEE\x20\xF3\xEC\xEE\xEB\xF7\xE0\xED\xE8\xFE\x20\xF1\xF2\xE0\xE2\xE8\xF2\xF1\xFF\x20\x49\x53\x4F\x20\x38\x38\x35\x39\x2D\x35'
  t.is(jschardet.detect(str).encoding, 'windows-1251')
})

test.failing('windows-1251 (Bulgarian)', function (t) {
  // Първата статия в Уикипедия на български език е създадена в началото на декември 2003 г., а в момента се работи по 91 318 статии, защитени с лиценза Криейтив Комънс - Признание - Споделяне на споделеното и Лиценза за свободна документация на ГНУ. Това означава, че те са свободни и винаги ще бъдат такива!
  const str = '\xBF\xEA\xE0\xD2\xD0\xE2\xD0\x20\xE1\xE2\xD0\xE2\xD8\xEF\x20\xD2\x20\xC3\xD8\xDA\xD8\xDF\xD5\xD4\xD8\xEF\x20\xDD\xD0\x20\xD1\xEA\xDB\xD3\xD0\xE0\xE1\xDA\xD8\x20\xD5\xD7\xD8\xDA\x20\xD5\x20\xE1\xEA\xD7\xD4\xD0\xD4\xD5\xDD\xD0\x20\xD2\x20\xDD\xD0\xE7\xD0\xDB\xDE\xE2\xDE\x20\xDD\xD0\x20\xD4\xD5\xDA\xD5\xDC\xD2\xE0\xD8\x20\x32\x30\x30\x33\x20\xD3\x2E\x2C\x20\xD0\x20\xD2\x20\xDC\xDE\xDC\xD5\xDD\xE2\xD0\x20\xE1\xD5\x20\xE0\xD0\xD1\xDE\xE2\xD8\x20\xDF\xDE\x20\x39\x31\x20\x33\x31\x38\x20\xE1\xE2\xD0\xE2\xD8\xD8\x2C\x20\xD7\xD0\xE9\xD8\xE2\xD5\xDD\xD8\x20\xE1\x20\xDB\xD8\xE6\xD5\xDD\xD7\xD0\x20\xBA\xE0\xD8\xD5\xD9\xE2\xD8\xD2\x20\xBA\xDE\xDC\xEA\xDD\xE1\x20\x2D\x20\xBF\xE0\xD8\xD7\xDD\xD0\xDD\xD8\xD5\x20\x2D\x20\xC1\xDF\xDE\xD4\xD5\xDB\xEF\xDD\xD5\x20\xDD\xD0\x20\xE1\xDF\xDE\xD4\xD5\xDB\xD5\xDD\xDE\xE2\xDE\x20\xD8\x20\xBB\xD8\xE6\xD5\xDD\xD7\xD0\x20\xD7\xD0\x20\xE1\xD2\xDE\xD1\xDE\xD4\xDD\xD0\x20\xD4\xDE\xDA\xE3\xDC\xD5\xDD\xE2\xD0\xE6\xD8\xEF\x20\xDD\xD0\x20\xB3\xBD\xC3\x2E\x20\xC2\xDE\xD2\xD0\x20\xDE\xD7\xDD\xD0\xE7\xD0\xD2\xD0\x2C\x20\xE7\xD5\x20\xE2\xD5\x20\xE1\xD0\x20\xE1\xD2\xDE\xD1\xDE\xD4\xDD\xD8\x20\xD8\x20\xD2\xD8\xDD\xD0\xD3\xD8\x20\xE9\xD5\x20\xD1\xEA\xD4\xD0\xE2\x20\xE2\xD0\xDA\xD8\xD2\xD0\x21'
  t.is(jschardet.detect(str).encoding, 'windows-1251')
})

test('windows-1252 (latin1)', function (t) {
  // Em virtude das suas múltiplas conquistas, que ao longo de mais de quarenta anos mais que duplicaram o território que o seu pai lhe havia legado, foi cognominado O Conquistador também é conhecido como O Fundador e O Grande. Os muçulmanos, em sinal de respeito, chamaram-lhe Ibn-Arrik («filho de Henrique», tradução literal do patronímico Henriques) ou El-Bortukali («o Português»).
  const str = '\x45\x6D\x20\x76\x69\x72\x74\x75\x64\x65\x20\x64\x61\x73\x20\x73\x75\x61\x73\x20\x6D\xFA\x6C\x74\x69\x70\x6C\x61\x73\x20\x63\x6F\x6E\x71\x75\x69\x73\x74\x61\x73\x2C\x20\x71\x75\x65\x20\x61\x6F\x20\x6C\x6F\x6E\x67\x6F\x20\x64\x65\x20\x6D\x61\x69\x73\x20\x64\x65\x20\x71\x75\x61\x72\x65\x6E\x74\x61\x20\x61\x6E\x6F\x73\x20\x6D\x61\x69\x73\x20\x71\x75\x65\x20\x64\x75\x70\x6C\x69\x63\x61\x72\x61\x6D\x20\x6F\x20\x74\x65\x72\x72\x69\x74\xF3\x72\x69\x6F\x20\x71\x75\x65\x20\x6F\x20\x73\x65\x75\x20\x70\x61\x69\x20\x6C\x68\x65\x20\x68\x61\x76\x69\x61\x20\x6C\x65\x67\x61\x64\x6F\x2C\x20\x66\x6F\x69\x20\x63\x6F\x67\x6E\x6F\x6D\x69\x6E\x61\x64\x6F\x20\x4F\x20\x43\x6F\x6E\x71\x75\x69\x73\x74\x61\x64\x6F\x72\x3B\x20\x74\x61\x6D\x62\xE9\x6D\x20\xE9\x20\x63\x6F\x6E\x68\x65\x63\x69\x64\x6F\x20\x63\x6F\x6D\x6F\x20\x4F\x20\x46\x75\x6E\x64\x61\x64\x6F\x72\x20\x65\x20\x4F\x20\x47\x72\x61\x6E\x64\x65\x2E\x20\x4F\x73\x20\x6D\x75\xE7\x75\x6C\x6D\x61\x6E\x6F\x73\x2C\x20\x65\x6D\x20\x73\x69\x6E\x61\x6C\x20\x64\x65\x20\x72\x65\x73\x70\x65\x69\x74\x6F\x2C\x20\x63\x68\x61\x6D\x61\x72\x61\x6D\x2D\x6C\x68\x65\x20\x49\x62\x6E\x2D\x41\x72\x72\x69\x6B\x20\x28\xAB\x66\x69\x6C\x68\x6F\x20\x64\x65\x20\x48\x65\x6E\x72\x69\x71\x75\x65\xBB\x2C\x20\x74\x72\x61\x64\x75\xE7\xE3\x6F\x20\x6C\x69\x74\x65\x72\x61\x6C\x20\x64\x6F\x20\x70\x61\x74\x72\x6F\x6E\xED\x6D\x69\x63\x6F\x20\x48\x65\x6E\x72\x69\x71\x75\x65\x73\x29\x20\x6F\x75\x20\x45\x6C\x2D\x42\x6F\x72\x74\x75\x6B\x61\x6C\x69\x20\x28\xAB\x6F\x20\x50\x6F\x72\x74\x75\x67\x75\xEA\x73\xBB\x29\x2E'
  t.is(jschardet.detect(str).encoding, 'windows-1252')

  // <string>Martin Kühl</string>
  const str = '\x3c\x73\x74\x72\x69\x6e\x67\x3e\x4d\x61\x72\x74\x69\x6e\x20\x4b\xfc\x68\x6c\x3c\x2f\x73\x74\x72\x69\x6e\x67\x3e'
  t.is(jschardet.detect(str).encoding, 'windows-1252')
})

test.failing('windows-1253 (Greek)', function (t) {
  // The only difference from ISO-8850-7 is the Ά(\xA2) letter.
  // I wasn't able to construct a string to make the heuristc find this charset.
  const str = ''
  t.is(jschardet.detect(str).encoding, 'windows-1253')
})

test('windows-1255 (Logical Hebrew)', function (t) {
  // mשנה! – סטודנטים חדשים יכולים להרשם ל
  const str = '\xF9\xF0\xE4\x21\x20\x96\x20\xF1\xE8\xE5\xE3\xF0\xE8\xE9\xED\x20\xE7\xE3\xF9\xE9\xED\x20\xE9\xEB\xE5\xEC\xE9\xED\x20\xEC\xE4\xF8\xF9\xED\x20\xEC'
  t.is(jschardet.detect(str).encoding, 'windows-1255')
})

test('KOI8-R (Russian)', function (t) {
  // ISO 8859-5 широко применяется в Сербии и Болгарии на юниксоподобных системах. В России эта кодировка почти не употребляется (взамен на юниксоподобных системах широкое применение нашла КОИ-8) тем не менее на некоторых иностранных системах для русского языка по умолчанию ставится ISO 8859-5
  const str = '\x49\x53\x4F\x20\x38\x38\x35\x39\x2D\x35\x20\xDB\xC9\xD2\xCF\xCB\xCF\x20\xD0\xD2\xC9\xCD\xC5\xCE\xD1\xC5\xD4\xD3\xD1\x20\xD7\x20\xF3\xC5\xD2\xC2\xC9\xC9\x20\xC9\x20\xE2\xCF\xCC\xC7\xC1\xD2\xC9\xC9\x20\xCE\xC1\x20\xC0\xCE\xC9\xCB\xD3\xCF\xD0\xCF\xC4\xCF\xC2\xCE\xD9\xC8\x20\xD3\xC9\xD3\xD4\xC5\xCD\xC1\xC8\x2E\x20\xF7\x20\xF2\xCF\xD3\xD3\xC9\xC9\x20\xDC\xD4\xC1\x20\xCB\xCF\xC4\xC9\xD2\xCF\xD7\xCB\xC1\x20\xD0\xCF\xDE\xD4\xC9\x20\xCE\xC5\x20\xD5\xD0\xCF\xD4\xD2\xC5\xC2\xCC\xD1\xC5\xD4\xD3\xD1\x20\x28\xD7\xDA\xC1\xCD\xC5\xCE\x20\xCE\xC1\x20\xC0\xCE\xC9\xCB\xD3\xCF\xD0\xCF\xC4\xCF\xC2\xCE\xD9\xC8\x20\xD3\xC9\xD3\xD4\xC5\xCD\xC1\xC8\x20\xDB\xC9\xD2\xCF\xCB\xCF\xC5\x20\xD0\xD2\xC9\xCD\xC5\xCE\xC5\xCE\xC9\xC5\x20\xCE\xC1\xDB\xCC\xC1\x20\xEB\xEF\xE9\x2D\x38\x29\x3B\x20\xD4\xC5\xCD\x20\xCE\xC5\x20\xCD\xC5\xCE\xC5\xC5\x20\xCE\xC1\x20\xCE\xC5\xCB\xCF\xD4\xCF\xD2\xD9\xC8\x20\xC9\xCE\xCF\xD3\xD4\xD2\xC1\xCE\xCE\xD9\xC8\x20\xD3\xC9\xD3\xD4\xC5\xCD\xC1\xC8\x20\xC4\xCC\xD1\x20\xD2\xD5\xD3\xD3\xCB\xCF\xC7\xCF\x20\xD1\xDA\xD9\xCB\xC1\x20\xD0\xCF\x20\xD5\xCD\xCF\xCC\xDE\xC1\xCE\xC9\xC0\x20\xD3\xD4\xC1\xD7\xC9\xD4\xD3\xD1\x20\x49\x53\x4F\x20\x38\x38\x35\x39\x2D\x35'
  t.is(jschardet.detect(str).encoding, 'KOI8-R')
})

test('MacCyrillic (Russian)', function (t) {
  // ISO 8859-5 широко применяется в Сербии и Болгарии на юниксоподобных системах. В России эта кодировка почти не употребляется (взамен на юниксоподобных системах широкое применение нашла КОИ-8) тем не менее на некоторых иностранных системах для русского языка по умолчанию ставится ISO 8859-5
  const str = '\x49\x53\x4F\x20\x38\x38\x35\x39\x2D\x35\x20\xF8\xE8\xF0\xEE\xEA\xEE\x20\xEF\xF0\xE8\xEC\xE5\xED\xDF\xE5\xF2\xF1\xDF\x20\xE2\x20\x91\xE5\xF0\xE1\xE8\xE8\x20\xE8\x20\x81\xEE\xEB\xE3\xE0\xF0\xE8\xE8\x20\xED\xE0\x20\xFE\xED\xE8\xEA\xF1\xEE\xEF\xEE\xE4\xEE\xE1\xED\xFB\xF5\x20\xF1\xE8\xF1\xF2\xE5\xEC\xE0\xF5\x2E\x20\x82\x20\x90\xEE\xF1\xF1\xE8\xE8\x20\xFD\xF2\xE0\x20\xEA\xEE\xE4\xE8\xF0\xEE\xE2\xEA\xE0\x20\xEF\xEE\xF7\xF2\xE8\x20\xED\xE5\x20\xF3\xEF\xEE\xF2\xF0\xE5\xE1\xEB\xDF\xE5\xF2\xF1\xDF\x20\x28\xE2\xE7\xE0\xEC\xE5\xED\x20\xED\xE0\x20\xFE\xED\xE8\xEA\xF1\xEE\xEF\xEE\xE4\xEE\xE1\xED\xFB\xF5\x20\xF1\xE8\xF1\xF2\xE5\xEC\xE0\xF5\x20\xF8\xE8\xF0\xEE\xEA\xEE\xE5\x20\xEF\xF0\xE8\xEC\xE5\xED\xE5\xED\xE8\xE5\x20\xED\xE0\xF8\xEB\xE0\x20\x8A\x8E\x88\x2D\x38\x29\x3B\x20\xF2\xE5\xEC\x20\xED\xE5\x20\xEC\xE5\xED\xE5\xE5\x20\xED\xE0\x20\xED\xE5\xEA\xEE\xF2\xEE\xF0\xFB\xF5\x20\xE8\xED\xEE\xF1\xF2\xF0\xE0\xED\xED\xFB\xF5\x20\xF1\xE8\xF1\xF2\xE5\xEC\xE0\xF5\x20\xE4\xEB\xDF\x20\xF0\xF3\xF1\xF1\xEA\xEE\xE3\xEE\x20\xDF\xE7\xFB\xEA\xE0\x20\xEF\xEE\x20\xF3\xEC\xEE\xEB\xF7\xE0\xED\xE8\xFE\x20\xF1\xF2\xE0\xE2\xE8\xF2\xF1\xDF\x20\x49\x53\x4F\x20\x38\x38\x35\x39\x2D\x35'
  t.is(jschardet.detect(str).encoding, 'MacCyrillic')
})

test('IBM855 (Russian)', function (t) {
  // ISO 8859-5 широко применяется в Сербии и Болгарии на юниксоподобных системах. В России эта кодировка почти не употребляется (взамен на юниксоподобных системах широкое применение нашла КОИ-8) тем не менее на некоторых иностранных системах для русского языка по умолчанию ставится ISO 8859-5
  const str = '\x49\x53\x4F\x20\x38\x38\x35\x39\x2D\x35\x20\xF5\xB7\xE1\xD6\xC6\xD6\x20\xD8\xE1\xB7\xD2\xA8\xD4\xDE\xA8\xE5\xE3\xDE\x20\xEB\x20\xE4\xA8\xE1\xA2\xB7\xB7\x20\xB7\x20\xA3\xD6\xD0\xAC\xA0\xE1\xB7\xB7\x20\xD4\xA0\x20\x9C\xD4\xB7\xC6\xE3\xD6\xD8\xD6\xA6\xD6\xA2\xD4\xF1\xB5\x20\xE3\xB7\xE3\xE5\xA8\xD2\xA0\xB5\x2E\x20\xEC\x20\xE2\xD6\xE3\xE3\xB7\xB7\x20\xF7\xE5\xA0\x20\xC6\xD6\xA6\xB7\xE1\xD6\xEB\xC6\xA0\x20\xD8\xD6\xFB\xE5\xB7\x20\xD4\xA8\x20\xE7\xD8\xD6\xE5\xE1\xA8\xA2\xD0\xDE\xA8\xE5\xE3\xDE\x20\x28\xEB\xF3\xA0\xD2\xA8\xD4\x20\xD4\xA0\x20\x9C\xD4\xB7\xC6\xE3\xD6\xD8\xD6\xA6\xD6\xA2\xD4\xF1\xB5\x20\xE3\xB7\xE3\xE5\xA8\xD2\xA0\xB5\x20\xF5\xB7\xE1\xD6\xC6\xD6\xA8\x20\xD8\xE1\xB7\xD2\xA8\xD4\xA8\xD4\xB7\xA8\x20\xD4\xA0\xF5\xD0\xA0\x20\xC7\xD7\xB8\x2D\x38\x29\x3B\x20\xE5\xA8\xD2\x20\xD4\xA8\x20\xD2\xA8\xD4\xA8\xA8\x20\xD4\xA0\x20\xD4\xA8\xC6\xD6\xE5\xD6\xE1\xF1\xB5\x20\xB7\xD4\xD6\xE3\xE5\xE1\xA0\xD4\xD4\xF1\xB5\x20\xE3\xB7\xE3\xE5\xA8\xD2\xA0\xB5\x20\xA6\xD0\xDE\x20\xE1\xE7\xE3\xE3\xC6\xD6\xAC\xD6\x20\xDE\xF3\xF1\xC6\xA0\x20\xD8\xD6\x20\xE7\xD2\xD6\xD0\xFB\xA0\xD4\xB7\x9C\x20\xE3\xE5\xA0\xEB\xB7\xE5\xE3\xDE\x20\x49\x53\x4F\x20\x38\x38\x35\x39\x2D\x35'
  t.is(jschardet.detect(str).encoding, 'IBM855')
})

test('IBM866 (Russian)', function (t) {
  // ISO 8859-5 широко применяется в Сербии и Болгарии на юниксоподобных системах. В России эта кодировка почти не употребляется (взамен на юниксоподобных системах широкое применение нашла КОИ-8) тем не менее на некоторых иностранных системах для русского языка по умолчанию ставится ISO 8859-5
  const str = '\x49\x53\x4F\x20\x38\x38\x35\x39\x2D\x35\x20\xE8\xA8\xE0\xAE\xAA\xAE\x20\xAF\xE0\xA8\xAC\xA5\xAD\xEF\xA5\xE2\xE1\xEF\x20\xA2\x20\x91\xA5\xE0\xA1\xA8\xA8\x20\xA8\x20\x81\xAE\xAB\xA3\xA0\xE0\xA8\xA8\x20\xAD\xA0\x20\xEE\xAD\xA8\xAA\xE1\xAE\xAF\xAE\xA4\xAE\xA1\xAD\xEB\xE5\x20\xE1\xA8\xE1\xE2\xA5\xAC\xA0\xE5\x2E\x20\x82\x20\x90\xAE\xE1\xE1\xA8\xA8\x20\xED\xE2\xA0\x20\xAA\xAE\xA4\xA8\xE0\xAE\xA2\xAA\xA0\x20\xAF\xAE\xE7\xE2\xA8\x20\xAD\xA5\x20\xE3\xAF\xAE\xE2\xE0\xA5\xA1\xAB\xEF\xA5\xE2\xE1\xEF\x20\x28\xA2\xA7\xA0\xAC\xA5\xAD\x20\xAD\xA0\x20\xEE\xAD\xA8\xAA\xE1\xAE\xAF\xAE\xA4\xAE\xA1\xAD\xEB\xE5\x20\xE1\xA8\xE1\xE2\xA5\xAC\xA0\xE5\x20\xE8\xA8\xE0\xAE\xAA\xAE\xA5\x20\xAF\xE0\xA8\xAC\xA5\xAD\xA5\xAD\xA8\xA5\x20\xAD\xA0\xE8\xAB\xA0\x20\x8A\x8E\x88\x2D\x38\x29\x3B\x20\xE2\xA5\xAC\x20\xAD\xA5\x20\xAC\xA5\xAD\xA5\xA5\x20\xAD\xA0\x20\xAD\xA5\xAA\xAE\xE2\xAE\xE0\xEB\xE5\x20\xA8\xAD\xAE\xE1\xE2\xE0\xA0\xAD\xAD\xEB\xE5\x20\xE1\xA8\xE1\xE2\xA5\xAC\xA0\xE5\x20\xA4\xAB\xEF\x20\xE0\xE3\xE1\xE1\xAA\xAE\xA3\xAE\x20\xEF\xA7\xEB\xAA\xA0\x20\xAF\xAE\x20\xE3\xAC\xAE\xAB\xE7\xA0\xAD\xA8\xEE\x20\xE1\xE2\xA0\xA2\xA8\xE2\xE1\xEF\x20\x49\x53\x4F\x20\x38\x38\x35\x39\x2D\x35'
  t.is(jschardet.detect(str).encoding, 'IBM866')
})

test.failing('EUC-CN', function (t) {
  // not really sure how to test this
  const str = ''
  t.is(jschardet.detect(str).encoding, 'EUC-CN')
})

test('EUC-KR', function (t) {
  // 화성 기후 탐사선 마스 클라이미트 오비터(사진)는 화성 궤도에 진입했으나, 우주선 제작사 록히드 마틴과 미항공우주국이 다른 단위를 써서 폭발하고 말았습니다.
  const str = '\x20\xC8\xAD\xBC\xBA\x20\xB1\xE2\xC8\xC4\x20\xC5\xBD\xBB\xE7\xBC\xB1\x20\xB8\xB6\xBD\xBA\x20\xC5\xAC\xB6\xF3\xC0\xCC\xB9\xCC\xC6\xAE\x20\xBF\xC0\xBA\xF1\xC5\xCD\x28\xBB\xE7\xC1\xF8\x29\xB4\xC2\x20\xC8\xAD\xBC\xBA\x20\xB1\xCB\xB5\xB5\xBF\xA1\x20\xC1\xF8\xC0\xD4\xC7\xDF\xC0\xB8\xB3\xAA\x2C\x20\xBF\xEC\xC1\xD6\xBC\xB1\x20\xC1\xA6\xC0\xDB\xBB\xE7\x20\xB7\xCF\xC8\xF7\xB5\xE5\x20\xB8\xB6\xC6\xBE\xB0\xFA\x20\xB9\xCC\xC7\xD7\xB0\xF8\xBF\xEC\xC1\xD6\xB1\xB9\xC0\xCC\x20\xB4\xD9\xB8\xA5\x20\xB4\xDC\xC0\xA7\xB8\xA6\x20\xBD\xE1\xBC\xAD\x20\xC6\xF8\xB9\xDF\xC7\xCF\xB0\xED\x20\xB8\xBB\xBE\xD2\xBD\xC0\xB4\xCF\xB4\xD9\x2E'
  t.is(jschardet.detect(str).encoding, 'EUC-KR')
})

test('EUC-JP', function (t) {
  // ウィキペディアはオープンコンテントの百科事典です。基本方針に賛同していただけるなら、誰でも記事を編集したり新しく作成したりできます。ガイドブックを読んでから、サンドボックスで練習してみましょう。質問は利用案内でどうぞ。
  const str = '\xA5\xA6\xA5\xA3\xA5\xAD\xA5\xDA\xA5\xC7\xA5\xA3\xA5\xA2\xA4\xCF\xA5\xAA\xA1\xBC\xA5\xD7\xA5\xF3\xA5\xB3\xA5\xF3\xA5\xC6\xA5\xF3\xA5\xC8\xA4\xCE\xC9\xB4\xB2\xCA\xBB\xF6\xC5\xB5\xA4\xC7\xA4\xB9\xA1\xA3\xB4\xF0\xCB\xDC\xCA\xFD\xBF\xCB\xA4\xCB\xBB\xBF\xC6\xB1\xA4\xB7\xA4\xC6\xA4\xA4\xA4\xBF\xA4\xC0\xA4\xB1\xA4\xEB\xA4\xCA\xA4\xE9\xA1\xA2\xC3\xAF\xA4\xC7\xA4\xE2\xB5\xAD\xBB\xF6\xA4\xF2\xCA\xD4\xBD\xB8\xA4\xB7\xA4\xBF\xA4\xEA\xBF\xB7\xA4\xB7\xA4\xAF\xBA\xEE\xC0\xAE\xA4\xB7\xA4\xBF\xA4\xEA\xA4\xC7\xA4\xAD\xA4\xDE\xA4\xB9\xA1\xA3\xA5\xAC\xA5\xA4\xA5\xC9\xA5\xD6\xA5\xC3\xA5\xAF\xA4\xF2\xC6\xC9\xA4\xF3\xA4\xC7\xA4\xAB\xA4\xE9\xA1\xA2\xA5\xB5\xA5\xF3\xA5\xC9\xA5\xDC\xA5\xC3\xA5\xAF\xA5\xB9\xA4\xC7\xCE\xFD\xBD\xAC\xA4\xB7\xA4\xC6\xA4\xDF\xA4\xDE\xA4\xB7\xA4\xE7\xA4\xA6\xA1\xA3\xBC\xC1\xCC\xE4\xA4\xCF\xCD\xF8\xCD\xD1\xB0\xC6\xC6\xE2\xA4\xC7\xA4\xC9\xA4\xA6\xA4\xBE\xA1\xA3'
  t.is(jschardet.detect(str).encoding, 'EUC-JP')
})

test('TIS-620', function (t) {
  // 'ไทย' เปลี่ยนทางมาที่นี่ สำหรับความหมายอื่น ดูที่ ไทย (แก้ความกำกวม)
  const str =  '\x22\xE4\xB7\xC2\x22\x20\xE0\xBB\xC5\xD5\xE8\xC2\xB9\xB7\xD2\xA7\xC1\xD2\xB7\xD5\xE8\xB9\xD5\xE8\x20\xCA\xD3\xCB\xC3\xD1\xBA\xA4\xC7\xD2\xC1\xCB\xC1\xD2\xC2\xCD\xD7\xE8\xB9\x20\xB4\xD9\xB7\xD5\xE8\x20\xE4\xB7\xC2\x20\x28\xE1\xA1\xE9\xA4\xC7\xD2\xC1\xA1\xD3\xA1\xC7\xC1\x29'
  t.is(jschardet.detect(str).encoding, 'TIS-620')
})

test('SHIFT_JIS', function (t) {
  // ウィキペディアはオープンコンテントの百科事典です。基本方針に賛同していただけるなら、誰でも記事を編集したり新しく作成したりできます。ガイドブックを読んでから、サンドボックスで練習してみましょう。質問は利用案内でどうぞ
  const str =  '\x83\x45\x83\x42\x83\x4C\x83\x79\x83\x66\x83\x42\x83\x41\x82\xCD\x83\x49\x81\x5B\x83\x76\x83\x93\x83\x52\x83\x93\x83\x65\x83\x93\x83\x67\x82\xCC\x95\x53\x89\xC8\x8E\x96\x93\x54\x82\xC5\x82\xB7\x81\x42\x8A\xEE\x96\x7B\x95\xFB\x90\x6A\x82\xC9\x8E\x5E\x93\xAF\x82\xB5\x82\xC4\x82\xA2\x82\xBD\x82\xBE\x82\xAF\x82\xE9\x82\xC8\x82\xE7\x81\x41\x92\x4E\x82\xC5\x82\xE0\x8B\x4C\x8E\x96\x82\xF0\x95\xD2\x8F\x57\x82\xB5\x82\xBD\x82\xE8\x90\x56\x82\xB5\x82\xAD\x8D\xEC\x90\xAC\x82\xB5\x82\xBD\x82\xE8\x82\xC5\x82\xAB\x82\xDC\x82\xB7\x81\x42\x83\x4B\x83\x43\x83\x68\x83\x75\x83\x62\x83\x4E\x82\xF0\x93\xC7\x82\xF1\x82\xC5\x82\xA9\x82\xE7\x81\x41\x83\x54\x83\x93\x83\x68\x83\x7B\x83\x62\x83\x4E\x83\x58\x82\xC5\x97\xFB\x8F\x4B\x82\xB5\x82\xC4\x82\xDD\x82\xDC\x82\xB5\x82\xE5\x82\xA4\x81\x42\x8E\xBF\x96\xE2\x82\xCD\x97\x98\x97\x70\x88\xC4\x93\xE0\x82\xC5\x82\xC7\x82\xA4\x82\xBC'
  t.is(jschardet.detect(str).encoding, 'SHIFT_JIS')
})

test('Big5', function (t) {
  // 次常用國字標準字體表
  const str = '\xA6\xB8\xB1\x60\xA5\xCE\xB0\xEA\xA6\x72\xBC\xD0\xB7\xC7\xA6\x72\xC5\xE9\xAA\xED'
  t.is(jschardet.detect(str).encoding, 'Big5')
})

test('GB2312/GB18030', function (t) {
  // 情人节为每年的2月14日，是西方的传统节日之一。这节日原来纪念两位同是名叫华伦泰的基督宗教初期教会殉道圣人。
  const str = '\xC7\xE9\xC8\xCB\xBD\xDA\xCE\xAA\xC3\xBF\xC4\xEA\xB5\xC4\x32\xD4\xC2\x31\x34\xC8\xD5\xA3\xAC\xCA\xC7\xCE\xF7\xB7\xBD\xB5\xC4\xB4\xAB\xCD\xB3\xBD\xDA\xC8\xD5\xD6\xAE\xD2\xBB\xA1\xA3\xD5\xE2\xBD\xDA\xC8\xD5\xD4\xAD\xC0\xB4\xBC\xCD\xC4\xEE\xC1\xBD\xCE\xBB\xCD\xAC\xCA\xC7\xC3\xFB\xBD\xD0\xBB\xAA\xC2\xD7\xCC\xA9\xB5\xC4\xBB\xF9\xB6\xBD\xD7\xDA\xBD\xCC\xB3\xF5\xC6\xDA\xBD\xCC\xBB\xE1\xD1\xB3\xB5\xC0\xCA\xA5\xC8\xCB\xA1\xA3'
  t.is(jschardet.detect(str).encoding, 'GB2312')
})

test('HZ-GB-2312', function (t) {
  // 情人节为每年的2月14日，是西方的传统节日之一。这节日原来纪念两位同是名叫华伦泰的基督宗教初期教会殉道圣人。
  const str = '\x7E\x7B\x47\x69\x48\x4B\x3D\x5A\x4E\x2A\x43\x3F\x44\x6A\x35\x44\x7E\x7D\x32\x7E\x7B\x54\x42\x7E\x7D\x31\x34\x7E\x7B\x48\x55\x23\x2C\x4A\x47\x4E\x77\x37\x3D\x35\x44\x34\x2B\x4D\x33\x3D\x5A\x48\x55\x56\x2E\x52\x3B\x21\x23\x55\x62\x3D\x5A\x48\x55\x54\x2D\x40\x34\x3C\x4D\x44\x6E\x41\x3D\x4E\x3B\x4D\x2C\x4A\x47\x43\x7B\x3D\x50\x3B\x2A\x42\x57\x4C\x29\x35\x44\x3B\x79\x36\x3D\x57\x5A\x3D\x4C\x33\x75\x46\x5A\x3D\x4C\x3B\x61\x51\x33\x35\x40\x4A\x25\x48\x4B\x21\x23\x7E\x7D'
  t.is(jschardet.detect(str).encoding, 'HZ-GB-2312')
})
