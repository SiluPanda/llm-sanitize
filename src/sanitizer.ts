import { PIIEntityType, PIIConfidence, PIIEntity, SanitizedInput, SanitizedOutput, InputSanitizeOptions, OutputSanitizeOptions, Sanitizer } from './types';
import { DEFAULT_PATTERNS, detectEntities } from './detectors';
import { buildPlaceholderMap, applyRedaction, restorePlaceholders } from './redact';
import { checkProfanity, checkPIILeakage } from './output-checks';

function buildSummary(entities: PIIEntity[]): Partial<Record<PIIEntityType, number>> {
    const summary: Partial<Record<PIIEntityType, number>> = {};
    for (const entity of entities) {
        summary[entity.type] = (summary[entity.type] ?? 0) + 1;
    }
    return summary;
}

export function sanitizeInput(text: string, options?: InputSanitizeOptions): SanitizedInput {
    const start = Date.now();
    const patterns = DEFAULT_PATTERNS.filter((p) => !options?.entities || options.entities.includes(p.type));
    // Build custom patterns if provided
    // Bug Fix: Preserve the user's custom entity type instead of always using 'custom'
    const customPatterns = (options?.customEntities ?? []).map((ce) => ({
        type: (ce.type || 'custom') as PIIEntityType,
        regex: ce.pattern,
        confidence: ce.confidence ?? 'medium' as PIIConfidence,
    }));
    const allPatterns = [...patterns, ...customPatterns];
    const entities = detectEntities(text, allPatterns, options?.sensitivity ?? 'medium');
    const placeholderMap = buildPlaceholderMap();
    const { text: sanitized, updatedMap } = applyRedaction(text, entities, options?.strategy ?? 'placeholder', placeholderMap);
    return {
        text: sanitized,
        entities,
        placeholderMap: updatedMap,
        summary: buildSummary(entities),
        durationMs: Date.now() - start,
    };
}

export function sanitizeOutput(text: string, options?: OutputSanitizeOptions): SanitizedOutput {
    const start = Date.now();
    const violations = [];
    if (options?.profanity) {
        violations.push(...checkProfanity(text));
    }
    if (options?.piiLeakage !== false) {
        violations.push(...checkPIILeakage(text));
    }
    let finalText = text;
    let placeholdersRestored = 0;
    if (options?.deanonymize && options?.placeholderMap) {
        const { text: restored, count } = restorePlaceholders(text, options.placeholderMap);
        finalText = restored;
        placeholdersRestored = count;
    }
    return {
        text: finalText,
        action: violations.length > 0 ? 'warn' : 'pass',
        violations,
        deanonymized: placeholdersRestored > 0,
        placeholdersRestored,
        durationMs: Date.now() - start,
    };
}

export function detectPII(text: string, options?: Pick<InputSanitizeOptions, 'entities' | 'sensitivity'>): PIIEntity[] {
    const patterns = DEFAULT_PATTERNS.filter((p) => !options?.entities || options.entities.includes(p.type));
    return detectEntities(text, patterns, options?.sensitivity ?? 'medium');
}

export function createSanitizer(defaults?: InputSanitizeOptions): Sanitizer {
    return {
        sanitizeInput(text: string, options?: InputSanitizeOptions): SanitizedInput {
            return sanitizeInput(text, { ...defaults, ...options });
        },
        sanitizeOutput(text: string, options?: OutputSanitizeOptions): SanitizedOutput {
            return sanitizeOutput(text, options);
        },
        detectPII(text: string, options?: Pick<InputSanitizeOptions, 'entities' | 'sensitivity'>): PIIEntity[] {
            return detectPII(text, { entities: defaults?.entities, sensitivity: defaults?.sensitivity, ...options });
        },
    };
}
