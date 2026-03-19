# llm-sanitize — Task Breakdown

## Phase 1: Project Setup and Scaffolding

- [ ] **Install dev dependencies** — Add `typescript`, `vitest`, and `eslint` as devDependencies in `package.json`. Run `npm install` to generate `node_modules` and `package-lock.json`. | Status: not_done
- [ ] **Configure ESLint** — Create `.eslintrc` (or equivalent) with TypeScript support matching monorepo conventions. Ensure `npm run lint` works against `src/`. | Status: not_done
- [ ] **Create directory structure** — Create all subdirectories specified in the file structure: `src/input/`, `src/redaction/`, `src/output/`, and `src/__tests__/` (with `input/`, `redaction/`, `output/` subdirectories under `__tests__/`). | Status: not_done
- [ ] **Verify build pipeline** — Confirm `npm run build` produces output in `dist/` with declaration files. Confirm `npm run test` runs vitest. Confirm `npm run lint` runs eslint. | Status: not_done

## Phase 2: Type Definitions (`src/types.ts`)

- [ ] **Define PIIEntityType union type** — Define the union `'email' | 'phone' | 'ssn' | 'credit-card' | 'ip-address' | 'date-of-birth' | 'address' | 'name' | 'passport-id' | 'custom'`. | Status: not_done
- [ ] **Define PIIConfidence type** — Define the union `'low' | 'medium' | 'high'`. | Status: not_done
- [ ] **Define PIIEntity interface** — Include `type`, `value`, `start`, `end`, `confidence`, optional `placeholder`, and optional `subtype` fields. | Status: not_done
- [ ] **Define RedactionStrategy type** — Define the union `'placeholder' | 'mask' | 'hash' | 'fake' | 'remove' | 'encrypt'`. | Status: not_done
- [ ] **Define RedactionConfig interface** — Include `default` strategy, optional `perEntity` overrides, and optional `encryptionKey` (Buffer). | Status: not_done
- [ ] **Define PlaceholderMap interface** — Include `entries` (Record<string, string>), `counters` (Record<string, number>), and `createdAt` (number). | Status: not_done
- [ ] **Define InputSanitizeOptions interface** — Include `entities` array, `redaction` config, `customEntities` array, and `sensitivity` level. | Status: not_done
- [ ] **Define CustomEntityConfig interface** — Include `type`, `pattern` (RegExp), `placeholder`, optional `confidence`, and optional `description`. | Status: not_done
- [ ] **Define SanitizedInput interface** — Include `text`, `entities` array, `placeholderMap`, `summary` record, and `durationMs`. | Status: not_done
- [ ] **Define OutputSanitizeOptions interface** — Include `profanity`, `toxicity`, `harmfulInstructions`, `piiLeakage` configs, optional `policyEnforcer`, `actions` overrides, `fallbackMessage`, and optional `placeholderMap`. | Status: not_done
- [ ] **Define ContentViolation interface** — Include `category`, `severity`, `matchedText`, `start`, `end`, and `description`. | Status: not_done
- [ ] **Define SanitizedOutput interface** — Include `text`, `action`, `violations` array, `deanonymized` boolean, `placeholdersRestored` count, and `durationMs`. | Status: not_done
- [ ] **Define SanitizerConfig interface** — Include `input` options, `output` options, `deanonymize` boolean, and event hooks (`onInputSanitized`, `onOutputSanitized`, `onViolation`). | Status: not_done
- [ ] **Define SanitizeOptions interface** — Extend `SanitizerConfig` with optional `provider` field (`'openai' | 'anthropic' | 'generic'`). | Status: not_done
- [ ] **Define Sanitizer interface** — Include `sanitizeInput()`, `sanitizeOutput()`, `detectPII()`, and `wrap()` methods. | Status: not_done
- [ ] **Define streaming configuration types** — Define `StreamingConfig` with `bufferThreshold` (number) and `onViolation` (`'block' | 'warn-and-continue'`). | Status: not_done

## Phase 3: Core PII Detectors (`src/input/`)

### Base Detector Infrastructure

- [ ] **Implement base detector interface** — Create `src/input/detector.ts` with a base `PIIDetector` interface/abstract class defining `detect(text: string): PIIEntity[]`. Include shared utilities for regex matching with position tracking. | Status: not_done
- [ ] **Implement entity deduplication** — Create `src/input/dedup.ts` implementing overlap resolution: when multiple detectors flag overlapping ranges, keep the detection with higher confidence; if equal, prefer the more specific type. | Status: not_done

### Individual Detectors

- [ ] **Implement email detector** — Create `src/input/email.ts`. Pattern: `[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`. Confidence: high. Exclude bare `@username` references and git URLs. | Status: not_done
- [ ] **Implement phone detector** — Create `src/input/phone.ts`. Multiple patterns: US (with/without +1), UK (+44, local 0xxxx), international (+CC format). Require at least 7 digits. Exclude bare digit sequences, ZIP codes, short numerics. Confidence: high. | Status: not_done
- [ ] **Implement SSN detector** — Create `src/input/ssn.ts`. Pattern: `\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b`. Add validation: no 000/666/900-999 area, no 00 group, no 0000 serial, exclude known invalid SSNs (078-05-1120). Context-boost: if "SSN", "social security", "social" nearby, confidence = high; else medium. | Status: not_done
- [ ] **Implement credit card detector** — Create `src/input/credit-card.ts`. Patterns for Visa, Mastercard (5xxx and 2xxx series), Amex, Discover. Implement Luhn algorithm validation. Only classify numbers passing Luhn check. Confidence: high. | Status: not_done
- [ ] **Implement Luhn algorithm** — Implement the Luhn checksum within `src/input/credit-card.ts`: double every second digit from right, subtract 9 if >9, sum all, check divisibility by 10. | Status: not_done
- [ ] **Implement IP address detector** — Create `src/input/ip-address.ts`. Patterns: IPv4 (validate 0-255 octets), IPv6 (full and compressed forms). Optionally exclude localhost, broadcast, and private ranges via config. Confidence: high. | Status: not_done
- [ ] **Implement date of birth detector** — Create `src/input/date-of-birth.ts`. Patterns: US (MM/DD/YYYY), EU (DD.MM.YYYY), ISO 8601 (YYYY-MM-DD), written (Month DD, YYYY). Context analysis within 50-char window: high confidence with "born"/"DOB"/"birthday" etc., medium if preceded by name-like pattern and date >10 years ago, low without context cues. | Status: not_done
- [ ] **Implement address detector** — Create `src/input/address.ts`. Heuristic pattern matching for US/UK addresses: street number + street name + street type suffix. Optional unit, city, state, ZIP components that increase confidence. Minimum match: number + name + type. | Status: not_done
- [ ] **Implement name detector** — Create `src/input/name.ts`. Heuristic: sequences of 2-4 capitalized words not starting a sentence. Exclude known proper nouns (countries, cities, companies, months, days). Context cues: titles (Mr./Mrs./Dr.), "name", "by", "from", "signed". Disabled by default. High confidence with title, medium with context, low with capitalization only. | Status: not_done
- [ ] **Implement passport/ID detector** — Create `src/input/passport-id.ts`. Pre-configured patterns (US: letter+8 digits, UK: 9 digits, EU generic: 1-2 letters + 6-8 digits). All disabled by default; enabled via config with country selection. Require context cues ("passport", "ID number") within 30 chars. | Status: not_done
- [ ] **Implement custom entity detector** — Create `src/input/custom.ts`. Accept user-defined regex patterns with type, placeholder prefix, confidence, and description. Evaluate after built-in detectors. Deduplicate against built-in matches. | Status: not_done

### Input Pipeline

- [ ] **Implement input sanitization pipeline** — Create `src/input/index.ts`. Orchestrate: (1) extract text, (2) run all enabled detectors, (3) deduplicate/resolve overlaps, (4) apply redaction strategies, (5) build placeholder map, (6) return `SanitizedInput`. | Status: not_done
- [ ] **Implement sensitivity filtering** — In the input pipeline, filter detected entities by confidence based on sensitivity level: `low` = high-confidence only, `medium` = high+medium, `high` = all. Default: medium. | Status: not_done

## Phase 4: Redaction Strategies (`src/redaction/`)

- [ ] **Implement redaction dispatcher** — Create `src/redaction/index.ts`. Accept an entity and a strategy config, dispatch to the appropriate strategy module. Support per-entity-type strategy overrides. | Status: not_done
- [ ] **Implement placeholder strategy** — Create `src/redaction/placeholder.ts`. Format: `[{ENTITY_TYPE}_{N}]`. Build and maintain `PlaceholderMap`. Same value gets same placeholder. Counter increments per type. Fully reversible. | Status: not_done
- [ ] **Implement mask strategy** — Create `src/redaction/mask.ts`. Per-entity masking rules: email (first char + `***` + `@` + first char + `***` + last 4 of domain), phone (preserve area code, mask middle, show last 2), SSN (mask first 5, show last 4), credit card (mask all but last 4), IP (mask last two octets), DOB (mask day/month, show year), address (mask street number/name), name (first char + `***` per word). Not reversible. | Status: not_done
- [ ] **Implement hash strategy** — Create `src/redaction/hash.ts`. SHA-256 hash of value, truncated to first 12 hex chars. Format: `[SHA256:{hash}]`. Use `node:crypto`. Consistent: same value always produces same hash. Not reversible. | Status: not_done
- [ ] **Implement fake data strategy** — Create `src/redaction/fake.ts`. Built-in minimal generator (no faker dependency). Generate format-correct fake values: email (random first.last@domain from fixed pools), phone (555 area code), SSN (valid format), credit card (Luhn-valid with correct prefix), IP (documentation ranges), DOB (1940-2005), address (random from pool), name (random from pool). Seed with hash of original value for per-request consistency. | Status: not_done
- [ ] **Build fake data pools** — Within `src/redaction/fake.ts`, create fixed pools of common first names, last names, domain names, street names, and city names for fake data generation. | Status: not_done
- [ ] **Implement remove strategy** — Create `src/redaction/remove.ts`. Delete PII entirely. Collapse adjacent whitespace to single space. Not reversible. | Status: not_done
- [ ] **Implement encrypt strategy** — Create `src/redaction/encrypt.ts`. AES-256-GCM encryption using `node:crypto`. Format: `[ENC:{base64(iv)}:{base64(ciphertext)}:{base64(authTag)}]`. Require encryption key in config. Export `decryptPII(encryptedValue, key)` utility. Fully reversible with key. | Status: not_done

## Phase 5: Output Sanitization (`src/output/`)

- [ ] **Build profanity word list** — Create `src/output/wordlist.ts`. Include ~400 English profanity terms. Include exclusion list for Scunthorpe problem (place names, scientific/medical terms containing profanity substrings). | Status: not_done
- [ ] **Implement profanity detector** — Create `src/output/profanity.ts`. Word list matching with case-insensitive, word-boundary-anchored patterns. Handle Scunthorpe problem via exclusion list. Support custom word additions and exclusions. Default severity: low. Default action: warn. | Status: not_done
- [ ] **Implement toxicity detector** — Create `src/output/toxicity.ts`. Pattern matching for: hate speech indicators ("all {group} are", "{group} should be", "I hate {group}" with protected group terms), personal attacks ("you are a/an {insult}"), threats ("I will {harm-verb} you", "you deserve to {harm}"). Severity: medium for personal attacks, high for hate speech and threats. | Status: not_done
- [ ] **Implement harmful instruction detector** — Create `src/output/harmful.ts`. Detect combination of instructional language ("how to", "step 1", "first you need to", "ingredients:", "materials:") in proximity to dangerous topic keywords (self-harm, weapons, explosives, drugs, hacking, fraud). Severity: high. Default action: block. | Status: not_done
- [ ] **Implement PII leakage detector** — Create `src/output/pii-leakage.ts`. Run PII detectors on output text. Compare against placeholder map: if detected PII matches a placeholder map entry, it is expected (not leakage). If detected PII was not in original input, flag as leakage. Severity: medium for emails/phones, high for SSNs/credit cards. Default action: warn for emails/phones, block for SSNs/credit cards. | Status: not_done
- [ ] **Implement output sanitization pipeline** — Create `src/output/index.ts`. Orchestrate: (1) extract response text, (2) run all enabled content detectors in parallel, (3) run PII leakage detection, (4) aggregate violations, (5) determine highest severity, (6) compute overall action (pass/warn/block), (7) apply action (replace with fallback if blocked, attach violations if warned), (8) de-anonymize if enabled. | Status: not_done
- [ ] **Implement severity-to-action mapping** — Support configurable action overrides per severity level. Defaults: low = pass, medium = warn, high = block. Allow per-category action overrides to take precedence over severity defaults. | Status: not_done
- [ ] **Implement fallback message** — When action is `block`, replace response content with configurable fallback message. Default: `"The response was blocked by the content safety filter."` | Status: not_done
- [ ] **Implement content-policy integration** — In the output pipeline, if a `policyEnforcer` is provided, call `enforcer.check(text)` and convert error-severity policy violations into `ContentViolation` objects with category `policy-violation`. | Status: not_done

## Phase 6: De-anonymization (`src/deanonymize.ts`)

- [ ] **Implement placeholder restoration** — Scan response text for all placeholder strings from the map. Replace with original values. Process in order of longest placeholder first to prevent partial matches. Replace all occurrences of each placeholder. | Status: not_done
- [ ] **Handle partial/variant mentions** — Implement case-insensitive matching with optional bracket tolerance for LLM variations (e.g., `EMAIL_1` without brackets, `[Email_1]` with different casing). | Status: not_done
- [ ] **Return de-anonymization report** — Track and return which placeholders were found and restored, and how many replacements were made. | Status: not_done
- [ ] **Implement deanonymize toggle** — Respect the `deanonymize` config option: when `false`, skip de-anonymization entirely and return the redacted response as-is. Default: `true`. | Status: not_done

## Phase 7: Configuration (`src/config.ts`)

- [ ] **Implement default configuration** — Define all defaults as specified: entities (all except name and passport-id), redaction (placeholder), sensitivity (medium), profanity (enabled, warn), toxicity (enabled, block), harmful instructions (enabled, block), PII leakage (enabled, warn), deanonymize (true), fallback message. | Status: not_done
- [ ] **Implement configuration merging** — Deep-merge user-provided options with defaults. Handle partial overrides correctly (e.g., overriding only `perEntity` without resetting `default`). | Status: not_done
- [ ] **Implement environment variable loading** — Read `LLM_SANITIZE_ENTITIES` (comma-separated), `LLM_SANITIZE_STRATEGY`, `LLM_SANITIZE_SENSITIVITY`, `LLM_SANITIZE_DEANONYMIZE` (true/false), and `LLM_SANITIZE_ENCRYPTION_KEY` (hex-encoded). Env vars override programmatic config. | Status: not_done
- [ ] **Validate configuration** — Validate entity types, strategy names, sensitivity levels, and encryption key presence when `encrypt` strategy is used. Throw descriptive errors for invalid configs. | Status: not_done

## Phase 8: Core Sanitizer Class (`src/sanitizer.ts`)

- [ ] **Implement Sanitizer class** — Create `src/sanitizer.ts`. Accept `SanitizerConfig`. Store resolved configuration. Expose `sanitizeInput()`, `sanitizeOutput()`, `detectPII()`, and `wrap()` methods. | Status: not_done
- [ ] **Wire sanitizeInput method** — Delegate to the input pipeline with the configured options. Fire `onInputSanitized` event hook after sanitization. Return `SanitizedInput`. | Status: not_done
- [ ] **Wire sanitizeOutput method** — Delegate to the output pipeline with the configured options. Accept optional `PlaceholderMap` for PII leakage comparison and de-anonymization. Fire `onOutputSanitized` event hook. Fire `onViolation` for each violation. Return `SanitizedOutput`. | Status: not_done
- [ ] **Wire detectPII method** — Delegate to the detection phase of the input pipeline only (no redaction). Return `PIIEntity[]`. | Status: not_done
- [ ] **Implement wrap method** — Delegate to the middleware module for SDK client wrapping. Auto-detect provider. Return a proxied client with the same type. | Status: not_done
- [ ] **Implement timing** — Use `performance.now()` to measure `durationMs` for both input and output sanitization. | Status: not_done

## Phase 9: Middleware Wrapper (`src/middleware.ts`)

- [ ] **Implement provider auto-detection** — Duck-type the client: has `chat.completions.create` = OpenAI, has `messages.create` = Anthropic, neither = throw error suggesting `sanitizeFunction()`. Allow explicit `provider` option to override. | Status: not_done
- [ ] **Implement OpenAI wrapper** — Create a Proxy wrapping `client.chat.completions.create`. Pre-call: iterate `messages` array, sanitize `content` of `user` role messages (optionally system messages), store placeholder map in closure. Call: forward sanitized params to real method. Post-call: extract `response.choices[0].message.content`, run output sanitization with placeholder map, replace content, return modified response. | Status: not_done
- [ ] **Implement Anthropic wrapper** — Create a Proxy wrapping `client.messages.create`. Pre-call: iterate `messages` array, sanitize text content blocks of `user` role messages, optionally sanitize `system` parameter, store placeholder map. Call: forward to real method. Post-call: extract `response.content[0].text`, run output sanitization, return modified response. | Status: not_done
- [ ] **Handle multi-turn conversations** — When multiple user messages exist in the messages array, sanitize each independently. Maintain a combined placeholder map across all messages in the same request. | Status: not_done
- [ ] **Handle system message sanitization** — Make system message sanitization configurable (default: not sanitized, since developer-authored). When enabled, sanitize system messages the same way as user messages. | Status: not_done

## Phase 10: Generic Function Wrapper and Public API (`src/index.ts`)

- [ ] **Implement sanitizeFunction** — Create wrapper for any `(input: string) => Promise<string>` async function. Pre-call: sanitize input. Call: forward sanitized string. Post-call: sanitize output with placeholder map, de-anonymize, return sanitized result. | Status: not_done
- [ ] **Export sanitize function** — Public API: `sanitize(client, options?)`. Delegate to `createSanitizer()` internally, then call `wrap()` on the sanitizer. | Status: not_done
- [ ] **Export sanitizeInput function** — Public API: `sanitizeInput(text, options?)`. Create a one-off sanitizer and call `sanitizeInput()`. | Status: not_done
- [ ] **Export sanitizeOutput function** — Public API: `sanitizeOutput(text, options?)`. Create a one-off sanitizer and call `sanitizeOutput()`. | Status: not_done
- [ ] **Export detectPII function** — Public API: `detectPII(text, options?)`. Create a one-off sanitizer and call `detectPII()`. | Status: not_done
- [ ] **Export createSanitizer function** — Public API: `createSanitizer(config)`. Return a `Sanitizer` instance. | Status: not_done
- [ ] **Export decryptPII utility** — Public API: `decryptPII(encryptedValue, key)`. AES-256-GCM decryption for the `encrypt` strategy. | Status: not_done
- [ ] **Export all types** — Re-export all TypeScript interfaces and type definitions from `types.ts`. | Status: not_done

## Phase 11: Streaming Support (`src/streaming.ts`)

- [ ] **Implement stream buffer accumulator** — Buffer incoming chunks from streaming LLM responses. Track accumulated text length. | Status: not_done
- [ ] **Implement incremental content scanning** — After each chunk, run fast incremental check on buffer for profanity and toxicity. Defer harmful instruction detection until sentence boundary or buffer size threshold (default: 200 chars). | Status: not_done
- [ ] **Implement flush decision logic** — If no violations: flush accumulated chunks to caller. If violation detected: either block immediately (emit fallback) or buffer-and-review (accumulate more context). Configurable via `streaming.onViolation`. | Status: not_done
- [ ] **Implement cross-chunk placeholder de-anonymization** — When flushing chunks, de-anonymize complete placeholders. If a placeholder spans a chunk boundary, buffer until full placeholder is assembled before de-anonymizing. | Status: not_done
- [ ] **Integrate streaming into OpenAI wrapper** — Detect `stream: true` in request params. Wrap the returned async iterator to apply streaming sanitization to each chunk. | Status: not_done
- [ ] **Integrate streaming into Anthropic wrapper** — Detect streaming mode in Anthropic request params. Wrap the returned stream to apply streaming sanitization. | Status: not_done
- [ ] **Support streaming configuration** — Accept `streaming.bufferThreshold` (default: 200) and `streaming.onViolation` (`'block' | 'warn-and-continue'`) in `SanitizeOptions`. | Status: not_done

## Phase 12: Event Hooks

- [ ] **Implement onInputSanitized hook** — Fire after input sanitization completes. Pass the full `SanitizedInput` report. | Status: not_done
- [ ] **Implement onOutputSanitized hook** — Fire after output sanitization completes. Pass the full `SanitizedOutput` report. | Status: not_done
- [ ] **Implement onViolation hook** — Fire for each individual `ContentViolation` detected during output sanitization. | Status: not_done
- [ ] **Ensure hooks are non-blocking** — Event hooks should not block the sanitization pipeline. If a hook throws, catch and ignore (or log) the error without affecting the response. | Status: not_done

## Phase 13: Unit Tests — PII Detectors

- [ ] **Write email detector tests** — At least 5 positives (`user@domain.com`, `user+tag@company.co.uk`, `first.last@subdomain.domain.org`, `user123@gmail.com`, `a.b@c.de`) and at least 5 negatives (`user@domain` no TLD, `@username` social handle, `user@domain.c` single-char TLD, `git@github.com:org/repo.git` git URL, `not-an-email`). Test position/offset correctness. | Status: not_done
- [ ] **Write phone detector tests** — At least 5 positives covering US, UK, and international formats. At least 5 negatives including ZIP codes, short numbers, year strings, order numbers without formatting. Verify 7+ digit requirement. | Status: not_done
- [ ] **Write SSN detector tests** — Positives: `123-45-6789`, `123 45 6789`, `123.45.6789`. Negatives: `000-12-3456` (invalid area), `666-12-3456` (invalid area), `900-12-3456` (900+ range), `123-00-6789` (invalid group), `123-45-0000` (invalid serial), `078-05-1120` (Woolworth). Test context-boosted confidence. | Status: not_done
- [ ] **Write credit card detector tests** — Positives: Visa (`4111111111111111`), Mastercard (`5500000000000004`), Amex (`378282246310005`), Discover. Negatives: random 16-digit sequences failing Luhn, tracking numbers, 15-digit numbers. Verify Luhn validation independently. | Status: not_done
- [ ] **Write Luhn algorithm tests** — Known valid test card numbers, known invalid numbers, edge cases (all zeros, all nines, single digit, 13-19 digit lengths). | Status: not_done
- [ ] **Write IP address detector tests** — Positives: IPv4 (`192.168.1.100`, `203.0.113.42`), IPv6 full, IPv6 compressed (`::1`). Negatives: version numbers (`1.2.3.4` context-dependent), out-of-range octets (`256.1.1.1`), partial IPs. Test optional exclusion of localhost/private ranges. | Status: not_done
- [ ] **Write date of birth detector tests** — Positives with context: `DOB: 03/15/1990`, `Born: March 15, 1990`, `birthday is 15.03.1990`, `date of birth: 1990-03-15`. Test confidence levels based on context cues. Test that bare dates without context are only detected at high sensitivity. | Status: not_done
- [ ] **Write address detector tests** — Positives: full US address (`123 Main Street, Springfield, IL 62701`), partial with unit (`456 Oak Ave, Apt 2B`), street-only (`789 Elm Dr`). Confidence levels per component count. Negatives: numbers without street types, bare city names. | Status: not_done
- [ ] **Write name detector tests** — Positives with context: `Mr. John Smith`, `Contact Jane Doe`, `Signed by Alice Johnson`. Negatives: country names, company names, sentence-starting capitalized words, month/day names. Verify disabled by default. | Status: not_done
- [ ] **Write passport/ID detector tests** — Positives with context: US passport (`A12345678` near "passport"), UK passport (9 digits near "passport number"). Negatives: matching patterns without context. Verify disabled by default, enabled via config. | Status: not_done
- [ ] **Write custom entity detector tests** — Register custom patterns (e.g., `EMP-\d{6}`, `MRN[-:\s]?\d{7,10}`). Verify detection, placeholder assignment, confidence setting, and deduplication against built-in detectors. | Status: not_done
- [ ] **Write deduplication tests** — Overlapping detections from multiple detectors: verify higher confidence wins, equal confidence prefers more specific type. Non-overlapping detections: verify all are kept. | Status: not_done

## Phase 14: Unit Tests — Redaction Strategies

- [ ] **Write placeholder strategy tests** — Verify numbered placeholder format (`[EMAIL_1]`, `[PHONE_1]`). Verify identical values get same placeholder. Verify counter increments for different values. Verify placeholder map construction. | Status: not_done
- [ ] **Write mask strategy tests** — For each entity type, verify masking output matches spec: email (`j***@e***.com`), phone (`(555) ***-**67`), SSN (`***-**-6789`), credit card (`**** **** **** 1111`), IP (`192.168.*.*`), DOB (`**/**/1990`), address (masked street), name (`J*** S***`). | Status: not_done
- [ ] **Write hash strategy tests** — Verify format `[SHA256:{12 hex chars}]`. Verify consistency (same input = same hash). Verify different inputs produce different hashes. Use `node:crypto` SHA-256. | Status: not_done
- [ ] **Write fake data strategy tests** — Verify output is format-valid for each entity type (fake email has `@` and `.`, fake phone has correct digit count, fake SSN passes validation, fake credit card passes Luhn). Verify per-request consistency (same original = same fake within request). Verify fake values differ from originals. | Status: not_done
- [ ] **Write remove strategy tests** — Verify PII is deleted entirely. Verify adjacent whitespace collapses to single space. Verify sentence structure around removal. | Status: not_done
- [ ] **Write encrypt strategy tests** — Verify format `[ENC:{iv}:{ciphertext}:{tag}]`. Verify encryption with `node:crypto` AES-256-GCM. Verify decryption with `decryptPII()` restores original value. Verify different IVs per encryption (non-deterministic). Verify error when no encryption key provided. | Status: not_done
- [ ] **Write per-entity strategy override tests** — Configure different strategies for different entity types. Verify each entity is redacted with its assigned strategy. Verify `default` strategy applies to unconfigured types. | Status: not_done

## Phase 15: Unit Tests — Output Sanitization

- [ ] **Write profanity detection tests** — Positives: common profanity terms (case-insensitive). Negatives: "assess" (should not match "ass"), "Scunthorpe" (should not match substring). Test custom word additions and exclusions. Verify word boundary matching. | Status: not_done
- [ ] **Write toxicity detection tests** — Positives: hate speech patterns, personal attacks ("you are a/an {insult}"), threats ("I will {harm-verb} you"). Negatives: benign usage of similar words, educational/news contexts. Verify severity levels (medium for attacks, high for hate/threats). | Status: not_done
- [ ] **Write harmful instruction detection tests** — Positives: instructional language combined with dangerous topic keywords (weapon/explosive/drug synthesis steps). Negatives: instructional language alone, dangerous topic mentions in news/educational context without procedural language. Verify severity: high. | Status: not_done
- [ ] **Write PII leakage detection tests** — Verify that PII matching placeholder map entries is NOT flagged as leakage. Verify that PII not in original input IS flagged. Verify severity: medium for emails/phones, high for SSNs/credit cards. Test with and without placeholder map. | Status: not_done
- [ ] **Write output pipeline tests** — Test severity aggregation (highest severity wins). Test action computation (pass/warn/block). Test fallback message replacement on block. Test violation metadata attachment on warn. Test pass-through on pass. | Status: not_done

## Phase 16: Unit Tests — De-anonymization

- [ ] **Write placeholder restoration tests** — Single placeholder replacement. Multiple different placeholders. Multiple occurrences of the same placeholder. Verify all replaced correctly. | Status: not_done
- [ ] **Write longest-first ordering tests** — If one placeholder is a substring of another (defensive), verify longest-first replacement prevents partial matches. | Status: not_done
- [ ] **Write case-insensitive matching tests** — Verify `[EMAIL_1]`, `[email_1]`, `[Email_1]`, and `EMAIL_1` (without brackets) all match and are replaced. | Status: not_done
- [ ] **Write deanonymize toggle tests** — Verify `deanonymize: false` skips restoration entirely. Verify `deanonymize: true` (default) performs restoration. | Status: not_done

## Phase 17: Integration Tests

- [ ] **Write OpenAI wrapper integration tests** — Mock OpenAI SDK client with `chat.completions.create`. Verify input messages are sanitized before forwarding. Verify response content is checked and de-anonymized. Test single message, multi-turn conversation, system message inclusion. | Status: not_done
- [ ] **Write Anthropic wrapper integration tests** — Mock Anthropic SDK client with `messages.create`. Verify input messages sanitized (text content blocks). Verify separate `system` parameter handling. Verify response `content[0].text` is sanitized. | Status: not_done
- [ ] **Write full round-trip tests** — Input with PII -> sanitized input -> mock LLM response referencing placeholders -> de-anonymized response with original PII restored. Verify the entire chain end-to-end. | Status: not_done
- [ ] **Write sanitizeFunction integration tests** — Wrap a mock async function. Verify input sanitization, forwarding, output sanitization, and de-anonymization for the generic wrapper. | Status: not_done
- [ ] **Write createSanitizer integration tests** — Create a sanitizer instance with full config. Call `sanitizeInput()`, `sanitizeOutput()`, `detectPII()`, and `wrap()`. Verify all methods work with shared config. | Status: not_done
- [ ] **Write event hook integration tests** — Configure `onInputSanitized`, `onOutputSanitized`, and `onViolation` hooks. Verify they fire with correct data at the right times during middleware operation. | Status: not_done
- [ ] **Write environment variable override tests** — Set `LLM_SANITIZE_ENTITIES`, `LLM_SANITIZE_STRATEGY`, `LLM_SANITIZE_SENSITIVITY`, `LLM_SANITIZE_DEANONYMIZE`, `LLM_SANITIZE_ENCRYPTION_KEY`. Verify they override programmatic config. | Status: not_done

## Phase 18: Streaming Tests

- [ ] **Write streaming buffer accumulation tests** — Verify chunks are accumulated correctly. Verify buffer length tracking. | Status: not_done
- [ ] **Write streaming violation detection tests** — Verify profanity/toxicity detected within buffered content. Verify harmful instruction detection deferred until sentence boundary or buffer threshold. | Status: not_done
- [ ] **Write streaming cross-chunk violation tests** — Verify violations that span chunk boundaries are detected when buffer accumulates enough context. | Status: not_done
- [ ] **Write streaming de-anonymization tests** — Verify placeholders fully within a chunk are de-anonymized on flush. Verify placeholders spanning chunk boundaries are buffered until complete, then de-anonymized. | Status: not_done
- [ ] **Write streaming block action tests** — Verify `onViolation: 'block'` stops the stream and emits fallback. Verify `onViolation: 'warn-and-continue'` continues streaming with violations attached. | Status: not_done
- [ ] **Write streaming round-trip tests** — OpenAI streaming with `stream: true`. Input sanitized before stream begins. Output chunks sanitized incrementally. Full de-anonymization across chunks. | Status: not_done

## Phase 19: Performance and False Positive Tests

- [ ] **Write PII detection latency benchmarks** — Measure detection time for 100 chars, 1KB, 4KB, 10KB inputs with all entity types enabled. Assert < 1ms for inputs under 4KB. | Status: not_done
- [ ] **Write redaction latency benchmarks** — Measure redaction time with 0, 5, 20, 100 entities. Assert < 0.5ms for under 20 entities. | Status: not_done
- [ ] **Write output moderation latency benchmarks** — Measure content moderation time for varying output sizes. Assert < 2ms for under 4KB. | Status: not_done
- [ ] **Write full middleware overhead benchmarks** — Measure total added time (input + output + de-anonymization). Assert < 5ms for typical inputs (1-4KB). | Status: not_done
- [ ] **Write email false positive benchmark** — Test against corpus of text samples with email-like patterns. Target < 2% false positive rate. | Status: not_done
- [ ] **Write phone false positive benchmark** — Test against text with numeric sequences (dates, prices, order numbers). Target < 5% false positive rate. | Status: not_done
- [ ] **Write credit card false positive benchmark** — Test against text with long numeric strings. Target < 1% false positive rate. | Status: not_done
- [ ] **Write profanity false positive benchmark** — Test against corpus of benign text samples. Target < 1% false positive rate (Scunthorpe mitigations). | Status: not_done
- [ ] **Write ReDoS resistance tests** — Test all regex patterns against adversarial inputs (nested repetitions, long strings) to verify sub-1ms matching on inputs up to 100KB and no catastrophic backtracking. | Status: not_done

## Phase 20: Edge Cases and Error Handling

- [ ] **Handle empty input text** — `sanitizeInput("")` and `detectPII("")` should return empty results without errors. | Status: not_done
- [ ] **Handle input with no PII** — Text containing no PII should pass through unchanged with empty entities array and empty placeholder map. | Status: not_done
- [ ] **Handle very large inputs** — Test with 100KB+ input text. Verify no performance degradation beyond linear scaling. No stack overflows from regex. | Status: not_done
- [ ] **Handle unicode and non-ASCII text** — PII detection should work correctly with unicode characters in surrounding text. Offsets should be character-based. | Status: not_done
- [ ] **Handle overlapping PII** — Input where a credit card pattern also matches a phone pattern. Verify deduplication resolves correctly. | Status: not_done
- [ ] **Handle encrypt strategy without key** — Throw a descriptive error when `encrypt` strategy is configured but no `encryptionKey` is provided. | Status: not_done
- [ ] **Handle invalid custom entity patterns** — Custom patterns without the `g` flag should throw or be handled gracefully. Patterns that match empty strings should be rejected. | Status: not_done
- [ ] **Handle null/undefined message content** — SDK wrappers should handle messages with null or undefined content gracefully (skip sanitization for that message). | Status: not_done
- [ ] **Handle LLM API call failures** — If the underlying LLM API call throws, the wrapper should propagate the error without swallowing it. Placeholder map should be discarded. | Status: not_done
- [ ] **Handle hook errors** — If an event hook (`onInputSanitized`, etc.) throws, the error should not propagate to the caller or affect the sanitization result. | Status: not_done

## Phase 21: Performance Optimization

- [ ] **Pre-compile all regex patterns at init** — Ensure all regex patterns are compiled once at module load time or at `createSanitizer()` call time, not during individual sanitization calls. | Status: not_done
- [ ] **Build profanity Set at init** — Load the profanity word list into a `Set` for O(1) lookup at initialization. Do not rebuild per call. | Status: not_done
- [ ] **Verify no ReDoS-vulnerable patterns** — Audit all regex patterns for nested quantifiers, unbounded alternation inside quantifiers, and other catastrophic backtracking risks. | Status: not_done
- [ ] **Verify memory profile** — Each sanitization call should allocate < 5KB of result objects. Static data (word lists, fake data pools) should be ~50KB total, shared across instances. | Status: not_done

## Phase 22: Documentation

- [ ] **Write README.md** — Cover: overview, installation, quick start (sanitize() with OpenAI and Anthropic), standalone functions (sanitizeInput, sanitizeOutput, detectPII), createSanitizer factory, sanitizeFunction for generic wrapping, configuration options, redaction strategies, PII entity types, output moderation categories, streaming, environment variables, monorepo integration examples, and API reference. | Status: not_done
- [ ] **Add JSDoc comments to all exports** — Document all public functions, interfaces, and types with JSDoc comments including `@param`, `@returns`, `@example`, and `@throws` annotations. | Status: not_done
- [ ] **Add inline code comments** — Add explanatory comments for non-obvious logic: Luhn algorithm, SSN validation rules, Scunthorpe exclusion list rationale, context analysis for DOB/name detection, de-anonymization partial match handling. | Status: not_done

## Phase 23: Final Verification and Publishing Prep

- [ ] **Run full test suite** — `npm run test` must pass with all unit, integration, streaming, performance, and false positive tests green. | Status: not_done
- [ ] **Run linter** — `npm run lint` must pass with no errors or warnings. | Status: not_done
- [ ] **Run build** — `npm run build` must produce `dist/` with all `.js`, `.d.ts`, and `.d.ts.map` files. | Status: not_done
- [ ] **Verify zero runtime dependencies** — Confirm `package.json` has no `dependencies` field (only `devDependencies`). Verify no `require()` or `import` of external packages in `src/` files (only `node:crypto` and `node:*` built-ins). | Status: not_done
- [ ] **Verify Node.js 18 compatibility** — Ensure no APIs are used that require Node.js > 18. Test on Node.js 18 if possible. | Status: not_done
- [ ] **Verify public API exports** — Import the built package and confirm `sanitize`, `sanitizeInput`, `sanitizeOutput`, `detectPII`, `createSanitizer`, `sanitizeFunction`, and `decryptPII` are all accessible. Confirm all types are exported. | Status: not_done
- [ ] **Bump version in package.json** — Bump version per semver (likely `1.0.0` for initial release with full spec implementation). | Status: not_done
- [ ] **Verify package files** — Confirm only `dist/` is included in the published package via the `files` field. No source, test, or spec files in the npm tarball. | Status: not_done
