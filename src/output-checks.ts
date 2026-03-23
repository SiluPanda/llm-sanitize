import { PIIEntity, ContentViolation } from './types';
import { detectEntities, DEFAULT_PATTERNS } from './detectors';

const PROFANITY_LIST: Array<{ word: string; severity: 'low' | 'medium' | 'high' }> = [
    { word: 'damn', severity: 'low' },
    { word: 'crap', severity: 'low' },
    { word: 'hell', severity: 'low' },
    { word: 'ass', severity: 'low' },
    { word: 'bastard', severity: 'medium' },
    { word: 'shit', severity: 'high' },
    { word: 'fuck', severity: 'high' },
    { word: 'bitch', severity: 'high' },
    { word: 'piss', severity: 'medium' },
    { word: 'dick', severity: 'medium' },
];

export function checkProfanity(text: string): ContentViolation[] {
    const violations: ContentViolation[] = [];
    for (const entry of PROFANITY_LIST) {
        const regex = new RegExp(`\\b${entry.word}\\b`, 'gi');
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            violations.push({
                category: 'profanity',
                severity: entry.severity,
                matchedText: match[0],
                start: match.index,
                end: match.index + match[0].length,
            });
        }
    }
    return violations;
}

export function checkPIILeakage(text: string, inputEntities?: PIIEntity[]): ContentViolation[] {
    const found = detectEntities(text, DEFAULT_PATTERNS, 'medium');
    let toReport: PIIEntity[];
    if (inputEntities && inputEntities.length > 0) {
        const inputValues = new Set(inputEntities.map((e) => e.value));
        toReport = found.filter((e) => !inputValues.has(e.value));
    }
    else {
        toReport = found;
    }
    return toReport.map((entity) => ({
        category: 'pii-leakage' as const,
        severity: 'high' as const,
        matchedText: entity.value,
        start: entity.start,
        end: entity.end,
    }));
}
