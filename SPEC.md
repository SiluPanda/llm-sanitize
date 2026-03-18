# llm-sanitize -- Specification

## 1. Overview

`llm-sanitize` is a bidirectional I/O sanitizer middleware for LLM applications. It intercepts API calls to LLM providers (OpenAI, Anthropic, and any generic async function), scrubs personally identifiable information (PII) from inputs before they reach the LLM, checks outputs for harmful content and PII leakage after the LLM responds, and optionally de-anonymizes the response by restoring redacted PII placeholders to their original values. The entire pipeline is activated by wrapping an existing SDK client with a single `sanitize(client)` call -- the caller's application code does not change.

The gap this package fills is specific and well-defined. PII redaction and content moderation are treated as separate concerns in the current JavaScript ecosystem, addressed by different packages that each handle one direction of the LLM I/O flow:

1. **PII redaction packages** (`pii-redactor`, `redact-pii`, and various regex-based utilities) detect and remove personal information from text. They operate on input only. None of them understand LLM API call structures, none of them intercept SDK clients, and none of them handle the round-trip problem: if you redact an email in the input with a placeholder, the LLM may reference that placeholder in its response, and you need to swap it back to the original email before returning the response to the user.

2. **Content moderation services** (OpenAI Moderation API, Google Perspective API, Azure AI Content Safety) classify text for toxicity, hate speech, and harmful content. They operate on output only. They are cloud services requiring network round-trips, API keys, and third-party data sharing. No JavaScript package provides local, offline content moderation that can run inline in a request pipeline without sending data to external servers.

3. **Microsoft Presidio** is the gold standard for PII detection and redaction, but it is Python-only, requires spaCy NLP models for named entity recognition, and cannot be used in Node.js applications. There is no JavaScript equivalent with comparable breadth of PII entity coverage.

No package in the npm ecosystem combines input PII redaction, output content moderation, and bidirectional middleware wrapping into a single dependency. A developer building a GDPR-compliant chatbot today must install a PII redactor, a profanity filter, and a content moderation client, then manually wire them into the request pipeline around every LLM call, handle the placeholder mapping for reversible redaction, and ensure error handling and streaming work correctly across all three layers. `llm-sanitize` collapses this into one function call.

Within this monorepo, `llm-sanitize` occupies the real-time I/O sanitization layer. It complements `jailbreak-heuristic` (which classifies user input for prompt injection -- a detection concern, not a sanitization concern), `content-policy` (which enforces declarative business content rules -- a policy concern, not a safety concern), `token-fence` (which wraps prompt sections with structural boundary markers -- a structural concern), and `llm-audit-log` (which records interactions for compliance -- an observability concern). `llm-sanitize` is the package that actually modifies the data flowing in and out of the LLM to protect privacy and filter harmful content.

The design philosophy is transparent middleware. The developer wraps their existing LLM client once. Every subsequent API call through that client is automatically sanitized in both directions. No code changes are required at call sites. The sanitizer is invisible until it acts -- and when it acts, it produces structured reports of what it found and what it did, available via event hooks for logging and auditing.

---

## 2. Goals and Non-Goals

### Goals

- Provide a `sanitize(client, options?)` function that wraps an OpenAI or Anthropic SDK client and returns a sanitized client with the same API surface, transparently intercepting all LLM API calls.
- Detect and redact PII in LLM inputs before the API call is made. Support at least ten PII entity types out of the box: email addresses, phone numbers, Social Security Numbers, credit card numbers, IP addresses, dates of birth, physical addresses, person names, passport/ID numbers, and custom user-defined patterns.
- Check LLM outputs for harmful content after the API call returns. Detect profanity, toxicity signals, harmful instructions, and PII leakage (PII in the output that was not present in the input).
- Support reversible redaction via placeholder mapping: replace PII with typed placeholders (`[EMAIL_1]`, `[PHONE_1]`) during input sanitization, store the mapping, and restore original values in the output after the LLM responds (de-anonymization).
- Provide six redaction strategies configurable per entity type: `placeholder` (default, reversible), `mask` (partial masking), `hash` (SHA-256, irreversible), `fake` (realistic fake data), `remove` (delete entirely), and `encrypt` (AES-256, reversible with key).
- Provide standalone functions (`sanitizeInput`, `sanitizeOutput`, `detectPII`) for use outside the middleware wrapper pattern.
- Provide a `createSanitizer(config)` factory for creating preconfigured sanitizer instances reusable across multiple calls.
- Support streaming: sanitize input before the stream begins, buffer and scan output chunks for harmful content as they arrive.
- Support generic wrapping of any `(input) => Promise<output>` async function, not just OpenAI and Anthropic clients.
- Emit structured events (`onInputSanitized`, `onOutputSanitized`, `onViolation`) for logging, auditing, and integration with `llm-audit-log`.
- Maintain zero runtime dependencies. All PII detection, content moderation, and cryptographic operations use built-in Node.js capabilities.
- Target Node.js 18 and above.

### Non-Goals

- **Not a jailbreak detector.** This package does not classify whether user input is a prompt injection or jailbreak attempt. Jailbreak detection is a classification problem (is this input malicious?) whereas sanitization is a transformation problem (remove dangerous content from this input). For jailbreak detection, use `jailbreak-heuristic` from this monorepo.
- **Not a business content policy engine.** This package does not enforce business rules like "never mention competitors" or "always include a disclaimer." Business content rules are declarative, organization-specific, and defined in configuration files. For business content policies, use `content-policy` from this monorepo. `llm-sanitize` handles universal safety concerns (PII, profanity, harmful content), not organization-specific content rules.
- **Not an ML-based NER system.** PII detection for person names and addresses uses heuristic pattern matching (capitalized word sequences, address format patterns), not machine learning named entity recognition. Heuristic detection is faster, zero-dependency, and deterministic, but it will miss unconventional name formats and non-standard addresses. For production deployments requiring high-recall name detection, supplement `llm-sanitize` with a dedicated NER service and register the results as custom PII patterns.
- **Not a cloud moderation proxy.** This package does not call OpenAI's Moderation API, Google's Perspective API, or any other external service. All detection is local. This avoids network latency, API costs, and third-party data sharing. For cloud-based moderation with ML models, use those services directly and compose them with `llm-sanitize`.
- **Not a data loss prevention (DLP) system.** This package redacts PII from individual LLM API calls. It does not monitor data flows across an organization, classify documents by sensitivity, or enforce data retention policies. For enterprise DLP, use dedicated DLP solutions.
- **Not a content filter for images, audio, or video.** This package operates on text. It does not analyze image content in multimodal LLM inputs/outputs.

---

## 3. Target Users and Use Cases

### Privacy-Conscious Application Developers

Developers building AI-powered applications (chatbots, assistants, search interfaces) who need to prevent user PII from reaching third-party LLM APIs. Users inadvertently include personal information in prompts -- email addresses, phone numbers, home addresses, credit card numbers. Sending this PII to OpenAI, Anthropic, or other providers creates privacy risk and potential regulatory violations. `llm-sanitize` intercepts and scrubs PII before the API call, transparently.

### GDPR and CCPA Compliance Engineers

Engineers responsible for ensuring AI applications comply with data protection regulations. GDPR Article 5(1)(c) requires data minimization -- only processing personal data that is necessary for the purpose. Sending unredacted user PII to an LLM API when the PII is not relevant to the query violates this principle. `llm-sanitize` provides the technical control that enforces data minimization at the LLM integration boundary.

### Healthcare AI Developers

Teams building AI applications that handle protected health information (PHI) under HIPAA. Patient names, dates of birth, medical record numbers, and other PHI identifiers must not be sent to external LLM APIs without appropriate safeguards. `llm-sanitize` redacts PHI from inputs, sends sanitized prompts to the LLM, and optionally restores identifiers in the response for display to authorized healthcare workers.

### Enterprise AI Platform Teams

Platform teams providing shared LLM access to multiple internal applications across an organization. A centralized sanitization layer ensures that all applications, regardless of which team built them, have PII scrubbed from inputs and harmful content filtered from outputs. The platform team configures `llm-sanitize` once on the shared client; downstream applications inherit the protection.

### Customer Support AI Teams

Teams deploying AI-powered customer support agents that process messages containing customer PII (names, account numbers, addresses, emails). The AI needs to understand the customer's issue but should not send their raw PII to the LLM provider. Placeholder redaction preserves context (the LLM sees `[EMAIL_1]` and understands it refers to the customer's email) while protecting the actual data. De-anonymization restores the real email in the response before sending it back to the customer.

### Financial Services AI Developers

Developers building AI tools for financial institutions where credit card numbers, account numbers, and SSNs may appear in user inputs. PCI DSS and financial regulations mandate strict controls on handling of cardholder data and personal financial information. `llm-sanitize` provides automated redaction of financial PII with Luhn validation for credit card numbers, reducing the risk of accidental data exposure.

---

## 4. Core Concepts

### Bidirectional Sanitization

The central concept of `llm-sanitize` is that LLM I/O requires protection in both directions:

- **Input sanitization** (pre-flight): Detect and remove PII from user input before it is sent to the LLM. This protects user privacy and ensures compliance with data protection regulations.
- **Output sanitization** (post-flight): Detect and filter harmful content, profanity, toxicity, and PII leakage in the LLM's response before it is returned to the user. This protects the end user from harmful generated content.

These two directions are typically addressed by different tools with different APIs. `llm-sanitize` unifies them into a single middleware wrapper.

### PII Entity

A PII entity is a specific instance of personally identifiable information detected in text. Each entity has a type (email, phone, SSN, etc.), the detected value, its position in the text (start and end offsets), the confidence of the detection (high for regex-matched patterns, medium for heuristic-matched patterns), and an identifier that is unique within the current request context (`EMAIL_1`, `EMAIL_2`, `PHONE_1`, etc.). The identifier is used as the placeholder in redacted text and as the key in the placeholder map.

### Redaction Strategy

A redaction strategy defines how a detected PII entity is replaced in the text. Six strategies are supported, each making a different tradeoff between privacy, reversibility, and data utility:

- **`placeholder`**: Replace with a typed, numbered placeholder (`[EMAIL_1]`). Reversible via de-anonymization. The LLM can reference the placeholder semantically. Default strategy.
- **`mask`**: Partially obscure the value, preserving structure (`j***@e***l.com`, `(555) ***-**89`). Not reversible. Preserves format for human readability.
- **`hash`**: Replace with the SHA-256 hash of the value. Irreversible. Consistent -- the same value always produces the same hash -- which is useful for deduplication or linking without revealing the original.
- **`fake`**: Replace with realistic fake data (a plausible but non-real email, phone number, etc.). Not reversible. Useful when the LLM needs realistic-looking data to produce a coherent response.
- **`remove`**: Delete the PII entirely, leaving no trace. Not reversible. Maximum privacy, but may break sentence structure.
- **`encrypt`**: Replace with an AES-256-GCM encrypted string. Reversible with the encryption key. Useful when the redacted text may be stored and later needs to be de-anonymized by an authorized party.

### Placeholder Map

The placeholder map is a bidirectional mapping between placeholder identifiers and original PII values, created during input sanitization when the `placeholder` strategy is used. During input redaction, the sanitizer builds a map like `{ "[EMAIL_1]": "john.doe@example.com", "[PHONE_1]": "(555) 123-4567" }`. After the LLM responds, the de-anonymizer scans the response for these placeholders and replaces them with the original values. The map is request-scoped -- it is created when a specific input is sanitized and discarded after the corresponding output is de-anonymized. It is never persisted, logged, or shared across requests.

### De-anonymization

De-anonymization is the process of restoring original PII values in the LLM's response by replacing placeholders with their original values from the placeholder map. It is the second half of the reversible redaction cycle. De-anonymization is optional and configurable: if the response is being logged, stored, or displayed to an unauthorized user, the caller can disable de-anonymization to keep the response in its redacted form.

### Content Violation

A content violation is a harmful content signal detected in the LLM's output. Each violation has a type (profanity, toxicity, harmful-instruction, pii-leakage), the detected content, its position in the text, a severity level (low, medium, high), and a human-readable description. The output sanitizer collects all violations and determines the overall action: pass (no violations), warn (low-severity violations only), or block (medium or high-severity violations).

### Middleware Wrapper

The middleware wrapper is the transparent proxy pattern that makes `llm-sanitize` invisible to application code. The `sanitize(client)` function accepts an LLM SDK client (OpenAI or Anthropic) and returns a new object with the same interface. When the application calls `client.chat.completions.create(params)`, the wrapper intercepts the call, sanitizes the input messages, forwards the sanitized call to the real client, receives the response, sanitizes the output, and returns the sanitized response. The application code sees no difference -- the wrapper has the same TypeScript type signature as the original client.

---

## 5. Input Sanitization (PII Redaction)

### PII Detection Pipeline

Input sanitization proceeds in a fixed sequence:

1. **Extract text**: Extract all user-facing text content from the LLM API call parameters (message content strings, system prompts, function call arguments).
2. **Detect PII entities**: Run all enabled PII detectors against the extracted text. Each detector scans for one entity type and returns an array of `PIIEntity` objects.
3. **Deduplicate and resolve overlaps**: If multiple detectors flag overlapping text ranges, keep the detection with the higher confidence. If confidence is equal, keep the more specific entity type (e.g., prefer `credit-card` over `phone` when the pattern matches both).
4. **Apply redaction**: For each detected entity, apply the configured redaction strategy, build the placeholder map (if using `placeholder` strategy), and produce the sanitized text.
5. **Return result**: Return the sanitized text, the list of detected entities, and the placeholder map.

### 5.1 Email Addresses

**Entity type**: `email`

**Detection**: Regex pattern matching for RFC 5322 simplified email format.

**Pattern**:
```
[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}
```

**Examples detected**:
- `john.doe@example.com`
- `user+tag@company.co.uk`
- `first.last@subdomain.domain.org`
- `user123@gmail.com`

**False positive considerations**: URLs containing `@` characters (e.g., `git@github.com:org/repo`), Twitter/social media handles (`@username`), at-mentions in chat contexts. The pattern requires both a local part and a domain with a TLD of at least two characters, which excludes bare `@username` references. The pattern does not match `@` followed by a single word without a dot (e.g., `@john`).

**Redaction examples**:
| Strategy | Input | Output |
|----------|-------|--------|
| `placeholder` | `john@example.com` | `[EMAIL_1]` |
| `mask` | `john@example.com` | `j***@e*****e.com` |
| `hash` | `john@example.com` | `[SHA256:a1b2c3...]` |
| `fake` | `john@example.com` | `sarah.miller@fakeemail.net` |
| `remove` | `john@example.com` | `` |
| `encrypt` | `john@example.com` | `[ENC:iv:ciphertext:tag]` |

### 5.2 Phone Numbers

**Entity type**: `phone`

**Detection**: Multiple regex patterns covering common phone number formats for US, UK, EU, and international numbers.

**Patterns**:
```
US:            \(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}
US with +1:    \+1[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}
UK:            \+?44[-.\s]?\d{4}[-.\s]?\d{6}
UK local:      0\d{4}[-.\s]?\d{6}
International: \+\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}
```

**Examples detected**:
- `(555) 123-4567` (US)
- `+1 555-123-4567` (US with country code)
- `555.123.4567` (US dot-separated)
- `+44 7911 123456` (UK)
- `+49 30 12345678` (Germany)
- `+33 1 23 45 67 89` (France)

**False positive considerations**: Sequences of digits that resemble phone numbers but are not (order numbers, reference IDs, ZIP codes, years). The detector requires at least 7 digits in the matched sequence to avoid matching short numeric strings. Standalone 5-digit sequences (ZIP codes) are not matched. The detector does not match bare digit sequences without formatting cues (parentheses, dashes, dots, plus sign, or spaces between groups).

**Redaction examples**:
| Strategy | Input | Output |
|----------|-------|--------|
| `placeholder` | `(555) 123-4567` | `[PHONE_1]` |
| `mask` | `(555) 123-4567` | `(555) ***-**67` |
| `hash` | `(555) 123-4567` | `[SHA256:d4e5f6...]` |
| `fake` | `(555) 123-4567` | `(555) 987-6543` |
| `remove` | `(555) 123-4567` | `` |

### 5.3 Social Security Numbers

**Entity type**: `ssn`

**Detection**: Regex pattern matching for US SSN format (9 digits in AAA-BB-CCCC format).

**Pattern**:
```
\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b
```

**Validation**: Beyond pattern matching, the detector validates that the detected number is a plausible SSN:
- The area number (first three digits) must not be 000, 666, or in the range 900-999.
- The group number (middle two digits) must not be 00.
- The serial number (last four digits) must not be 0000.
- Known invalid SSNs used in advertising (e.g., 078-05-1120, the Woolworth wallet SSN) are excluded.

**Examples detected**:
- `123-45-6789`
- `123 45 6789`
- `123.45.6789`

**False positive considerations**: Nine-digit numbers in other contexts (bank account numbers, employee IDs, order numbers). The validation rules reduce false positives by excluding impossible SSN ranges. The word boundary anchors (`\b`) prevent matching nine-digit substrings of longer numbers. Context awareness: if the surrounding text contains words like "SSN", "social security", or "social", the detector increases confidence to high. Without context cues, confidence is medium.

**Redaction examples**:
| Strategy | Input | Output |
|----------|-------|--------|
| `placeholder` | `123-45-6789` | `[SSN_1]` |
| `mask` | `123-45-6789` | `***-**-6789` |
| `hash` | `123-45-6789` | `[SHA256:g7h8i9...]` |
| `remove` | `123-45-6789` | `` |

### 5.4 Credit Card Numbers

**Entity type**: `credit-card`

**Detection**: Regex pattern matching for major card network number formats, followed by Luhn algorithm validation.

**Patterns**:
```
Visa:              4\d{3}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}
Mastercard:        5[1-5]\d{2}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}
Mastercard (2-series): 2[2-7]\d{2}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}
Amex:              3[47]\d{2}[-\s]?\d{6}[-\s]?\d{5}
Discover:          6(?:011|5\d{2})[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}
```

**Luhn validation**: After a candidate number is matched by the pattern, the Luhn algorithm is applied to the digit sequence (ignoring separators). The Luhn algorithm:
1. Starting from the rightmost digit, double every second digit.
2. If the doubled value exceeds 9, subtract 9.
3. Sum all digits.
4. If the total is divisible by 10, the number passes validation.

Only numbers that pass the Luhn check are classified as credit card numbers. This eliminates most false positives from random 16-digit sequences.

**Examples detected**:
- `4111 1111 1111 1111` (Visa test card)
- `5500-0000-0000-0004` (Mastercard test card)
- `3782 822463 10005` (Amex test card)
- `4111111111111111` (Visa, no separators)

**False positive considerations**: Long numeric identifiers (tracking numbers, serial numbers, database IDs) that happen to have 13-19 digits. The Luhn check eliminates the vast majority of these -- random digit sequences have only a 10% chance of passing Luhn validation. The network-specific prefix patterns further narrow the match space.

**Redaction examples**:
| Strategy | Input | Output |
|----------|-------|--------|
| `placeholder` | `4111 1111 1111 1111` | `[CREDIT_CARD_1]` |
| `mask` | `4111 1111 1111 1111` | `**** **** **** 1111` |
| `hash` | `4111 1111 1111 1111` | `[SHA256:j0k1l2...]` |
| `remove` | `4111 1111 1111 1111` | `` |

### 5.5 IP Addresses

**Entity type**: `ip-address`

**Detection**: Regex patterns for both IPv4 and IPv6 addresses.

**Patterns**:
```
IPv4: \b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b
IPv6: \b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b
IPv6 (compressed): \b(?:[0-9a-fA-F]{1,4}:){1,7}:|::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}\b
```

**Validation**: IPv4 octets must be in the range 0-255. Common non-PII addresses are optionally excluded: `127.0.0.1` (localhost), `0.0.0.0`, `255.255.255.255` (broadcast), and private range prefixes (`10.`, `172.16.`-`172.31.`, `192.168.`) can be configured as non-PII.

**Examples detected**:
- `192.168.1.100` (private, included by default)
- `203.0.113.42` (public documentation range)
- `2001:0db8:85a3:0000:0000:8a2e:0370:7334` (IPv6)
- `::1` (IPv6 loopback)

**False positive considerations**: Version numbers (`1.2.3.4`), decimal numbers with dots, and other dot-separated numeric strings. The IPv4 pattern requires exactly four octets with values 0-255. The word boundary anchors prevent matching IP-like substrings inside longer identifiers.

**Redaction examples**:
| Strategy | Input | Output |
|----------|-------|--------|
| `placeholder` | `192.168.1.100` | `[IP_ADDRESS_1]` |
| `mask` | `192.168.1.100` | `192.168.*.*` |
| `hash` | `192.168.1.100` | `[SHA256:m3n4o5...]` |

### 5.6 Dates of Birth

**Entity type**: `date-of-birth`

**Detection**: Regex patterns for common date formats, combined with context analysis to distinguish dates of birth from other dates.

**Patterns**:
```
US:        \b(0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])[-/](\d{4}|\d{2})\b
EU:        \b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](\d{4}|\d{2})\b
ISO 8601:  \b\d{4}[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b
Written:   \b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(0?[1-9]|[12]\d|3[01]),?\s+\d{4}\b
```

**Context analysis**: A date pattern alone does not confirm a date of birth. The detector searches for context cues within a window of 50 characters before and after the matched date:
- **High confidence**: Text contains "born", "birth", "DOB", "date of birth", "birthday", "d.o.b.", "birthdate".
- **Medium confidence**: Date is preceded by a name-like pattern (capitalized words) and the date is more than 10 years in the past.
- **Low confidence**: Date pattern matches but no context cues are present. Detected only when sensitivity is set to `high`.

**Examples detected** (with context):
- `Date of birth: 03/15/1990`
- `Born: March 15, 1990`
- `DOB: 1990-03-15`
- `My birthday is 15.03.1990`

**False positive considerations**: Arbitrary dates (event dates, deadlines, timestamps). The context analysis requirement means that dates without birth-related context words are not flagged at default sensitivity. This trades recall for precision -- the detector misses dates of birth that lack context cues but avoids flagging every date in the text as PII.

### 5.7 Physical Addresses

**Entity type**: `address`

**Detection**: Heuristic pattern matching for US and UK street address formats.

**Pattern components**:
```
Street number:  \d{1,6}
Street name:    [A-Z][a-zA-Z]+(\s+[A-Z][a-zA-Z]+)*
Street type:    (Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Court|Ct|Way|Place|Pl|Circle|Cir|Terrace|Ter|Highway|Hwy)\.?
Unit:           (Apt|Suite|Ste|Unit|#)\s*\d+[A-Za-z]?
City:           [A-Z][a-zA-Z]+(\s+[A-Z][a-zA-Z]+)*
State:          [A-Z]{2}
ZIP:            \d{5}(-\d{4})?
```

**Composite pattern** (US): The detector looks for a sequence matching: `street-number street-name street-type [,] [unit] [,] city [,] state [ZIP]`. Not all components are required -- the minimum match is `street-number street-name street-type`. Each additional component (city, state, ZIP) increases confidence.

**Examples detected**:
- `123 Main Street, Springfield, IL 62701` (full US address, high confidence)
- `456 Oak Ave, Apt 2B` (partial address with unit, medium confidence)
- `789 Elm Dr` (street address only, low confidence)

**False positive considerations**: Addresses are the hardest PII entity to detect with regex because their format is highly variable across countries and contexts. The detector prioritizes precision over recall -- it catches well-formatted US/UK addresses but misses addresses in non-standard formats, addresses without street type suffixes, and international address formats. For comprehensive address detection, use a geocoding service as a supplementary detector.

### 5.8 Person Names

**Entity type**: `name`

**Detection**: Heuristic-based detection using capitalized word sequences and contextual cues. This is the least precise built-in detector and is disabled by default.

**Algorithm**:
1. Find sequences of 2-4 capitalized words that do not start a sentence (not preceded by `.` or at the start of text).
2. Exclude common false positives: known proper nouns (country names, city names, company names, month names, day names), words in the entity's dictionary, and words that appear in the surrounding text as common English words.
3. Check for context cues: preceded by titles (`Mr.`, `Mrs.`, `Ms.`, `Dr.`, `Prof.`), followed by possessives or role descriptions, or preceded by "name", "by", "from", "signed", "author".
4. Assign confidence: high if preceded by a title, medium if context cues are present, low if only capitalization heuristic matches.

**Examples detected** (with context):
- `Mr. John Smith` (high confidence -- title prefix)
- `Contact Jane Doe for details` (medium confidence -- "contact" context)
- `Signed by Alice Johnson` (medium confidence -- "signed by" context)

**Why disabled by default**: Name detection using heuristics produces significant false positives. Capitalized words in English include proper nouns (cities, companies, products, brands), sentence-starting words, acronyms, and emphasized text. Without an NLP model for named entity recognition, precision is limited. Applications that need name detection should enable it explicitly and configure an allowlist of capitalized words that are not names in their domain context.

### 5.9 Passport and ID Numbers

**Entity type**: `passport-id`

**Detection**: Configurable regex patterns for government-issued identification numbers. No patterns are enabled by default because ID formats vary dramatically across countries and overlap with other numeric identifiers.

**Pre-configured patterns** (available but disabled):
```
US Passport:   \b[A-Z]\d{8}\b       (letter followed by 8 digits)
UK Passport:   \b\d{9}\b            (9 digits, context required)
EU ID (generic): \b[A-Z]{1,2}\d{6,8}\b  (1-2 letters followed by 6-8 digits)
```

**Enabling**: The developer explicitly enables passport/ID detection and selects the country-specific patterns that are relevant to their application:

```typescript
const sanitized = sanitize(client, {
  entities: {
    'passport-id': {
      enabled: true,
      patterns: ['us-passport', 'uk-passport'],
    },
  },
});
```

**False positive considerations**: ID number patterns are short and generic. A 9-digit number could be a passport, a phone number, a ZIP+4 code, or an account number. Enabling passport detection without context analysis will produce many false positives. The detector requires context cues ("passport", "passport number", "travel document", "ID number") within 30 characters of the match to achieve medium or high confidence.

### 5.10 Custom PII Patterns

**Entity type**: `custom`

**Detection**: User-defined regex patterns registered at configuration time. This is the extension mechanism for PII types not covered by the built-in detectors.

**Configuration**:
```typescript
const sanitized = sanitize(client, {
  customEntities: [
    {
      type: 'employee-id',
      pattern: /\bEMP-\d{6}\b/g,
      placeholder: 'EMPLOYEE_ID',
      confidence: 'high',
      description: 'Internal employee identifier',
    },
    {
      type: 'medical-record',
      pattern: /\bMRN[-:\s]?\d{7,10}\b/gi,
      placeholder: 'MEDICAL_RECORD',
      confidence: 'high',
      description: 'Medical record number',
    },
  ],
});
```

Custom patterns follow the same lifecycle as built-in entity detectors: they run during the detection phase, produce `PIIEntity` objects, and the matched text is redacted according to the configured redaction strategy. Custom patterns are evaluated after built-in detectors, so if a built-in detector already matched a text range, the custom pattern's match for the same range is dropped during deduplication.

---

## 6. Redaction Strategies

### 6.1 `placeholder` (Default)

**Output format**: `[{ENTITY_TYPE}_{N}]` where `ENTITY_TYPE` is the uppercase entity type and `N` is a sequential counter starting at 1 for each type within a single request.

**Examples**:
- `john@example.com` becomes `[EMAIL_1]`
- A second email becomes `[EMAIL_2]`
- `(555) 123-4567` becomes `[PHONE_1]`

**Placeholder map entry**:
```json
{
  "[EMAIL_1]": "john@example.com",
  "[EMAIL_2]": "jane@company.org",
  "[PHONE_1]": "(555) 123-4567"
}
```

**Reversibility**: Fully reversible via de-anonymization. The placeholder map stores the exact original value. After the LLM responds, occurrences of `[EMAIL_1]` in the response are replaced with `john@example.com`.

**Why this is the default**: Placeholder redaction preserves the semantic role of the PII in the text. The LLM sees `[EMAIL_1]` and understands that it refers to an email address. It can reference it in the response ("I'll send the confirmation to [EMAIL_1]"). De-anonymization then restores the real email for the end user. This provides the best balance of privacy protection and response coherence.

### 6.2 `mask`

**Output format**: Partial masking that preserves the structure and a subset of characters.

**Masking rules per entity type**:
| Entity Type | Masking Rule | Example Input | Example Output |
|-------------|-------------|---------------|----------------|
| `email` | First char + `***` + `@` + first char + `***` + last 4 chars of domain | `john@example.com` | `j***@e***.com` |
| `phone` | Preserve area code, mask middle digits, show last 2 | `(555) 123-4567` | `(555) ***-**67` |
| `ssn` | Mask first 5 digits, show last 4 | `123-45-6789` | `***-**-6789` |
| `credit-card` | Mask all but last 4 digits | `4111 1111 1111 1111` | `**** **** **** 1111` |
| `ip-address` | Mask last two octets (IPv4) | `192.168.1.100` | `192.168.*.*` |
| `date-of-birth` | Mask day and month, show year | `03/15/1990` | `**/**/1990` |
| `address` | Mask street number and name | `123 Main St, Springfield, IL` | `*** **** **, Springfield, IL` |
| `name` | First char + `***` per word | `John Smith` | `J*** S***` |

**Reversibility**: Not reversible. The masked characters are lost.

### 6.3 `hash`

**Output format**: `[SHA256:{first 12 hex chars}]`

**Algorithm**: SHA-256 hash of the UTF-8 encoded original value, truncated to the first 12 hexadecimal characters for readability.

```typescript
import { createHash } from 'node:crypto';
const hash = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
// Output: [SHA256:a1b2c3d4e5f6]
```

**Reversibility**: Not reversible. SHA-256 is a one-way hash function.

**Consistency**: The same input value always produces the same hash. This means that if `john@example.com` appears three times in the text, all three occurrences are replaced with the same hash string. This preserves referential relationships without revealing the original value.

### 6.4 `fake`

**Output format**: A realistic-looking but non-real value of the same entity type.

**Fake data generation**: The sanitizer includes a built-in minimal fake data generator (no dependency on `faker` or similar packages). The generator produces values that are format-correct but do not correspond to real entities:

| Entity Type | Fake Value Source |
|-------------|-------------------|
| `email` | Random first.last@domain combinations from a fixed pool of common first names, last names, and domain names |
| `phone` | Random digits in the matched format with the 555 area code (reserved for fictitious use in the US) |
| `ssn` | Random digits in SSN format that pass area/group/serial validation |
| `credit-card` | Random digits that pass Luhn validation in the matched card network's prefix format |
| `ip-address` | Random IP in the documentation range (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) |
| `date-of-birth` | Random date between 1940 and 2005 in the matched date format |
| `address` | Random house number + street name from a fixed pool + original city/state/ZIP if detected |
| `name` | Random name from a fixed pool of common first and last names |

**Consistency within request**: The same original value is replaced with the same fake value within a single request. This is achieved by seeding the fake generator with a hash of the original value, ensuring deterministic output.

**Reversibility**: Not reversible. The mapping between original and fake values is not stored.

### 6.5 `remove`

**Output format**: The PII is deleted entirely. Adjacent whitespace is collapsed to a single space to avoid double spaces in the text.

**Example**:
- Input: `Please contact john@example.com for details`
- Output: `Please contact for details`

**Reversibility**: Not reversible.

**Tradeoff**: Maximum privacy -- no trace of the PII remains. But sentence structure may become awkward or grammatically broken. Use this only when the PII is truly irrelevant to the LLM's task.

### 6.6 `encrypt`

**Output format**: `[ENC:{base64(iv)}:{base64(ciphertext)}:{base64(authTag)}]`

**Algorithm**: AES-256-GCM encryption using the Node.js `crypto` module.

```typescript
import { createCipheriv, randomBytes } from 'node:crypto';

const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
let ciphertext = cipher.update(value, 'utf8', 'base64');
ciphertext += cipher.final('base64');
const authTag = cipher.getAuthTag().toString('base64');
// Output: [ENC:{base64(iv)}:{ciphertext}:{authTag}]
```

**Key management**: The encryption key must be provided in the configuration. The sanitizer does not generate, store, or manage encryption keys. The caller is responsible for secure key management.

```typescript
const sanitized = sanitize(client, {
  redaction: {
    strategy: 'encrypt',
    encryptionKey: Buffer.from(process.env.SANITIZE_KEY!, 'hex'),
  },
});
```

**Reversibility**: Fully reversible with the encryption key. The `decryptPII(encryptedValue, key)` utility function is exported for manual decryption. De-anonymization in the middleware uses the same key to decrypt placeholder values before returning the response.

### Strategy Configuration Per Entity Type

Different entity types can use different redaction strategies:

```typescript
const sanitized = sanitize(client, {
  redaction: {
    default: 'placeholder',
    perEntity: {
      'credit-card': 'mask',     // Always mask credit cards (PCI DSS)
      'ssn': 'remove',           // Never send SSN to LLM, even redacted
      'email': 'placeholder',    // Placeholder for emails (need de-anonymization)
      'phone': 'placeholder',    // Placeholder for phones
      'name': 'fake',            // Replace names with fake names
    },
  },
});
```

---

## 7. Placeholder Mapping and De-anonymization

### Map Construction

During input sanitization with the `placeholder` strategy, the sanitizer builds a `PlaceholderMap`:

```typescript
interface PlaceholderMap {
  /** Mapping from placeholder string to original PII value. */
  entries: Record<string, string>;

  /** Number of entities per type (for counter tracking). */
  counters: Record<string, number>;

  /** Timestamp when the map was created. */
  createdAt: number;
}
```

**Example**: Given the input `Please email john@example.com or call (555) 123-4567 to reach John at john@example.com`, the map is:

```json
{
  "entries": {
    "[EMAIL_1]": "john@example.com",
    "[PHONE_1]": "(555) 123-4567"
  },
  "counters": {
    "email": 1,
    "phone": 1
  }
}
```

Note that the second occurrence of `john@example.com` reuses `[EMAIL_1]` -- identical values get the same placeholder.

### De-anonymization Process

After the LLM responds, de-anonymization scans the response text for all known placeholder strings and replaces them with original values:

1. **Iterate over placeholder map entries** in order of longest placeholder first (to prevent partial matches if one placeholder is a substring of another -- unlikely but defensive).
2. **Replace all occurrences** of each placeholder in the response text with its original value.
3. **Handle partial mentions**: If the LLM uses a placeholder in a modified form (e.g., writes `EMAIL_1` without brackets, or `[Email_1]` with different casing), the de-anonymizer uses case-insensitive matching with optional bracket tolerance.
4. **Return the de-anonymized response** along with a report of which placeholders were found and restored.

### When NOT to De-anonymize

De-anonymization should be disabled when:

- **The response is logged or stored**: Logs and databases should contain the redacted version to avoid persisting PII in additional locations.
- **The response is displayed to an unauthorized user**: If the end user is not the PII owner, they should see the redacted version.
- **The PII was redacted for a reason beyond transit privacy**: If the intent is to prevent the LLM from using the PII at all (not just to protect it during API transit), de-anonymization defeats the purpose.

De-anonymization is controlled by the `deanonymize` option:

```typescript
const sanitized = sanitize(client, {
  deanonymize: true,   // Default: restore PII in responses
});

const sanitized = sanitize(client, {
  deanonymize: false,  // Keep responses redacted
});
```

### Map Lifecycle

The placeholder map is:
- **Created** when `sanitizeInput()` is called (one map per call).
- **Used** when `sanitizeOutput()` is called with the same map (passed internally by the middleware wrapper).
- **Discarded** after de-anonymization is complete or after the response is returned.
- **Never persisted** to disk, database, or logs. The map contains the original PII values and must be treated as sensitive data.
- **Never shared** across requests. Each LLM API call gets its own map.

In the middleware wrapper, the map is held in a closure scoped to the individual API call. It is eligible for garbage collection as soon as the call completes.

---

## 8. Output Sanitization (Content Moderation)

### Content Moderation Pipeline

Output sanitization proceeds in a fixed sequence:

1. **Extract text**: Extract the response text from the LLM API response object (message content, function call results).
2. **Run content detectors**: Execute all enabled output detectors in parallel. Each detector scans for one category of harmful content and returns an array of `ContentViolation` objects.
3. **Run PII leakage detector**: Scan the output for PII that was not present in the input and was not in the placeholder map. This detects model memorization of PII from training data.
4. **Aggregate violations**: Collect all violations, determine the highest severity, and compute the overall action (pass, warn, block).
5. **Apply action**: If the action is `block`, replace the response with a configurable fallback message. If the action is `warn`, return the response with the violations attached as metadata. If the action is `pass`, return the response unchanged.
6. **De-anonymize** (if enabled and using placeholder strategy): Replace placeholder strings in the response with original PII values.

### 8.1 Profanity Detection

**Category**: `profanity`

**Detection method**: Word list matching against a built-in English profanity word list. The list contains approximately 400 terms covering common profanity, slurs, and vulgar language. Matching is case-insensitive and uses word boundary anchors to prevent matching substrings of legitimate words (e.g., "assess" should not match "ass", "Scunthorpe" should not match a profanity substring).

**Severity**: Low by default. Profanity in LLM output is usually a style issue rather than a safety issue. The severity can be elevated to medium or high via configuration.

**False positive mitigation**: The Scunthorpe problem (legitimate words containing profanity substrings) is addressed by word boundary matching and an exclusion list of known false positives (place names, scientific terms, medical terms that contain profanity substrings).

**Action**: `warn` by default. The response is returned with the profanity violations attached as metadata. Configure `profanity: { action: 'block' }` to block responses containing profanity.

### 8.2 Toxicity Signals

**Category**: `toxicity`

**Detection method**: Pattern matching for toxic language patterns:

- **Hate speech indicators**: Phrases expressing hatred, dehumanization, or discrimination against protected groups. Pattern-based detection for common hate speech structures ("all {group} are", "{group} should be", "I hate {group}"). The group list includes terms for racial, ethnic, religious, gender, and sexual orientation groups.
- **Personal attacks**: Direct insults, name-calling, and ad hominem attacks directed at the user or a third party. Pattern detection for structures like "you are a/an {insult}", "you're {insult}", "{name} is a/an {insult}".
- **Threats**: Language expressing intent to cause harm. Pattern detection for "I will {harm-verb} you", "you deserve to {harm}", "someone should {harm-verb}".

**Severity**: Medium for personal attacks, high for hate speech and threats.

**Limitations**: Pattern-based toxicity detection catches explicit, direct toxic language. It does not detect subtle toxicity, sarcasm, coded language, or context-dependent toxicity. For comprehensive toxicity detection, supplement with a cloud moderation API.

### 8.3 Harmful Instructions

**Category**: `harmful-instruction`

**Detection method**: Pattern matching for instructions describing dangerous activities:

- **Self-harm content**: Instructions or encouragement related to self-harm or suicide. Pattern detection for step-by-step instructions, methods, and encouragement language in the context of self-harm.
- **Dangerous activities**: Instructions for creating weapons, explosives, drugs, or other dangerous materials. Pattern detection for synthesis instructions, ingredient lists, and procedural language in dangerous contexts.
- **Illegal activities**: Instructions for hacking, fraud, identity theft, and other illegal activities.

**Severity**: High for all harmful instruction categories.

**Detection approach**: The detector looks for the combination of instructional language ("how to", "step 1", "first you need to", "ingredients:", "materials:") in proximity to dangerous topic keywords. Instructional language alone is benign. Dangerous topic keywords alone may appear in educational or news contexts. The combination of instructional language plus dangerous topic keywords in the same passage signals harmful instructions.

**Action**: `block` by default. Responses containing harmful instruction violations are replaced with the fallback message.

### 8.4 PII Leakage Detection

**Category**: `pii-leakage`

**Detection method**: Run the same PII detectors used for input sanitization against the LLM output. Compare detected PII entities against the input's placeholder map:

- If a detected PII entity in the output matches a placeholder map entry (the LLM referenced the placeholder and the PII came from the input), it is **not** leakage -- it is expected and will be handled by de-anonymization.
- If a detected PII entity in the output does not match any placeholder map entry and was not present in the original (pre-sanitization) input, it is **leakage** -- the LLM generated PII from its training data (model memorization) or fabricated PII that happens to match a real person's data.

**Severity**: Medium for emails and phone numbers (may be fabricated/hallucinated), high for SSNs and credit card numbers (always concerning).

**Action**: `warn` by default for emails/phones, `block` for SSNs/credit cards. Configurable per entity type.

### 8.5 Content Policy Integration

**Category**: `policy-violation`

**Detection method**: If a `content-policy` enforcer is provided in the configuration, the output sanitizer delegates to it for business rule enforcement. This is optional integration -- `llm-sanitize` does not depend on `content-policy` at the package level.

```typescript
import { createEnforcer, loadPolicy } from 'content-policy';
import { sanitize } from 'llm-sanitize';

const enforcer = createEnforcer(loadPolicy('./policy.yaml'));

const sanitized = sanitize(client, {
  output: {
    policyEnforcer: enforcer,
  },
});
```

When a policy enforcer is configured, the output sanitizer calls `enforcer.check(responseText)` and converts any `error`-severity policy violations into `ContentViolation` objects with category `policy-violation`.

### Severity Levels and Actions

| Severity | Meaning | Default Action |
|----------|---------|----------------|
| `low` | Minor content concern (mild profanity, informal language) | `pass` |
| `medium` | Significant content concern (personal attacks, PII leakage of emails/phones) | `warn` |
| `high` | Critical content concern (hate speech, threats, harmful instructions, SSN/credit card leakage) | `block` |

**Configuring actions per severity**:

```typescript
const sanitized = sanitize(client, {
  output: {
    actions: {
      low: 'pass',     // Ignore low-severity violations
      medium: 'warn',  // Return response but attach violation metadata
      high: 'block',   // Replace response with fallback message
    },
  },
});
```

**Fallback message**: When the action is `block`, the response content is replaced with a configurable fallback message:

```typescript
const sanitized = sanitize(client, {
  output: {
    fallbackMessage: 'I apologize, but I cannot provide that response. Please rephrase your question.',
  },
});
```

Default fallback: `"The response was blocked by the content safety filter."`

---

## 9. API Surface

### Installation

```bash
npm install llm-sanitize
```

### No Runtime Dependencies

`llm-sanitize` has zero runtime dependencies. All PII detection uses built-in `RegExp`. Hashing uses `node:crypto`. Encryption uses `node:crypto`. Fake data generation uses a built-in minimal generator. Profanity detection uses a built-in word list. No external packages are required.

### Main Export: `sanitize`

The primary API. Wraps an LLM SDK client and returns a sanitized client with the same interface.

```typescript
import { sanitize } from 'llm-sanitize';
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const safe = sanitize(client);

// Use exactly like the original client -- sanitization is transparent
const response = await safe.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'user', content: 'My email is john@example.com and my SSN is 123-45-6789. Can you help me file taxes?' },
  ],
});

// Input was sanitized: LLM received "My email is [EMAIL_1] and my SSN is [SSN_1]. Can you help me file taxes?"
// Output was checked for harmful content
// Response was de-anonymized: [EMAIL_1] -> john@example.com (if LLM referenced it)
console.log(response.choices[0].message.content);
```

**With Anthropic**:

```typescript
import { sanitize } from 'llm-sanitize';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const safe = sanitize(client);

const response = await safe.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [
    { role: 'user', content: 'Contact me at (555) 123-4567 or jane@company.org' },
  ],
});
```

**With options**:

```typescript
const safe = sanitize(client, {
  input: {
    entities: ['email', 'phone', 'ssn', 'credit-card'],
    redaction: {
      default: 'placeholder',
      perEntity: {
        'credit-card': 'mask',
        'ssn': 'remove',
      },
    },
  },
  output: {
    profanity: { enabled: true, action: 'warn' },
    toxicity: { enabled: true, action: 'block' },
    harmfulInstructions: { enabled: true, action: 'block' },
    piiLeakage: { enabled: true, action: 'warn' },
  },
  deanonymize: true,
  onInputSanitized: (report) => {
    console.log(`Redacted ${report.entities.length} PII entities`);
  },
  onOutputSanitized: (report) => {
    if (report.violations.length > 0) {
      console.log(`Found ${report.violations.length} content violations`);
    }
  },
});
```

### Standalone: `sanitizeInput`

Sanitize text without the middleware wrapper. Returns a `SanitizedInput` containing the redacted text, detected entities, and placeholder map.

```typescript
import { sanitizeInput } from 'llm-sanitize';

const result = sanitizeInput(
  'My email is john@example.com and my phone is (555) 123-4567',
  { entities: ['email', 'phone'], redaction: { default: 'placeholder' } }
);

console.log(result.text);
// "My email is [EMAIL_1] and my phone is [PHONE_1]"

console.log(result.entities);
// [
//   { type: 'email', value: 'john@example.com', start: 12, end: 28, confidence: 'high', placeholder: '[EMAIL_1]' },
//   { type: 'phone', value: '(555) 123-4567', start: 46, end: 60, confidence: 'high', placeholder: '[PHONE_1]' },
// ]

console.log(result.placeholderMap);
// { entries: { '[EMAIL_1]': 'john@example.com', '[PHONE_1]': '(555) 123-4567' }, ... }
```

### Standalone: `sanitizeOutput`

Check output text for harmful content. Returns a `SanitizedOutput` containing the action taken, all violations found, and the output text (potentially replaced with a fallback if blocked).

```typescript
import { sanitizeOutput } from 'llm-sanitize';

const result = sanitizeOutput(
  'Here is the response text from the LLM...',
  {
    profanity: { enabled: true },
    toxicity: { enabled: true },
    piiLeakage: { enabled: true },
    placeholderMap: previousMap,  // Optional: for de-anonymization
  }
);

console.log(result.action);      // 'pass' | 'warn' | 'block'
console.log(result.violations);  // ContentViolation[]
console.log(result.text);        // Response text (or fallback if blocked)
```

### Detection Only: `detectPII`

Detect PII in text without redacting it. Returns an array of detected entities with their types, values, positions, and confidence levels.

```typescript
import { detectPII } from 'llm-sanitize';

const entities = detectPII(
  'Contact john@example.com or call (555) 123-4567. SSN: 123-45-6789.',
  { entities: ['email', 'phone', 'ssn', 'credit-card'] }
);

console.log(entities);
// [
//   { type: 'email', value: 'john@example.com', start: 8, end: 24, confidence: 'high' },
//   { type: 'phone', value: '(555) 123-4567', start: 33, end: 47, confidence: 'high' },
//   { type: 'ssn', value: '123-45-6789', start: 54, end: 65, confidence: 'high' },
// ]
```

### Factory: `createSanitizer`

Creates a preconfigured sanitizer instance. Useful when sanitizing multiple inputs or outputs with the same configuration, or when using the middleware wrapper is not appropriate.

```typescript
import { createSanitizer } from 'llm-sanitize';

const sanitizer = createSanitizer({
  input: {
    entities: ['email', 'phone', 'ssn', 'credit-card', 'ip-address'],
    redaction: { default: 'placeholder' },
  },
  output: {
    profanity: { enabled: true, action: 'warn' },
    toxicity: { enabled: true, action: 'block' },
    harmfulInstructions: { enabled: true, action: 'block' },
    piiLeakage: { enabled: true, action: 'warn' },
  },
  deanonymize: true,
});

// Use the instance methods
const inputResult = sanitizer.sanitizeInput('My email is john@example.com');
const outputResult = sanitizer.sanitizeOutput('Response text', inputResult.placeholderMap);
const entities = sanitizer.detectPII('Some text with PII');

// Or wrap a client
const safe = sanitizer.wrap(client);
```

### Generic Wrapper: `sanitizeFunction`

Wrap any async function with bidirectional sanitization. The function must accept a string input and return a string output.

```typescript
import { sanitizeFunction } from 'llm-sanitize';

async function myLLMCall(prompt: string): Promise<string> {
  // Custom LLM integration
  return await someCustomLLM(prompt);
}

const safeLLMCall = sanitizeFunction(myLLMCall, {
  input: { entities: ['email', 'phone'] },
  output: { profanity: { enabled: true } },
});

const response = await safeLLMCall('My email is john@example.com. Help me with...');
// Input was sanitized, output was checked
```

### Type Definitions

```typescript
// ── PII Entity ───────────────────────────────────────────────────────

/** A built-in PII entity type. */
type PIIEntityType =
  | 'email'
  | 'phone'
  | 'ssn'
  | 'credit-card'
  | 'ip-address'
  | 'date-of-birth'
  | 'address'
  | 'name'
  | 'passport-id'
  | 'custom';

/** Confidence level of PII detection. */
type PIIConfidence = 'low' | 'medium' | 'high';

/** A detected PII entity in text. */
interface PIIEntity {
  /** The type of PII entity detected. */
  type: PIIEntityType | string;

  /** The detected PII value. */
  value: string;

  /** Start character offset in the original text. */
  start: number;

  /** End character offset in the original text. */
  end: number;

  /** Detection confidence. */
  confidence: PIIConfidence;

  /** The placeholder assigned (if using placeholder redaction). */
  placeholder?: string;

  /** Custom entity subtype (for 'custom' type entities). */
  subtype?: string;
}

// ── Redaction ────────────────────────────────────────────────────────

/** Redaction strategy identifier. */
type RedactionStrategy = 'placeholder' | 'mask' | 'hash' | 'fake' | 'remove' | 'encrypt';

/** Redaction configuration. */
interface RedactionConfig {
  /** Default redaction strategy. Default: 'placeholder'. */
  default: RedactionStrategy;

  /** Per-entity-type strategy overrides. */
  perEntity?: Partial<Record<PIIEntityType | string, RedactionStrategy>>;

  /** Encryption key for 'encrypt' strategy. Required if 'encrypt' is used. */
  encryptionKey?: Buffer;
}

// ── Placeholder Map ──────────────────────────────────────────────────

/** Mapping from placeholder strings to original PII values. */
interface PlaceholderMap {
  /** Placeholder -> original value entries. */
  entries: Record<string, string>;

  /** Per-entity-type counters. */
  counters: Record<string, number>;

  /** Creation timestamp (Date.now()). */
  createdAt: number;
}

// ── Input Sanitization ───────────────────────────────────────────────

/** Options for input sanitization. */
interface InputSanitizeOptions {
  /**
   * PII entity types to detect. Default: all built-in types except
   * 'name' (disabled by default) and 'passport-id' (disabled by default).
   */
  entities?: PIIEntityType[];

  /** Redaction configuration. */
  redaction?: RedactionConfig;

  /** Custom PII entity patterns. */
  customEntities?: CustomEntityConfig[];

  /**
   * Detection sensitivity. Affects which confidence levels are included.
   * 'low': only high-confidence detections.
   * 'medium': high and medium confidence. Default.
   * 'high': all confidence levels including low.
   */
  sensitivity?: 'low' | 'medium' | 'high';
}

/** Configuration for a custom PII entity. */
interface CustomEntityConfig {
  /** Entity type name. */
  type: string;

  /** Detection regex pattern. Must have the 'g' flag. */
  pattern: RegExp;

  /** Placeholder prefix (e.g., 'EMPLOYEE_ID' -> [EMPLOYEE_ID_1]). */
  placeholder: string;

  /** Detection confidence to assign to matches. Default: 'high'. */
  confidence?: PIIConfidence;

  /** Human-readable description. */
  description?: string;
}

/** Result of input sanitization. */
interface SanitizedInput {
  /** The sanitized text with PII redacted. */
  text: string;

  /** All PII entities detected. */
  entities: PIIEntity[];

  /** Placeholder map (populated when using 'placeholder' strategy). */
  placeholderMap: PlaceholderMap;

  /** Number of entities detected per type. */
  summary: Record<string, number>;

  /** Sanitization duration in milliseconds. */
  durationMs: number;
}

// ── Output Sanitization ──────────────────────────────────────────────

/** Options for output sanitization. */
interface OutputSanitizeOptions {
  /** Profanity detection configuration. */
  profanity?: {
    enabled: boolean;
    action?: 'pass' | 'warn' | 'block';
    customWords?: string[];
    excludeWords?: string[];
  };

  /** Toxicity detection configuration. */
  toxicity?: {
    enabled: boolean;
    action?: 'pass' | 'warn' | 'block';
  };

  /** Harmful instruction detection configuration. */
  harmfulInstructions?: {
    enabled: boolean;
    action?: 'pass' | 'warn' | 'block';
  };

  /** PII leakage detection configuration. */
  piiLeakage?: {
    enabled: boolean;
    action?: 'pass' | 'warn' | 'block';
    /** Entity types to check for leakage. Default: all. */
    entities?: PIIEntityType[];
  };

  /** External content policy enforcer (from content-policy package). */
  policyEnforcer?: {
    check(text: string): { pass: boolean; violations: Array<{ ruleId: string; severity: string; message: string }> };
  };

  /** Override default actions by severity. */
  actions?: {
    low?: 'pass' | 'warn' | 'block';
    medium?: 'pass' | 'warn' | 'block';
    high?: 'pass' | 'warn' | 'block';
  };

  /** Fallback message when response is blocked. */
  fallbackMessage?: string;

  /** Placeholder map from input sanitization (for PII leakage and de-anonymization). */
  placeholderMap?: PlaceholderMap;
}

/** A content violation detected in output. */
interface ContentViolation {
  /** Violation category. */
  category: 'profanity' | 'toxicity' | 'harmful-instruction' | 'pii-leakage' | 'policy-violation';

  /** Severity level. */
  severity: 'low' | 'medium' | 'high';

  /** The detected content. */
  matchedText: string;

  /** Start character offset in the output text. */
  start: number;

  /** End character offset in the output text. */
  end: number;

  /** Human-readable description. */
  description: string;
}

/** Result of output sanitization. */
interface SanitizedOutput {
  /** The output text (may be replaced with fallback if blocked). */
  text: string;

  /** Action taken: pass (no issues), warn (issues found but returned), block (replaced with fallback). */
  action: 'pass' | 'warn' | 'block';

  /** All content violations detected. */
  violations: ContentViolation[];

  /** Whether de-anonymization was performed. */
  deanonymized: boolean;

  /** Number of placeholders restored during de-anonymization. */
  placeholdersRestored: number;

  /** Sanitization duration in milliseconds. */
  durationMs: number;
}

// ── Sanitizer Configuration ──────────────────────────────────────────

/** Full configuration for createSanitizer(). */
interface SanitizerConfig {
  /** Input sanitization options. */
  input?: InputSanitizeOptions;

  /** Output sanitization options. */
  output?: OutputSanitizeOptions;

  /** Whether to de-anonymize responses. Default: true. */
  deanonymize?: boolean;

  /** Event hooks. */
  onInputSanitized?: (report: SanitizedInput) => void;
  onOutputSanitized?: (report: SanitizedOutput) => void;
  onViolation?: (violation: ContentViolation) => void;
}

/** Options for the sanitize() middleware wrapper. */
interface SanitizeOptions extends SanitizerConfig {
  /** SDK provider type. Auto-detected if not provided. */
  provider?: 'openai' | 'anthropic' | 'generic';
}

// ── Sanitizer Instance ───────────────────────────────────────────────

/** A preconfigured sanitizer instance. */
interface Sanitizer {
  /** Sanitize input text. */
  sanitizeInput(text: string): SanitizedInput;

  /** Sanitize output text. */
  sanitizeOutput(text: string, placeholderMap?: PlaceholderMap): SanitizedOutput;

  /** Detect PII in text without redacting. */
  detectPII(text: string): PIIEntity[];

  /** Wrap an LLM SDK client with bidirectional sanitization. */
  wrap<T>(client: T): T;
}
```

---

## 10. Configuration

### Default Configuration

When no options are provided to `sanitize()` or `createSanitizer()`:

| Option | Default | Description |
|--------|---------|-------------|
| `input.entities` | `['email', 'phone', 'ssn', 'credit-card', 'ip-address', 'date-of-birth', 'address']` | All built-in entity types except `name` and `passport-id`. |
| `input.redaction.default` | `'placeholder'` | Use typed placeholders for redaction. |
| `input.sensitivity` | `'medium'` | Include high and medium confidence detections. |
| `input.customEntities` | `[]` | No custom PII patterns. |
| `output.profanity` | `{ enabled: true, action: 'warn' }` | Detect profanity, warn but do not block. |
| `output.toxicity` | `{ enabled: true, action: 'block' }` | Detect toxicity, block response. |
| `output.harmfulInstructions` | `{ enabled: true, action: 'block' }` | Detect harmful instructions, block response. |
| `output.piiLeakage` | `{ enabled: true, action: 'warn' }` | Detect PII leakage, warn but do not block. |
| `output.policyEnforcer` | `undefined` | No external policy enforcer. |
| `output.fallbackMessage` | `'The response was blocked by the content safety filter.'` | Default blocked response text. |
| `deanonymize` | `true` | Restore PII in responses via de-anonymization. |
| `onInputSanitized` | `undefined` | No event hook. |
| `onOutputSanitized` | `undefined` | No event hook. |
| `onViolation` | `undefined` | No event hook. |

### Sensitivity Levels

Sensitivity controls which confidence levels of PII detection are included:

| Sensitivity | Confidence Levels Included | Effect |
|-------------|---------------------------|--------|
| `low` | `high` only | Minimal detection. Only clear-cut PII with regex-validated patterns. Lowest false positive rate. |
| `medium` | `high` + `medium` | Balanced detection. Includes context-assisted detection (dates of birth with nearby context cues, addresses with multiple components). Default. |
| `high` | `high` + `medium` + `low` | Aggressive detection. Includes heuristic-only detection (bare dates without context, short addresses, possible names). Highest recall, highest false positive rate. |

### Entity Enable/Disable

Individual entity types can be enabled or disabled:

```typescript
// Detect only emails and phone numbers
const safe = sanitize(client, {
  input: { entities: ['email', 'phone'] },
});

// Detect everything including names (disabled by default)
const safe = sanitize(client, {
  input: { entities: ['email', 'phone', 'ssn', 'credit-card', 'ip-address', 'date-of-birth', 'address', 'name'] },
});
```

### Environment Variables

| Environment Variable | Description |
|---------------------|-------------|
| `LLM_SANITIZE_ENTITIES` | Comma-separated list of entity types to detect. Overrides `input.entities`. |
| `LLM_SANITIZE_STRATEGY` | Default redaction strategy. Overrides `input.redaction.default`. |
| `LLM_SANITIZE_SENSITIVITY` | Detection sensitivity: `low`, `medium`, `high`. Overrides `input.sensitivity`. |
| `LLM_SANITIZE_DEANONYMIZE` | Whether to de-anonymize: `true` or `false`. Overrides `deanonymize`. |
| `LLM_SANITIZE_ENCRYPTION_KEY` | Hex-encoded encryption key for `encrypt` strategy. |

---

## 11. SDK Integration

### OpenAI Client Wrapping

The `sanitize()` function detects an OpenAI client by checking for the `chat.completions.create` method. It wraps this method with a proxy that:

1. **Pre-call**: Iterates over the `messages` array in the request parameters. For each message with role `user` (or all roles if configured), sanitizes the `content` field using `sanitizeInput()`. System messages are optionally sanitized (configurable, default: not sanitized, since system messages are developer-authored, not user-authored). Stores the placeholder map.

2. **Call**: Forwards the sanitized parameters to the real `client.chat.completions.create()`.

3. **Post-call**: Extracts the response message content from `response.choices[0].message.content`. Runs `sanitizeOutput()` with the stored placeholder map. Replaces the response content with the sanitized/de-anonymized content. Returns the modified response object.

```typescript
// The wrapper creates a Proxy that intercepts chat.completions.create
const safe = sanitize(openaiClient);

// This call is intercepted:
const response = await safe.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'My email is john@example.com' },
  ],
});
// Internally:
// 1. User message sanitized: "My email is [EMAIL_1]"
// 2. Forwarded to OpenAI with sanitized messages
// 3. Response checked for harmful content
// 4. Placeholders de-anonymized in response
```

### Anthropic Client Wrapping

The `sanitize()` function detects an Anthropic client by checking for the `messages.create` method. It wraps this method similarly:

1. **Pre-call**: Iterates over the `messages` array. For each message with role `user`, sanitizes the text `content` blocks. The `system` parameter (separate from messages in Anthropic's API) is optionally sanitized.

2. **Call**: Forwards to the real `client.messages.create()`.

3. **Post-call**: Extracts the response text from `response.content[0].text` (for text blocks). Runs output sanitization. Returns the modified response.

```typescript
const safe = sanitize(anthropicClient);

const response = await safe.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  system: 'You are a helpful assistant.',
  messages: [
    { role: 'user', content: 'Call me at (555) 123-4567' },
  ],
});
```

### Generic Function Wrapping

The `sanitizeFunction()` export wraps any async function that takes a string and returns a string:

```typescript
const safeFn = sanitizeFunction(
  async (prompt: string) => {
    // Custom LLM call
    return await myCustomLLM.complete(prompt);
  },
  { input: { entities: ['email', 'phone'] } }
);

const result = await safeFn('My email is john@example.com');
```

### Provider Auto-Detection

The `sanitize()` function auto-detects the provider by duck-typing:
- Has `chat.completions.create` method: OpenAI
- Has `messages.create` method: Anthropic
- Neither: Throws an error suggesting `sanitizeFunction()` for custom integrations

The provider can be explicitly specified via the `provider` option to override auto-detection.

---

## 12. Streaming Support

### Input Sanitization with Streaming

Input sanitization for streaming calls is identical to non-streaming calls. The input is fully available before the stream begins, so it is sanitized in its entirety before the request is sent.

### Output Sanitization with Streaming

Streaming output sanitization requires buffering and scanning chunks as they arrive:

1. **Buffer accumulation**: As chunks arrive from the LLM, the sanitizer accumulates them in a buffer.
2. **Incremental scanning**: After each chunk, the sanitizer runs a fast incremental check on the buffer for harmful content signals. Profanity and toxicity detection can operate on partial text with reasonable accuracy. Harmful instruction detection requires more context and is deferred until a sentence boundary or a configurable buffer size threshold is reached.
3. **Flush decision**: If no violations are detected, accumulated chunks are flushed to the caller. If a violation is detected, the sanitizer can either:
   - **Block immediately**: Stop the stream and emit the fallback message.
   - **Buffer and review**: Hold the stream, accumulate more context to confirm the violation, then decide.
4. **De-anonymization on flush**: As chunks are flushed, placeholder strings that appear completely within a chunk are de-anonymized. If a placeholder spans a chunk boundary, the sanitizer buffers until the full placeholder is assembled before de-anonymizing.

**Streaming with OpenAI**:

```typescript
const safe = sanitize(client);

const stream = await safe.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'My email is john@example.com' }],
  stream: true,
});

for await (const chunk of stream) {
  // Chunks are sanitized and de-anonymized as they arrive
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

**Streaming configuration**:

```typescript
const safe = sanitize(client, {
  streaming: {
    /** Buffer size threshold in characters before running content checks. Default: 200. */
    bufferThreshold: 200,
    /** Action when harmful content is detected mid-stream. Default: 'block'. */
    onViolation: 'block',  // 'block' | 'warn-and-continue'
  },
});
```

**Limitation**: Streaming output sanitization has inherently lower accuracy than non-streaming sanitization because the full response is not available when decisions must be made. Harmful content that spans chunk boundaries may be missed if the buffer threshold is too small. Increasing the buffer threshold improves accuracy but increases latency before the first chunk is visible to the user.

---

## 13. Integration with Monorepo Packages

### With `jailbreak-heuristic`

`jailbreak-heuristic` classifies input for jailbreak attempts; `llm-sanitize` cleans input of PII. They address orthogonal concerns and are typically used together in the request pipeline: classify first (reject malicious input), then sanitize (clean acceptable input).

```typescript
import { classify } from 'jailbreak-heuristic';
import { sanitize } from 'llm-sanitize';

const safe = sanitize(client);

async function handleMessage(userInput: string): Promise<string> {
  // Step 1: Check for jailbreak attempt
  const classification = classify(userInput);
  if (classification.label === 'jailbreak' || classification.label === 'likely-jailbreak') {
    return 'Your message was blocked by the safety filter.';
  }

  // Step 2: Send through sanitized client (PII redaction + output moderation)
  const response = await safe.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: userInput }],
  });

  return response.choices[0].message.content;
}
```

### With `content-policy`

`content-policy` enforces business content rules; `llm-sanitize` handles PII and safety. They can be composed by providing a `content-policy` enforcer to `llm-sanitize`'s output sanitizer, or by running them sequentially.

```typescript
import { sanitize } from 'llm-sanitize';
import { createEnforcer, loadPolicy } from 'content-policy';

const enforcer = createEnforcer(loadPolicy('./policy.yaml'));

// Option 1: Integrate policy enforcer into llm-sanitize
const safe = sanitize(client, {
  output: {
    policyEnforcer: enforcer,
  },
});

// Option 2: Run sequentially
const safe = sanitize(client);
const response = await safe.chat.completions.create({ ... });
const policyResult = enforcer.check(response.choices[0].message.content);
```

### With `llm-audit-log`

Record sanitization events for compliance audit using the event hooks.

```typescript
import { sanitize } from 'llm-sanitize';
import { createAuditLog } from 'llm-audit-log';

const auditLog = createAuditLog({ storage: { type: 'jsonl', path: './audit.jsonl' } });

const safe = sanitize(client, {
  onInputSanitized: async (report) => {
    if (report.entities.length > 0) {
      await auditLog.record({
        actor: 'system',
        model: 'llm-sanitize',
        provider: 'custom',
        input: `Redacted ${report.entities.length} PII entities`,
        output: report.summary,
        tokens: { input: 0, output: 0, total: 0 },
        latencyMs: report.durationMs,
        cost: null,
        metadata: {
          action: 'pii-redaction',
          entityTypes: [...new Set(report.entities.map(e => e.type))],
          entityCount: report.entities.length,
        },
      });
    }
  },
  onViolation: async (violation) => {
    await auditLog.record({
      actor: 'system',
      model: 'llm-sanitize',
      provider: 'custom',
      input: null,
      output: violation,
      tokens: { input: 0, output: 0, total: 0 },
      latencyMs: 0,
      cost: null,
      metadata: {
        action: violation.severity === 'high' ? 'blocked' : 'flagged',
        category: violation.category,
        severity: violation.severity,
      },
    });
  },
});
```

### With `token-fence`

`token-fence` wraps prompt sections with structural boundary markers to prevent cross-section injection. `llm-sanitize` sanitizes the content within those sections. They complement each other: `token-fence` protects prompt structure, `llm-sanitize` protects prompt content.

```typescript
import { sanitize, sanitizeInput } from 'llm-sanitize';
import { fence } from 'token-fence';

// Sanitize user input first, then fence it
const sanitized = sanitizeInput(userMessage);
const fencedInput = fence(sanitized.text, { role: 'user' });

// Send the sanitized, fenced input to the LLM
const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: fencedInput },
  ],
});
```

---

## 14. Testing Strategy

### Unit Tests

Unit tests verify each PII detector and content moderation detector independently.

- **Per-entity PII detection tests**: For each built-in entity type (email, phone, SSN, credit card, IP address, date of birth, address, name, passport-id), test with at least 5 known-positive inputs (valid PII values in various formats) and at least 5 known-negative inputs (values that resemble the PII type but are not, including common false positive candidates). Example: the email detector is tested with `user@domain.com` (positive), `user@domain` (negative -- no TLD), `@username` (negative -- social handle), `user@domain.c` (negative -- single-char TLD), and `git@github.com:org/repo.git` (negative -- git URL).

- **Per-entity redaction tests**: For each redaction strategy and each entity type, verify that the strategy produces the expected output format. Test that `placeholder` creates numbered placeholders, `mask` preserves structure, `hash` produces consistent hashes, `fake` produces format-valid replacements, `remove` produces clean deletions, and `encrypt` produces decryptable ciphertext.

- **Placeholder map tests**: Verify that the placeholder map correctly maps placeholders to original values, that identical values get the same placeholder, that the counter increments for different values of the same type, and that de-anonymization correctly restores all placeholders.

- **De-anonymization tests**: Verify that de-anonymization correctly replaces placeholders in LLM responses, handles partial matches gracefully, handles case variations, and handles multiple occurrences of the same placeholder.

- **Luhn validation tests**: Verify the credit card Luhn algorithm with known valid card numbers (test card numbers from payment processors), known invalid numbers, and edge cases (all zeros, all nines, single digit).

- **SSN validation tests**: Verify SSN validation rules (no 000, 666, 900-999 area numbers; no 00 group; no 0000 serial; known invalid SSNs excluded).

- **Profanity detection tests**: Verify word list matching with boundary detection, case insensitivity, Scunthorpe problem handling, and custom word list additions/exclusions.

- **Toxicity detection tests**: Verify pattern matching for hate speech, personal attacks, and threats with positive and negative examples.

- **PII leakage detection tests**: Verify that PII in output that matches placeholder map entries is not flagged as leakage, while PII that was not in the input is flagged.

- **Streaming tests**: Verify that streaming output sanitization correctly buffers chunks, detects violations across chunk boundaries, and de-anonymizes placeholders that span chunks.

### Integration Tests

- **OpenAI wrapper tests**: Mock the OpenAI SDK client and verify that the wrapper correctly sanitizes input messages, forwards the call, and sanitizes the response. Test with various message structures (single message, multi-turn conversation, system message included).

- **Anthropic wrapper tests**: Same pattern as OpenAI but with Anthropic's message structure (separate system parameter, content blocks).

- **Round-trip tests**: Verify the full cycle: input with PII -> sanitized input -> mock LLM response referencing placeholders -> de-anonymized response with original PII restored.

- **Streaming round-trip tests**: Same as round-trip tests but with streaming responses.

### Performance Tests

- **PII detection latency**: Measure detection time for inputs of varying sizes (100 chars to 100KB) with all entity types enabled. Target: < 1ms for inputs under 4KB.

- **Redaction latency**: Measure redaction time with 0, 5, 20, and 100 PII entities per input. Target: < 0.5ms for inputs with under 20 entities.

- **Output moderation latency**: Measure content moderation time for outputs of varying sizes. Target: < 2ms for outputs under 4KB.

- **Full middleware overhead**: Measure the total time added by the middleware wrapper (input sanitization + output sanitization + de-anonymization) compared to a direct API call. Target: < 5ms total overhead (excluding the LLM API call itself).

### False Positive Benchmarks

- **Email detector**: Test against a corpus of 1000 text samples containing email-like patterns. Target: < 2% false positive rate.
- **Phone detector**: Test against text with numeric sequences (dates, prices, order numbers). Target: < 5% false positive rate.
- **Credit card detector**: Test against text with long numeric strings. Target: < 1% false positive rate (Luhn validation virtually eliminates false positives).
- **Profanity detector**: Test against a corpus of 1000 benign text samples. Target: < 1% false positive rate (Scunthorpe problem mitigations).

### Test Framework

Tests use Vitest, matching the project's existing configuration.

---

## 15. Performance

### Sub-5ms Overhead Requirement

The core performance requirement is that the total sanitization overhead (input sanitization + output sanitization + de-anonymization) adds less than 5 milliseconds to each LLM API call. For context: LLM API calls take 500-5000ms. A 5ms overhead is a 0.1-1% increase in total latency -- negligible.

### PII Detection Performance

All regex patterns are compiled once at module load time or once per `createSanitizer()` call. Pattern objects are reused across sanitization calls. No regex is compiled during a sanitization call.

All patterns are designed to avoid catastrophic backtracking (ReDoS):
- No nested quantifiers.
- Bounded repetition counts.
- No unbounded alternation inside quantifiers.
- All patterns are tested against adversarial inputs to verify sub-1ms matching on inputs up to 100KB.

### Content Moderation Performance

Profanity detection uses a pre-built `Set` for O(1) word lookup combined with regex word boundary extraction. The word list is loaded once and indexed at initialization.

Toxicity pattern matching uses compiled regex patterns evaluated in a single pass over the text.

### Memory

Each sanitization call allocates the result objects (`SanitizedInput`, `SanitizedOutput`, `PIIEntity` array, `ContentViolation` array, `PlaceholderMap`). These are small: typically under 5KB per call. The placeholder map holds original PII values for the duration of the API call (from input sanitization to output de-anonymization) and is then eligible for garbage collection.

The built-in data (profanity word list, fake data pools, Scunthorpe exclusion list) is loaded once at module initialization and shared across all sanitizer instances. Total static memory: approximately 50KB.

### Expected Performance

| Operation | Input Size | Entity Count | Mean Latency |
|-----------|-----------|-------------|-------------|
| `detectPII` | 100 chars | 0-2 | 0.05ms |
| `detectPII` | 1 KB | 0-5 | 0.15ms |
| `detectPII` | 4 KB | 0-10 | 0.40ms |
| `detectPII` | 10 KB | 0-20 | 0.90ms |
| `sanitizeInput` (detect + redact) | 1 KB | 3 | 0.25ms |
| `sanitizeInput` (detect + redact) | 4 KB | 10 | 0.60ms |
| `sanitizeOutput` (content mod) | 1 KB | -- | 0.30ms |
| `sanitizeOutput` (content mod) | 4 KB | -- | 0.80ms |
| Full middleware overhead | 1 KB in, 2 KB out | 3 entities | 0.7ms |
| Full middleware overhead | 4 KB in, 8 KB out | 10 entities | 2.0ms |

---

## 16. Dependencies

### Runtime Dependencies

None. Zero. This is a hard requirement. `llm-sanitize` must not depend on any npm package at runtime. All functionality is implemented using built-in JavaScript and Node.js capabilities:

- **Pattern matching**: Built-in `RegExp`.
- **Hashing**: `node:crypto` (`createHash('sha256')`).
- **Encryption**: `node:crypto` (`createCipheriv`, `createDecipheriv` for AES-256-GCM).
- **Random data**: `node:crypto` (`randomBytes` for IVs, `randomInt` for fake data).
- **Timing**: `performance.now()` from built-in `perf_hooks`.
- **Text processing**: Built-in `String.prototype` methods and `Intl` APIs.

The zero-dependency constraint exists for three reasons:
1. **Security**: The package operates in a security-critical position (filtering data between users and LLMs). Every dependency is a supply chain attack vector. Zero dependencies means zero supply chain risk from this package.
2. **Size**: The package should be lightweight (~30KB minified). Dependencies add size.
3. **Compatibility**: The package should work in any Node.js 18+ environment without native module compilation or platform-specific binaries.

### Dev Dependencies

| Dependency | Purpose |
|-----------|---------|
| `typescript` | TypeScript compiler. |
| `vitest` | Test runner. |
| `eslint` | Linter. |

---

## 17. File Structure

```
llm-sanitize/
├── src/
│   ├── index.ts                  # Public API: sanitize, sanitizeInput, sanitizeOutput, detectPII,
│   │                             #   createSanitizer, sanitizeFunction
│   ├── types.ts                  # All TypeScript type definitions
│   ├── sanitizer.ts              # Core Sanitizer class: orchestrates input/output sanitization
│   ├── middleware.ts             # SDK client wrapping: OpenAI, Anthropic, generic function
│   ├── input/
│   │   ├── index.ts              # Input sanitization pipeline orchestration
│   │   ├── detector.ts           # Base PII detector interface and shared utilities
│   │   ├── email.ts              # Email address detector
│   │   ├── phone.ts              # Phone number detector (multi-format)
│   │   ├── ssn.ts                # Social Security Number detector with validation
│   │   ├── credit-card.ts        # Credit card number detector with Luhn validation
│   │   ├── ip-address.ts         # IP address detector (IPv4, IPv6)
│   │   ├── date-of-birth.ts      # Date of birth detector with context analysis
│   │   ├── address.ts            # Physical address detector (heuristic)
│   │   ├── name.ts               # Person name detector (heuristic, disabled by default)
│   │   ├── passport-id.ts        # Passport/ID number detector (configurable patterns)
│   │   ├── custom.ts             # Custom entity detector registration
│   │   └── dedup.ts              # Entity deduplication and overlap resolution
│   ├── redaction/
│   │   ├── index.ts              # Redaction strategy dispatcher
│   │   ├── placeholder.ts        # Placeholder redaction strategy and map construction
│   │   ├── mask.ts               # Masking redaction strategy
│   │   ├── hash.ts               # Hash redaction strategy
│   │   ├── fake.ts               # Fake data redaction strategy and generator
│   │   ├── remove.ts             # Remove redaction strategy
│   │   └── encrypt.ts            # Encrypt/decrypt redaction strategy
│   ├── output/
│   │   ├── index.ts              # Output sanitization pipeline orchestration
│   │   ├── profanity.ts          # Profanity detection with word list
│   │   ├── toxicity.ts           # Toxicity signal detection
│   │   ├── harmful.ts            # Harmful instruction detection
│   │   ├── pii-leakage.ts        # PII leakage detection (output vs. input comparison)
│   │   └── wordlist.ts           # Built-in profanity word list and exclusion list
│   ├── deanonymize.ts            # De-anonymization: placeholder restoration in output
│   ├── streaming.ts              # Streaming-specific buffering and incremental scanning
│   └── config.ts                 # Configuration parsing, defaults, environment variable loading
├── src/__tests__/
│   ├── sanitize.test.ts          # Tests for sanitize() middleware wrapper
│   ├── sanitize-input.test.ts    # Tests for sanitizeInput() standalone
│   ├── sanitize-output.test.ts   # Tests for sanitizeOutput() standalone
│   ├── detect-pii.test.ts        # Tests for detectPII() standalone
│   ├── create-sanitizer.test.ts  # Tests for createSanitizer() factory
│   ├── input/
│   │   ├── email.test.ts         # Email detector tests
│   │   ├── phone.test.ts         # Phone number detector tests
│   │   ├── ssn.test.ts           # SSN detector and validation tests
│   │   ├── credit-card.test.ts   # Credit card detector and Luhn tests
│   │   ├── ip-address.test.ts    # IP address detector tests
│   │   ├── date-of-birth.test.ts # Date of birth detector tests
│   │   ├── address.test.ts       # Address detector tests
│   │   ├── name.test.ts          # Name detector tests
│   │   ├── passport-id.test.ts   # Passport/ID number detector tests
│   │   ├── custom.test.ts        # Custom entity detector tests
│   │   └── dedup.test.ts         # Deduplication and overlap resolution tests
│   ├── redaction/
│   │   ├── placeholder.test.ts   # Placeholder strategy and map tests
│   │   ├── mask.test.ts          # Masking strategy tests
│   │   ├── hash.test.ts          # Hash strategy tests
│   │   ├── fake.test.ts          # Fake data strategy tests
│   │   ├── remove.test.ts        # Remove strategy tests
│   │   └── encrypt.test.ts       # Encrypt/decrypt strategy tests
│   ├── output/
│   │   ├── profanity.test.ts     # Profanity detection tests
│   │   ├── toxicity.test.ts      # Toxicity detection tests
│   │   ├── harmful.test.ts       # Harmful instruction detection tests
│   │   └── pii-leakage.test.ts   # PII leakage detection tests
│   ├── deanonymize.test.ts       # De-anonymization tests
│   ├── streaming.test.ts         # Streaming sanitization tests
│   ├── middleware.test.ts        # SDK wrapper tests (OpenAI, Anthropic)
│   ├── integration.test.ts       # Round-trip integration tests
│   ├── false-positives.test.ts   # False positive benchmark tests
│   └── performance.test.ts       # Performance benchmark tests
├── package.json
├── tsconfig.json
├── SPEC.md                       # This file
└── README.md
```

---

## 18. Implementation Roadmap

### Phase 1: Core PII Detection and Redaction

1. Define TypeScript types (`types.ts`).
2. Implement the PII detector interface and shared utilities (`input/detector.ts`).
3. Implement the four highest-confidence PII detectors: email, phone, SSN (with validation), and credit card (with Luhn validation) (`input/email.ts`, `input/phone.ts`, `input/ssn.ts`, `input/credit-card.ts`).
4. Implement the `placeholder` redaction strategy and placeholder map construction (`redaction/placeholder.ts`).
5. Implement the input sanitization pipeline: detection, deduplication, redaction (`input/index.ts`, `input/dedup.ts`).
6. Implement `sanitizeInput()` and `detectPII()` public API (`index.ts`).
7. Write unit tests for each detector, the placeholder strategy, and the input pipeline.
8. Verify sub-1ms performance for detection on inputs under 4KB.

### Phase 2: Extended PII Detection and Redaction Strategies

9. Implement remaining PII detectors: IP address, date of birth (with context analysis), physical address (heuristic), person name (heuristic), and passport/ID number (`input/ip-address.ts`, `input/date-of-birth.ts`, `input/address.ts`, `input/name.ts`, `input/passport-id.ts`).
10. Implement custom entity detector registration (`input/custom.ts`).
11. Implement remaining redaction strategies: `mask`, `hash`, `fake` (with built-in fake data generator), `remove`, and `encrypt` (`redaction/mask.ts`, `redaction/hash.ts`, `redaction/fake.ts`, `redaction/remove.ts`, `redaction/encrypt.ts`).
12. Implement per-entity-type strategy configuration (`redaction/index.ts`).
13. Write unit tests for all new detectors and redaction strategies.

### Phase 3: Output Sanitization

14. Implement profanity detection with built-in word list and Scunthorpe mitigations (`output/profanity.ts`, `output/wordlist.ts`).
15. Implement toxicity signal detection (`output/toxicity.ts`).
16. Implement harmful instruction detection (`output/harmful.ts`).
17. Implement PII leakage detection (`output/pii-leakage.ts`).
18. Implement the output sanitization pipeline: detection, severity aggregation, action determination (`output/index.ts`).
19. Implement `sanitizeOutput()` public API.
20. Write unit tests for each output detector and the output pipeline.

### Phase 4: De-anonymization and Middleware

21. Implement de-anonymization: placeholder restoration in output text (`deanonymize.ts`).
22. Implement the middleware wrapper for OpenAI SDK client (`middleware.ts`).
23. Implement the middleware wrapper for Anthropic SDK client (`middleware.ts`).
24. Implement `sanitize()` public API with provider auto-detection.
25. Implement `sanitizeFunction()` for generic async function wrapping.
26. Implement `createSanitizer()` factory.
27. Write integration tests for full round-trip sanitization (input -> LLM -> output -> de-anonymization).
28. Write middleware wrapper tests with mock SDK clients.

### Phase 5: Streaming, Configuration, and Events

29. Implement streaming output sanitization with buffering and incremental scanning (`streaming.ts`).
30. Implement configuration parsing, defaults, and environment variable loading (`config.ts`).
31. Implement event hooks (`onInputSanitized`, `onOutputSanitized`, `onViolation`).
32. Write streaming sanitization tests.
33. Write false positive benchmark tests.
34. Write performance benchmark tests.
35. Verify total middleware overhead < 5ms for typical inputs.

---

## 19. Example Use Cases

### GDPR-Compliant Chatbot

A European e-commerce company deploys a customer support chatbot powered by GPT-4. Under GDPR, sending customer PII (names, emails, addresses) to OpenAI's US-based servers creates a data transfer compliance risk. The company wraps their OpenAI client with `llm-sanitize`:

```typescript
import OpenAI from 'openai';
import { sanitize } from 'llm-sanitize';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const safe = sanitize(client, {
  input: {
    entities: ['email', 'phone', 'name', 'address'],
    redaction: { default: 'placeholder' },
  },
  deanonymize: true,
});

// Customer message: "Hi, I'm Hans Mueller, my order to Berliner Str. 42, 10115 Berlin
//   hasn't arrived. Please contact me at hans.mueller@email.de or +49 30 12345678"
//
// Sent to OpenAI: "Hi, I'm [NAME_1], my order to [ADDRESS_1] hasn't arrived.
//   Please contact me at [EMAIL_1] or [PHONE_1]"
//
// OpenAI response: "I'm sorry about the delay, [NAME_1]. I've checked your order to
//   [ADDRESS_1] and it's scheduled for delivery tomorrow. I'll send a confirmation
//   to [EMAIL_1]."
//
// Returned to customer: "I'm sorry about the delay, Hans Mueller. I've checked your
//   order to Berliner Str. 42, 10115 Berlin and it's scheduled for delivery tomorrow.
//   I'll send a confirmation to hans.mueller@email.de."
```

### Healthcare AI Assistant

A telehealth platform uses Claude to help nurses summarize patient notes. Patient PHI (names, dates of birth, medical record numbers) must not be sent to Anthropic's servers per HIPAA requirements.

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { sanitize } from 'llm-sanitize';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const safe = sanitize(client, {
  input: {
    entities: ['name', 'date-of-birth', 'ssn', 'phone', 'email', 'address'],
    sensitivity: 'high',
    customEntities: [
      {
        type: 'medical-record',
        pattern: /\bMRN[-:\s]?\d{7,10}\b/gi,
        placeholder: 'MEDICAL_RECORD',
        confidence: 'high',
      },
    ],
    redaction: { default: 'placeholder' },
  },
  deanonymize: true,
  output: {
    harmfulInstructions: { enabled: true, action: 'block' },
    piiLeakage: { enabled: true, action: 'block' },
  },
});
```

### Customer Support with PII Protection

A SaaS company uses an AI agent to handle tier-1 support tickets. Tickets contain customer PII (names, emails, account numbers) that should not be sent to the LLM provider. The support agent needs the AI to understand the ticket context but not retain the customer's actual PII.

```typescript
import { sanitize } from 'llm-sanitize';

const safe = sanitize(client, {
  input: {
    entities: ['email', 'phone', 'credit-card', 'name'],
    redaction: {
      default: 'placeholder',
      perEntity: { 'credit-card': 'mask' },  // Always mask card numbers
    },
  },
  deanonymize: true,
  onInputSanitized: (report) => {
    // Log sanitization events for SOC 2 compliance
    logger.info('PII sanitized', {
      entityCount: report.entities.length,
      entityTypes: report.summary,
    });
  },
});
```

### Enterprise Content Filtering Pipeline

An enterprise AI platform combines multiple safety layers:

```typescript
import { classify } from 'jailbreak-heuristic';
import { sanitize } from 'llm-sanitize';
import { createEnforcer, loadPolicy } from 'content-policy';
import { createAuditLog } from 'llm-audit-log';

const enforcer = createEnforcer(loadPolicy('./enterprise-policy.yaml'));
const auditLog = createAuditLog({ storage: { type: 'jsonl', path: './audit.jsonl' } });

const safe = sanitize(client, {
  output: { policyEnforcer: enforcer },
  onInputSanitized: async (report) => {
    await auditLog.record({ /* ... */ });
  },
  onViolation: async (violation) => {
    await auditLog.record({ /* ... */ });
  },
});

async function processRequest(userId: string, message: string): Promise<string> {
  // Layer 1: Jailbreak detection
  const jailbreakResult = classify(message);
  if (jailbreakResult.label === 'jailbreak') {
    return 'Input blocked.';
  }

  // Layer 2: Bidirectional sanitization (PII + content moderation + policy)
  const response = await safe.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: message }],
  });

  return response.choices[0].message.content;
}
```
