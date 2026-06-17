// Test utilities — port of chardet/scripts/utils.py (accuracy-test subset).

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as iconv from 'iconv-lite';
import { lookupEncoding } from '../src/registry.js';
import { ISO_TO_LANGUAGE } from '../src/utils.js';
import {
  ensureTestData,
} from '../scripts/lib/test-data.js';

// Repo root resolved from this file's location (tests/ → repo root).
const _REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');

// Inverted ISO_TO_LANGUAGE: English name → ISO code.
const _LANGUAGE_NAME_TO_ISO: Record<string, string> = {};
for (const [iso, name] of Object.entries(ISO_TO_LANGUAGE)) {
  _LANGUAGE_NAME_TO_ISO[name] = iso;
}
// "scottish gaelic" is the full form; ISO_TO_LANGUAGE maps gd → "gaelic".
_LANGUAGE_NAME_TO_ISO['scottish gaelic'] = 'gd';

/**
 * Returns the test data directory, cloning from GitHub if needed.
 * Caches the clone in tests/data/ and reuses it on subsequent runs.
 */
export function getDataDir(): string {
  const localData = path.join(_REPO_ROOT, 'tests', 'data');
  ensureTestData(localData, path.join(_REPO_ROOT, 'tests'));
  return localData;
}

/**
 * Collects [encoding, language, absoluteFilePath] tuples from the test data dir.
 * Directory format: "{encoding}-{lang_iso}" e.g. "utf-8-en", "None-None".
 */
export function collectTestFiles(
  dataDir: string,
): Array<[string | null, string | null, string]> {
  const result: Array<[string | null, string | null, string]> = [];
  const dirs = fs.readdirSync(dataDir).sort();
  for (const dirName of dirs) {
    const dirPath = path.join(dataDir, dirName);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    const dashIdx = dirName.lastIndexOf('-');
    if (dashIdx === -1) continue;
    const encPart = dirName.slice(0, dashIdx);
    const langPart = dirName.slice(dashIdx + 1);
    const encoding: string | null = encPart === 'None' ? null : encPart;
    const language: string | null = langPart === 'None' ? null : langPart;
    const files = fs.readdirSync(dirPath).sort();
    for (const file of files) {
      const fp = path.join(dirPath, file);
      if (fs.statSync(fp).isFile()) {
        result.push([encoding, language, fp]);
      }
    }
  }
  return result;
}

/**
 * Normalizes a detected language string to an ISO 639-1 code.
 * Handles both ISO codes (chardet 7+) and English names.
 */
export function normalizeLanguage(detected: string | null): string | null {
  if (!detected) return null;
  const lowered = detected.toLowerCase().replace(/—$/, '');
  return _LANGUAGE_NAME_TO_ISO[lowered] ?? lowered;
}

// Pre-computed symbol pairs where one is functionally equivalent to the other.
const _EQUIVALENT_SYMBOL_PAIRS: ReadonlySet<string> = new Set(['¤€', '€¤']);

function _charsEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  if (_EQUIVALENT_SYMBOL_PAIRS.has(a + b)) return true;
  const strip = (s: string): string => s.normalize('NFKD').replace(/\p{M}/gu, '');
  return strip(a) === strip(b);
}

/**
 * Port of Python's chardet.equivalences.is_equivalent_detection().
 *
 * Checks whether decoding data with detected produces functionally identical
 * text to decoding with expected. Uses iconv-lite, which covers all encodings
 * Python's codec library handles (DOS code pages, HP-Roman8, etc.).
 *
 * Only available in Node.js — see the stub in src/equivalences.ts for why
 * this cannot live there.
 */
export function isEquivalentDetection(
  data: Uint8Array,
  expected: string | null,
  detected: string | null,
): boolean {
  if (expected === null) return detected === null;
  if (detected === null) return false;

  const normExp = lookupEncoding(expected) ?? expected.toLowerCase();
  const normDet = lookupEncoding(detected) ?? detected.toLowerCase();
  if (normExp === normDet) return true;

  if (!iconv.encodingExists(normExp) || !iconv.encodingExists(normDet)) return false;

  try {
    const buf = Buffer.from(data);
    const textExp = iconv.decode(buf, normExp);
    const textDet = iconv.decode(buf, normDet);
    if (textExp === textDet) return true;
    if (textExp.length !== textDet.length) return false;
    for (let i = 0; i < textExp.length; i++) {
      if (!_charsEquivalent(textExp[i], textDet[i])) return false;
    }
    return true;
  } catch {
    return false;
  }
}
