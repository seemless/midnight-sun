import { describe, it, expect } from "vitest";
import { fillFields } from "../../src/content/filler";
import type { DetectedField, Profile } from "../../src/shared/types";

const TEST_PROFILE: Profile = {
  firstName: "Connor",
  lastName: "Murphy",
  email: "connor@test.com",
  phone: "8186881702",
  location: "Los Angeles, CA",
  linkedinUrl: "https://linkedin.com/in/connormurphy",
  githubUrl: "https://github.com/connormurphy",
  portfolioUrl: "https://connormurphy.dev",
  summary: "Experienced software engineer",
  experiences: [
    { id: "1", title: "Senior Software Engineer", company: "Acme Corp", location: "LA", startDate: "2022-01", endDate: "Present", description: "", highlights: [] },
  ],
  education: [],
  skills: ["TypeScript", "React"],
};

function makeField(overrides: Partial<DetectedField>): DetectedField {
  return {
    selectorCandidates: ["#test-field"],
    inputType: "text",
    signals: ["test"],
    structuredSignals: {},
    matchedField: null,
    confidence: 0,
    currentValue: "",
    visible: true,
    ...overrides,
  };
}

describe("fillFields", () => {
  describe("low-confidence threshold", () => {
    it("skips fields below 0.4 confidence with low_confidence reason", () => {
      const html = `<html><body><input id="test-field" type="text" /></body></html>`;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      const fields: DetectedField[] = [
        makeField({
          selectorCandidates: ["#test-field"],
          matchedField: "currentTitle",
          confidence: 0.231,
          signals: ["Are you currently based in or willing to relocate to the Bay Area?"],
        }),
      ];

      const results = fillFields(fields, TEST_PROFILE, doc);

      expect(results.length).toBe(1);
      expect(results[0].success).toBe(false);
      expect(results[0].reason).toBe("low_confidence");
      expect(results[0].filledValue).toBe("");
    });

    it("fills fields at or above 0.4 confidence", () => {
      const html = `<html><body><input id="email-field" type="email" /></body></html>`;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      const fields: DetectedField[] = [
        makeField({
          selectorCandidates: ["#email-field"],
          matchedField: "email",
          confidence: 0.85,
          signals: ["Email"],
        }),
      ];

      const results = fillFields(fields, TEST_PROFILE, doc);

      expect(results.length).toBe(1);
      expect(results[0].success).toBe(true);
      expect(results[0].filledValue).toBe("connor@test.com");
    });

    it("skips at exactly 0.39 confidence", () => {
      const html = `<html><body><input id="test-field" type="text" /></body></html>`;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      const fields: DetectedField[] = [
        makeField({
          selectorCandidates: ["#test-field"],
          matchedField: "state",
          confidence: 0.39,
          signals: ["Are you legally authorized to work?"],
        }),
      ];

      const results = fillFields(fields, TEST_PROFILE, doc);

      expect(results[0].success).toBe(false);
      expect(results[0].reason).toBe("low_confidence");
    });

    it("fills at exactly 0.4 confidence", () => {
      const html = `<html><body><input id="test-field" type="text" /></body></html>`;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      const fields: DetectedField[] = [
        makeField({
          selectorCandidates: ["#test-field"],
          matchedField: "location",
          confidence: 0.4,
          signals: ["Location"],
        }),
      ];

      const results = fillFields(fields, TEST_PROFILE, doc);

      expect(results[0].success).toBe(true);
      expect(results[0].filledValue).toBe("Los Angeles, CA");
    });
  });
});
