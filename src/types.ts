export type PIIEntityType = 'email' | 'phone' | 'ssn' | 'credit-card' | 'ip-address' | 'date-of-birth' | 'name' | 'custom';
export type PIIConfidence = 'low' | 'medium' | 'high';
export type RedactionStrategy = 'placeholder' | 'mask' | 'hash' | 'remove';

export interface PIIEntity {
    type: PIIEntityType;
    value: string;
    start: number;
    end: number;
    confidence: PIIConfidence;
    placeholder?: string;
}

export interface PlaceholderMap {
    entries: Record<string, string>;
    counters: Record<string, number>;
}

export interface SanitizedInput {
    text: string;
    entities: PIIEntity[];
    placeholderMap: PlaceholderMap;
    summary: Partial<Record<PIIEntityType, number>>;
    durationMs: number;
}

export interface ContentViolation {
    category: 'profanity' | 'pii-leakage';
    severity: 'low' | 'medium' | 'high';
    matchedText: string;
    start: number;
    end: number;
}

export interface SanitizedOutput {
    text: string;
    action: 'pass' | 'warn';
    violations: ContentViolation[];
    deanonymized: boolean;
    placeholdersRestored: number;
    durationMs: number;
}

export interface InputSanitizeOptions {
    entities?: PIIEntityType[];
    strategy?: RedactionStrategy;
    customEntities?: Array<{
        type: string;
        pattern: RegExp;
        placeholder: string;
        confidence?: PIIConfidence;
    }>;
    sensitivity?: 'low' | 'medium' | 'high';
}

export interface OutputSanitizeOptions {
    piiLeakage?: boolean;
    profanity?: boolean;
    placeholderMap?: PlaceholderMap;
    deanonymize?: boolean;
}

export interface Sanitizer {
    sanitizeInput(text: string, options?: InputSanitizeOptions): SanitizedInput;
    sanitizeOutput(text: string, options?: OutputSanitizeOptions): SanitizedOutput;
    detectPII(text: string, options?: Pick<InputSanitizeOptions, 'entities' | 'sensitivity'>): PIIEntity[];
}
