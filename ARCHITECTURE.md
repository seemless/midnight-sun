# The Midnight Sun — Architecture

## Overview

The Midnight Sun is a Chrome extension (Manifest V3) that auto-fills job applications, generates smart answers via LLM (Ollama, OpenAI, Anthropic, or Gemini), and tracks application status. It works across every major ATS — Greenhouse, Lever, Ashby, Workday, iCIMS, Taleo, LinkedIn, Indeed — without any site-specific fill logic.

**Stack:** TypeScript, React, Tailwind CSS, Vite + CRXJS, Vitest, happy-dom.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Chrome Browser                               │
│                                                                      │
│  ┌──────────────┐    messages     ┌───────────────────────────────┐  │
│  │   Popup UI   │ ◄────────────► │    Background Service Worker   │  │
│  │  (React SPA) │                │  - LLM provider proxy          │  │
│  │              │                │  - All-frames detection        │  │
│  │  FillPreview │                │  - Badge updates               │  │
│  │  Dashboard   │                │  - Resume generation proxy     │  │
│  │  Profile     │                └───────────────────────────────┘  │
│  │  Resumes     │                        ▲                          │
│  └──────┬───────┘                        │ messages (per-frame)     │
│         │                                │                          │
│         │ sendToActiveTab                │                          │
│         │ (frameId: 0)                   │                          │
│         ▼                                ▼                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Content Script (injected in all frames)          │   │
│  │                                                              │   │
│  │  detector.ts ─► detectFields(document)                       │   │
│  │  filler.ts   ─► fillFields(fields, profile, document)        │   │
│  │  snapshot.ts ─► extractSnapshot(document, url)                │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    chrome.storage.local                       │   │
│  │                                                              │   │
│  │  profile       ─ user resume data                            │   │
│  │  applications  ─ job tracking records                        │   │
│  │  fillRuns      ─ audit logs (100 max)                        │   │
│  │  ms:job:*      ─ JobRecord per posting                       │   │
│  │  ms:snapshot:* ─ page snapshots (5 per job)                  │   │
│  │  ms:answers:*  ─ cached smart answers                        │   │
│  │  ms:anslib:*   ─ answer library (per-question memory)        │   │
│  │  ms:resume:*   ─ resume documents (global library)          │   │
│  │  voice         ─ user-authored pitch/tone/constraints        │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Location | Role |
|-----------|----------|------|
| **Popup** | `src/popup/` | React UI with five tabs: Fill, Dashboard, Profile, Resumes, Debug. State machine drives the detect → fill → smart-apply workflow. Resume library supports upload + LLM generation + per-job linking. |
| **Content Script** | `src/content/` | Injected into every page (`<all_urls>`, `all_frames: true`). Detects form fields (text + radio/checkbox groups), fills values, extracts page snapshots. No ATS-specific logic. |
| **Background Worker** | `src/background/` | Service worker handling LLM provider proxy requests, all-frames detection, and badge updates. |
| **Shared** | `src/shared/` | Types, matchers, storage, URL utilities, normalization — shared across all contexts. |
| **Lib** | `src/lib/llm/` | LLM provider abstraction: interface, registry, shared prompt/parser, 4 providers (Ollama, OpenAI, Anthropic, Gemini). |

### Message Flow

All communication uses typed messages (`Message` union in `types.ts`):

- **Popup → Content Script:** `chrome.tabs.sendMessage(tabId, msg, { frameId: 0 })` via `sendToActiveTab()`
- **Popup → Background:** `chrome.runtime.sendMessage(msg)` via `sendToBackground()`
- **Background → Content Script:** `chrome.tabs.sendMessage(tabId, msg, { frameId })` for per-frame scanning

---

## Field Detection: How Pattern Matching Works

The detector is **completely ATS-agnostic**. It doesn't know what Greenhouse or Ashby look like. Instead, it relies on a three-stage pipeline that works on any HTML form.

### Stage 1: DOM Scanning

`detectFields(document)` in `detector.ts` scans for all fillable elements:

```
Fillable:  input (text, email, tel, url, number, password, date, month, search)
           textarea
           select
Custom:    [role="listbox"], [role="combobox"], [class*="select"][role]
```

Hidden file/submit/reset/image inputs are excluded. Custom controls are detected but flagged as "manual required" since they can't be reliably auto-filled.

### Stage 2: Signal Extraction

For each element, `extractSignals(el, doc)` pulls text from every source available:

| Priority | Source | Example |
|----------|--------|---------|
| 1 | `<label for="id">` | `<label for="email">Email Address</label>` |
| 2 | Ancestor `<label>` | `<label><span>Name</span><input/></label>` |
| 3 | `name` attribute | `<input name="first_name">` |
| 4 | `id` attribute | `<input id="applicant_email">` |
| 5 | `placeholder` | `<input placeholder="Enter your email">` |
| 6 | `aria-label` | `<input aria-label="Phone number">` |
| 7 | `title` attribute | `<input title="LinkedIn Profile URL">` |
| 8 | `data-automation-id` | `<input data-automation-id="legalNameSection_firstName">` (Workday) |
| 9 | Previous sibling text | `<span>Company</span><input/>` |
| 10 | Container text | Walking up to `.field`, `.form-group`, `[role="group"]`, etc. and extracting label text minus input values |
| 11 | `aria-labelledby` | Resolving the referenced element's text |

This produces two outputs:
- **`flat`**: An array of raw strings for matching (`["First Name", "first_name", "fname"]`)
- **`structured`**: A `FieldSignals` object recording where each signal came from (for debug UI)

Container text extraction (`extractContainerText`) is particularly important for modern ATS UIs (Gem, Ashby) that don't use standard `<label>` elements. It walks up the DOM looking for wrapper patterns (`[data-field]`, `.field`, `.form-group`, `[class*="field"]`, `fieldset`, `[role="group"]`) and extracts the text content after stripping out the input element itself.

### Stage 3: Keyword Matching

`matchField(signals)` in `matchers.ts` compares extracted signals against a keyword dictionary for 22 profile fields:

```typescript
const FIELD_KEYWORDS: Record<ProfileField, string[]> = {
  firstName:  ["first name", "first_name", "firstname", "given name", "fname", ...],
  lastName:   ["last name", "last_name", "lastname", "family name", "surname", ...],
  email:      ["email", "e-mail", "email address", "e_mail", ...],
  phone:      ["phone", "telephone", "mobile", "cell", "phone number", ...],
  linkedinUrl:["linkedin", "linkedin url", "linkedin profile", ...],
  heardAbout: ["how did you hear", "heard about", "referral source", ...],
  // ... 22 fields total
};
```

**Confidence scoring** uses three match types:

| Match Type | Confidence | Example |
|------------|-----------|---------|
| **Exact** | `1.0 - (keyword_index × 0.02)` | signal `"first name"` = keyword `"first name"` |
| **Contains** | `0.85 - (keyword_index × 0.02)` | signal `"enter your first name"` contains `"first name"` |
| **Reverse-contains** | `0.7 - (keyword_index × 0.02)` | keyword `"first name"` contains signal `"first"` (min 3 chars) |

Keywords earlier in the array get slightly higher confidence (the `keyword_index × 0.02` penalty). The best match across all signals × all fields wins. Confidence is clamped to [0.1, 1.0].

**Essay-prompt penalty:** When the primary signal looks like an essay question (>40 chars, starts with why/what/how/describe, contains "?"), all fields except `summary` get a `ESSAY_CONFIDENCE_PENALTY` (0.3x) multiplier. This prevents "Describe your work experience in 3-4 sentences" from matching `currentTitle`.

### Constants (`src/shared/constants.ts`)

All tunable thresholds live in one file:

| Constant | Value | Purpose |
|----------|-------|---------|
| `MIN_FILL_CONFIDENCE` | `0.4` | Below this, `fillFields()` skips with `reason: "low_confidence"` |
| `ESSAY_CONFIDENCE_PENALTY` | `0.3` | Multiplier for essay-like signals on non-summary fields |
| `MAX_SIGNAL_LENGTH` | `200` | Max chars for previous-sibling text (prevents country-list pollution) |
| `MAX_HEADING_TEXT_LENGTH` | `300` | Max chars for heading/container text extraction |
| `MAX_HEADING_SCAN_DEPTH` | `6` | Max ancestor levels to walk for heading-scan |
| `INFRA_SELECTORS` | `[...]` | CSS selectors for recaptcha, honeypots, bot traps — never detected or filled |

### Why This Works Across Every ATS

The three-stage approach is intentionally over-engineered for signal extraction and deliberately simple for matching:

1. **Signal extraction casts a wide net.** It doesn't matter if Greenhouse uses `<label for="">`, Ashby uses wrapper `<div>` containers, Workday uses `data-automation-id`, or LinkedIn uses `aria-label`. We extract from *all* sources and merge them.

2. **Keyword matching is language-based, not selector-based.** We don't look for `#greenhouse-first-name` or `.ashby-name-field`. We look for the *words* "first name" in whatever text surrounds the input. Every ATS uses human-readable labels somewhere.

3. **Multiple selector candidates for resilience.** When we find a field, we generate selectors by ID, by name, by data-automation-id, by aria-label, and by nth-of-type path. React SPAs may re-render and invalidate one selector, but another will survive.

4. **Soft visibility instead of hard filtering.** Elements with `display:none` or `visibility:hidden` are tagged `visible: false` but still included in results. Only `aria-hidden="true"` causes a hard skip. This handles progressive-disclosure forms where fields become visible after user interaction.

5. **Demographic safety net.** Fields matching demographic keywords (race, gender, veteran, disability, EEO) are detected but force-set to `matchedField: null` and `category: "demographic"`. They are never auto-filled.

---

## The Fill Pipeline

### Deterministic Fill (`filler.ts`)

After detection, `fillFields()` iterates matched fields with a gating pipeline:

1. **Skip no-match** — `matchedField === null` → `reason: "no_match"`
2. **Skip low-confidence** — `confidence < MIN_FILL_CONFIDENCE` (0.4) → `reason: "low_confidence"`
3. **Skip custom controls** — `inputType === "custom"` → `reason: "custom_control"`, `manualRequired: true`
4. **Skip empty profile** — profile value is blank → `reason: "empty_profile"`
5. **Resolve element** — try each selector candidate in order until one matches
6. **Get profile value** — map `ProfileField` → user's profile data (e.g., `firstName` → `"Connor"`)
7. **Set value** — framework-aware value setting:

```typescript
// For <select>: match option by value or text (exact then partial)
setSelectValue(el, value);

// For <input>/<textarea>: bypass React/Angular value interception
const nativeSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype, 'value'
)?.set;
nativeSetter?.call(el, value);

// Fire events in user-interaction order
el.dispatchEvent(new Event('focus', { bubbles: true }));
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
el.dispatchEvent(new Event('blur', { bubbles: true }));
```

This native setter trick is essential. React and Angular intercept `.value =` assignments through synthetic event systems. By calling the browser's native property descriptor directly, we write the raw DOM value, then fire real DOM events that the framework picks up normally.

### Results & Audit

Every fill attempt produces a `FillResult` with:
- Success/failure status
- Typed failure reason: `no_match`, `low_confidence`, `custom_control`, `empty_profile`, `element_not_found`, `set_value_failed`, `exception`
- `manualRequired` flag for custom controls
- Duration in milliseconds

These are persisted as `FillRun` records (up to 100) for debugging. The popup UI shows per-field results with color coding.

---

## Frame Detection: Handling Iframes

Many ATS platforms embed forms in iframes (Gem, some Workday pages). The extension handles this with a two-tier approach:

### Tier 1: Top Frame (Default)

`sendToActiveTab()` always targets `frameId: 0` (the top frame). This is fast and works for most ATS pages where the form lives in the main document.

### Tier 2: All-Frames Fallback

If the top frame returns 0 fields, the popup automatically falls back:

1. Popup sends `DETECT_ALL_FRAMES` to background worker
2. Background calls `chrome.webNavigation.getAllFrames(tabId)`
3. For each frame, sends `DETECT_FIELDS` with `{ frameId: frame.frameId }`
4. Collects results from all frames
5. Returns the frame with the most detected fields

This requires the `webNavigation` permission and handles cross-origin frames gracefully (they throw and are skipped).

---

## Smart Apply (LLM Provider Integration)

For open-ended questions ("Why do you want to work here?", "Describe your experience..."), the extension generates answers using a pluggable LLM provider. Supported: **Ollama** (local), **OpenAI**, **Anthropic**, **Google Gemini**.

### Provider Architecture

```
src/lib/llm/
  types.ts          SmartApplyProvider interface, ProviderConfig, ProviderId
  prompt.ts         buildApplicationPrompt(), parseSmartResponse() — shared by all providers
  registry.ts       registerProvider(), getProvider(), listProviders()
  index.ts          Barrel export (imports all providers to trigger registration)
  providers/
    ollama.ts       Ollama (local, no API key, /api/generate)
    openai.ts       OpenAI (/v1/chat/completions, Bearer token)
    anthropic.ts    Anthropic (/v1/messages, x-api-key header)
    gemini.ts       Gemini (/v1beta/models/{model}:generateContent, key in query)
```

Every provider implements the same `SmartApplyProvider` interface:
- `generateApplication(context, profile, config, voice?)` — builds prompt (with optional voice), calls API, parses response
- `isAvailable(config)` — health check (Ollama: `/api/tags`, cloud: auth test)
- `listModels(config)` — dynamic for Ollama, static list for cloud

### Flow

```
Popup                    Background              LLM Provider
  │                          │                          │
  ├─ EXTRACT_JOB_CONTEXT ──► │                          │
  │  (to content script)     │                          │
  │◄── JOB_CONTEXT ─────────┤                          │
  │                          │                          │
  ├─ Check answers cache     │                          │
  │  (ms:answers:* in KV)    │                          │
  │                          │                          │
  ├─ GENERATE_SMART_ANSWERS ─┤                          │
  │  (+ providerConfig)      ├─ getProvider(config.id) ─┤
  │                          ├─ provider.generate() ───►│
  │                          │◄── JSON response ───────┤
  │◄── SMART_ANSWERS_RESULT ─┤                          │
  │                          │                          │
  │  [user edits answers]    │                          │
  │                          │                          │
  ├─ FILL_SMART_ANSWERS ───► │                          │
  │  (to content script)     │                          │
  │◄── SMART_FILL_COMPLETE ──┤                          │
```

### Open Question Detection

`extractOpenQuestions()` in the content script finds free-text fields that aren't covered by deterministic matching. Two-pass scan:

**Pass 1** — Standard open-question elements:
- Selector: `textarea, [role="textbox"], [contenteditable="true"]`
- Skips `aria-hidden="true"`, demographic fields, and infrastructure elements
- Uses `ESSAY_PATTERN` (`/^(why|what|how|describe|tell us|explain|please|in \d+ words)/i`) to relax the deterministic-match confidence threshold

**Pass 2** — Text inputs with essay-like labels (Ashby uses `<input type="text">` for essays):
- Selector: `input[type="text"]`
- Only included if label matches `ESSAY_PATTERN`, contains "?", or is >50 chars with essay keywords
- Skips if deterministic matcher would claim it at >0.7 confidence

Both passes scan the main document and same-origin iframes.

**Smart fill targets** (`SMART_FILL_SELECTOR` in `filler.ts`):
`textarea, [role="textbox"], [contenteditable="true"], input[type="text"]`

### Answer Caching

Generated answers are cached in `SmartAnswersDoc` records keyed by `postingKey`:

- Questions are hashed (SHA-256) for identity comparison
- On revisit, cached answers are reused if the current questions are a subset
- `newQuestionCount` tracks how many questions need fresh generation
- `editedByUser` flag preserves manual edits across regenerations
- `jobContentHash` detects when the job description has changed

---

## Storage Architecture

### Layer 1: Storage Adapter (`storage.ts`)

High-level CRUD for user data, using an adapter pattern for testability:

| Key | Type | Description |
|-----|------|-------------|
| `profile` | `Profile` | Parsed resume: name, contact, experiences, education, skills |
| `applications` | `Application[]` | Job tracking with 7-state status (saved → ghosted) |
| `fillRuns` | `FillRun[]` | Audit log of fill attempts (100 max, newest first) |
| `smartApplyRuns` | `SmartApplyRun[]` | Audit log of LLM generations (30 max) |
| `settings` | `Settings` | User preferences (autoDetect, theme, statelessMode, providerConfig) |
| `voice` | `Voice` | User-authored pitch, strengths, role targets, constraints, tone |

### Layer 2: Namespaced KV Store (`jobStore.ts`)

Job-specific data with namespace prefixing:

Job-specific data with namespace prefixing:

| Key Pattern | Type | Description |
|-------------|------|-------------|
| `ms:job:<postingKey>` | `JobRecord` | Job posting metadata, status, snapshot/answers refs |
| `ms:snapshot:<id>` | `JobSnapshot` | Point-in-time page capture (5 per job max) |
| `ms:answers:<id>` | `SmartAnswersDoc` | Cached generated answers with edit tracking |
| `ms:jobIndex` | `StorageIndex` | Posting keys list for pagination |
| `ms:anslib:<hash>` | `AnswerLibraryEntry` | Per-question answer memory (hash of normalized question text) |
| `ms:anslib:__index__` | `string[]` | Index of all answer library hashes |
| `ms:resume:<id>` | `ResumeDoc` | Resume document (markdown content, name, source) |
| `ms:resumeIndex` | `{ resumeIds, updatedAt }` | Index of all resume IDs for listing |

### URL Canonicalization

Every job URL is canonicalized before use as a key:

1. Strip hash fragments
2. Remove tracking params (`utm_*`, `fbclid`, `gclid`, etc.)
3. Keep identity params (`gh_jid`, `applicationId`, etc.)
4. Sort remaining params alphabetically
5. Remove trailing slash
6. `postingKey = sha256(canonicalUrl)`

This ensures the same job posting accessed via different referral links maps to the same record.

### ATS Source Detection

`detectSource(url)` identifies the platform from the hostname:

```
boards.greenhouse.io/*     → greenhouse
jobs.lever.co/*            → lever
*.myworkdayjobs.com/*      → workday
app.ashbyhq.com/*          → ashbyhq
*.icims.com/*              → icims
*.taleo.net/*              → taleo
*.bamboohr.com/*           → bamboohr
linkedin.com/jobs/*        → linkedin
indeed.com/*               → indeed
*                          → unknown
```

Source detection is used for snapshot metadata extraction (site-specific adapters for Ashby and Greenhouse company name extraction) and ATS-aware URL canonicalization, but **never** for field detection or filling.

---

## Testing

**Framework:** Vitest with happy-dom for DOM simulation.

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `detector.test.ts` | 31 | Signal extraction, field detection, visibility, demographics, infrastructure exclusion, listbox filtering, heading extraction |
| `matchers.test.ts` | 23 | Keyword matching, confidence scoring, essay-prompt penalty, edge cases |
| `filler.test.ts` | 4 | Low-confidence threshold, fill gating |
| `fillrun.test.ts` | 8 | FillRun creation, stats computation, storage |
| `parser.test.ts` | 20 | Resume parsing |
| `storage.test.ts` | 7 | CRUD operations, adapter pattern |
| `llm-providers.test.ts` | 26 | Prompt builder, response parser, provider registry, availability |
| `choice-groups.test.ts` | 12 | Radio/checkbox detection, grouping, fill matching, demographic skip |
| `answer-library.test.ts` | 15 | CRUD, hash consistency, lookup by signals, batch save |
| `voice-prompt.test.ts` | 15 | Voice injection in prompts, tone options, empty voice handling |

Key testing patterns:
- happy-dom provides `Document` for detector tests (no browser needed)
- Memory storage adapter swapped in via `setStorageAdapter(createMemoryStorage())`
- `parentNode?.removeChild(input)` used instead of `input.remove()` for happy-dom compatibility

---

## Key Design Decisions

1. **ATS-agnostic detection over site-specific selectors.** The detector works on *any* HTML form. We never write selectors like `.greenhouse-field` or `#ashby-input`. This means zero maintenance when ATS platforms update their markup.

2. **Confidence scoring over boolean matching.** A 0–1 confidence score lets the UI show "likely matches" vs "strong matches" and lets the fill pipeline skip low-confidence fields rather than filling wrong values.

3. **Multiple selector candidates per field.** React SPAs re-render aggressively. Having 4-5 selector candidates (by ID, name, automation-id, aria-label, nth-of-type) means at least one will survive a re-render.

4. **Native property descriptors for framework compatibility.** Directly calling `HTMLInputElement.prototype.value.set` bypasses React/Angular synthetic event systems. Firing `focus → input → change → blur` in order matches real user interaction.

5. **Privacy-first LLM.** Default provider is Ollama (local, no data leaves the machine). Cloud providers (OpenAI, Anthropic, Gemini) are opt-in and require the user to configure an API key. API keys are stored in extension storage (session-only in stateless mode).

6. **Audit everything.** Every fill attempt and smart generation is logged with full context, timing, and failure reasons. This makes debugging production issues possible without reproduction.

7. **Stateless mode option.** Profile data can be stored in `chrome.storage.session` instead of `chrome.storage.local`. Session storage survives popup open/close but clears on browser restart. User uploads resume each browser session — nothing persists to disk.

---

## Debug Bundle Schema

The Debug tab's "Export All" button produces a JSON file for offline analysis. Schema:

```json
{
  "version": "0.1.0",
  "exportedAt": "ISO-8601 timestamp",
  "fillRuns": [
    {
      "id": "uuid",
      "timestamp": "ISO-8601",
      "url": "full page URL",
      "company": "extracted company name",
      "role": "extracted role name",
      "pageMeta": { "title": "", "hostname": "", "stepIndex": 0 },
      "detectedFields": [
        {
          "selectorCandidates": ["#id", "input[name=...]", "path..."],
          "inputType": "text|email|tel|select|textarea|checkbox|radio|custom",
          "signals": ["Label text", "name_attr", "placeholder"],
          "structuredSignals": { "label": "", "aria": "", "name": "", "id": "", "placeholder": "", "nearbyText": "" },
          "matchedField": "firstName|null",
          "confidence": 0.85,
          "currentValue": "",
          "visible": true,
          "category": "demographic (optional)"
        }
      ],
      "fillResults": [
        {
          "selector": "#id",
          "matchedField": "firstName",
          "filledValue": "Connor",
          "success": true,
          "reason": "low_confidence|empty_profile|custom_control|... (on failure)",
          "durationMs": 5
        }
      ],
      "stats": {
        "totalFields": 27,
        "matched": 13,
        "filled": 5,
        "failed": 7,
        "manualRequired": 1,
        "skipped": 14,
        "reasonBreakdown": { "empty_profile": 7, "custom_control": 1 }
      },
      "totalDurationMs": 42
    }
  ]
}
```

**What's included:** All fill runs from the last 100 attempts, with full field detection data, fill results, and timing.

**What's NOT included:** Profile data (PII), smart apply answers, settings. The export is safe to share for debugging.
