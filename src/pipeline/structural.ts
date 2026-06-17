// Stage 2b: multi-byte structural probing. Port of
// chardet/src/chardet/pipeline/structural.py.
//
// Each per-encoding analyzer walks the data once and returns
// [pairRatio, mbBytes, leadDiversity]. Results are memoized in
// ctx.analysisCache so multiple public functions on the same data/encoding
// share a single pass.

import { PipelineContext } from './index.js';
import { EncodingInfo } from '../registry.js';

type Analysis = [number, number, number];
type Analyzer = (data: Uint8Array) => Analysis;

export function _analyzeShiftJis(data: Uint8Array): Analysis {
  // Lead 0x81-0x9F, 0xE0-0xEF; trail 0x40-0x7E, 0x80-0xFC.
  let leadCount = 0;
  let validCount = 0;
  let mb = 0;
  const leads = new Set<number>();
  const length = data.length;
  let i = 0;
  while (i < length) {
    const b = data[i];
    if ((b >= 0x81 && b <= 0x9F) || (b >= 0xE0 && b <= 0xEF)) {
      leadCount++;
      if (i + 1 < length) {
        const trail = data[i + 1];
        if ((trail >= 0x40 && trail <= 0x7E) || (trail >= 0x80 && trail <= 0xFC)) {
          validCount++;
          leads.add(b);
          mb += 1;
          if (trail > 0x7F) mb += 1;
          i += 2;
          continue;
        }
      }
      i += 1;
    } else {
      i += 1;
    }
  }
  const ratio = leadCount > 0 ? validCount / leadCount : 0.0;
  return [ratio, mb, leads.size];
}

export function _analyzeCp932(data: Uint8Array): Analysis {
  // Lead 0x81-0x9F, 0xE0-0xFC; trail 0x40-0x7E, 0x80-0xFC.
  // Extends Shift_JIS by raising the lead ceiling from 0xEF to 0xFC for
  // IBM/NEC vendor extensions.
  let leadCount = 0;
  let validCount = 0;
  let mb = 0;
  const leads = new Set<number>();
  const length = data.length;
  let i = 0;
  while (i < length) {
    const b = data[i];
    if ((b >= 0x81 && b <= 0x9F) || (b >= 0xE0 && b <= 0xFC)) {
      leadCount++;
      if (i + 1 < length) {
        const trail = data[i + 1];
        if ((trail >= 0x40 && trail <= 0x7E) || (trail >= 0x80 && trail <= 0xFC)) {
          validCount++;
          leads.add(b);
          mb += 1;
          if (trail > 0x7F) mb += 1;
          i += 2;
          continue;
        }
      }
      i += 1;
    } else {
      i += 1;
    }
  }
  const ratio = leadCount > 0 ? validCount / leadCount : 0.0;
  return [ratio, mb, leads.size];
}

export function _analyzeEucJp(data: Uint8Array): Analysis {
  // 2-byte: 0xA1-0xFE / 0xA1-0xFE.
  // SS2 (half-width katakana): 0x8E + 0xA1-0xDF.
  // SS3 (JIS X 0212): 0x8F + 0xA1-0xFE + 0xA1-0xFE.
  let leadCount = 0;
  let validCount = 0;
  let mb = 0;
  const leads = new Set<number>();
  const length = data.length;
  let i = 0;
  while (i < length) {
    const b = data[i];
    if (b === 0x8E) {
      leadCount++;
      if (i + 1 < length && data[i + 1] >= 0xA1 && data[i + 1] <= 0xDF) {
        validCount++;
        leads.add(b);
        mb += 2;
        i += 2;
        continue;
      }
      i += 1;
    } else if (b === 0x8F) {
      leadCount++;
      if (
        i + 2 < length &&
        data[i + 1] >= 0xA1 && data[i + 1] <= 0xFE &&
        data[i + 2] >= 0xA1 && data[i + 2] <= 0xFE
      ) {
        validCount++;
        leads.add(b);
        mb += 3;
        i += 3;
        continue;
      }
      i += 1;
    } else if (b >= 0xA1 && b <= 0xFE) {
      leadCount++;
      if (i + 1 < length && data[i + 1] >= 0xA1 && data[i + 1] <= 0xFE) {
        validCount++;
        leads.add(b);
        mb += 2;
        i += 2;
        continue;
      }
      i += 1;
    } else {
      i += 1;
    }
  }
  const ratio = leadCount > 0 ? validCount / leadCount : 0.0;
  return [ratio, mb, leads.size];
}

export function _analyzeEucKr(data: Uint8Array): Analysis {
  // Lead 0xA1-0xFE; trail 0xA1-0xFE.
  let leadCount = 0;
  let validCount = 0;
  let mb = 0;
  const leads = new Set<number>();
  const length = data.length;
  let i = 0;
  while (i < length) {
    const b = data[i];
    if (b >= 0xA1 && b <= 0xFE) {
      leadCount++;
      if (i + 1 < length && data[i + 1] >= 0xA1 && data[i + 1] <= 0xFE) {
        validCount++;
        leads.add(b);
        mb += 2;
        i += 2;
        continue;
      }
      i += 1;
    } else {
      i += 1;
    }
  }
  const ratio = leadCount > 0 ? validCount / leadCount : 0.0;
  return [ratio, mb, leads.size];
}

export function _analyzeCp949(data: Uint8Array): Analysis {
  // Lead 0x81-0xC8, 0xCA-0xFD; trail 0x41-0x5A, 0x61-0x7A, 0x81-0xFE.
  // 0xC9 is not a valid UHC lead.
  let leadCount = 0;
  let validCount = 0;
  let mb = 0;
  const leads = new Set<number>();
  const length = data.length;
  let i = 0;
  while (i < length) {
    const b = data[i];
    if ((b >= 0x81 && b <= 0xC8) || (b >= 0xCA && b <= 0xFD)) {
      leadCount++;
      if (i + 1 < length) {
        const trail = data[i + 1];
        if (
          (trail >= 0x41 && trail <= 0x5A) ||
          (trail >= 0x61 && trail <= 0x7A) ||
          (trail >= 0x81 && trail <= 0xFE)
        ) {
          validCount++;
          leads.add(b);
          mb += 1;
          if (trail > 0x7F) mb += 1;
          i += 2;
          continue;
        }
      }
      i += 1;
    } else {
      i += 1;
    }
  }
  const ratio = leadCount > 0 ? validCount / leadCount : 0.0;
  return [ratio, mb, leads.size];
}

export function _analyzeGb18030(data: Uint8Array): Analysis {
  // Strict GB2312 (0xA1-0xF7 / 0xA1-0xFE) plus GB18030 4-byte sequences.
  // The broader GBK extension range is intentionally excluded — its lead
  // 0x81-0xFE / trail 0x40-0x7E,0x80-0xFE permissiveness lets unrelated
  // single-byte data score 1.0.
  let leadCount = 0;
  let validCount = 0;
  let mb = 0;
  const leads = new Set<number>();
  const length = data.length;
  let i = 0;
  while (i < length) {
    const b = data[i];
    if (b >= 0x81 && b <= 0xFE) {
      leadCount++;
      // Try 4-byte first (byte2 in 0x30-0x39 distinguishes from 2-byte).
      if (
        i + 3 < length &&
        data[i + 1] >= 0x30 && data[i + 1] <= 0x39 &&
        data[i + 2] >= 0x81 && data[i + 2] <= 0xFE &&
        data[i + 3] >= 0x30 && data[i + 3] <= 0x39
      ) {
        validCount++;
        leads.add(b);
        mb += 2; // bytes 0 and 2 are non-ASCII
        i += 4;
        continue;
      }
      // 2-byte GB2312.
      if (
        b >= 0xA1 && b <= 0xF7 &&
        i + 1 < length &&
        data[i + 1] >= 0xA1 && data[i + 1] <= 0xFE
      ) {
        validCount++;
        leads.add(b);
        mb += 2;
        i += 2;
        continue;
      }
      i += 1;
    } else {
      i += 1;
    }
  }
  const ratio = leadCount > 0 ? validCount / leadCount : 0.0;
  return [ratio, mb, leads.size];
}

export function _analyzeBig5(data: Uint8Array): Analysis {
  // Lead 0xA1-0xF9; trail 0x40-0x7E, 0xA1-0xFE.
  let leadCount = 0;
  let validCount = 0;
  let mb = 0;
  const leads = new Set<number>();
  const length = data.length;
  let i = 0;
  while (i < length) {
    const b = data[i];
    if (b >= 0xA1 && b <= 0xF9) {
      leadCount++;
      if (i + 1 < length) {
        const trail = data[i + 1];
        if ((trail >= 0x40 && trail <= 0x7E) || (trail >= 0xA1 && trail <= 0xFE)) {
          validCount++;
          leads.add(b);
          mb += 1;
          if (trail > 0x7F) mb += 1;
          i += 2;
          continue;
        }
      }
      i += 1;
    } else {
      i += 1;
    }
  }
  const ratio = leadCount > 0 ? validCount / leadCount : 0.0;
  return [ratio, mb, leads.size];
}

export function _analyzeBig5hkscs(data: Uint8Array): Analysis {
  // Lead 0x87-0xFE; trail 0x40-0x7E, 0xA1-0xFE.
  let leadCount = 0;
  let validCount = 0;
  let mb = 0;
  const leads = new Set<number>();
  const length = data.length;
  let i = 0;
  while (i < length) {
    const b = data[i];
    if (b >= 0x87 && b <= 0xFE) {
      leadCount++;
      if (i + 1 < length) {
        const trail = data[i + 1];
        if ((trail >= 0x40 && trail <= 0x7E) || (trail >= 0xA1 && trail <= 0xFE)) {
          validCount++;
          leads.add(b);
          mb += 1;
          if (trail > 0x7F) mb += 1;
          i += 2;
          continue;
        }
      }
      i += 1;
    } else {
      i += 1;
    }
  }
  const ratio = leadCount > 0 ? validCount / leadCount : 0.0;
  return [ratio, mb, leads.size];
}

export function _analyzeJohab(data: Uint8Array): Analysis {
  // Lead 0x84-0xD3, 0xD8-0xDE, 0xE0-0xF9; trail 0x31-0x7E, 0x91-0xFE.
  let leadCount = 0;
  let validCount = 0;
  let mb = 0;
  const leads = new Set<number>();
  const length = data.length;
  let i = 0;
  while (i < length) {
    const b = data[i];
    if (
      (b >= 0x84 && b <= 0xD3) ||
      (b >= 0xD8 && b <= 0xDE) ||
      (b >= 0xE0 && b <= 0xF9)
    ) {
      leadCount++;
      if (i + 1 < length) {
        const trail = data[i + 1];
        if ((trail >= 0x31 && trail <= 0x7E) || (trail >= 0x91 && trail <= 0xFE)) {
          validCount++;
          leads.add(b);
          if (b > 0x7F) mb += 1;
          if (trail > 0x7F) mb += 1;
          i += 2;
          continue;
        }
      }
      i += 1;
    } else {
      i += 1;
    }
  }
  const ratio = leadCount > 0 ? validCount / leadCount : 0.0;
  return [ratio, mb, leads.size];
}

const _ANALYZERS: Record<string, Analyzer> = {
  shift_jis_2004: _analyzeShiftJis,
  cp932: _analyzeCp932,
  euc_jis_2004: _analyzeEucJp,
  euc_kr: _analyzeEucKr,
  cp949: _analyzeCp949,
  gb18030: _analyzeGb18030,
  big5hkscs: _analyzeBig5hkscs,
  johab: _analyzeJohab,
};

function _getAnalysis(
  data: Uint8Array,
  name: string,
  ctx: PipelineContext,
): Analysis | null {
  const cached = ctx.analysisCache.get(name);
  if (cached !== undefined) return cached;
  const analyzer = _ANALYZERS[name];
  if (analyzer === undefined) return null;
  const result = analyzer(data);
  ctx.analysisCache.set(name, result);
  return result;
}

export function computeStructuralScore(
  data: Uint8Array,
  encodingInfo: EncodingInfo,
  ctx: PipelineContext,
): number {
  if (data.length === 0 || !encodingInfo.isMultibyte) return 0.0;
  const result = _getAnalysis(data, encodingInfo.name, ctx);
  if (result === null) return 0.0;
  return result[0];
}

export function computeMultibyteByteCoverage(
  data: Uint8Array,
  encodingInfo: EncodingInfo,
  ctx: PipelineContext,
  nonAsciiCount?: number,
): number {
  if (data.length === 0 || !encodingInfo.isMultibyte) return 0.0;
  const result = _getAnalysis(data, encodingInfo.name, ctx);
  if (result === null) return 0.0;
  const mbBytes = result[1];

  let nonAscii: number;
  if (nonAsciiCount !== undefined) {
    nonAscii = nonAsciiCount;
  } else {
    nonAscii = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] >= 0x80) nonAscii++;
    }
  }
  if (nonAscii === 0) return 0.0;
  return mbBytes / nonAscii;
}

export function computeLeadByteDiversity(
  data: Uint8Array,
  encodingInfo: EncodingInfo,
  ctx: PipelineContext,
): number {
  if (data.length === 0 || !encodingInfo.isMultibyte) return 0;
  const result = _getAnalysis(data, encodingInfo.name, ctx);
  if (result === null) return 256; // Unknown encoding -- don't gate.
  return result[2];
}
