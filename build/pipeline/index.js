export const DETERMINISTIC_CONFIDENCE = 0.95;
// Bytes considered valid ASCII text: tab (0x09), LF (0x0A), CR (0x0D), printable ASCII (0x20–0x7E)
export const ASCII_TEXT_BYTES = new Set([0x09, 0x0A, 0x0D, ...Array.from({ length: 0x5F }, (_, i) => i + 0x20)]);
// Bytes >= 0x80 — used by later stages for non-ASCII counting
export const HIGH_BYTES = new Set(Array.from({ length: 0x80 }, (_, i) => i + 0x80));
export const _NONE_RESULT = {
    encoding: null,
    confidence: 0.0,
    language: null,
    mimeType: null,
};
export class PipelineContext {
    analysisCache = new Map();
    nonAsciiCount = null;
    mbScores = new Map();
    mbCoverage = new Map();
}
//# sourceMappingURL=index.js.map