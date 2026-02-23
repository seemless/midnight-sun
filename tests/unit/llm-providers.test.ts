import { describe, it, expect } from "vitest";
import {
  buildApplicationPrompt,
  parseSmartResponse,
  buildSmartApplyResult,
  zipAnswers,
} from "../../src/lib/llm/prompt";
import { getProvider, listProviders } from "../../src/lib/llm";
import type { JobContext, Profile } from "../../src/shared/types";
import { EMPTY_PROFILE } from "../../src/shared/types";

// --- Test fixtures ---

const TEST_PROFILE: Profile = {
  ...EMPTY_PROFILE,
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@example.com",
  summary: "Experienced engineer with 5 years in web development.",
  skills: ["TypeScript", "React", "Node.js"],
};

const TEST_CONTEXT: JobContext = {
  url: "https://jobs.example.com/apply",
  title: "Senior Frontend Engineer",
  company: "Acme Corp",
  description: "We are looking for a frontend engineer...",
  questions: [
    {
      label: "Why do you want to work at Acme Corp?",
      selectorCandidates: ["#q1"],
      signals: ["Why do you want to work at Acme Corp?"],
    },
    {
      label: "Describe a challenging project.",
      selectorCandidates: ["#q2"],
      signals: ["Describe a challenging project."],
    },
  ],
};

// --- Prompt Builder ---

describe("buildApplicationPrompt", () => {
  it("includes job title and company", () => {
    const prompt = buildApplicationPrompt(TEST_CONTEXT, TEST_PROFILE);
    expect(prompt).toContain("Senior Frontend Engineer");
    expect(prompt).toContain("Acme Corp");
  });

  it("includes profile data", () => {
    const prompt = buildApplicationPrompt(TEST_CONTEXT, TEST_PROFILE);
    expect(prompt).toContain("Jane");
    expect(prompt).toContain("jane@example.com");
  });

  it("includes question labels", () => {
    const prompt = buildApplicationPrompt(TEST_CONTEXT, TEST_PROFILE);
    expect(prompt).toContain("Why do you want to work at Acme Corp?");
    expect(prompt).toContain("Describe a challenging project.");
  });

  it("handles context with no questions", () => {
    const ctx: JobContext = { ...TEST_CONTEXT, questions: [] };
    const prompt = buildApplicationPrompt(ctx, TEST_PROFILE);
    expect(prompt).toContain("No additional questions");
  });

  it("escapes double quotes in question labels", () => {
    const ctx: JobContext = {
      ...TEST_CONTEXT,
      questions: [
        {
          label: 'Tell us about your "ideal" role',
          selectorCandidates: ["#q1"],
          signals: [],
        },
      ],
    };
    const prompt = buildApplicationPrompt(ctx, TEST_PROFILE);
    expect(prompt).toContain('\\"ideal\\"');
  });
});

// --- Response Parser ---

describe("parseSmartResponse", () => {
  const VALID_RESPONSE = JSON.stringify({
    summary: "Jane has 5 years of frontend experience.",
    whyCompany: "Acme is a leader in the industry.",
    answers: [
      { label: "Why Acme?", answer: "Great culture." },
      { label: "Challenging project?", answer: "Built a design system." },
    ],
  });

  it("parses valid JSON", () => {
    const result = parseSmartResponse(VALID_RESPONSE);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe("Jane has 5 years of frontend experience.");
    expect(result!.whyCompany).toBe("Acme is a leader in the industry.");
    expect(result!.answers).toHaveLength(2);
  });

  it("strips markdown code fences", () => {
    const wrapped = "```json\n" + VALID_RESPONSE + "\n```";
    const result = parseSmartResponse(wrapped);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe("Jane has 5 years of frontend experience.");
  });

  it("extracts JSON from surrounding text", () => {
    const messy = "Here is the result:\n" + VALID_RESPONSE + "\nDone!";
    const result = parseSmartResponse(messy);
    expect(result).not.toBeNull();
    expect(result!.answers).toHaveLength(2);
  });

  it("returns null for invalid JSON", () => {
    expect(parseSmartResponse("not json at all")).toBeNull();
  });

  it("returns null for JSON missing required fields", () => {
    expect(parseSmartResponse('{"summary": "hi"}')).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseSmartResponse("")).toBeNull();
  });
});

// --- zipAnswers ---

describe("zipAnswers", () => {
  it("maps parsed answers to question metadata by index", () => {
    const parsed = {
      summary: "...",
      whyCompany: "...",
      answers: [
        { label: "Q1", answer: "A1" },
        { label: "Q2", answer: "A2" },
      ],
    };
    const zipped = zipAnswers(TEST_CONTEXT, parsed);
    expect(zipped).toHaveLength(2);
    expect(zipped[0].label).toBe("Why do you want to work at Acme Corp?");
    expect(zipped[0].selectorCandidates).toEqual(["#q1"]);
    expect(zipped[0].answer).toBe("A1");
    expect(zipped[1].label).toBe("Describe a challenging project.");
    expect(zipped[1].answer).toBe("A2");
  });

  it("handles fewer answers than questions", () => {
    const parsed = {
      summary: "...",
      whyCompany: "...",
      answers: [{ label: "Q1", answer: "A1" }],
    };
    const zipped = zipAnswers(TEST_CONTEXT, parsed);
    expect(zipped).toHaveLength(2);
    expect(zipped[1].answer).toBe(""); // missing answer → empty
  });
});

// --- buildSmartApplyResult ---

describe("buildSmartApplyResult", () => {
  it("constructs a complete SmartApplyResult", () => {
    const parsed = {
      summary: "Summary text",
      whyCompany: "Why text",
      answers: [
        { label: "Q1", answer: "A1" },
        { label: "Q2", answer: "A2" },
      ],
    };
    const result = buildSmartApplyResult(TEST_CONTEXT, parsed, "gpt-4o", 5000, 1234);
    expect(result.summary).toBe("Summary text");
    expect(result.whyCompany).toBe("Why text");
    expect(result.model).toBe("gpt-4o");
    expect(result.promptChars).toBe(5000);
    expect(result.durationMs).toBe(1234);
    expect(result.answers).toHaveLength(2);
    expect(result.answers[0].selectorCandidates).toEqual(["#q1"]);
  });
});

// --- Provider Registry ---

describe("Provider Registry", () => {
  it("lists all four providers", () => {
    const providers = listProviders();
    expect(providers).toHaveLength(4);
    const ids = providers.map((p) => p.id);
    expect(ids).toContain("ollama");
    expect(ids).toContain("openai");
    expect(ids).toContain("anthropic");
    expect(ids).toContain("gemini");
  });

  it("getProvider returns Ollama provider", () => {
    const provider = getProvider("ollama");
    expect(provider.id).toBe("ollama");
    expect(provider.name).toBe("Ollama (Local)");
    expect(provider.requiresApiKey).toBe(false);
  });

  it("getProvider returns OpenAI provider", () => {
    const provider = getProvider("openai");
    expect(provider.id).toBe("openai");
    expect(provider.name).toBe("OpenAI");
    expect(provider.requiresApiKey).toBe(true);
  });

  it("getProvider returns Anthropic provider", () => {
    const provider = getProvider("anthropic");
    expect(provider.id).toBe("anthropic");
    expect(provider.name).toBe("Anthropic");
    expect(provider.requiresApiKey).toBe(true);
  });

  it("getProvider returns Gemini provider", () => {
    const provider = getProvider("gemini");
    expect(provider.id).toBe("gemini");
    expect(provider.name).toBe("Google Gemini");
    expect(provider.requiresApiKey).toBe(true);
  });

  it("getProvider throws for unknown provider", () => {
    expect(() => getProvider("nonexistent" as any)).toThrow("Unknown provider");
  });

  it("provider metadata has default models", () => {
    const providers = listProviders();
    for (const p of providers) {
      expect(p.defaultModel).toBeTruthy();
      expect(p.models.length).toBeGreaterThan(0);
    }
  });

  it("Ollama provider has defaultBaseUrl", () => {
    const ollama = listProviders().find((p) => p.id === "ollama")!;
    expect(ollama.defaultBaseUrl).toBe("http://localhost:11434");
  });

  it("cloud providers do not have defaultBaseUrl", () => {
    const cloud = listProviders().filter((p) => p.id !== "ollama");
    for (const p of cloud) {
      expect(p.defaultBaseUrl).toBeUndefined();
    }
  });
});

// --- Cloud provider API key validation ---

describe("Cloud provider API key validation", () => {
  it("OpenAI isAvailable returns false without API key", async () => {
    const provider = getProvider("openai");
    const result = await provider.isAvailable({ id: "openai", model: "gpt-4o" });
    expect(result).toBe(false);
  });

  it("Anthropic isAvailable returns false without API key", async () => {
    const provider = getProvider("anthropic");
    const result = await provider.isAvailable({ id: "anthropic", model: "claude-sonnet-4-20250514" });
    expect(result).toBe(false);
  });

  it("Gemini isAvailable returns false without API key", async () => {
    const provider = getProvider("gemini");
    const result = await provider.isAvailable({ id: "gemini", model: "gemini-2.0-flash" });
    expect(result).toBe(false);
  });
});
