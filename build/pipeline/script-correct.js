// Port of chardet/src/chardet/pipeline/script_correct.py.
//
// Structural cross-script correction for ASCII-diluted single-byte text.
//
// When text is mostly ASCII with only a few non-ASCII bytes (e.g. a comment in
// another language inside source code), the statistical bigram score is
// dominated by the shared ASCII bigrams and the discriminating high-byte signal
// is drowned out. Every Latin single-byte model then lands in a tiny confidence
// band and the winner is effectively arbitrary — so a Cyrillic/Greek/Hebrew
// snippet frequently collapses onto a Latin encoding (typically windows-1250).
//
// The one thing the drowned signal still reveals reliably is *script*, via the
// STRUCTURE of the high bytes: Latin-script languages carry non-ASCII as
// ISOLATED diacritics inside ASCII words, while Cyrillic/Greek/Hebrew/Arabic
// carry it as RUNS (whole words are non-ASCII). This stage reads that structure
// and, only when the statistically-chosen encoding's script CONTRADICTS it,
// re-scores the candidates of the correct script on the discriminating bytes and
// promotes the winner. It never touches a top result whose script already
// matches the structure, so it cannot disturb confident/dense detections.
//
// Runs after statistical scoring in the orchestrator's _postprocessResults. Uses
// the generated ENCODING_SCRIPT map (ASCII-compatible single-byte codecs only —
// so EBCDIC and multi-byte encodings are excluded by construction).
import { BigramProfile, getIdfWeights, scoreBestLanguage } from '../models/index.js';
import { ENCODING_SCRIPT } from './_encoding-scripts.js';
// Only act in the ASCII-dilution regime: mostly ASCII, few high bytes.
const _MAX_NON_ASCII_FRACTION = 0.06;
const _MAX_HIGH_BYTES = 50;
// Need at least this many distinct high-byte bigrams to re-score on.
const _MIN_FOCUSED_BIGRAMS = 4;
// High-byte structure: isolated diacritics (< this adjacency) read as Latin;
// runs (mean run length >= this) read as a non-Latin script.
const _MAX_ISOLATED_ADJACENCY = 0.5;
const _MIN_RUN_MEAN_LENGTH = 4.0;
const _NON_LATIN_EXCLUDED = new Set(['latin', 'other']);
/** Lengths of maximal runs of consecutive bytes >= 0x80. */
export function _highByteRuns(data) {
    const runs = [];
    let current = 0;
    for (let i = 0; i < data.length; i++) {
        if (data[i] >= 0x80) {
            current += 1;
        }
        else if (current) {
            runs.push(current);
            current = 0;
        }
    }
    if (current)
        runs.push(current);
    return runs;
}
/**
 * Return [adjacency, meanRunLength] for the high bytes.
 *
 * adjacency is the fraction of high bytes that sit next to another high byte —
 * ~0 for isolated diacritics, ~1 for script runs.
 */
export function _structure(data) {
    const runs = _highByteRuns(data);
    let total = 0;
    for (const length of runs)
        total += length;
    if (!total)
        return [0.0, 0.0];
    let inRuns = 0;
    for (const length of runs)
        if (length >= 2)
            inRuns += length;
    return [inRuns / total, total / runs.length];
}
/**
 * Bigram profile over only the bigrams that touch a high byte.
 *
 * Stripping the ASCII-ASCII bigrams removes the dilution — the profile carries
 * just the discriminating signal. Returns null if there are no such bigrams.
 */
function _focusedProfile(data) {
    const idf = getIdfWeights();
    const freq = new Map();
    for (let i = 0; i < data.length - 1; i++) {
        const b1 = data[i];
        const b2 = data[i + 1];
        if (b1 < 0x80 && b2 < 0x80)
            continue;
        const idx = (b1 << 8) | b2;
        freq.set(idx, (freq.get(idx) ?? 0) + idf[idx]);
    }
    if (freq.size === 0)
        return null;
    return BigramProfile.fromWeightedFreq(freq);
}
/** Highest focused-score candidate whose script is in *keep* (or == keep). */
function _bestOfScript(data, candidates, profile, keep) {
    const pool = candidates.filter(r => {
        if (r.encoding === null)
            return false;
        const script = ENCODING_SCRIPT[r.encoding];
        if (script === undefined)
            return false;
        return keep === 'non-latin' ? !_NON_LATIN_EXCLUDED.has(script) : script === keep;
    });
    if (pool.length === 0)
        return null;
    let best = pool[0];
    let bestScore = scoreBestLanguage(data, best.encoding, profile)[0];
    for (let i = 1; i < pool.length; i++) {
        const score = scoreBestLanguage(data, pool[i].encoding, profile)[0];
        if (score > bestScore) {
            bestScore = score;
            best = pool[i];
        }
    }
    return best;
}
/**
 * Promote a correct-script candidate when the top result's script is wrong.
 *
 * Only fires in the ASCII-dilution regime, only when the top result's script
 * contradicts the byte structure, and only ever replaces the top with a
 * candidate of the structurally-indicated script. A no-op otherwise.
 *
 * @param data    The raw byte data the results were produced from.
 * @param results Detection results sorted by confidence descending.
 * @returns       The list, possibly with a corrected top result.
 */
export function correctScriptConfusion(data, results) {
    if (results.length === 0)
        return results;
    const top = results[0];
    // not an ASCII-compatible single-byte top -> leave alone
    if (top.encoding === null)
        return results;
    const topScript = ENCODING_SCRIPT[top.encoding];
    if (topScript === undefined)
        return results;
    let high = 0;
    for (let i = 0; i < data.length; i++)
        if (data[i] >= 0x80)
            high++;
    if (high === 0
        || high >= _MAX_HIGH_BYTES
        || high / data.length >= _MAX_NON_ASCII_FRACTION) {
        return results; // not the dilution regime
    }
    const profile = _focusedProfile(data);
    if (profile === null || profile.nonzero.length < _MIN_FOCUSED_BIGRAMS) {
        return results;
    }
    const [adjacency, meanRun] = _structure(data);
    let keep;
    if (adjacency < _MAX_ISOLATED_ADJACENCY) {
        if (topScript === 'latin')
            return results; // isolated + Latin top -> structure agrees
        keep = 'latin';
    }
    else if (meanRun >= _MIN_RUN_MEAN_LENGTH) {
        if (topScript !== 'latin')
            return results; // run + non-Latin top -> structure agrees
        keep = 'non-latin';
    }
    else {
        return results; // ambiguous structure -> do not touch
    }
    const best = _bestOfScript(data, results, profile, keep);
    if (best === null || best.encoding === top.encoding)
        return results;
    const promoted = {
        encoding: best.encoding,
        confidence: top.confidence,
        language: best.language,
        mimeType: best.mimeType,
    };
    const rest = results.filter(r => r !== best);
    return [promoted, ...rest];
}
//# sourceMappingURL=script-correct.js.map