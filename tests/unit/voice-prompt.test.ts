import { describe, it, expect } from "vitest";
import { buildApplicationPrompt } from "../../src/lib/llm/prompt";
import type { JobContext, Profile, Voice } from "../../src/shared/types";
import { EMPTY_PROFILE, EMPTY_VOICE } from "../../src/shared/types";

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
  ],
};

const TEST_VOICE: Voice = {
  corePitch: "I'm a product-minded engineer who ships fast and cares about user experience.",
  topStrengths: ["system design", "React performance", "team leadership"],
  roleTargets: ["Senior Frontend Engineer", "Staff Engineer"],
  constraints: "Remote-first preferred, authorized to work in US",
  tone: "direct",
};

// --- Voice in prompts ---

describe("Voice prompt injection", () => {
  it("includes voice block when voice has corePitch", () => {
    const prompt = buildApplicationPrompt(TEST_CONTEXT, TEST_PROFILE, TEST_VOICE);
    expect(prompt).toContain("Candidate Voice & Preferences:");
    expect(prompt).toContain("Core Pitch:");
    expect(prompt).toContain("I'm a product-minded engineer");
  });

  it("includes top strengths", () => {
    const prompt = buildApplicationPrompt(TEST_CONTEXT, TEST_PROFILE, TEST_VOICE);
    expect(prompt).toContain("Top Strengths:");
    expect(prompt).toContain("system design");
    expect(prompt).toContain("React performance");
    expect(prompt).toContain("team leadership");
  });

  it("includes role targets", () => {
    const prompt = buildApplicationPrompt(TEST_CONTEXT, TEST_PROFILE, TEST_VOICE);
    expect(prompt).toContain("Target Roles:");
    expect(prompt).toContain("Senior Frontend Engineer");
    expect(prompt).toContain("Staff Engineer");
  });

  it("includes constraints", () => {
    const prompt = buildApplicationPrompt(TEST_CONTEXT, TEST_PROFILE, TEST_VOICE);
    expect(prompt).toContain("Constraints:");
    expect(prompt).toContain("Remote-first preferred");
  });

  it("includes tone directive", () => {
    const prompt = buildApplicationPrompt(TEST_CONTEXT, TEST_PROFILE, TEST_VOICE);
    expect(prompt).toContain("Write in a direct tone");
  });

  it("includes anti-generic instruction", () => {
    const prompt = buildApplicationPrompt(TEST_CONTEXT, TEST_PROFILE, TEST_VOICE);
    expect(prompt).toContain("Use the candidate's own words");
    expect(prompt).toContain("Don't be generic");
  });

  it("does not include voice block when voice is undefined", () => {
    const prompt = buildApplicationPrompt(TEST_CONTEXT, TEST_PROFILE);
    expect(prompt).not.toContain("Candidate Voice & Preferences:");
    expect(prompt).not.toContain("Core Pitch:");
  });

  it("does not include voice block when corePitch is empty", () => {
    const prompt = buildApplicationPrompt(TEST_CONTEXT, TEST_PROFILE, EMPTY_VOICE);
    expect(prompt).not.toContain("Candidate Voice & Preferences:");
    expect(prompt).not.toContain("Core Pitch:");
  });

  it("omits strengths line when topStrengths is empty", () => {
    const voice: Voice = {
      ...TEST_VOICE,
      topStrengths: [],
    };
    const prompt = buildApplicationPrompt(TEST_CONTEXT, TEST_PROFILE, voice);
    expect(prompt).toContain("Core Pitch:");
    expect(prompt).not.toContain("Top Strengths:");
  });

  it("omits role targets line when roleTargets is empty", () => {
    const voice: Voice = {
      ...TEST_VOICE,
      roleTargets: [],
    };
    const prompt = buildApplicationPrompt(TEST_CONTEXT, TEST_PROFILE, voice);
    expect(prompt).toContain("Core Pitch:");
    expect(prompt).not.toContain("Target Roles:");
  });

  it("omits constraints line when constraints is empty", () => {
    const voice: Voice = {
      ...TEST_VOICE,
      constraints: "",
    };
    const prompt = buildApplicationPrompt(TEST_CONTEXT, TEST_PROFILE, voice);
    expect(prompt).toContain("Core Pitch:");
    expect(prompt).not.toContain("Constraints:");
  });

  it("voice block appears before profile section", () => {
    const prompt = buildApplicationPrompt(TEST_CONTEXT, TEST_PROFILE, TEST_VOICE);
    const voiceIndex = prompt.indexOf("Candidate Voice & Preferences:");
    const profileIndex = prompt.indexOf("Candidate Profile:");
    expect(voiceIndex).toBeGreaterThan(-1);
    expect(profileIndex).toBeGreaterThan(-1);
    expect(voiceIndex).toBeLessThan(profileIndex);
  });

  it("still includes profile and job data when voice is present", () => {
    const prompt = buildApplicationPrompt(TEST_CONTEXT, TEST_PROFILE, TEST_VOICE);
    expect(prompt).toContain("Senior Frontend Engineer");
    expect(prompt).toContain("Acme Corp");
    expect(prompt).toContain("Jane");
    expect(prompt).toContain("jane@example.com");
  });

  it("supports all four preset tone options", () => {
    const tones = ["direct", "warm", "technical", "enthusiastic"];
    for (const tone of tones) {
      const voice: Voice = { ...TEST_VOICE, tone };
      const prompt = buildApplicationPrompt(TEST_CONTEXT, TEST_PROFILE, voice);
      expect(prompt).toContain(`Write in a ${tone} tone`);
    }
  });

  it("supports custom tone strings", () => {
    const voice: Voice = { ...TEST_VOICE, tone: "peppy and smart" };
    const prompt = buildApplicationPrompt(TEST_CONTEXT, TEST_PROFILE, voice);
    expect(prompt).toContain("Write in a peppy and smart tone");
  });

  it("supports single-word custom tone", () => {
    const voice: Voice = { ...TEST_VOICE, tone: "funny" };
    const prompt = buildApplicationPrompt(TEST_CONTEXT, TEST_PROFILE, voice);
    expect(prompt).toContain("Write in a funny tone");
  });

  it("minimal voice with only corePitch and tone works", () => {
    const voice: Voice = {
      corePitch: "I build great products.",
      topStrengths: [],
      roleTargets: [],
      constraints: "",
      tone: "warm",
    };
    const prompt = buildApplicationPrompt(TEST_CONTEXT, TEST_PROFILE, voice);
    expect(prompt).toContain("Core Pitch: I build great products.");
    expect(prompt).toContain("Write in a warm tone");
    expect(prompt).not.toContain("Top Strengths:");
    expect(prompt).not.toContain("Target Roles:");
    expect(prompt).not.toContain("Constraints:");
  });
});
