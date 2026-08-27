// Stage 2a: byte sequence validity filtering. Port of
// chardet/src/chardet/pipeline/validity.py — filter_by_validity.
import { SBCS_UNDEFINED_BYTES } from '../sbcs-undefined-bytes.js';
import { decodesWithoutError, whatwgLabelFor } from '../text-decoder.js';
export function filterByValidity(data, candidates) {
    if (data.length === 0)
        return candidates;
    const valid = [];
    for (const enc of candidates) {
        // The build-time-extracted undefined-byte set is derived from
        // Python's strict codec behaviour and is authoritative for the SBCS it
        // covers. Consult it before TextDecoder so windows-125x (and other SBCS
        // with WHATWG labels) match Python instead of WHATWG's permissive
        // pass-through of undefined C1 positions.
        const undefSet = SBCS_UNDEFINED_BYTES[enc.name];
        if (undefSet !== undefined) {
            let bad = false;
            for (let i = 0; i < data.length; i++) {
                if (undefSet.has(data[i])) {
                    bad = true;
                    break;
                }
            }
            if (!bad)
                valid.push(enc);
            continue;
        }
        const label = whatwgLabelFor(enc.name);
        if (label === null) {
            // No WHATWG label and no SBCS table entry (multibyte without WHATWG,
            // or dense SBCS with no gaps): keep as a candidate.
            valid.push(enc);
            continue;
        }
        if (decodesWithoutError(label, data)) {
            valid.push(enc);
        }
    }
    return valid;
}
//# sourceMappingURL=validity.js.map