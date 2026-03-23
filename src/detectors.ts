import { PIIEntityType, PIIConfidence, PIIEntity } from './types';

interface PIIPattern {
    type: PIIEntityType;
    regex: RegExp;
    confidence: PIIConfidence;
    validate?: (match: string) => boolean;
}

const EMAIL: PIIPattern = {
    type: 'email',
    regex: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
    confidence: 'high',
};

const PHONE: PIIPattern = {
    type: 'phone',
    regex: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    confidence: 'high',
};

const SSN: PIIPattern = {
    type: 'ssn',
    regex: /\b(?!000|666|9\d{2})\d{3}[-\s]?(?!00)\d{2}[-\s]?(?!0000)\d{4}\b/g,
    confidence: 'high',
    validate: (match: string): boolean => {
        const digits = match.replace(/[-\s]/g, '');
        const area = parseInt(digits.substring(0, 3));
        return area !== 0 && area !== 666 && area < 900;
    },
};

const CREDIT_CARD: PIIPattern = {
    type: 'credit-card',
    regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    confidence: 'high',
    validate: (match: string): boolean => luhnCheck(match.replace(/[-\s]/g, '')),
};

const IP_ADDRESS: PIIPattern = {
    type: 'ip-address',
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    confidence: 'high',
};

const DATE_OF_BIRTH: PIIPattern = {
    type: 'date-of-birth',
    regex: /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/g,
    confidence: 'low',
};

const NAME: PIIPattern = {
    type: 'name',
    regex: /\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)+\b/g,
    confidence: 'low',
};

export const DEFAULT_PATTERNS: PIIPattern[] = [
    EMAIL,
    PHONE,
    SSN,
    CREDIT_CARD,
    IP_ADDRESS,
    DATE_OF_BIRTH,
    NAME,
];

function luhnCheck(cardNumber: string): boolean {
    let sum = 0;
    let isEven = false;
    for (let i = cardNumber.length - 1; i >= 0; i--) {
        let digit = parseInt(cardNumber[i]);
        if (isEven) {
            digit *= 2;
            if (digit > 9)
                digit -= 9;
        }
        sum += digit;
        isEven = !isEven;
    }
    return sum % 10 === 0;
}

const DOB_CONTEXT_CUES = ['born', 'dob', 'birthday', 'date of birth', 'birth date', 'birthdate', 'd.o.b'];
const NAME_CONTEXT_CUES = ['name', 'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'dear', 'from:', 'to:', 'signed'];

function boostConfidence(matchIndex: number, text: string, contextCues: string[], windowSize = 50): boolean {
    const start = Math.max(0, matchIndex - windowSize);
    const end = Math.min(text.length, matchIndex + windowSize);
    const window = text.substring(start, end).toLowerCase();
    return contextCues.some((cue) => window.includes(cue));
}

const CONFIDENCE_ORDER: Record<PIIConfidence, number> = { low: 0, medium: 1, high: 2 };

function confidencePassesSensitivity(confidence: PIIConfidence, sensitivity: 'low' | 'medium' | 'high'): boolean {
    // low sensitivity: only high confidence
    // medium sensitivity: medium and high
    // high sensitivity: all
    if (sensitivity === 'low')
        return confidence === 'high';
    if (sensitivity === 'medium')
        return confidence === 'medium' || confidence === 'high';
    return true;
}

function deduplicateOverlaps(entities: PIIEntity[]): PIIEntity[] {
    const sorted = [...entities].sort((a, b) => a.start - b.start || CONFIDENCE_ORDER[b.confidence] - CONFIDENCE_ORDER[a.confidence]);
    const result: PIIEntity[] = [];
    let lastEnd = -1;
    for (const entity of sorted) {
        if (entity.start >= lastEnd) {
            result.push(entity);
            lastEnd = entity.end;
        }
        else {
            // Overlaps with previous; keep the one with higher confidence
            const prev = result[result.length - 1];
            if (CONFIDENCE_ORDER[entity.confidence] > CONFIDENCE_ORDER[prev.confidence]) {
                result[result.length - 1] = entity;
                lastEnd = entity.end;
            }
        }
    }
    return result;
}

export function detectEntities(text: string, patterns: PIIPattern[], sensitivity: 'low' | 'medium' | 'high' = 'medium'): PIIEntity[] {
    const found: PIIEntity[] = [];
    for (const pattern of patterns) {
        const regex = new RegExp(pattern.regex.source, pattern.regex.flags.includes('g') ? pattern.regex.flags : pattern.regex.flags + 'g');
        let match: RegExpExecArray | null;
        regex.lastIndex = 0;
        while ((match = regex.exec(text)) !== null) {
            const value = match[0];
            if (pattern.validate && !pattern.validate(value)) {
                continue;
            }
            let confidence: PIIConfidence = pattern.confidence;
            // Boost confidence for context-dependent types
            if (pattern.type === 'date-of-birth') {
                if (boostConfidence(match.index, text, DOB_CONTEXT_CUES)) {
                    confidence = 'high';
                }
            }
            else if (pattern.type === 'name') {
                if (boostConfidence(match.index, text, NAME_CONTEXT_CUES)) {
                    confidence = 'medium';
                }
            }
            if (!confidencePassesSensitivity(confidence, sensitivity)) {
                continue;
            }
            found.push({
                type: pattern.type,
                value,
                start: match.index,
                end: match.index + value.length,
                confidence,
            });
        }
    }
    // Sort by start, then deduplicate overlaps
    found.sort((a, b) => a.start - b.start);
    return deduplicateOverlaps(found);
}
