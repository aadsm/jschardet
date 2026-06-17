import { detectMagic } from '../src/pipeline/magic.js';

/** Mirrors Python's _make_zip_local_entry: builds a minimal ZIP local file header. */
function makeZipLocalEntry(filename: Uint8Array, content: Uint8Array = new Uint8Array(0)): Uint8Array {
  const headerSize = 30;
  const buf = new Uint8Array(headerSize + filename.length + content.length);
  const view = new DataView(buf.buffer);
  // PK\x03\x04
  buf[0] = 0x50; buf[1] = 0x4b; buf[2] = 0x03; buf[3] = 0x04;
  view.setUint16(4,  20,              true); // version needed
  view.setUint16(6,  0,               true); // flags
  view.setUint16(8,  0,               true); // compression (store)
  view.setUint16(10, 0,               true); // mod time
  view.setUint16(12, 0,               true); // mod date
  view.setUint32(14, 0,               true); // crc32
  view.setUint32(18, content.length,  true); // compressed size
  view.setUint32(22, content.length,  true); // uncompressed size
  view.setUint16(26, filename.length, true); // filename length
  view.setUint16(28, 0,               true); // extra field length
  buf.set(filename, headerSize);
  buf.set(content, headerSize + filename.length);
  return buf;
}

function enc(s: string): Uint8Array { return new TextEncoder().encode(s); }
function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}
function zeros(n: number): Uint8Array { return new Uint8Array(n); }

describe('detectMagic — known formats', () => {
  const cases: Array<[Uint8Array, string]> = [
    // Images
    [concat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), zeros(8)), 'image/png'],
    [concat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), zeros(8)), 'image/jpeg'],
    [concat(new Uint8Array([0xff, 0xd8, 0xff, 0xe1]), zeros(8)), 'image/jpeg'],
    [concat(enc('GIF87a'), zeros(8)), 'image/gif'],
    [concat(enc('GIF89a'), zeros(8)), 'image/gif'],
    [new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]), 'image/webp'],
    [concat(new Uint8Array([0x42, 0x4d]), zeros(12)), 'image/bmp'],
    [concat(new Uint8Array([0x4d, 0x4d, 0x00, 0x2a]), zeros(8)), 'image/tiff'],
    [concat(new Uint8Array([0x49, 0x49, 0x2a, 0x00]), zeros(8)), 'image/tiff'],
    [concat(enc('8BPS'), zeros(8)), 'image/vnd.adobe.photoshop'],
    [concat(enc('qoif'), zeros(8)), 'image/qoi'],
    [concat(new Uint8Array([0x00, 0x00, 0x01, 0x00]), zeros(8)), 'image/vnd.microsoft.icon'],
    // JPEG XL container
    [concat(new Uint8Array([0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]), zeros(8)), 'image/jxl'],
    // JPEG XL codestream
    [concat(new Uint8Array([0xff, 0x0a]), zeros(8)), 'image/jxl'],
    // ftyp images
    [concat(new Uint8Array([0x00, 0x00, 0x00, 0x1c]), enc('ftyp'), enc('avif'), zeros(16)), 'image/avif'],
    [concat(new Uint8Array([0x00, 0x00, 0x00, 0x1c]), enc('ftyp'), enc('heic'), zeros(16)), 'image/heic'],
    [concat(new Uint8Array([0x00, 0x00, 0x00, 0x1c]), enc('ftyp'), enc('heix'), zeros(16)), 'image/heic'],
    [concat(new Uint8Array([0x00, 0x00, 0x00, 0x1c]), enc('ftyp'), enc('mif1'), zeros(16)), 'image/heif'],
    // Audio/Video
    [concat(enc('ID3'), zeros(10)), 'audio/mpeg'],
    [concat(enc('MThd'), zeros(10)), 'audio/midi'],
    [concat(new Uint8Array([0x00, 0x00, 0x00, 0x1c]), enc('ftypMSNV'), zeros(16)), 'video/mp4'],
    [concat(new Uint8Array([0x00, 0x00, 0x00, 0x18]), enc('ftypisom'), zeros(12)), 'video/mp4'],
    [concat(new Uint8Array([0x00, 0x00, 0x00, 0x18]), enc('ftypmp42'), zeros(12)), 'video/mp4'],
    [concat(new Uint8Array([0x00, 0x00, 0x00, 0x20]), enc('ftypM4A '), zeros(20)), 'audio/mp4'],
    [concat(new Uint8Array([0x00, 0x00, 0x00, 0x14]), enc('ftypqt  '), zeros(8)), 'video/quicktime'],
    [concat(enc('OggS'), zeros(10)), 'audio/ogg'],
    [concat(enc('fLaC'), zeros(10)), 'audio/flac'],
    [new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]), 'audio/wav'],
    [new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20]), 'video/x-msvideo'],
    [new Uint8Array([0x46, 0x4f, 0x52, 0x4d, 0x00, 0x00, 0x00, 0x00, 0x41, 0x49, 0x46, 0x46]), 'audio/aiff'],
    [new Uint8Array([0x46, 0x4f, 0x52, 0x4d, 0x00, 0x00, 0x00, 0x00, 0x41, 0x49, 0x46, 0x43]), 'audio/aiff'],
    [concat(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), zeros(8)), 'video/webm'],
    // Archives
    [concat(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), zeros(8)), 'application/zip'],
    [concat(new Uint8Array([0x1f, 0x8b]), zeros(10)), 'application/gzip'],
    [concat(enc('BZh'), zeros(10)), 'application/x-bzip2'],
    [concat(new Uint8Array([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]), zeros(8)), 'application/x-xz'],
    [concat(new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), zeros(8)), 'application/x-7z-compressed'],
    [concat(new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]), zeros(8)), 'application/vnd.rar'],
    [concat(new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]), zeros(8)), 'application/vnd.rar'],
    [concat(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]), zeros(8)), 'application/zstd'],
    // TAR at offset 257
    [concat(zeros(257), new Uint8Array([0x75, 0x73, 0x74, 0x61, 0x72, 0x00]), zeros(8)), 'application/x-tar'],
    [concat(zeros(257), new Uint8Array([0x75, 0x73, 0x74, 0x61, 0x72, 0x20]), zeros(8)), 'application/x-tar'],
    // Documents
    [concat(enc('%PDF-'), zeros(8)), 'application/pdf'],
    [concat(enc('SQLite format 3\x00'), zeros(8)), 'application/x-sqlite3'],
    [concat(enc('ARROW1'), zeros(8)), 'application/vnd.apache.arrow.file'],
    [concat(enc('PAR1'), zeros(8)), 'application/vnd.apache.parquet'],
    [concat(new Uint8Array([0x00]), enc('asm'), zeros(8)), 'application/wasm'],
    // Executables
    [concat(enc('dex\n'), zeros(8)), 'application/vnd.android.dex'],
    [concat(new Uint8Array([0x7f]), enc('ELF'), zeros(8)), 'application/x-elf'],
    [concat(new Uint8Array([0xfe, 0xed, 0xfa, 0xce]), zeros(8)), 'application/x-mach-binary'],
    [concat(new Uint8Array([0xfe, 0xed, 0xfa, 0xcf]), zeros(8)), 'application/x-mach-binary'],
    [concat(new Uint8Array([0xce, 0xfa, 0xed, 0xfe]), zeros(8)), 'application/x-mach-binary'],
    [concat(new Uint8Array([0xcf, 0xfa, 0xed, 0xfe]), zeros(8)), 'application/x-mach-binary'],
    [concat(enc('MZ'), zeros(12)), 'application/vnd.microsoft.portable-executable'],
    // Fonts
    [concat(enc('wOFF'), zeros(8)), 'font/woff'],
    [concat(enc('wOF2'), zeros(8)), 'font/woff2'],
    [concat(enc('OTTO'), zeros(8)), 'font/otf'],
    [concat(new Uint8Array([0x00, 0x01, 0x00, 0x00]), zeros(8)), 'font/ttf'],
  ];

  test.each(cases)('detects %s as %s', (data, expected) => {
    const result = detectMagic(data);
    expect(result).not.toBeNull();
    expect(result!.encoding).toBeNull();
    expect(result!.confidence).toBe(1.0);
    expect(result!.language).toBeNull();
    expect(result!.mimeType).toBe(expected);
  });
});

describe('detectMagic — edge cases', () => {
  test('no match', () => {
    expect(detectMagic(enc('Hello, world! This is plain text.'))).toBeNull();
  });

  test('empty input', () => {
    expect(detectMagic(new Uint8Array([]))).toBeNull();
  });

  test('truncated PNG signature', () => {
    expect(detectMagic(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull();
  });

  test('TAR too short', () => {
    expect(detectMagic(concat(zeros(200), enc('ustar\x00')))).toBeNull();
  });

  test('cafebabe Java class (major version >= 45)', () => {
    // Java 11 = major version 55 (0x0037)
    const data = concat(new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x37]), zeros(8));
    const result = detectMagic(data);
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe('application/java-vm');
  });

  test('cafebabe Mach-O fat binary (small nfat_arch)', () => {
    const data = concat(new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x02]), zeros(8));
    const result = detectMagic(data);
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe('application/x-mach-binary');
  });

  test('ftyp text false positive rejected', () => {
    expect(detectMagic(enc('The ftypeface was bold and strong'))).toBeNull();
  });

  test('ftyp ASCII prefix rejected (box_size >> data length)', () => {
    expect(detectMagic(concat(enc('abcdftypisom'), zeros(4)))).toBeNull();
  });
});

describe('detectMagic — ZIP subtype detection', () => {
  test('XLSX detected', () => {
    const data = concat(
      makeZipLocalEntry(enc('[Content_Types].xml')),
      makeZipLocalEntry(enc('xl/workbook.xml'))
    );
    expect(detectMagic(data)!.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  });

  test('DOCX detected', () => {
    const data = concat(
      makeZipLocalEntry(enc('[Content_Types].xml')),
      makeZipLocalEntry(enc('word/document.xml'))
    );
    expect(detectMagic(data)!.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
  });

  test('PPTX detected', () => {
    const data = concat(
      makeZipLocalEntry(enc('[Content_Types].xml')),
      makeZipLocalEntry(enc('ppt/presentation.xml'))
    );
    expect(detectMagic(data)!.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    );
  });

  test('OOXML with _rels first', () => {
    const data = concat(
      makeZipLocalEntry(enc('_rels/.rels')),
      makeZipLocalEntry(enc('[Content_Types].xml')),
      makeZipLocalEntry(enc('xl/workbook.xml'))
    );
    expect(detectMagic(data)!.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  });

  test('JAR detected', () => {
    const data = makeZipLocalEntry(enc('META-INF/MANIFEST.MF'), enc('Manifest-Version: 1.0\r\n'));
    expect(detectMagic(data)!.mimeType).toBe('application/java-archive');
  });

  test('APK detected', () => {
    const data = makeZipLocalEntry(enc('AndroidManifest.xml'), zeros(20));
    expect(detectMagic(data)!.mimeType).toBe('application/vnd.android.package-archive');
  });

  test('EPUB via mimetype entry', () => {
    const data = concat(
      makeZipLocalEntry(enc('mimetype'), enc('application/epub+zip')),
      makeZipLocalEntry(enc('META-INF/container.xml'))
    );
    expect(detectMagic(data)!.mimeType).toBe('application/epub+zip');
  });

  test('EPUB via container.xml', () => {
    const data = makeZipLocalEntry(enc('META-INF/container.xml'));
    expect(detectMagic(data)!.mimeType).toBe('application/epub+zip');
  });

  test('Python wheel detected', () => {
    const data = makeZipLocalEntry(enc('chardet-7.0.0.dist-info/WHEEL'), enc('Wheel-Version: 1.0\r\n'));
    expect(detectMagic(data)!.mimeType).toBe('application/x-wheel+zip');
  });

  test('Python wheel via METADATA', () => {
    const data = makeZipLocalEntry(enc('chardet-7.0.0.dist-info/METADATA'), enc('Name: chardet\r\n'));
    expect(detectMagic(data)!.mimeType).toBe('application/x-wheel+zip');
  });

  test('ODT detected', () => {
    const data = makeZipLocalEntry(enc('mimetype'), enc('application/vnd.oasis.opendocument.text'));
    expect(detectMagic(data)!.mimeType).toBe('application/vnd.oasis.opendocument.text');
  });

  test('ODS detected', () => {
    const data = makeZipLocalEntry(enc('mimetype'), enc('application/vnd.oasis.opendocument.spreadsheet'));
    expect(detectMagic(data)!.mimeType).toBe('application/vnd.oasis.opendocument.spreadsheet');
  });

  test('ODP detected', () => {
    const data = makeZipLocalEntry(enc('mimetype'), enc('application/vnd.oasis.opendocument.presentation'));
    expect(detectMagic(data)!.mimeType).toBe('application/vnd.oasis.opendocument.presentation');
  });

  test('ODG detected', () => {
    const data = makeZipLocalEntry(enc('mimetype'), enc('application/vnd.oasis.opendocument.graphics'));
    expect(detectMagic(data)!.mimeType).toBe('application/vnd.oasis.opendocument.graphics');
  });

  test('PK inside file content not misclassified', () => {
    const fakeHeader = makeZipLocalEntry(enc('xl/workbook.xml'));
    const data = makeZipLocalEntry(enc('data.bin'), fakeHeader);
    expect(detectMagic(data)!.mimeType).toBe('application/zip');
  });

  test('plain ZIP fallback', () => {
    const data = makeZipLocalEntry(enc('readme.txt'), enc('hello'));
    expect(detectMagic(data)!.mimeType).toBe('application/zip');
  });

  test('ZIP with non-matching entries', () => {
    const data = concat(
      makeZipLocalEntry(enc('readme.txt'), enc('hello')),
      makeZipLocalEntry(enc('data.csv'), enc('a,b,c'))
    );
    expect(detectMagic(data)!.mimeType).toBe('application/zip');
  });

  test('truncated ZIP is still ZIP', () => {
    const data = concat(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), zeros(8));
    expect(detectMagic(data)!.mimeType).toBe('application/zip');
  });

  test('ZIP entry name truncated', () => {
    // Header claiming 100-byte filename, only 5 bytes provided
    const buf = new Uint8Array(30 + 5);
    const view = new DataView(buf.buffer);
    buf[0] = 0x50; buf[1] = 0x4b; buf[2] = 0x03; buf[3] = 0x04;
    view.setUint16(4, 20, true);
    view.setUint16(26, 100, true); // name_len = 100
    buf.set(enc('xl/wo'), 30);
    expect(detectMagic(buf)!.mimeType).toBe('application/zip');
  });
});
