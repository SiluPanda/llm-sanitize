import { describe, it, expect } from 'vitest';
import { buildPlaceholderMap, applyRedaction, restorePlaceholders } from '../redact';
import { PIIEntityType } from '../types';

const makeEntity = (type: PIIEntityType, value: string, start: number) => ({
  type,
  value,
  start,
  end: start + value.length,
  confidence: 'high' as const,
});

describe('buildPlaceholderMap', () => {
  it('returns empty entries and counters', () => {
    const map = buildPlaceholderMap();
    expect(map.entries).toEqual({});
    expect(map.counters).toEqual({});
  });
});

describe('placeholder strategy', () => {
  it('replaces entity with [TYPE_1] placeholder', () => {
    const text = 'Email is alice@example.com here';
    const entity = makeEntity('email', 'alice@example.com', 9);
    const map = buildPlaceholderMap();
    const { text: result, updatedMap } = applyRedaction(text, [entity], 'placeholder', map);
    expect(result).toBe('Email is [EMAIL_1] here');
    expect(updatedMap.entries['[EMAIL_1]']).toBe('alice@example.com');
    expect(updatedMap.counters['EMAIL']).toBe(1);
  });

  it('increments counter for same type', () => {
    const text = 'a@b.com and c@d.com';
    const entities = [
      makeEntity('email', 'a@b.com', 0),
      makeEntity('email', 'c@d.com', 12),
    ];
    const map = buildPlaceholderMap();
    const { updatedMap } = applyRedaction(text, entities, 'placeholder', map);
    expect(updatedMap.counters['EMAIL']).toBe(2);
    // Entities are processed last-to-first to preserve offsets, so c@d.com (index 12) gets _1
    expect(updatedMap.entries['[EMAIL_1]']).toBe('c@d.com');
    expect(updatedMap.entries['[EMAIL_2]']).toBe('a@b.com');
  });
});

describe('mask strategy', () => {
  it('replaces entity value with asterisks of same length', () => {
    const text = 'Email: alice@example.com';
    const entity = makeEntity('email', 'alice@example.com', 7);
    const map = buildPlaceholderMap();
    const { text: result } = applyRedaction(text, [entity], 'mask', map);
    expect(result).toBe('Email: ' + '*'.repeat('alice@example.com'.length));
  });
});

describe('hash strategy', () => {
  it('replaces entity with 8-char hex string', () => {
    const text = 'Email: alice@example.com';
    const entity = makeEntity('email', 'alice@example.com', 7);
    const map = buildPlaceholderMap();
    const { text: result } = applyRedaction(text, [entity], 'hash', map);
    const replaced = result.substring(7);
    expect(replaced).toHaveLength(8);
    expect(replaced).toMatch(/^[0-9a-f]{8}$/);
  });

  it('produces consistent hash for same value', () => {
    const entity = makeEntity('email', 'alice@example.com', 7);
    const map = buildPlaceholderMap();
    const { text: r1 } = applyRedaction('Email: alice@example.com', [entity], 'hash', map);
    const { text: r2 } = applyRedaction('Email: alice@example.com', [entity], 'hash', map);
    expect(r1).toBe(r2);
  });
});

describe('remove strategy', () => {
  it('removes the entity value entirely', () => {
    const text = 'Call 555-867-5309 now';
    const entity = makeEntity('phone', '555-867-5309', 5);
    const map = buildPlaceholderMap();
    const { text: result } = applyRedaction(text, [entity], 'remove', map);
    expect(result).toBe('Call  now');
  });
});

describe('restorePlaceholders', () => {
  it('restores a single placeholder', () => {
    const map = buildPlaceholderMap();
    map.entries['[EMAIL_1]'] = 'alice@example.com';
    const { text, count } = restorePlaceholders('Contact [EMAIL_1] please', map);
    expect(text).toBe('Contact alice@example.com please');
    expect(count).toBe(1);
  });

  it('restores multiple placeholders', () => {
    const map = buildPlaceholderMap();
    map.entries['[EMAIL_1]'] = 'alice@example.com';
    map.entries['[PHONE_1]'] = '555-867-5309';
    const { text, count } = restorePlaceholders('[EMAIL_1] or [PHONE_1]', map);
    expect(text).toBe('alice@example.com or 555-867-5309');
    expect(count).toBe(2);
  });

  it('returns count 0 when no matching placeholders', () => {
    const map = buildPlaceholderMap();
    const { text, count } = restorePlaceholders('No placeholders here', map);
    expect(text).toBe('No placeholders here');
    expect(count).toBe(0);
  });

  it('ignores unknown placeholder tags', () => {
    const map = buildPlaceholderMap();
    map.entries['[EMAIL_1]'] = 'alice@example.com';
    const { text, count } = restorePlaceholders('[EMAIL_1] and [UNKNOWN_9]', map);
    expect(text).toBe('alice@example.com and [UNKNOWN_9]');
    expect(count).toBe(1);
  });
});

describe('case-insensitive placeholder restoration', () => {
  it('restores placeholders with different case', () => {
    const map = buildPlaceholderMap();
    map.entries['[EMAIL_1]'] = 'alice@example.com';
    const { text, count } = restorePlaceholders('Contact [email_1] please', map);
    expect(text).toBe('Contact alice@example.com please');
    expect(count).toBe(1);
  });
});
