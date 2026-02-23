# Agent Quick Reference

Chrome extension (MV3) that auto-fills job applications via pattern matching + LLM. React/TS/Tailwind.

## Where to Look

| What you need | Where it lives |
|---|---|
| **Field detection** (how inputs are found) | `src/content/detector.ts` — `detectFields()`, `extractSignals()`, `getSelectorCandidates()` |
| **Field filling** (how values are set) | `src/content/filler.ts` — `fillFields()`, `fillChoiceGroups()`, `fillSmartEntries()` |
| **File input attach** (resume upload) | `src/content/index.ts` — `detectFileInputs()`, `attachFileToInput()` |
| **Keyword matching** (signal → profile field) | `src/shared/matchers.ts` — `matchField()`, `FIELD_KEYWORDS`, `ESSAY_PATTERN` |
| **LLM prompts** (resume/CL/smart answers) | `src/lib/llm/prompt.ts` — `buildResumePrompt()`, `buildCoverLetterPrompt()`, `buildApplicationPrompt()`, `stripTrailingCommentary()` |
| **LLM providers** (Ollama/OpenAI/Anthropic/Gemini) | `src/lib/llm/providers/*.ts` — each implements `SmartApplyProvider` |
| **Provider registry** | `src/lib/llm/registry.ts` — `getProvider()`, `listProviders()` |
| **All types** (Message union, interfaces) | `src/shared/types.ts` — `Message`, `DetectedField`, `Profile`, `JobContext`, `FileInputInfo`, `GenerationRun` |
| **Storage** (CRUD for profile/settings/runs) | `src/shared/storage.ts` — adapter pattern, `getProfile()`, `saveFillRun()`, `saveGenerationRun()` |
| **Job store** (per-job KV data) | `src/shared/jobStore.ts` — `ms:job:*`, `ms:snapshot:*`, `ms:answers:*`, `ms:resume:*` |
| **Constants/thresholds** | `src/shared/constants.ts` — `MIN_FILL_CONFIDENCE`, `ESSAY_CONFIDENCE_PENALTY`, `INFRA_SELECTORS` |
| **Background worker** (LLM proxy, frame detection) | `src/background/index.ts` |
| **Content script entry** (message handlers) | `src/content/index.ts` — handles DETECT_FIELDS, FILL_FIELDS, DETECT_FILE_INPUTS, ATTACH_FILE, etc. |
| **Popup UI** | `src/popup/pages/` — `FillPreview.tsx` (main workflow), `Dashboard.tsx`, `Profile.tsx`, `Resumes.tsx`, `DebugLog.tsx` |
| **Page snapshots** | `src/content/snapshot.ts` — `extractSnapshot()` |
| **URL utils** | `src/shared/urls.ts` — `canonicalizeUrl()`, `detectSource()`, `postingKey()` |

## Message Flow

```
Popup ──sendToActiveTab()──► Content Script (frameId:0)
Popup ──sendToBackground()──► Background Worker ──► LLM Provider
Background ──tabs.sendMessage(frameId)──► Content Script (per-frame)
```

All messages are typed in the `Message` union in `types.ts`.

## Key Patterns

- **No ATS-specific logic.** Detection works by extracting text signals from any HTML form and matching keywords. Never write selectors targeting a specific ATS.
- **Native property descriptors** for setting values in React/Angular forms. `HTMLInputElement.prototype.value.set.call(el, value)` + event dispatch.
- **DataTransfer API** for file inputs. Browsers block `.value =` on file inputs.
- **Confidence scoring** (0–1) on field matches. Below `MIN_FILL_CONFIDENCE` (0.4) = skip.
- **LLM is optional.** Deterministic fill works without any provider configured.
- **All audit logging** goes to storage: `FillRun` (100 max), `SmartApplyRun` (30 max), `GenerationRun` (20 max).

## Build & Test

```
npm run build    # tsc && vite build → dist/
npm run dev      # vite dev + CRXJS hot reload
npm run test     # vitest (happy-dom for DOM tests)
```

Load `dist/` as unpacked extension in `chrome://extensions`.

## Docs

- `ARCHITECTURE.md` — full technical design, diagrams, storage schema
- `LEARNINGS.md` — every bug and gotcha, indexed by symptom
- `ROADMAP.json` — phases, completions, vision, narrative design, priorities
