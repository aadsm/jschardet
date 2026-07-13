# jschardet

[![License: 0BSD](https://img.shields.io/badge/License-0BSD-blue.svg)](LICENSE) [![NPM](https://nodei.co/npm/jschardet.svg?style=shields&data=v,d&color=blue)](https://nodei.co/npm/jschardet/)

jschardet is a character encoding detector for JavaScript. Runs in Node.js and browsers with zero runtime dependencies.

jschardet 4 is a ground-up TypeScript port of [chardet 7](https://github.com/chardet/chardet). It's much faster and more accurate than jschardet 3, and a drop-in replacement for its documented API.

The API is `detect()` and `detectAll()`, returning `encoding`, `confidence`, `language`, and `mimeType`.

## Features

99.2% accuracy on 2,517 test files, up from 42.0% in jschardet 3, with ~6× the throughput and ~9× lower peak memory. Language detection for every result. MIME type detection for binary files.

| | jschardet 4.0.0 | jschardet 3.1.4 | chardet 7.4.3 (Python) |
|---|---|---|---|
| Accuracy (2,517 files) | **99.2%** | 42.0% | 99.2% |
| Speed | **945 files/s** | 154 files/s | 187 files/s |
| Language detection | **97.4%** | — | 97.4% |
| Peak memory | **84.5 MiB** | 751.4 MiB | 50.7 MiB |
| Bundle size (min / gzip) | **1,043 / 676 KiB** | 334 / 120 KiB | — |
| Cold start (import + first detect) | **80.3 ms** | 25.7 ms | 94.9 ms |
| Runs in browsers | **yes** | yes | — |
| MIME type detection | **yes** | no | yes |
| License | **0BSD** | LGPL | 0BSD |

Compared to jschardet 3, v4 has a larger bundle and a ~80 ms first-call cost. Both come from shipping a larger detection model; the model decompresses once on first `detect()` and stays in memory afterwards, so subsequent calls run at full speed.

See [docs/performance.md](docs/performance.md) for the full benchmark methodology and per-encoding accuracy.

## Installation

### npm

```bash
npm install jschardet
```

### Browser

Copy and include [jschardet.min.js](https://github.com/aadsm/jschardet/blob/main/dist/jschardet.min.js) in your page (IIFE, attaches a global `jschardet`). For ESM, use [jschardet.esm.min.js](https://github.com/aadsm/jschardet/blob/main/dist/jschardet.esm.min.js) instead. Unminified builds and source maps are in [`dist/`](https://github.com/aadsm/jschardet/tree/main/dist).

The library is also available via [jsDelivr](https://www.jsdelivr.com/package/npm/jschardet):

| Format | URL |
|--------|-----|
| IIFE (`<script src>`) | `https://cdn.jsdelivr.net/npm/jschardet` |
| ESM (`<script type="module">`) | `https://cdn.jsdelivr.net/npm/jschardet/dist/jschardet.esm.min.js` |

**Classic script tag** (after copying `jschardet.min.js` next to your HTML):

```html
<script src="jschardet.min.js"></script>
<script>
  console.log(jschardet.detect("\xc3\xa0\xc3\xad\xc3\xa0\xc3\xa7\xc3\xa3"));
</script>
```

**ESM** (after copying `jschardet.esm.min.js`):

```html
<script type="module">
  import { detect } from './jschardet.esm.min.js';
  console.log(detect("\xc3\xa0\xc3\xad\xc3\xa0\xc3\xa7\xc3\xa3"));
</script>
```

## Quick start

```js
import { detect, detectAll } from 'jschardet';

// string — ASCII
detect("Python is a great programming language for beginners and experts alike.")
// { encoding: 'ascii', confidence: 1, language: 'en', mimeType: 'text/plain' }

// Uint8Array — "The naïve approach doesn't always work in complex systems." in UTF-8
detect(new TextEncoder().encode("The naïve approach doesn't always work in complex systems."))
// { encoding: 'utf-8', confidence: 0.84, language: 'en', mimeType: 'text/plain' }

// Uint8Array — "日本語の文字コード検出テストです。" in EUC-JP
detect(new Uint8Array([
  0xc6, 0xfc, 0xcb, 0xdc, 0xb8, 0xec, 0xa4, 0xce, 0xca, 0xb8,
  0xbb, 0xfa, 0xa5, 0xb3, 0xa1, 0xbc, 0xa5, 0xc9, 0xb8, 0xa1,
  0xbd, 0xd0, 0xa5, 0xc6, 0xa5, 0xb9, 0xa5, 0xc8, 0xa4, 0xc7,
  0xa4, 0xb9, 0xa1, 0xa3,
]))
// { encoding: 'EUC-JP', confidence: 0.56, language: 'ja', mimeType: 'text/plain' }

// Buffer (Node.js) — "Le café est une boisson très populaire en France et dans le monde entier." in windows-1252
const results = detectAll(Buffer.from([
   76, 101,  32,  99,  97, 102, 233,  32, 101, 115, 116,  32, 117, 110, 101,
   32,  98, 111, 105, 115, 115, 111, 110,  32, 116, 114, 232, 115,  32, 112,
  111, 112, 117, 108,  97, 105, 114, 101,  32, 101, 110,  32,  70, 114,  97,
  110,  99, 101,  32, 101, 116,  32, 100,  97, 110, 115,  32, 108, 101,  32,
  109, 111, 110, 100, 101,  32, 101, 110, 116, 105, 101, 114,  46,
]))
for (const r of results.slice(0, 4)) {
  console.log(r.encoding, r.confidence.toFixed(2));
}
// Windows-1252 0.32
// iso8859-15 0.32
// ISO-8859-1 0.32
// MacRoman 0.31
```

## API

### `detect(buffer, options?)`

Accepts a `string`, `Uint8Array`, `ArrayBuffer`, or any `ArrayBufferView` (Node `Buffer` and `DataView` work too). Returns the best match as an object:

| Field | Type | Description |
|-------|------|-------------|
| `encoding` | `string \| null` | Detected encoding name, or `null` if unknown |
| `confidence` | `number` | Score from 0.0 to 1.0 |
| `language` | `string \| null` | Language hint when available |
| `mimeType` | `string \| null` | MIME type hint when available |

### `detectAll(buffer, options?)`

Same input types as `detect`. Returns all candidates above the confidence threshold (default **0.20**), sorted by confidence. At least one result is always returned when the built-in threshold applies.

### Options

```ts
interface IOptionsMap {
  minimumThreshold?: number;      // override default 0.20 for detectAll filtering
  detectEncodings?: string[];     // allowlist of encoding names to consider
  excludeEncodings?: string[];    // blocklist of encoding names
}
```

### `enableDebug()`

Logs full candidate lists to the console from `detect` / `detectAll` (useful when tuning thresholds or allowlists).

## CLI

```bash
jschardet somefile.txt
# somefile.txt: utf-8 with confidence 1

jschardet --minimal somefile.txt
# utf-8

# Include detected language
jschardet -l somefile.txt
# somefile.txt: utf-8 en (English) with confidence 1

# Only consider specific encodings
jschardet -i utf-8,windows-1252 somefile.txt
# somefile.txt: utf-8 with confidence 1

# Pipe from stdin
cat somefile.txt | jschardet
# stdin: utf-8 with confidence 1
```

## Supported encodings

Same [encodings](https://chardet.readthedocs.io/en/stable/supported-encodings.html#supported-encodings) as chardet (aliases and encoding-era filters are documented there).

### Modern Web

ascii, big5hkscs, cp874, cp932, cp949, euc-jis-2004, euc-kr, gb18030, hz-gb-2312, iso-2022-kr, iso2022-jp-2, iso2022-jp-2004, iso2022-jp-ext, koi8-r, koi8-u, shift_jis_2004, tis-620, utf-16, utf-16-be, utf-16-le, utf-32, utf-32-be, utf-32-le, utf-7, utf-8, utf-8-sig, windows-1250, windows-1251, windows-1252, windows-1253, windows-1254, windows-1255, windows-1256, windows-1257, windows-1258

### Legacy ISO

iso-8859-1, iso-8859-2, iso-8859-3, iso-8859-4, iso-8859-5, iso-8859-6, iso-8859-7, iso-8859-8, iso-8859-9, iso-8859-10, iso-8859-13, iso-8859-14, iso-8859-15, iso-8859-16, johab

### Legacy Mac

mac-cyrillic, mac-greek, mac-iceland, mac-latin2, mac-roman, mac-turkish

### Legacy Regional

cp1006, cp1125, cp720, hp-roman8, koi8-t, kz-1048, ptcp154

### DOS

cp437, cp737, cp775, cp850, cp852, cp855, cp856, cp857, cp858, cp860, cp861, cp862, cp863, cp864, cp865, cp866, cp869

### Mainframe (EBCDIC)

cp1026, cp1140, cp273, cp424, cp500, cp875

## chardet module

The upstream chardet API is available as-is via the `chardet` named export.
Use `UniversalDetector` for streaming detection over large files or network streams:

```js
import { chardet } from 'jschardet';
import { createReadStream } from 'node:fs';

const detector = new chardet.UniversalDetector();
for await (const chunk of createReadStream('unknown.txt')) {
  detector.feed(chunk);
  if (detector.done) break;
}
console.log(detector.close());
// { encoding: 'utf-8', confidence: 1, language: 'en', mimeType: 'text/plain' }
```

## License

[0BSD](LICENSE), same as [chardet](https://github.com/chardet/chardet/blob/main/LICENSE).
