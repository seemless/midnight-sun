# Learnings

Key takeaways from development. Reference this to avoid re-debugging known issues.

---

## Quick Lookup Index

| Symptom | Check these |
|---------|-------------|
| Wrong field being filled | `MIN_FILL_CONFIDENCE` threshold, `ESSAY_PATTERN` penalty, demographic gating, `heardAbout` keywords |
| Hundreds of fields detected | Listbox/combobox option skipping, `MAX_SIGNAL_LENGTH` cap, custom controls loop |
| Smart Apply filled recaptcha | `isInfrastructure()` applied in detector + `extractOpenQuestions()` + `fillSmartEntries()` repair |
| Zero fields detected | Frame routing (`frameId: 0`, all-frames fallback), content script handler logging, `document.readyState` |
| All signals say "Your answer" | Heading-scan strategy (`MAX_HEADING_SCAN_DEPTH`), generic text skip in sibling walk |
| Essay question matched to profile field | `ESSAY_CONFIDENCE_PENALTY` multiplier, `isEssayPrompt()` check, summary exemption |
| Field detected but not filled | `MIN_FILL_CONFIDENCE`, `empty_profile` (user hasn't filled that profile field), `custom_control` |
| Smart Apply generation fails | Provider config (`Settings.providerConfig`), API key present, `isAvailable()` check, background worker logs |
| Search/filter fields being filled | `isSearchFormElement()`, `SEARCH_FORM_SELECTORS`, `[role="search"]` ancestor check |
| "Name" matches firstName not fullName | Bare "name" keyword at index 0 of fullName keywords (exact-match 1.0 vs reverse-contains 0.7) |
| Resume generation fails | Same as Smart Apply: provider config, API key, background worker. Check `GENERATE_RESUME` message handler |
| LLM appends commentary after resume | `stripTrailingCommentary()` in `parseResumeResponse()`, prompt rules 11/12 |
| File attachment fails | `DETECT_FILE_INPUTS` returns empty → no `input[type="file"]` on page. Check iframes. `ATTACH_FILE` fails → element not found or `accept` attribute incompatible |
| Generation times out | `DEFAULT_TIMEOUT` is 180s (was 90s). Check model size, provider latency. Background worker logs show the actual fetch duration |

## Triage Checklist (copy/paste for debug exports)

1. Which site + URL?
2. Detected count? Matched count? Filled count?
3. Top 3 failure reasons in `reasonBreakdown`?
4. Any infrastructure fields detected? (search for `recaptcha`, `captcha`)
5. Any custom controls explosion? (check `totalFields` vs `matched` ratio)
6. Any low-confidence match filled? (should be impossible — check for `confidence < 0.4` in filled results)
7. Any signals that are just `["Your answer"]`? (heading scan may need expansion)
8. Any demographic fields missing `category: "demographic"`? (check DEMOGRAPHIC_KEYWORDS)

## Known Brittle Zones

- **Iframe targeting / message races** — `sendMessage` without `frameId` delivers to ALL frames, only first `sendResponse` wins. Empty iframes can beat the real form.
- **Contenteditable handling** — `textContent =` works but some editors (ProseMirror, Slate) may not pick it up. May need `execCommand` or clipboard API fallback.
- **Select normalization** — Country/state/yes-no selects need value normalization (Phase 1.3). "United States" vs "US" vs "USA" all need to match.
- **ATS platform metadata extraction** — `og:site_name` on Ashby often reports "Ashby" not the company. Prefer JSON-LD `hiringOrganization.name` > page header > URL path > `og:site_name`.
- **Google Forms DOM structure** — No `<label>`, no `aria-label` on inputs. Question text in `[role="heading"]` ancestor. Heading scan works but is fragile if Google changes nesting depth.

---

## Chrome Extension / Manifest V3

- **2026-02-21 — `all_frames: true` + `sendMessage` race condition.**
  `chrome.tabs.sendMessage(tabId, msg)` without `frameId` delivers to ALL frames.
  Only the first `sendResponse` wins. If an empty iframe responds before the top
  frame, the popup gets zero fields. Fix: always pass `{ frameId: 0 }` for top-frame
  targeting, or use `webNavigation.getAllFrames()` to scan each frame individually.

- **2026-02-21 — Content script injection does not equal message delivery.**
  `"matches": ["<all_urls>"]` with `all_frames: true` injects the script everywhere,
  but you still need to verify messages are reaching the right frame. Add diagnostic
  logging inside message handlers, not just at module load time.

- **2026-02-23 — Slider on the stateless toggle goes outside of the expected area.**
  The toggle thumb can overflow its track bounds when no explicit width/height
  constraint is applied to the slider element. Fix: ensure the slider and its
  container have matching size constraints so the thumb stays within the track.

---

## Build / Tooling

- **2026-02-21 — `noEmit: true` required in tsconfig.json.**
  CRXJS/Vite handles bundling. Without `noEmit: true`, `tsc` emits `.js` files next
  to `.ts` sources, causing stale file confusion. Vite then may load the wrong file.

- **2026-02-21 — happy-dom `HTMLSelectElement.remove()` override.**
  In happy-dom, calling `input.remove()` on a select element triggers
  `HTMLSelectElement.remove(index)` (which removes an option) instead of
  `Element.remove()` (which removes from DOM). Fix: use
  `input.parentNode?.removeChild(input)` instead.

---

## Field Detection

- **2026-02-21 — Signal extraction over selector matching.**
  Don't write ATS-specific CSS selectors (`.greenhouse-field`, `#ashby-input`).
  Instead, extract text from label/aria/name/id/placeholder/container and match
  keywords. This works across all ATS without maintenance.

- **2026-02-21 — Container text extraction is critical for modern ATS.**
  Many ATS (Gem, Ashby) use `<div>` wrappers instead of `<label>`. Walking up to
  `.field`, `.form-group`, `[role="group"]`, `[class*="field"]` and extracting text
  content (minus the input's own value) catches labels that `<label for="">` misses.

- **2026-02-21 — Demographic fields must be detected but never filled.**
  Race, gender, veteran, disability, EEO questions appear on most applications.
  Detect them (keyword match), tag `category: "demographic"`, force
  `matchedField: null`. Never auto-fill. Display with "EEO" badge in UI.

---

## React / Framework Compatibility

- **2026-02-21 — Native property descriptor setter for React forms.**
  React intercepts `.value =` assignments. Calling
  `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)`
  bypasses React's synthetic event system. Then fire `focus -> input -> change -> blur`
  events (in that order, all with `{ bubbles: true }`) to trigger React's onChange.

---

## Smart Apply / LLM Providers

- **2026-02-21 — Background proxy required for localhost in MV3.**
  Popup cannot reliably `fetch("http://localhost:11434")` in Manifest V3. Route
  through the background service worker, which has full network access.

- **2026-02-21 — Provider abstraction: prompt and parsing are provider-agnostic.**
  `buildApplicationPrompt()` and `parseSmartResponse()` live in `src/lib/llm/prompt.ts`
  and are shared by all providers (Ollama, OpenAI, Anthropic, Gemini). Each provider
  only handles API formatting (request shape, auth headers, response extraction).
  The prompt text is identical across providers — only the transport differs.

- **2026-02-21 — Provider registry with self-registration.**
  Each provider file imports `registerProvider()` and calls it at module load.
  The barrel export `src/lib/llm/index.ts` imports all provider files to trigger
  registration. `getProvider(id)` and `listProviders()` are the public API.

- **2026-02-21 — Anthropic browser requests need `anthropic-dangerous-direct-browser-access: true`.**
  The Anthropic API rejects browser-originated requests (no `Origin` header allowed)
  unless this header is set. Without it, all requests fail with a CORS error.

- **2026-02-21 — Gemini uses API key in query param, not header.**
  Unlike OpenAI/Anthropic which use `Authorization`/`x-api-key` headers, Gemini
  passes the API key as `?key=...` in the URL. The endpoint also differs:
  `/v1beta/models/{model}:generateContent`. Use `responseMimeType: "application/json"`
  in `generationConfig` to request structured output.

- **2026-02-21 — Settings migration: `ollamaUrl` → `providerConfig`.**
  Old settings had `ollamaUrl: string`. New settings have `providerConfig: ProviderConfig`.
  `getSettings()` does a one-time migration: if `ollamaUrl` exists but no `providerConfig`,
  it creates one and persists. This handles upgrades without data loss.

- **2026-02-21 — Smart fill must handle contenteditable + role=textbox, not just textarea.**
  Many ATS (Ashby, Gem) render essay question fields as `<div contenteditable="true">`
  or `<div role="textbox">` instead of `<textarea>`. The original `fillSmartAnswers`
  only checked `instanceof HTMLTextAreaElement | HTMLInputElement`, silently failing
  on these elements. Fix: use `setContentEditableValue()` which sets `textContent`
  and fires `InputEvent` + `change`. Also expand the repair selector from just
  `textarea` to `textarea, [role="textbox"], [contenteditable="true"]`.

- **2026-02-21 — Keep smart fill and deterministic fill as separate code paths.**
  `fillSmartEntries()` and `fillFields()` share `setNativeValue()` but otherwise have
  completely different logic. Smart fill does selector cascade → signal-based repair;
  deterministic fill does resolveElement → matchedField → profile lookup. Merging them
  would complicate both. Keep them as separate exported functions in `filler.ts`.

---

## Detection Bugs (from debug export analysis)

- **2026-02-21 — Always exclude infrastructure elements (recaptcha, honeypots).**
  `g-recaptcha-response` textareas appear on many ATS pages. If not excluded, they
  get detected as fields and Smart Apply even tries to fill them. Added
  `isInfrastructure()` helper that checks against `INFRA_SELECTORS` list. Applied in
  3 places: main detection loop, custom controls loop, `extractOpenQuestions()`, and
  `fillSmartEntries()` repair scan.

- **2026-02-21 — Skip children of `[role="listbox"]` / `[role="combobox"]` containers.**
  `react-international-phone` renders 200+ `<li>` country code options. Without
  ancestor filtering, each gets detected as a separate "custom" field matched to
  "phone". Fix: `el.closest('[role="listbox"]') && el !== container` → skip.

- **2026-02-21 — Cap previous-sibling text to 200 chars and skip generic text.**
  Phone input's `previousElementSibling` can be the country dropdown with 15000+
  chars of concatenated country names. Added `text.length <= 200` guard. Also skip
  generic text like "Your answer", "Type here" that provides no useful signal.

- **2026-02-21 — Google Forms: question text is in `[role="heading"]` ancestors, not labels.**
  Google Forms doesn't use `<label>`, `aria-label`, or parent wrappers for question
  text. The question lives in a `<div role="heading">` within a shared ancestor div.
  Added heading-scan strategy that walks up 6 levels looking for heading elements when
  existing signals are weak/generic.

- **2026-02-21 — Essay prompts must NOT match profile fields (except "summary").**
  "Describe your work experience in 3-4 sentences" was matching `currentTitle` at
  0.77 confidence because it contains "position". Added `isEssayPrompt()` check:
  signals >40 chars, starting with why/what/how/describe, containing "?", or
  mentioning sentence/word/paragraph counts get a 0.3x confidence multiplier on all
  fields except `summary`. Exported as `ESSAY_PATTERN` from `matchers.ts`.

- **2026-02-21 — Ashby uses `<input type="text">` for essay questions, not `<textarea>`.**
  `extractOpenQuestions()` originally only queried `textarea, [role="textbox"],
  [contenteditable="true"]`. Added Pass 2 that scans `input[type="text"]` elements
  whose labels match `ESSAY_PATTERN` or are >50 chars with essay keywords. Also
  updated `SMART_FILL_SELECTOR` in `fillSmartEntries()` repair to include
  `input[type="text"]`.

- **2026-02-21 — Low-confidence matches must NOT be filled.**
  Even with essay-prompt penalties dropping confidence to 0.23, `fillFields()` had
  no minimum threshold — any non-null `matchedField` got filled. This caused
  "Are you willing to relocate to the Bay Area?" (matched to `currentTitle` at 0.231)
  to fill with "Senior Software Engineer". Added `confidence < 0.4` guard in
  `fillFields()` that emits `reason: "low_confidence"` instead of filling.

- **2026-02-21 — "LGBTQ+" must be in demographic keywords.**
  Discord/Greenhouse has "I consider myself a member of the LGBTQ+ community" as an
  EEO question. Without "lgbtq" in `DEMOGRAPHIC_KEYWORDS`, this field wasn't tagged
  as demographic and could potentially be matched/filled. Added "lgbtq" keyword.

- **2026-02-21 — Extract thresholds to `constants.ts`, not magic numbers.**
  `MIN_FILL_CONFIDENCE`, `ESSAY_CONFIDENCE_PENALTY`, `MAX_SIGNAL_LENGTH`,
  `INFRA_SELECTORS` — all live in `src/shared/constants.ts`. One place to tune,
  no hunting through detector/filler/matchers for buried numbers.

- **2026-02-21 — "How did you hear about this job?" needs its own field.**
  Without `heardAbout` in `FIELD_KEYWORDS`, this matches `summary` at 0.83 and would
  fill with the user's summary text (wrong). Added `heardAbout` as a recognized field
  with keywords like "how did you hear", "referral source". Since `getProfileValue()`
  returns `""` for it (no profile value yet), it gets `empty_profile` — correctly
  identified but never wrongly filled. Full implementation is Phase 1.

- **2026-02-21 — ATS company name extraction: prefer JSON-LD over og:site_name.**
  Ashby's `og:site_name` reports "Ashby" or "jobs.ashbyhq.com", not the actual company.
  Best fallback chain: JSON-LD `hiringOrganization.name` > page header/company block >
  URL path segment (`/Paragon/...`) > `og:site_name` (weak).

---

## Auto-Apply / UX Pipeline

- **2026-02-21 — Auto-Apply chains Detect → Fill → Smart Generate in one click.**
  `handleAutoApply()` runs the full pipeline but pauses at the "generated" phase so the
  user can review/edit smart answers before applying. If no open questions exist, it
  shows the "auto-applied" phase with deterministic fill results only. The pipeline tracks
  auto-fill stats in `autoFillStatsRef` so they display alongside generated answers.

- **2026-02-21 — Radio/checkbox inputs need separate detection and fill paths.**
  Individual radio/checkbox inputs are excluded from `FILLABLE_SELECTOR` (via `:not` pseudo-
  classes) since they must be handled as logical groups. `detectChoiceGroups()` groups them
  by `name` attribute, extracts the group question from `<legend>`, `aria-label`, or nearby
  text, and runs the same demographic check as text fields. `fillChoiceGroups()` matches
  profile values to option labels using exact → fuzzy → yes/no shorthand, and uses
  `el.click()` + `dispatchEvent(change)` instead of setting `.checked` directly (which
  React/Angular don't pick up).

- **2026-02-21 — Answer Library uses SHA-256 hash of normalized question text as key.**
  `computeQuestionHash()` applies `normalizeText()` then `sha256()` to produce a stable
  key regardless of whitespace/casing changes. Auto-save happens after smart fill completes
  (not during generation) so only actually-filled answers are saved. Library lookup happens
  in `FillPreview.tsx` before sending fill data, not in the content script.

- **2026-02-21 — Voice is stored separately from Profile.**
  Voice (corePitch, topStrengths, roleTargets, constraints, tone) is intentionally not
  part of the Profile object. Profile = facts parsed from resume; Voice = user-authored
  preferences and personality. Voice persists independently so re-importing a resume
  doesn't overwrite tone settings. Stored under `"voice"` key, respects stateless mode.

- **2026-02-21 — Voice injection in prompt: before profile, after job description.**
  `buildApplicationPrompt()` inserts the voice block between the job description and the
  candidate profile section. The block includes anti-generic instructions: "Use the
  candidate's own words from Core Pitch as the foundation." This placement ensures the
  LLM sees the user's voice before the raw resume data, giving it priority in tone.

---

## Debug Fix Learnings (from real-world exports)

- **2026-02-21 — Bare "Name" signal matches fullName, not firstName.**
  Both `firstName` and `fullName` matched `"Name"` via reverse-contains at 0.7, but
  `firstName` won due to iteration order. Fixed by adding bare `"name"` at index 0 of
  `fullName` keywords, giving it an exact-match score of 1.0 which beats 0.7.

- **2026-02-21 — Job search forms generate false positive field detections.**
  Career pages often have a job search form (`[role="search"]`, `name="search"`,
  `name="categories"`, `name="locations"`) alongside the application form. The "Locations"
  filter matched `location` at 0.85. Fixed with `isSearchFormElement()` which checks
  both specific selectors (`SEARCH_FORM_SELECTORS`) and `[role="search"]` ancestors.

- **2026-02-21 — "Authorized to be employed" != "authorized to work".**
  Real forms use "Are you authorized to be employed in the US?" but our keywords only
  had "authorized to work". Expanded with "authorized to be employed" and "legally eligible".

- **2026-02-21 — middleName needs to be a recognized ProfileField.**
  Crelate forms have `input[name="middleName"]`. Added as a ProfileField with keywords.
  The profile doesn't store middleName, so `getProfileValue()` returns `""` — the field
  is recognized but gets `empty_profile` fill reason (correctly).

---

## Resume Management

- **2026-02-21 — Resume store follows jobStore KVStore pattern.**
  `resumeStore.ts` uses `ms:resume:<id>` keys and a `ms:resumeIndex` index, mirroring
  the `ms:job:*` pattern. Same `setResumeKVStore()` for test injection.

- **2026-02-21 — Resume generation returns markdown, not JSON.**
  Unlike `generateApplication()` which returns structured JSON (`SmartApplyResult`),
  `generateResume()` returns raw markdown via `parseResumeResponse()`. The parser just
  strips code fences — much simpler than `parseSmartResponse()`.

- **2026-02-21 — Per-job resume linking via JobRecord.linkedResumeId.**
  Each JobRecord can reference one resume. The resume picker in FillPreview.tsx updates
  this link via `upsertJob()`. Resumes themselves are global (not per-job) but can be
  generated for a specific job via `generatedForJob` pointer.

- **2026-02-21 — Voice.tone changed from union to plain string.**
  Originally `"direct" | "warm" | "technical" | "enthusiastic"`, now `string` to support
  custom tones via "Other" dropdown option. `EMPTY_VOICE.tone` still defaults to `"direct"`.
  The prompt interpolation (`Write in a ${voice.tone} tone`) works with any string.

---

## LLM Output Post-Processing

- **2026-02-23 — LLMs leak system instructions into generated resume/CL content.**
  Models (especially instruction-tuned ones) frequently append trailing commentary after
  generating the requested content. Example: "This resume adheres strictly to the provided
  guidelines, using only the experiences, education, skills, companies, and job titles from
  the existing source material." This is the model echoing its own instructions back.
  Fix has two layers:
  1. **Prompt rules** — Added rule 11 to `buildResumePrompt()` and rule 12 to
     `buildCoverLetterPrompt()` explicitly forbidding commentary.
  2. **Post-processing** — `stripTrailingCommentary()` walks backward through trailing
     paragraph blocks (text separated by blank lines) and strips blocks matching ~20
     commentary regex patterns. Safety: blocks containing markdown structural elements
     (headings, bullets, bold, tables, HRs) are never stripped. If stripping would
     remove everything, the original text is returned unchanged.

- **2026-02-23 — Commentary stripping must walk backward, not forward.**
  The original instinct was to scan the full text for commentary patterns. This is wrong
  because legitimate resume content can contain words like "note" or "the above" in context.
  Walking backward from the end and stopping at the first non-commentary block ensures we
  only strip trailing meta-text, never embedded content.

- **2026-02-23 — `isMarkdownStructure()` is the safety net.**
  When deciding whether a trailing paragraph is commentary, we first check if any line in
  the block is a markdown structural element (starts with `#`, `-`, `*`, `|`, `**`, `---`).
  If so, it's content — stop stripping. This prevents accidentally removing a Skills section
  that happens to contain the word "note" or "the above".

---

## File Input Detection & Attachment

- **2026-02-23 — `input[type="file"]` is explicitly excluded from `FILLABLE_SELECTOR`.**
  The detector uses `:not([type="file"])` in its input selector because file inputs can't
  be filled with text values. A separate `detectFileInputs()` function handles them with
  their own message flow (`DETECT_FILE_INPUTS` / `ATTACH_FILE`).

- **2026-02-23 — DataTransfer API is the only way to programmatically set file input values.**
  Browsers block `input.value = "path"` on file inputs for security. The `DataTransfer` API
  lets you create a `File` object, add it to a `DataTransfer`, and assign `dt.files` to
  `input.files`. This is the Chrome-standard approach:
  ```typescript
  const dt = new DataTransfer();
  dt.items.add(new File([content], fileName, { type: mimeType }));
  input.files = dt.files;
  ```
  Then dispatch `input` + `change` events with `{ bubbles: true }` for React/Angular.

- **2026-02-23 — File input `accept` attribute must be checked before attachment.**
  Many job sites only accept PDF uploads (`accept=".pdf,application/pdf"`). Attaching a
  markdown file to a PDF-only field will fail silently or show an error. The UI checks the
  `accept` attribute and warns the user when markdown/text isn't compatible. Future: PDF
  export from markdown to support these fields.

- **2026-02-23 — File input label extraction reuses `extractSignals()`.**
  Rather than writing new label extraction logic for file inputs, we reuse the existing
  `extractSignals()` + `getSelectorCandidates()` from `detector.ts`. The signals tell us
  whether the upload field is for a resume, cover letter, or "other" document.

---

## Generation Timeout & Logging

- **2026-02-23 — Generation timeout increased from 90s to 180s.**
  Default `DEFAULT_TIMEOUT` was 90 seconds. Larger models (70B params on Ollama, or
  heavy Anthropic prompts) routinely exceeded this. Doubled to 180s across all 4 providers.

- **2026-02-23 — `GenerationRun` audit logging follows `FillRun` / `SmartApplyRun` pattern.**
  Every resume/CL generation (success or failure) is logged with `performance.now()` timing,
  model metadata, content length, and error messages. Stored in `generationRuns` (20 max).
  `source` field tracks whether generation was triggered from the Resumes tab or FillPreview.
  Displayed in Debug tab with expandable cards showing duration, model, output size, errors.

- **2026-02-23 — Duplicate stateless mode toggle in Profile.tsx.**
  The Profile page had two identical stateless mode toggle blocks (copy-paste artifact).
  Second instance removed. When debugging duplicate UI elements, always search for the
  exact JSX comment string — the first instance was the intended one.
