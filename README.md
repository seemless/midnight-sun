# The Midnight Sun ☀️🌙

> *In the land of the midnight sun, there is no hiding. Every shadow is illuminated, every detail revealed. Your career is the same — we just help you see it clearly.*

Auto-fill job applications. Generate tailored resumes. Track everything. Make job hunting suck less.

**The Midnight Sun** is a Chrome extension that turns the soul-crushing job applications into something fast, intelligent, and maybe even a little fun. It detects form fields on any ATS (Greenhouse, Lever, Ashby, Workday, LinkedIn, Indeed — all of them), fills your profile data instantly, generates smart answers to open-ended questions via LLM, and builds tailored resumes and cover letters on the fly.

No site-specific selectors. No brittle scraping. Just pattern matching that works everywhere.

---

## Quick Start

```bash
npm install
npm run dev
```

Then load the extension in Chrome:
1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist/` folder

## Development

```bash
npm run dev       # Vite dev server + CRXJS hot reload
npm run test      # Run unit tests
npm run build     # Production build
```

---

## What It Does Today

### Core Features

- **One-click Auto-Apply** — Scans the page, fills deterministic fields (name, email, phone, LinkedIn, etc.), detects essay questions, generates tailored answers via LLM, and lets you review before applying. All in one pipeline.

- **ATS-agnostic field detection** — Works on any HTML form. No site-specific selectors. Extracts signals from labels, aria attributes, placeholders, names, IDs, nearby text, container text, and data-automation attributes. Matches against a 22-field keyword dictionary with confidence scoring.

- **Smart Apply (LLM-powered answers)** — Open-ended questions ("Why do you want to work here?", "Describe your experience...") get tailored answers from your choice of LLM provider. Default is Ollama (local, private). Also supports OpenAI, Anthropic, and Google Gemini.

- **Resume & cover letter generation** — Generates tailored markdown resumes and cover letters for each job. Uses your existing resume as source material. Strips trailing LLM commentary automatically. Resumes are stored in a global library and linked per-job.

- **File input attachment** — Detects `<input type="file">` elements on job pages and programmatically attaches your selected resume via the DataTransfer API. No more downloading → navigating → uploading manually.

- **Voice & personality** — Set your core pitch, top strengths, target roles, constraints, and writing tone. These inject into every LLM prompt so generated content sounds like you, not a form letter.

- **Answer library** — Previously filled answers are remembered (SHA-256 hashed question text as key). Revisit a similar question on a different application and your old answer is pre-populated.

- **Gap detection** — Before generating, the LLM analyzes your profile against the job description and asks targeted questions to fill critical gaps. Prevents hallucination by getting real data first.

- **Application tracking** — Every job you visit gets a `JobRecord`. Status flows from `seen` → `filled` → `applied` → `interviewing` → `offered` → `accepted`/`rejected`/`ghosted`. Page snapshots, cached answers, and resume links are all per-job.

- **Full audit logging** — Every fill attempt, smart generation, and resume/CL generation is logged with timing, field counts, failure reasons, and model metadata. The Debug tab shows everything and exports to JSON.

- **Stateless mode** — Optional privacy mode where profile data lives in `chrome.storage.session` (survives popup open/close, clears on browser restart). Nothing persists to disk.

### Supported ATS Platforms

Works on any ATS with standard HTML forms. Explicitly tested against:

Greenhouse, Lever, Ashby, Workday, iCIMS, Taleo, BambooHR, LinkedIn, Indeed, Google Forms, Crelate, Gem, and dozens of custom career pages.

---

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full technical design.

**Stack:** Chrome Extension (Manifest V3) + React + TypeScript + Tailwind CSS + Vite/CRXJS

**LLM Providers:** Ollama (local, default), OpenAI, Anthropic, Google Gemini

**Key principle:** Every piece of business logic is a pure, testable function. The LLM never blocks the critical path — deterministic fill always works without it.

---

## Where It's Going

See [ROADMAP.json](./ROADMAP.json) for the full vision, including:

- **Desktop companion app** — A native app that handles persistence, career data, and long-term intelligence. The Chrome extension becomes the field agent; the desktop app is mission control.
- **The narrative** — An unlockable story about an agent committing corporate espionage, revealed as you accomplish real career goals.
- **Guidance counselor mode** — The long-term vision: not just filling forms, but helping you figure out what you actually want, navigate career transitions, and achieve evolving goals.

---

## Docs

| Document | What's in it |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design, message flow, detection pipeline, storage schema, LLM provider architecture |
| [LEARNINGS.md](./LEARNINGS.md) | Every bug, gotcha, and hard-won insight from development. The "don't debug this twice" file. |
| [ROADMAP.json](./ROADMAP.json) | Vision, phases, completions, desktop app plan, narrative milestones, priorities — machine-readable |
