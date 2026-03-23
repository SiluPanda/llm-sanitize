import { describe, it, expect } from 'vitest';
import { detectEntities, DEFAULT_PATTERNS } from '../detectors';

describe('email detection', () => {
  it('detects a simple email', () => {
    const entities = detectEntities('Contact me at alice@example.com for details.', DEFAULT_PATTERNS, 'medium');
    const emails = entities.filter((e) => e.type === 'email');
    expect(emails).toHaveLength(1);
    expect(emails[0].value).toBe('alice@example.com');
    expect(emails[0].confidence).toBe('high');
  });

  it('detects multiple emails', () => {
    const entities = detectEntities('Emails: a@b.com and c@d.org', DEFAULT_PATTERNS, 'medium');
    const emails = entities.filter((e) => e.type === 'email');
    expect(emails).toHaveLength(2);
    expect(emails.map((e) => e.value)).toContain('a@b.com');
    expect(emails.map((e) => e.value)).toContain('c@d.org');
  });

  it('does not detect invalid email patterns', () => {
    const entities = detectEntities('not-an-email or @missing', DEFAULT_PATTERNS, 'medium');
    const emails = entities.filter((e) => e.type === 'email');
    expect(emails).toHaveLength(0);
  });

  it('records correct start/end positions', () => {
    const text = 'Send to bob@test.io now';
    const entities = detectEntities(text, DEFAULT_PATTERNS, 'medium');
    const email = entities.find((e) => e.type === 'email');
    expect(text.substring(email!.start, email!.end)).toBe('bob@test.io');
  });
});

describe('phone detection', () => {
  it('detects US phone number with dashes', () => {
    const entities = detectEntities('Call 555-867-5309 for more info.', DEFAULT_PATTERNS, 'medium');
    const phones = entities.filter((e) => e.type === 'phone');
    expect(phones).toHaveLength(1);
    expect(phones[0].value).toBe('555-867-5309');
  });

  it('detects phone with country code', () => {
    const entities = detectEntities('International: +1-800-555-0199', DEFAULT_PATTERNS, 'medium');
    const phones = entities.filter((e) => e.type === 'phone');
    expect(phones.length).toBeGreaterThanOrEqual(1);
    expect(phones[0].confidence).toBe('high');
  });

  it('detects phone with parentheses', () => {
    const entities = detectEntities('(212) 555-1234', DEFAULT_PATTERNS, 'medium');
    const phones = entities.filter((e) => e.type === 'phone');
    expect(phones).toHaveLength(1);
  });
});

describe('credit card detection with Luhn validation', () => {
  it('detects a valid Luhn credit card number', () => {
    // 4532015112830366 is a valid Luhn number (test card)
    const entities = detectEntities('Card: 4532015112830366', DEFAULT_PATTERNS, 'medium');
    const cards = entities.filter((e) => e.type === 'credit-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].value).toBe('4532015112830366');
  });

  it('detects a valid card with dashes', () => {
    const entities = detectEntities('Card: 4532-0151-1283-0366', DEFAULT_PATTERNS, 'medium');
    const cards = entities.filter((e) => e.type === 'credit-card');
    expect(cards).toHaveLength(1);
  });

  it('rejects an invalid Luhn number', () => {
    // 1234567890123456 fails Luhn
    const entities = detectEntities('Card: 1234567890123456', DEFAULT_PATTERNS, 'medium');
    const cards = entities.filter((e) => e.type === 'credit-card');
    expect(cards).toHaveLength(0);
  });
});

describe('SSN detection', () => {
  it('detects a valid SSN with dashes', () => {
    const entities = detectEntities('SSN: 123-45-6789', DEFAULT_PATTERNS, 'medium');
    const ssns = entities.filter((e) => e.type === 'ssn');
    expect(ssns).toHaveLength(1);
    expect(ssns[0].value).toBe('123-45-6789');
  });

  it('rejects SSN starting with 000', () => {
    const entities = detectEntities('SSN: 000-45-6789', DEFAULT_PATTERNS, 'medium');
    const ssns = entities.filter((e) => e.type === 'ssn');
    expect(ssns).toHaveLength(0);
  });

  it('rejects SSN starting with 666', () => {
    const entities = detectEntities('SSN: 666-45-6789', DEFAULT_PATTERNS, 'medium');
    const ssns = entities.filter((e) => e.type === 'ssn');
    expect(ssns).toHaveLength(0);
  });

  it('rejects SSN starting with 9xx', () => {
    const entities = detectEntities('SSN: 912-45-6789', DEFAULT_PATTERNS, 'medium');
    const ssns = entities.filter((e) => e.type === 'ssn');
    expect(ssns).toHaveLength(0);
  });
});

describe('IP address detection', () => {
  it('detects a valid IPv4 address', () => {
    const entities = detectEntities('Server at 192.168.1.100 is down.', DEFAULT_PATTERNS, 'medium');
    const ips = entities.filter((e) => e.type === 'ip-address');
    expect(ips).toHaveLength(1);
    expect(ips[0].value).toBe('192.168.1.100');
  });

  it('detects multiple IPs', () => {
    const entities = detectEntities('From 10.0.0.1 to 10.0.0.254', DEFAULT_PATTERNS, 'medium');
    const ips = entities.filter((e) => e.type === 'ip-address');
    expect(ips).toHaveLength(2);
  });

  it('does not detect invalid octets', () => {
    const entities = detectEntities('IP: 999.999.999.999', DEFAULT_PATTERNS, 'medium');
    const ips = entities.filter((e) => e.type === 'ip-address');
    expect(ips).toHaveLength(0);
  });
});

describe('sensitivity filtering', () => {
  it('low sensitivity only returns high-confidence entities', () => {
    // name is low confidence, email is high confidence
    const text = 'John Smith said alice@example.com';
    const entities = detectEntities(text, DEFAULT_PATTERNS, 'low');
    const names = entities.filter((e) => e.type === 'name');
    const emails = entities.filter((e) => e.type === 'email');
    expect(names).toHaveLength(0);
    expect(emails).toHaveLength(1);
  });

  it('high sensitivity returns all confidence levels', () => {
    const text = 'John Smith has a birthday';
    // name is low confidence and no name context cues, should pass with high sensitivity
    const entities = detectEntities(text, DEFAULT_PATTERNS, 'high');
    const names = entities.filter((e) => e.type === 'name');
    expect(names.length).toBeGreaterThanOrEqual(1);
  });
});
