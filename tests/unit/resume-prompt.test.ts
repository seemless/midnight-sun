import { describe, it, expect } from "vitest";
import { buildResumePrompt, parseResumeResponse } from "../../src/lib/llm/prompt";
import type { JobContext, Profile, Voice } from "../../src/shared/types";
import { EMPTY_PROFILE, EMPTY_VOICE } from "../../src/shared/types";

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
  description: "We are looking for a frontend engineer with React experience...",
  questions: [],
};

const TEST_VOICE: Voice = {
  corePitch: "I'm a product-minded engineer who ships fast.",
  topStrengths: ["system design", "React performance"],
  roleTargets: ["Senior Frontend Engineer"],
  constraints: "Remote-first preferred",
  tone: "direct",
};

describe("buildResumePrompt", () => {
  it("includes job title and company", () => {
    const prompt = buildResumePrompt(TEST_CONTEXT, TEST_PROFILE);
    expect(prompt).toContain("Senior Frontend Engineer");
    expect(prompt).toContain("Acme Corp");
  });

  it("includes candidate name in template", () => {
    const prompt = buildResumePrompt(TEST_CONTEXT, TEST_PROFILE);
    expect(prompt).toContain("Jane Doe");
  });

  it("includes profile data as JSON", () => {
    const prompt = buildResumePrompt(TEST_CONTEXT, TEST_PROFILE);
    expect(prompt).toContain("TypeScript");
    expect(prompt).toContain("React");
    expect(prompt).toContain("jane@example.com");
  });

  it("includes job description", () => {
    const prompt = buildResumePrompt(TEST_CONTEXT, TEST_PROFILE);
    expect(prompt).toContain("frontend engineer with React experience");
  });

  it("requests markdown output", () => {
    const prompt = buildResumePrompt(TEST_CONTEXT, TEST_PROFILE);
    expect(prompt).toContain("Respond ONLY with markdown");
  });

  it("includes resume section guidance", () => {
    const prompt = buildResumePrompt(TEST_CONTEXT, TEST_PROFILE);
    expect(prompt).toContain("## Summary");
    expect(prompt).toContain("## Experience");
    expect(prompt).toContain("## Education");
    expect(prompt).toContain("## Skills");
  });

  it("includes voice block when voice has corePitch", () => {
    const prompt = buildResumePrompt(TEST_CONTEXT, TEST_PROFILE, TEST_VOICE);
    expect(prompt).toContain("Candidate Voice & Preferences:");
    expect(prompt).toContain("Core Pitch:");
    expect(prompt).toContain("product-minded engineer");
  });

  it("includes voice strengths and role targets", () => {
    const prompt = buildResumePrompt(TEST_CONTEXT, TEST_PROFILE, TEST_VOICE);
    expect(prompt).toContain("Top Strengths:");
    expect(prompt).toContain("system design");
    expect(prompt).toContain("Target Roles:");
  });

  it("does not include voice block when voice is undefined", () => {
    const prompt = buildResumePrompt(TEST_CONTEXT, TEST_PROFILE);
    expect(prompt).not.toContain("Candidate Voice & Preferences:");
  });

  it("does not include voice block when corePitch is empty", () => {
    const prompt = buildResumePrompt(TEST_CONTEXT, TEST_PROFILE, EMPTY_VOICE);
    expect(prompt).not.toContain("Candidate Voice & Preferences:");
  });

  it("includes anti-invention rule", () => {
    const prompt = buildResumePrompt(TEST_CONTEXT, TEST_PROFILE);
    expect(prompt).toContain("Do NOT invent experience");
  });
});

describe("parseResumeResponse", () => {
  it("returns raw markdown as-is", () => {
    const md = "# Jane Doe\n\n## Summary\nExperienced engineer.";
    const result = parseResumeResponse(md);
    expect(result).toBe(md);
  });

  it("strips markdown code fences", () => {
    const raw = "```markdown\n# Jane Doe\n## Summary\nEngineer.\n```";
    const result = parseResumeResponse(raw);
    expect(result).toBe("# Jane Doe\n## Summary\nEngineer.");
  });

  it("strips md code fences", () => {
    const raw = "```md\n# Resume\n```";
    const result = parseResumeResponse(raw);
    expect(result).toBe("# Resume");
  });

  it("strips plain code fences", () => {
    const raw = "```\n# Resume Content\n```";
    const result = parseResumeResponse(raw);
    expect(result).toBe("# Resume Content");
  });

  it("returns null for empty string", () => {
    expect(parseResumeResponse("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseResumeResponse("   \n  \n  ")).toBeNull();
  });

  it("trims whitespace", () => {
    const result = parseResumeResponse("  \n# Resume\n  ");
    expect(result).toBe("# Resume");
  });
});
