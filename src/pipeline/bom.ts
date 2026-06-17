import { startsWith } from '../utils.js';
import { DetectionResult } from './index.js';

// Ordered longest-first so UTF-32 is checked before UTF-16
// (UTF-32-LE BOM starts with the same bytes as UTF-16-LE BOM)
export const _BOMS: Array<[Uint8Array, string]> = [
  [new Uint8Array([0x00, 0x00, 0xfe, 0xff]), 'utf-32'],
  [new Uint8Array([0xff, 0xfe, 0x00, 0x00]), 'utf-32'],
  [new Uint8Array([0xef, 0xbb, 0xbf]),       'utf-8-sig'],
  [new Uint8Array([0xfe, 0xff]),             'utf-16'],
  [new Uint8Array([0xff, 0xfe]),             'utf-16'],
];

const _UTF32_BOM_LE = _BOMS[1][0];
const _UTF32_BOM_BE = _BOMS[0][0];

export function detectBom(data: Uint8Array): DetectionResult | null {
  for (const [bomBytes, encoding] of _BOMS) {
    if (!startsWith(data, bomBytes)) continue;
    // UTF-32 BOMs overlap with UTF-16 BOMs — validate payload is a multiple of 4 bytes
    if (bomBytes === _UTF32_BOM_BE || bomBytes === _UTF32_BOM_LE) {
      const payloadLen = data.length - bomBytes.length;
      if (payloadLen % 4 !== 0) continue;
    }
    return { encoding, confidence: 1.0, language: null, mimeType: null };
  }
  return null;
}
