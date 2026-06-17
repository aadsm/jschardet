export const DETERMINISTIC_CONFIDENCE = 0.95;

// Bytes considered valid ASCII text: tab (0x09), LF (0x0A), CR (0x0D), printable ASCII (0x20–0x7E)
export const ASCII_TEXT_BYTES: Set<number> = new Set(
  [0x09, 0x0A, 0x0D, ...Array.from({ length: 0x5F }, (_, i) => i + 0x20)]
);

// Bytes >= 0x80 — used by later stages for non-ASCII counting
export const HIGH_BYTES: Set<number> = new Set(
  Array.from({ length: 0x80 }, (_, i) => i + 0x80)
);

export interface DetectionResult {
  encoding: string | null;
  confidence: number;
  language: string | null;
  mimeType: string | null;
}

export const _NONE_RESULT: DetectionResult = {
  encoding: null,
  confidence: 0.0,
  language: null,
  mimeType: null,
};

export class PipelineContext {
  analysisCache: Map<string, [number, number, number]> = new Map();
  nonAsciiCount: number | null = null;
  mbScores: Map<string, number> = new Map();
  mbCoverage: Map<string, number> = new Map();
}
