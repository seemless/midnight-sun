import { describe, it, expect } from "vitest";
import { matchField, getProfileValue, normalize } from "../../src/shared/matchers";

describe("normalize", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalize("  First  Name  ")).toBe("first name");
  });
  it("converts underscores and dashes to spaces", () => {
    expect(normalize("first_name")).toBe("first name");
    expect(normalize("first-name")).toBe("first name");
  });
});

describe("matchField", () => {
  it("matches exact label text", () => {
    const result = matchField(["First Name"]);
    expect(result?.field).toBe("firstName");
    expect(result?.confidence).toBeGreaterThan(0.9);
  });

  it("matches input name attributes", () => {
    expect(matchField(["first_name"])?.field).toBe("firstName");
    expect(matchField(["last_name"])?.field).toBe("lastName");
    expect(matchField(["email"])?.field).toBe("email");
    expect(matchField(["phone"])?.field).toBe("phone");
  });

  it("matches LinkedIn field variations", () => {
    expect(matchField(["linkedin"])?.field).toBe("linkedinUrl");
    expect(matchField(["LinkedIn URL"])?.field).toBe("linkedinUrl");
    expect(matchField(["LinkedIn Profile"])?.field).toBe("linkedinUrl");
  });

  it("matches GitHub field variations", () => {
    expect(matchField(["github"])?.field).toBe("githubUrl");
    expect(matchField(["GitHub URL"])?.field).toBe("githubUrl");
  });

  it("matches summary/cover letter fields", () => {
    expect(matchField(["cover letter"])?.field).toBe("summary");
    expect(matchField(["Additional Information"])?.field).toBe("summary");
    expect(matchField(["Tell us about yourself"])?.field).toBe("summary");
  });

  it("matches phone variations", () => {
    expect(matchField(["phone number"])?.field).toBe("phone");
    expect(matchField(["telephone"])?.field).toBe("phone");
    expect(matchField(["mobile"])?.field).toBe("phone");
  });

  it("matches location fields", () => {
    expect(matchField(["location"])?.field).toBe("location");
    expect(matchField(["city"])?.field).toBe("city");
    expect(matchField(["state"])?.field).toBe("state");
    expect(matchField(["zip code"])?.field).toBe("zip");
    expect(matchField(["country"])?.field).toBe("country");
  });

  it("matches work authorization fields", () => {
    expect(matchField(["authorized to work"])?.field).toBe("authorized");
    expect(matchField(["visa sponsorship"])?.field).toBe("sponsorship");
  });

  it("returns null for unrecognized fields", () => {
    expect(matchField(["xyzzy"])).toBeNull();
    expect(matchField([""])).toBeNull();
    expect(matchField([])).toBeNull();
  });

  describe("essay-prompt penalty (Bug 4)", () => {
    it("penalizes essay-like labels so they don't match profile fields", () => {
      const result = matchField([
        "Describe your work experience in 3-4 sentences, and how it relates to the requirements for this position.",
      ]);
      // Should either be null or have very low confidence
      if (result) {
        expect(result.confidence).toBeLessThan(0.4);
      }
    });

    it("penalizes interrogative prompts about the company", () => {
      const result = matchField([
        "Why is this job exciting to you? What about Paragon drew you to this opportunity?",
      ]);
      if (result) {
        // If it matches summary, that's OK (summary is exempted from penalty)
        if (result.field !== "summary") {
          expect(result.confidence).toBeLessThan(0.4);
        }
      }
    });

    it("still matches short labels like 'Current Title' correctly", () => {
      const result = matchField(["Current Title"]);
      expect(result?.field).toBe("currentTitle");
      expect(result?.confidence).toBeGreaterThan(0.8);
    });

    it("still matches 'title' as currentTitle for short signals", () => {
      const result = matchField(["title"]);
      expect(result?.field).toBe("currentTitle");
      expect(result?.confidence).toBeGreaterThan(0.5);
    });

    it("does not penalize summary field for essay-like labels", () => {
      const result = matchField(["Tell us about yourself and your experience"]);
      // "tell us about yourself" should match summary even though it's essay-like
      if (result) {
        expect(result.field).toBe("summary");
        expect(result.confidence).toBeGreaterThan(0.3);
      }
    });
  });

  it("uses multiple signals to find best match", () => {
    // Both signals point to email
    const result = matchField(["email_input", "Your email address"]);
    expect(result?.field).toBe("email");
  });

  it("prefers stronger matches", () => {
    // "email" is a stronger signal than a vague match
    const result = matchField(["email"]);
    expect(result?.field).toBe("email");
    expect(result?.confidence).toBeGreaterThan(0.8);
  });

  // --- Debug fix: middleName ---
  it("matches middleName from name attribute", () => {
    const result = matchField(["middleName"]);
    expect(result?.field).toBe("middleName");
  });

  it("matches middleName from label text", () => {
    const result = matchField(["Middle Name"]);
    expect(result?.field).toBe("middleName");
  });

  it("matches middle initial", () => {
    const result = matchField(["Middle Initial"]);
    expect(result?.field).toBe("middleName");
  });

  // --- Debug fix: bare "Name" → fullName ---
  it("matches bare 'Name' to fullName, not firstName", () => {
    const result = matchField(["Name"]);
    expect(result?.field).toBe("fullName");
    expect(result?.confidence).toBe(1.0);
  });

  it("still matches 'First Name' to firstName", () => {
    const result = matchField(["First Name"]);
    expect(result?.field).toBe("firstName");
  });

  // --- Debug fix: authorized keywords ---
  it("matches 'Are you authorized to be employed in the US?'", () => {
    const result = matchField(["Are you authorized to be employed in the US?"]);
    expect(result?.field).toBe("authorized");
  });

  it("matches 'legally eligible'", () => {
    const result = matchField(["legally eligible"]);
    expect(result?.field).toBe("authorized");
  });
});

describe("getProfileValue", () => {
  const profile = {
    firstName: "Connor",
    lastName: "Smith",
    email: "connor@example.com",
    phone: "555-1234",
    location: "San Francisco, CA",
    linkedinUrl: "linkedin.com/in/connor",
    githubUrl: "github.com/connor",
    portfolioUrl: "connor.dev",
    summary: "Software engineer with 5 years experience",
    experiences: [
      { title: "Senior Engineer", company: "Roblox" },
      { title: "Engineer", company: "StartupCo" },
    ],
  };

  it("returns firstName", () => {
    expect(getProfileValue("firstName", profile)).toBe("Connor");
  });

  it("returns fullName", () => {
    expect(getProfileValue("fullName", profile)).toBe("Connor Smith");
  });

  it("returns current title from first experience", () => {
    expect(getProfileValue("currentTitle", profile)).toBe("Senior Engineer");
  });

  it("returns current company from first experience", () => {
    expect(getProfileValue("currentCompany", profile)).toBe("Roblox");
  });

  it("returns empty string for unknown fields", () => {
    expect(getProfileValue("yearsExperience", profile)).toBe("");
  });
});
