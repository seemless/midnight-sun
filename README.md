# The Midnight Sun ☀️🌙

Auto-fill job applications. Track everything. Make job hunting suck less.

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

## How It Works

1. **Import your resume** — Paste text in the Profile tab. Parsed instantly, no AI needed.
2. **Visit a job application** — Navigate to any job page (Greenhouse, Lever, etc.)
3. **Scan & Fill** — Click "Scan Page for Fields", review matches, click "Fill"
4. **Track it** — Application added to your dashboard automatically

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full technical design.

**Stack:** Chrome Extension (Manifest V3) + React + TypeScript + Tailwind CSS

**Key principle:** Every piece of business logic is a pure, testable function.
No LLM required for core features. Ollama integration planned for Phase 2.
