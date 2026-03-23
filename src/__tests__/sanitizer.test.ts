import { describe, it, expect } from 'vitest';
import { sanitizeInput, sanitizeOutput, detectPII, createSanitizer } from '../sanitizer';

describe('sanitizeInput', () => {
  it('detects and replaces an email with placeholder', () => {
    const result = sanitizeInput('Please email alice@example.com for help.');
    expect(result.text).toContain('[EMAIL_1]');
    expect(result.text).not.toContain('alice@example.com');
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].type).toBe('email');
    expect(result.summary.email).toBe(1);
    expect(result.placeholderMap.entries['[EMAIL_1]']).toBe('alice@example.com');
  });

  it('uses mask strategy when specified', () => {
    const result = sanitizeInput('Email: alice@example.com', { strategy: 'mask' });
    expect(result.text).not.toContain('alice@example.com');
    expect(result.text).toContain('*');
    expect(Object.keys(result.placeholderMap.entries)).toHaveLength(0);
  });

  it('uses remove strategy', () => {
    const result = sanitizeInput('Email: alice@example.com end', { strategy: 'remove' });
    expect(result.text).toBe('Email:  end');
  });

  it('uses hash strategy', () => {
    const result = sanitizeInput('Email: alice@example.com', { strategy: 'hash' });
    expect(result.text).toMatch(/Email: [0-9a-f]{8}/);
  });

  it('filters by entity type', () => {
    const text = 'Email alice@example.com or call 555-867-5309';
    const result = sanitizeInput(text, { entities: ['email'] });
    expect(result.text).toContain('[EMAIL_1]');
    expect(result.text).toContain('555-867-5309');
    expect(result.entities.every((e) => e.type === 'email')).toBe(true);
  });

  it('handles multiple PIIs', () => {
    const text = 'Email: a@b.com, Phone: 555-867-5309, SSN: 123-45-6789';
    const result = sanitizeInput(text);
    expect(result.entities.length).toBeGreaterThanOrEqual(3);
    expect(result.summary.email).toBe(1);
    expect(result.summary.phone).toBe(1);
    expect(result.summary.ssn).toBe(1);
  });

  it('returns durationMs as non-negative number', () => {
    const result = sanitizeInput('hello');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns empty entities for clean text', () => {
    const result = sanitizeInput('Hello, how are you today?');
    expect(result.entities).toHaveLength(0);
    expect(result.text).toBe('Hello, how are you today?');
  });
});

describe('sanitizeOutput', () => {
  it('passes clean output', () => {
    const result = sanitizeOutput('Here is your summary.');
    expect(result.action).toBe('pass');
    expect(result.violations).toHaveLength(0);
    expect(result.deanonymized).toBe(false);
  });

  it('warns on PII leakage in output', () => {
    const result = sanitizeOutput('The user email is alice@example.com.');
    expect(result.action).toBe('warn');
    const piiViolations = result.violations.filter((v) => v.category === 'pii-leakage');
    expect(piiViolations.length).toBeGreaterThan(0);
    expect(piiViolations[0].matchedText).toBe('alice@example.com');
  });

  it('detects profanity when enabled', () => {
    const result = sanitizeOutput('What the hell is going on?', { profanity: true });
    expect(result.action).toBe('warn');
    const profViolations = result.violations.filter((v) => v.category === 'profanity');
    expect(profViolations.length).toBeGreaterThan(0);
    expect(profViolations[0].severity).toBe('low');
  });

  it('does not detect profanity when disabled (default)', () => {
    const result = sanitizeOutput('What the hell is going on?');
    const profViolations = result.violations.filter((v) => v.category === 'profanity');
    expect(profViolations).toHaveLength(0);
  });

  it('de-anonymizes with placeholderMap', () => {
    const inputResult = sanitizeInput('Email me at alice@example.com please.');
    // Manually craft the output to contain the placeholder
    const outputText = 'Got your message at [EMAIL_1], will respond soon.';
    const result = sanitizeOutput(outputText, {
      placeholderMap: inputResult.placeholderMap,
      deanonymize: true,
      piiLeakage: false,
    });
    expect(result.text).toBe('Got your message at alice@example.com, will respond soon.');
    expect(result.placeholdersRestored).toBe(1);
    expect(result.deanonymized).toBe(true);
  });

  it('does not de-anonymize when deanonymize is false', () => {
    const inputResult = sanitizeInput('Email me at alice@example.com.');
    const result = sanitizeOutput('[EMAIL_1] is the address', {
      placeholderMap: inputResult.placeholderMap,
      deanonymize: false,
      piiLeakage: false,
    });
    expect(result.text).toBe('[EMAIL_1] is the address');
    expect(result.placeholdersRestored).toBe(0);
  });
});

describe('detectPII', () => {
  it('detects PII in text', () => {
    const entities = detectPII('alice@example.com and 192.168.1.1');
    const emails = entities.filter((e) => e.type === 'email');
    const ips = entities.filter((e) => e.type === 'ip-address');
    expect(emails).toHaveLength(1);
    expect(ips).toHaveLength(1);
  });

  it('respects entity filter', () => {
    const entities = detectPII('alice@example.com and 192.168.1.1', { entities: ['email'] });
    expect(entities.every((e) => e.type === 'email')).toBe(true);
  });

  it('returns empty array for clean text', () => {
    const entities = detectPII('No sensitive data here.');
    expect(entities).toHaveLength(0);
  });
});

describe('createSanitizer', () => {
  it('creates a sanitizer with default options', () => {
    const sanitizer = createSanitizer({ strategy: 'mask' });
    const result = sanitizer.sanitizeInput('Email: alice@example.com');
    expect(result.text).toContain('*');
  });

  it('allows overriding defaults per call', () => {
    const sanitizer = createSanitizer({ strategy: 'mask' });
    const result = sanitizer.sanitizeInput('Email: alice@example.com', { strategy: 'remove' });
    expect(result.text).toBe('Email: ');
  });

  it('sanitizeOutput delegates correctly', () => {
    const sanitizer = createSanitizer();
    const result = sanitizer.sanitizeOutput('Clean output.');
    expect(result.action).toBe('pass');
  });

  it('detectPII delegates correctly', () => {
    const sanitizer = createSanitizer();
    const entities = sanitizer.detectPII('alice@example.com');
    expect(entities).toHaveLength(1);
    expect(entities[0].type).toBe('email');
  });
});

describe('custom entity type preservation', () => {
  it('preserves custom entity type in detection results', () => {
    const result = sanitizeInput('MRN: 12345678', {
      customEntities: [{
        type: 'mrn',
        pattern: /MRN:\s*(\d{8})/g,
        placeholder: 'MRN',
      }],
    });
    const customEntities = result.entities.filter(e => (e.type as string) === 'mrn');
    expect(customEntities.length).toBeGreaterThanOrEqual(1);
  });
});
