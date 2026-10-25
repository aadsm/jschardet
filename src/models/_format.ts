// Port of chardet/src/chardet/models/_format.py — the model-artifacts file
// format. Upstream keeps the read side and the write side in one module so a
// format change cannot land on one side only; the port has no trainer, so only
// the read side crosses over. The pruning-contract read helpers
// (parse_rowmax_bin, rowmax_from_table) and the whole write side stay out with
// the rest of the rowmax carve-out — see "Statistical-scoring rowmax pruning"
// in docs/port-notes.md.

// models.bin magic: the v2 dense format. Upstream's models.bin stores the
// bigram tables zlib-compressed after this header; the port ships them already
// inflated by the .bin.js wrapper (see scripts/generate-model-bins.js), so the
// parser below slices the trailing blob directly where Python calls
// zlib.decompress on it.
export const MODELS_MAGIC = new Uint8Array([0x43, 0x4D, 0x44, 0x32]); // "CMD2"

export interface ParsedModels {
  models: Map<string, Uint8Array>;
  norms: Map<string, number>;
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

// Parse the v2 dense models.bin format into (models, norms). Mirrors chardet's
// parse_models_bin, minus the zlib.decompress: the .bin.js wrapper has already
// inflated the trailing bigram payload, so the blob is sliced from offset
// directly.
export function parseModelsBin(data: Uint8Array): ParsedModels {
  if (data.length < 4 ||
      data[0] !== MODELS_MAGIC[0] || data[1] !== MODELS_MAGIC[1] ||
      data[2] !== MODELS_MAGIC[2] || data[3] !== MODELS_MAGIC[3]) {
    throw new Error('corrupt models.bin: missing CMD2 magic');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 4;

  try {
    const numModels = view.getUint32(offset, false);
    offset += 4;
    if (numModels > 10_000) {
      throw new Error(`corrupt models.bin: num_models=${numModels} exceeds limit`);
    }

    const names: string[] = [];
    const norms = new Map<string, number>();
    for (let i = 0; i < numModels; i++) {
      const nameLen = view.getUint32(offset, false);
      offset += 4;
      if (nameLen > 256) {
        throw new Error(`corrupt models.bin: name_len=${nameLen} exceeds 256`);
      }
      let name: string;
      try {
        name = utf8Decoder.decode(data.subarray(offset, offset + nameLen));
      } catch (e) {
        throw new Error(`corrupt models.bin: ${(e as Error).message}`);
      }
      offset += nameLen;
      const norm = view.getFloat64(offset, false);
      offset += 8;
      names.push(name);
      norms.set(name, norm);
    }

    // The blob arrives raw — the wrapper has already inflated the trailing
    // bigram payload, so we slice from `offset` directly without an extra
    // zlib step (Python does zlib.decompress here on still-compressed data).
    const blob = data.subarray(offset);
    const expectedSize = numModels * 65536;
    if (blob.length !== expectedSize) {
      throw new Error(
        `corrupt models.bin: blob size ${blob.length} != expected decompressed size ${expectedSize}`,
      );
    }

    const models = new Map<string, Uint8Array>();
    for (let i = 0; i < names.length; i++) {
      const start = i * 65536;
      models.set(names[i], blob.subarray(start, start + 65536));
    }
    return { models, norms };
  } catch (e) {
    if (e instanceof RangeError) {
      throw new Error(`corrupt models.bin: ${e.message}`);
    }
    throw e;
  }
}

// langnorm.bin layout: magic, SHA-256 of the matching models.bin, then one
// big-endian float64 per model in models.bin header order: the model's L2
// norm after each weight is scaled by the square root of its bigram's IDF
// (see langnormFromTable).
export const LANGNORM_MAGIC = new Uint8Array([0x43, 0x4c, 0x4e, 0x31]); // "CLN1"
export const LANGNORM_HEADER_SIZE = 4 + 32;

// Parse langnorm.bin into per-model language-scoring norms, or null when the
// magic or size does not match. Mirrors chardet's parse_langnorm_bin minus
// its digest comparison: the embedded digest is of chardet's models.bin,
// which the port re-packs into models.bin.js, so
// scripts/generate-model-bins.js checks it against the source file instead
// and the two wrappers are only ever generated together.
export function parseLangnormBin(data: Uint8Array, modelKeys: readonly string[]): Map<string, number> | null {
  if (
    data.length !== LANGNORM_HEADER_SIZE + modelKeys.length * 8 ||
    LANGNORM_MAGIC.some((b, i) => data[i] !== b)
  ) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const norms = new Map<string, number>();
  modelKeys.forEach((key, i) => norms.set(key, view.getFloat64(LANGNORM_HEADER_SIZE + i * 8, false)));
  return norms;
}

// Derive one model's norm under the language-scoring metric. The language
// tiers compare an input profile weighted by IDF against models weighted by
// the square root of IDF, so a model's length in that space is the root of
// the sum of weight**2 * idf over its bigrams. Scoring folds the model-side
// factor into the profile and divides by this norm, so the table itself is
// never rescaled.
export function langnormFromTable(table: Uint8Array, idf: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < 65536; i++) {
    const v = table[i];
    if (v) total += v * v * idf[i];
  }
  return Math.sqrt(total);
}
