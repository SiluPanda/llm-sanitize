# llm-sanitize

Bidirectional I/O sanitizer middleware for LLM applications.

[![npm version](https://img.shields.io/npm/v/llm-sanitize.svg)](https://www.npmjs.com/package/llm-sanitize)
[![npm downloads](https://img.shields.io/npm/dt/llm-sanitize.svg)](https://www.npmjs.com/package/llm-sanitize)
[![license](https://img.shields.io/npm/l/llm-sanitize.svg)](https://github.com/SiluPanda/llm-sanitize/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/llm-sanitize.svg)](https://nodejs.org)

---

## Description

`llm-sanitize` detects and redacts personally identifiable information (PII) from user inputs before they reach a language model, and scans LLM outputs for PII leakage and profanity before they reach the user. The placeholder redaction strategy is fully reversible: after the LLM responds with placeholder tags, the original values can be restored automatically through de-anonymization.

Zero runtime dependencies. All detection, redaction, and hashing use Node.js built-ins only (`node:crypto`).

---

## Installation

```bash
npm install llm-sanitize
```

Requires Node.js 18 or later.

---

## Quick Start

```typescript
import { sanitizeInput, sanitizeOutput } from 'llm-sanitize';

// 1. Sanitize user input before sending to the LLM
const input = sanitizeInput('My email is alice@example.com and SSN is 123-45-6789.');
console.log(input.text);
// "My email is [EMAIL_1] and SSN is [SSN_1]."
console.log(input.summary);
// { email: 1, ssn: 1 }

// 2. Send input.text to your LLM, get back a response
const llmResponse = 'We received your request from [EMAIL_1].';

// 3. Sanitize the output, optionally de-anonymizing placeholders
const output = sanitizeOutput(llmResponse, {
  placeholderMap: input.placeholderMap,
  deanonymize: true,
  piiLeakage: false,
});
console.log(output.text);
// "We received your request from alice@example.com."
console.log(output.action);
// "pass"
```

---

## Features

- **Bidirectional sanitization** -- Scrub PII from inputs before the LLM call and scan outputs for leakage and profanity after the LLM responds.
- **Seven built-in PII detectors** -- Email, phone, SSN, credit card (Luhn-validated), IPv4 address, date of birth, and person name.
- **Four redaction strategies** -- Placeholder (reversible), mask, SHA-256 hash, and remove.
- **Reversible de-anonymization** -- The `placeholder` strategy stores a mapping from tags to original values. Pass the map to `sanitizeOutput` to restore originals in the LLM response.
- **Confidence-based filtering** -- Each detection carries a confidence level (`high`, `medium`, or `low`). The `sensitivity` option controls which confidence levels are included.
- **Context-aware confidence boosting** -- Date-of-birth and name detections are boosted when contextual cues (e.g., "born", "DOB", "Mr.", "Dr.") appear nearby.
- **Output content checks** -- Detect profanity and PII leakage in LLM responses. Violations are returned with category, severity, and position data.
- **Custom entity patterns** -- Register arbitrary regex patterns as custom PII entity types.
- **Factory pattern** -- `createSanitizer` returns a reusable instance with bound default options.
- **Zero dependencies** -- Uses only Node.js built-ins.
- **Full TypeScript support** -- Ships with declaration files and source maps.

---

## PII Entity Types

| Type | Description | Default Confidence |
|------|-------------|-------------------|
| `email` | Email addresses | high |
| `phone` | US phone numbers (with or without country code, parentheses, dashes, dots, spaces) | high |
| `ssn` | US Social Security Numbers (validates area/group/serial rules) | high |
| `credit-card` | Credit card numbers (Luhn algorithm validated) | high |
| `ip-address` | IPv4 addresses (validates 0-255 octets) | high |
| `date-of-birth` | Dates in ISO, US, or EU formats (boosted to high near DOB context cues) | low |
| `name` | Sequences of two or more capitalized words (boosted to medium near name context cues) | low |
| `custom` | User-defined regex patterns registered via `customEntities` | configurable |

---

## Redaction Strategies

| Strategy | Description | Reversible |
|----------|-------------|------------|
| `placeholder` | Replaces with `[TYPE_N]` tags (e.g., `[EMAIL_1]`). Stores originals in a `PlaceholderMap`. Default strategy. | Yes |
| `mask` | Replaces each character with `*`, preserving length. | No |
| `hash` | Replaces with the first 8 hex characters of the SHA-256 digest. Same value always produces the same hash. | No |
| `remove` | Deletes the value entirely. | No |

---

## API Reference

### `sanitizeInput(text, options?)`

Scans text for PII, applies the configured redaction strategy, and returns a `SanitizedInput` result.

```typescript
import { sanitizeInput } from 'llm-sanitize';

const result = sanitizeInput('Call me at 555-867-5309', {
  entities: ['phone', 'email'],
  strategy: 'placeholder',
  sensitivity: 'medium',
});
```

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `text` | `string` | The input text to sanitize. |
| `options` | `InputSanitizeOptions` | Optional configuration (see below). |

**`InputSanitizeOptions`:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `entities` | `PIIEntityType[]` | All built-in types | Restrict detection to these entity types only. |
| `strategy` | `RedactionStrategy` | `'placeholder'` | How detected PII is redacted. One of `'placeholder'`, `'mask'`, `'hash'`, `'remove'`. |
| `sensitivity` | `'low' \| 'medium' \| 'high'` | `'medium'` | Confidence threshold. `'low'` = high-confidence only. `'medium'` = high + medium. `'high'` = all. |
| `customEntities` | `Array<{ type: string; pattern: RegExp; placeholder: string; confidence?: PIIConfidence }>` | `[]` | Custom regex patterns to detect as PII. |

**Returns `SanitizedInput`:**

| Field | Type | Description |
|-------|------|-------------|
| `text` | `string` | The redacted text. |
| `entities` | `PIIEntity[]` | Array of all detected PII entities with type, value, position, and confidence. |
| `placeholderMap` | `PlaceholderMap` | Mapping from placeholder tags to original values. Used for de-anonymization. |
| `summary` | `Partial<Record<PIIEntityType, number>>` | Count of detected entities per type. |
| `durationMs` | `number` | Processing time in milliseconds. |

---

### `sanitizeOutput(text, options?)`

Checks LLM output for PII leakage and profanity. Optionally restores placeholder tags to their original values.

```typescript
import { sanitizeOutput } from 'llm-sanitize';

const result = sanitizeOutput(llmResponseText, {
  piiLeakage: true,
  profanity: true,
  placeholderMap: input.placeholderMap,
  deanonymize: true,
});
```

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `text` | `string` | The LLM output text to check. |
| `options` | `OutputSanitizeOptions` | Optional configuration (see below). |

**`OutputSanitizeOptions`:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `piiLeakage` | `boolean` | `true` | When enabled, scans output for PII that was not present in the original input. |
| `profanity` | `boolean` | `false` | When enabled, scans output for profanity. |
| `placeholderMap` | `PlaceholderMap` | `undefined` | The placeholder map from a prior `sanitizeInput` call. Required for de-anonymization. |
| `deanonymize` | `boolean` | `false` | When `true` and a `placeholderMap` is provided, restores placeholder tags to original values. |

**Returns `SanitizedOutput`:**

| Field | Type | Description |
|-------|------|-------------|
| `text` | `string` | The final output text (de-anonymized if requested). |
| `action` | `'pass' \| 'warn'` | `'pass'` if no violations were found; `'warn'` if any violations were detected. |
| `violations` | `ContentViolation[]` | Array of detected violations with category, severity, matched text, and position. |
| `deanonymized` | `boolean` | Whether any placeholders were restored. |
| `placeholdersRestored` | `number` | Count of placeholder tags that were restored to original values. |
| `durationMs` | `number` | Processing time in milliseconds. |

---

### `detectPII(text, options?)`

Standalone PII detection without redaction. Returns the raw list of detected entities.

```typescript
import { detectPII } from 'llm-sanitize';

const entities = detectPII('Contact alice@example.com or call 555-867-5309', {
  entities: ['email'],
  sensitivity: 'low',
});
// [{ type: 'email', value: 'alice@example.com', start: 8, end: 25, confidence: 'high' }]
```

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `text` | `string` | The text to scan for PII. |
| `options` | `{ entities?: PIIEntityType[]; sensitivity?: 'low' \| 'medium' \| 'high' }` | Optional entity type filter and sensitivity level. |

**Returns `PIIEntity[]`:**

Each `PIIEntity` contains:

| Field | Type | Description |
|-------|------|-------------|
| `type` | `PIIEntityType` | The entity type (e.g., `'email'`, `'phone'`, `'ssn'`). |
| `value` | `string` | The matched text. |
| `start` | `number` | Start offset in the original text. |
| `end` | `number` | End offset in the original text. |
| `confidence` | `PIIConfidence` | Detection confidence: `'high'`, `'medium'`, or `'low'`. |
| `placeholder` | `string \| undefined` | The placeholder tag, if one was assigned. |

---

### `createSanitizer(defaults?)`

Factory function that returns a `Sanitizer` instance with bound default options. Per-call options override the defaults.

```typescript
import { createSanitizer } from 'llm-sanitize';

const sanitizer = createSanitizer({
  strategy: 'mask',
  sensitivity: 'high',
  entities: ['email', 'phone', 'ssn'],
});

const input = sanitizer.sanitizeInput('Email: alice@example.com');
const output = sanitizer.sanitizeOutput('Clean response.');
const entities = sanitizer.detectPII('alice@example.com');
```

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `defaults` | `InputSanitizeOptions` | Default options applied to every `sanitizeInput` and `detectPII` call. |

**Returns `Sanitizer`:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `sanitizeInput` | `(text: string, options?: InputSanitizeOptions) => SanitizedInput` | Sanitize input text. Per-call options override defaults. |
| `sanitizeOutput` | `(text: string, options?: OutputSanitizeOptions) => SanitizedOutput` | Check and optionally de-anonymize output text. |
| `detectPII` | `(text: string, options?: { entities?: PIIEntityType[]; sensitivity?: string }) => PIIEntity[]` | Detect PII without redaction. Inherits `entities` and `sensitivity` from defaults. |

---

## Configuration

### Sensitivity Levels

The `sensitivity` option controls which confidence levels pass the detection threshold:

| Sensitivity | Included Confidence Levels | Use Case |
|-------------|---------------------------|----------|
| `'low'` | `high` only | Minimize false positives. Only well-established patterns (email, phone, SSN, credit card, IP). |
| `'medium'` | `high` + `medium` | Balanced default. Catches context-boosted names and dates. |
| `'high'` | `high` + `medium` + `low` | Maximum recall. Includes low-confidence detections like names without context cues. |

### Custom Entity Patterns

Register custom regex patterns to detect domain-specific PII:

```typescript
const result = sanitizeInput('Patient MRN: 12345678', {
  customEntities: [
    {
      type: 'mrn',
      pattern: /\bMRN:\s*(\d{8})\b/g,
      placeholder: 'MRN',
      confidence: 'high',
    },
  ],
});
```

Custom entities are detected alongside built-in patterns and participate in the same overlap deduplication logic.

---

## Error Handling

All functions in `llm-sanitize` are synchronous and deterministic. They do not throw exceptions during normal operation. If input text is empty or contains no PII, the functions return clean results with empty entity arrays and `action: 'pass'`.

Edge cases handled internally:

- **Overlapping detections** -- When multiple patterns match overlapping text regions, the detection with higher confidence wins. If confidence is equal, the earlier (by start position) detection is kept.
- **Invalid SSNs** -- SSNs starting with 000, 666, or 9xx are rejected by validation rules per SSA specifications.
- **Invalid credit cards** -- Numbers that fail Luhn checksum validation are not reported as credit card entities.
- **Unknown placeholders** -- During de-anonymization, placeholder tags not found in the map are left unchanged in the output text.

---

## Advanced Usage

### Full Round-Trip Pipeline

```typescript
import { sanitizeInput, sanitizeOutput } from 'llm-sanitize';

async function safeLLMCall(userMessage: string, callLLM: (text: string) => Promise<string>) {
  // Sanitize input
  const { text: sanitized, placeholderMap } = sanitizeInput(userMessage);

  // Call the LLM with sanitized text
  const llmReply = await callLLM(sanitized);

  // Check output and restore placeholders
  const { text: finalReply, action, violations } = sanitizeOutput(llmReply, {
    placeholderMap,
    deanonymize: true,
    profanity: true,
  });

  if (action === 'warn') {
    console.warn('Content violations detected:', violations);
  }

  return finalReply;
}
```

### Detect-Only Mode

Use `detectPII` when you need to inspect text for PII without modifying it:

```typescript
import { detectPII } from 'llm-sanitize';

const entities = detectPII('John Smith at john@corp.com, born 1990-05-15', {
  sensitivity: 'high',
});

for (const entity of entities) {
  console.log(`${entity.type}: "${entity.value}" [${entity.confidence}] at ${entity.start}-${entity.end}`);
}
```

### Reusable Sanitizer with Defaults

```typescript
import { createSanitizer } from 'llm-sanitize';

const sanitizer = createSanitizer({
  strategy: 'hash',
  entities: ['email', 'phone', 'credit-card'],
  sensitivity: 'low',
});

// All calls use hash strategy, restricted entities, and low sensitivity
const r1 = sanitizer.sanitizeInput(text1);
const r2 = sanitizer.sanitizeInput(text2);

// Override per call
const r3 = sanitizer.sanitizeInput(text3, { strategy: 'placeholder' });
```

### Output Profanity Scanning

```typescript
import { sanitizeOutput } from 'llm-sanitize';

const result = sanitizeOutput(llmResponse, {
  profanity: true,
  piiLeakage: true,
});

if (result.action === 'warn') {
  for (const v of result.violations) {
    console.log(`[${v.category}] severity=${v.severity}: "${v.matchedText}" at ${v.start}-${v.end}`);
  }
}
```

---

## TypeScript

`llm-sanitize` is written in TypeScript and ships with full type declarations. All public types are exported from the package root:

```typescript
import type {
  PIIEntityType,
  PIIConfidence,
  RedactionStrategy,
  PIIEntity,
  PlaceholderMap,
  SanitizedInput,
  ContentViolation,
  SanitizedOutput,
  InputSanitizeOptions,
  OutputSanitizeOptions,
  Sanitizer,
} from 'llm-sanitize';
```

### Type Summary

| Type | Kind | Description |
|------|------|-------------|
| `PIIEntityType` | Union | `'email' \| 'phone' \| 'ssn' \| 'credit-card' \| 'ip-address' \| 'date-of-birth' \| 'name' \| 'custom'` |
| `PIIConfidence` | Union | `'low' \| 'medium' \| 'high'` |
| `RedactionStrategy` | Union | `'placeholder' \| 'mask' \| 'hash' \| 'remove'` |
| `PIIEntity` | Interface | A detected PII instance with type, value, position, and confidence. |
| `PlaceholderMap` | Interface | Maps placeholder tags (`entries`) to original values, with per-type counters. |
| `SanitizedInput` | Interface | Result of `sanitizeInput`: redacted text, entities, placeholder map, summary, duration. |
| `ContentViolation` | Interface | A content violation: category (`'profanity' \| 'pii-leakage'`), severity, matched text, position. |
| `SanitizedOutput` | Interface | Result of `sanitizeOutput`: final text, action, violations, de-anonymization status, duration. |
| `InputSanitizeOptions` | Interface | Options for input sanitization: entity filter, strategy, sensitivity, custom entities. |
| `OutputSanitizeOptions` | Interface | Options for output sanitization: PII leakage, profanity, placeholder map, de-anonymize flag. |
| `Sanitizer` | Interface | A reusable sanitizer instance with `sanitizeInput`, `sanitizeOutput`, and `detectPII` methods. |

---

## License

MIT
