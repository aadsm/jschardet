import { findBytes, startsWith } from '../utils.js';
import { DetectionResult } from './index.js';

// (prefix_bytes, mime_type) — longest prefix first to avoid shorter prefixes
// shadowing longer ones. All entries match at offset 0.
// Formats with sub-type logic (ftyp, RIFF, FORM, ZIP) are handled separately.
const _MAGIC_NUMBERS: Array<[Uint8Array, string]> = [
  // Images
  [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
  [new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]), 'image/gif'],
  [new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), 'image/gif'],
  [new Uint8Array([0x4d, 0x4d, 0x00, 0x2a]), 'image/tiff'],
  [new Uint8Array([0x49, 0x49, 0x2a, 0x00]), 'image/tiff'],
  [new Uint8Array([0x38, 0x42, 0x50, 0x53]), 'image/vnd.adobe.photoshop'],
  [new Uint8Array([0x71, 0x6f, 0x69, 0x66]), 'image/qoi'],
  [new Uint8Array([0x42, 0x4d]),             'image/bmp'],
  [new Uint8Array([0xff, 0xd8, 0xff]),       'image/jpeg'],
  // JPEG XL: 12-byte container signature (must precede the 2-byte codestream)
  [new Uint8Array([0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]), 'image/jxl'],
  // JPEG XL: 2-byte codestream signature
  [new Uint8Array([0xff, 0x0a]), 'image/jxl'],
  [new Uint8Array([0x00, 0x00, 0x01, 0x00]), 'image/vnd.microsoft.icon'],
  // Audio/Video
  [new Uint8Array([0x49, 0x44, 0x33]),                   'audio/mpeg'],
  [new Uint8Array([0x4d, 0x54, 0x68, 0x64]),             'audio/midi'],
  [new Uint8Array([0x4f, 0x67, 0x67, 0x53]),             'audio/ogg'],
  [new Uint8Array([0x66, 0x4c, 0x61, 0x43]),             'audio/flac'],
  [new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),             'video/webm'],
  // Archives (ZIP handled separately below for subtype detection)
  [new Uint8Array([0x1f, 0x8b]),                         'application/gzip'],
  [new Uint8Array([0x42, 0x5a, 0x68]),                   'application/x-bzip2'],
  [new Uint8Array([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]), 'application/x-xz'],
  [new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), 'application/x-7z-compressed'],
  [new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]), 'application/vnd.rar'],
  [new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]),       'application/vnd.rar'],
  [new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]),             'application/zstd'],
  // Documents / Data
  [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),       'application/pdf'],
  [new Uint8Array([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00]), 'application/x-sqlite3'],
  [new Uint8Array([0x41, 0x52, 0x52, 0x4f, 0x57, 0x31]), 'application/vnd.apache.arrow.file'],
  [new Uint8Array([0x50, 0x41, 0x52, 0x31]),             'application/vnd.apache.parquet'],
  [new Uint8Array([0x00, 0x61, 0x73, 0x6d]),             'application/wasm'],
  // Executables / Bytecode (cafebabe handled separately)
  [new Uint8Array([0x64, 0x65, 0x78, 0x0a]),             'application/vnd.android.dex'],
  [new Uint8Array([0x7f, 0x45, 0x4c, 0x46]),             'application/x-elf'],
  [new Uint8Array([0xfe, 0xed, 0xfa, 0xce]),             'application/x-mach-binary'],
  [new Uint8Array([0xfe, 0xed, 0xfa, 0xcf]),             'application/x-mach-binary'],
  [new Uint8Array([0xce, 0xfa, 0xed, 0xfe]),             'application/x-mach-binary'],
  [new Uint8Array([0xcf, 0xfa, 0xed, 0xfe]),             'application/x-mach-binary'],
  [new Uint8Array([0x4d, 0x5a]),                         'application/vnd.microsoft.portable-executable'],
  // Fonts
  [new Uint8Array([0x77, 0x4f, 0x46, 0x46]), 'font/woff'],
  [new Uint8Array([0x77, 0x4f, 0x46, 0x32]), 'font/woff2'],
  [new Uint8Array([0x4f, 0x54, 0x54, 0x4f]), 'font/otf'],
  [new Uint8Array([0x00, 0x01, 0x00, 0x00]), 'font/ttf'],
];

const _TAR_OFFSET = 257;
const _TAR_SIG_0 = new Uint8Array([0x75, 0x73, 0x74, 0x61, 0x72, 0x00]); // "ustar\0"
const _TAR_SIG_1 = new Uint8Array([0x75, 0x73, 0x74, 0x61, 0x72, 0x20]); // "ustar "

const _RIFF_SUBTYPES = new Map<number, string>([
  // "WEBP" = 0x57454250, "WAVE" = 0x57415645, "AVI " = 0x41564920
  [0x57454250, 'image/webp'],
  [0x57415645, 'audio/wav'],
  [0x41564920, 'video/x-msvideo'],
]);

const _FORM_SUBTYPES = new Map<number, string>([
  // "AIFF" = 0x41494646, "AIFC" = 0x41494643
  [0x41494646, 'audio/aiff'],
  [0x41494643, 'audio/aiff'],
]);

const _ZIP_SIGNATURE = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const _ZIP_SCAN_LIMIT = 4096;

const _ZIP_FILENAME_PREFIXES: Array<[Uint8Array, string]> = [
  [new TextEncoder().encode('xl/'),       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  [new TextEncoder().encode('word/'),     'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  [new TextEncoder().encode('ppt/'),      'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  [new TextEncoder().encode('META-INF/MANIFEST.MF'), 'application/java-archive'],
  [new TextEncoder().encode('AndroidManifest.xml'),  'application/vnd.android.package-archive'],
  [new TextEncoder().encode('META-INF/container.xml'), 'application/epub+zip'],
];

const _ZIP_FILENAME_SUFFIXES: Array<[Uint8Array, string]> = [
  [new TextEncoder().encode('.dist-info/'), 'application/x-wheel+zip'],
];

const _OPENDOCUMENT_MIMES = new Set([
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.graphics',
]);

const _FTYP_MARKER = new Uint8Array([0x66, 0x74, 0x79, 0x70]); // "ftyp"
const _FTYP_OFFSET = 4;
const _FTYP_AVIF_BRANDS   = new Set([[0x61, 0x76, 0x69, 0x66], [0x61, 0x76, 0x69, 0x73]].map(b => b.join(',')));
const _FTYP_HEIC_BRANDS   = new Set([[0x68, 0x65, 0x69, 0x63], [0x68, 0x65, 0x69, 0x78]].map(b => b.join(',')));
const _FTYP_HEIF_BRANDS   = new Set([[0x6d, 0x69, 0x66, 0x31], [0x6d, 0x73, 0x66, 0x31]].map(b => b.join(',')));
const _FTYP_AUDIO_BRANDS  = new Set([[0x4d, 0x34, 0x41, 0x20], [0x4d, 0x34, 0x42, 0x20], [0x46, 0x34, 0x41, 0x20]].map(b => b.join(',')));
const _FTYP_QT_BRANDS     = new Set([[0x71, 0x74, 0x20, 0x20]].map(b => b.join(',')));

const _CAFEBABE = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);
const _CAFEBABE_MAX_FAT_ARCHES = 20;

function _brandKey(data: Uint8Array, offset: number): string {
  return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]].join(',');
}

function _readUint32BE(data: Uint8Array, offset: number): number {
  // Replaces Python int.from_bytes(data[a:b], 'big')
  return new DataView(data.buffer, data.byteOffset).getUint32(offset, false);
}

function _readUint16LE(data: Uint8Array, offset: number): number {
  // Replaces Python int.from_bytes(data[a:b], 'little')
  return new DataView(data.buffer, data.byteOffset).getUint16(offset, true);
}

function _readUint32LE(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset).getUint32(offset, true);
}

function _classifyZip(data: Uint8Array): string {
  const scan = data.subarray(0, _ZIP_SCAN_LIMIT);
  let offset = 0;
  while (true) {
    const idx = findBytes(scan, _ZIP_SIGNATURE, offset);
    if (idx === -1 || scan.length < idx + 30) break;
    const nameLen   = _readUint16LE(scan, idx + 26);
    const extraLen  = _readUint16LE(scan, idx + 28);
    const nameStart = idx + 30;
    if (scan.length < nameStart + nameLen) break;
    const name = scan.subarray(nameStart, nameStart + nameLen);
    // Check filename prefixes
    for (const [prefix, mime] of _ZIP_FILENAME_PREFIXES) {
      if (startsWith(name, prefix)) return mime;
    }
    // Check filename suffixes
    for (const [suffix, mime] of _ZIP_FILENAME_SUFFIXES) {
      if (findBytes(name, suffix) !== -1) return mime;
    }
    // OpenDocument: "mimetype" entry with uncompressed content
    const mimetypeBytes = new TextEncoder().encode('mimetype');
    if (name.length === mimetypeBytes.length && startsWith(name, mimetypeBytes)) {
      const compression = _readUint16LE(scan, idx + 8);
      if (compression === 0) { // stored (uncompressed)
        const contentStart = nameStart + nameLen + extraLen;
        const contentLen   = _readUint32LE(scan, idx + 22);
        if (scan.length >= contentStart + contentLen) {
          const content = scan.subarray(contentStart, contentStart + contentLen);
          const contentStr = new TextDecoder('ascii', { fatal: false }).decode(content);
          if (_OPENDOCUMENT_MIMES.has(contentStr)) return contentStr;
        }
      }
    }
    const flags = _readUint16LE(scan, idx + 6);
    const contentSize = (flags & 0x0008) ? 0 : _readUint32LE(scan, idx + 18);
    offset = nameStart + nameLen + extraLen + contentSize;
  }
  return 'application/zip';
}

function _makeResult(mime: string): DetectionResult {
  return { encoding: null, confidence: 1.0, language: null, mimeType: mime };
}

export function detectMagic(data: Uint8Array): DetectionResult | null {
  if (data.length === 0) return null;

  // Check ftyp box (MP4/MOV/HEIC/AVIF) — "ftyp" at offset 4
  if (data.length >= 12 && startsWith(data.subarray(_FTYP_OFFSET), _FTYP_MARKER)) {
    const boxSize = _readUint32BE(data, 0);
    if (boxSize >= 8 && boxSize <= data.length) {
      const brand = _brandKey(data, 8);
      if (_FTYP_AVIF_BRANDS.has(brand))  return _makeResult('image/avif');
      if (_FTYP_HEIC_BRANDS.has(brand))  return _makeResult('image/heic');
      if (_FTYP_HEIF_BRANDS.has(brand))  return _makeResult('image/heif');
      if (_FTYP_AUDIO_BRANDS.has(brand)) return _makeResult('audio/mp4');
      if (_FTYP_QT_BRANDS.has(brand))    return _makeResult('video/quicktime');
      return _makeResult('video/mp4');
    }
  }

  // RIFF container — check subtype at bytes 8–11
  if (data.length >= 12 && startsWith(data, new Uint8Array([0x52, 0x49, 0x46, 0x46]))) {
    const key = _readUint32BE(data, 8);
    const mime = _RIFF_SUBTYPES.get(key);
    if (mime !== undefined) return _makeResult(mime);
  }

  // FORM container (AIFF)
  if (data.length >= 12 && startsWith(data, new Uint8Array([0x46, 0x4f, 0x52, 0x4d]))) {
    const key = _readUint32BE(data, 8);
    const mime = _FORM_SUBTYPES.get(key);
    if (mime !== undefined) return _makeResult(mime);
  }

  // ZIP-based format detection
  if (startsWith(data, _ZIP_SIGNATURE)) {
    return _makeResult(_classifyZip(data));
  }

  // Java class file vs Mach-O fat binary (both \xca\xfe\xba\xbe)
  if (data.length >= 8 && startsWith(data, _CAFEBABE)) {
    const nfatArch = _readUint32BE(data, 4);
    if (nfatArch <= _CAFEBABE_MAX_FAT_ARCHES) return _makeResult('application/x-mach-binary');
    return _makeResult('application/java-vm');
  }

  // Fixed-offset magic numbers (all at offset 0)
  for (const [prefix, mime] of _MAGIC_NUMBERS) {
    if (startsWith(data, prefix)) return _makeResult(mime);
  }

  // TAR archive — "ustar" at offset 257
  if (data.length >= _TAR_OFFSET + 6) {
    const tarSig = data.subarray(_TAR_OFFSET, _TAR_OFFSET + 6);
    if (startsWith(tarSig, _TAR_SIG_0) || startsWith(tarSig, _TAR_SIG_1)) {
      return _makeResult('application/x-tar');
    }
  }

  return null;
}
