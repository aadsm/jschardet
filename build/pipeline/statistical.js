// Stage 3: statistical bigram scoring. Port of
// chardet/src/chardet/pipeline/statistical.py.
import { BigramProfile, scoreBestLanguage } from '../models/index.js';
export function scoreCandidates(data, candidates) {
    if (data.length === 0 || candidates.length === 0)
        return [];
    const profile = new BigramProfile(data);
    const scores = [];
    for (const enc of candidates) {
        const [s, lang] = scoreBestLanguage(data, enc.name, profile);
        if (s > 0.0)
            scores.push({ name: enc.name, confidence: s, language: lang });
    }
    scores.sort((a, b) => b.confidence - a.confidence);
    return scores.map(({ name, confidence, language }) => ({
        encoding: name,
        confidence,
        language,
        mimeType: null,
    }));
}
//# sourceMappingURL=statistical.js.map