import { createHash } from 'crypto';
import { PIIEntity, PlaceholderMap, RedactionStrategy } from './types';

export function buildPlaceholderMap(): PlaceholderMap {
    return { entries: {}, counters: {} };
}

export function applyRedaction(
    text: string,
    entities: PIIEntity[],
    strategy: RedactionStrategy,
    placeholderMap: PlaceholderMap,
): { text: string; updatedMap: PlaceholderMap } {
    // Process from last to first to preserve offsets
    const sorted = [...entities].sort((a, b) => b.start - a.start);
    const map: PlaceholderMap = {
        entries: { ...placeholderMap.entries },
        counters: { ...placeholderMap.counters },
    };
    let result = text;
    for (const entity of sorted) {
        let replacement: string;
        if (strategy === 'placeholder') {
            const key = entity.type.toUpperCase();
            map.counters[key] = (map.counters[key] ?? 0) + 1;
            const tag = `[${key}_${map.counters[key]}]`;
            map.entries[tag] = entity.value;
            replacement = tag;
        }
        else if (strategy === 'mask') {
            replacement = '*'.repeat(entity.value.length);
        }
        else if (strategy === 'hash') {
            replacement = createHash('sha256').update(entity.value).digest('hex').substring(0, 8);
        }
        else {
            // remove
            replacement = '';
        }
        result = result.substring(0, entity.start) + replacement + result.substring(entity.end);
    }
    return { text: result, updatedMap: map };
}

export function restorePlaceholders(text: string, placeholderMap: PlaceholderMap): { text: string; count: number } {
    let result = text;
    let count = 0;
    const placeholderRegex = /\[[A-Za-z\-]+_\d+\]/g;
    const matches: Array<{ tag: string; index: number }> = [];
    let match: RegExpExecArray | null;
    while ((match = placeholderRegex.exec(text)) !== null) {
        matches.push({ tag: match[0], index: match.index });
    }
    // Replace from last to first to preserve offsets
    for (let i = matches.length - 1; i >= 0; i--) {
        const { tag, index } = matches[i];
        // Bug Fix: Case-insensitive placeholder restoration
        // LLMs may return [Email_1] instead of [EMAIL_1]
        const original = placeholderMap.entries[tag] ??
            Object.entries(placeholderMap.entries).find(([k]) => k.toLowerCase() === tag.toLowerCase())?.[1];
        if (original !== undefined) {
            result = result.substring(0, index) + original + result.substring(index + tag.length);
            count++;
        }
    }
    return { text: result, count };
}
