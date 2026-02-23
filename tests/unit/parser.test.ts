import { describe, it, expect, beforeEach } from "vitest";
import {
  parseResume,
  resetIdCounter,
  extractEmail,
  extractPhone,
  extractLinkedInUrl,
  extractGithubUrl,
  parseNameLine,
  parseSkills,
  splitSections,
  splitEntries,
} from "../../src/shared/parser";

beforeEach(() => {
  resetIdCounter();
});

describe("parseResume", () => {
  it("parses a basic resume", () => {
    const text = `
Connor Smith
San Francisco, CA
connor@example.com | 555-123-4567
linkedin.com/in/connorsmith | github.com/connor

Summary
Experienced software engineer with 5 years building web applications.

Experience

Senior Software Engineer
Roblox | San Francisco, CA
Jan 2022 - Present
• Led migration of monolith to microservices
• Reduced deploy time by 40%

Software Engineer
StartupCo | New York, NY
Jun 2019 - Dec 2021
• Built React frontend from scratch
• Implemented CI/CD pipeline

Education

University of California, Berkeley
B.S. in Computer Science
Aug 2015 - May 2019

Skills
JavaScript, TypeScript, React, Node.js, Python, AWS, Docker, Kubernetes
    `.trim();

    const profile = parseResume(text);

    expect(profile.firstName).toBe("Connor");
    expect(profile.lastName).toBe("Smith");
    expect(profile.email).toBe("connor@example.com");
    expect(profile.phone).toBe("555-123-4567");
    expect(profile.location).toBe("San Francisco, CA");
    expect(profile.linkedinUrl).toBe("linkedin.com/in/connorsmith");
    expect(profile.githubUrl).toBe("github.com/connor");
    expect(profile.summary).toContain("Experienced software engineer");

    expect(profile.experiences).toHaveLength(2);
    expect(profile.experiences[0].title).toBe("Senior Software Engineer");
    expect(profile.experiences[0].company).toBe("Roblox");
    expect(profile.experiences[0].startDate).toBe("Jan 2022");
    expect(profile.experiences[0].endDate).toBe("Present");
    expect(profile.experiences[0].highlights).toHaveLength(2);

    expect(profile.experiences[1].title).toBe("Software Engineer");
    expect(profile.experiences[1].company).toBe("StartupCo");

    expect(profile.education).toHaveLength(1);
    expect(profile.education[0].school).toBe(
      "University of California, Berkeley"
    );
    expect(profile.education[0].degree).toContain("B.S.");

    expect(profile.skills).toContain("JavaScript");
    expect(profile.skills).toContain("TypeScript");
    expect(profile.skills).toContain("React");
    expect(profile.skills.length).toBeGreaterThanOrEqual(8);
  });

  it("handles resume with no experience section", () => {
    const text = `
Jane Doe
jane@example.com

Education
MIT
M.S. in AI
Sep 2022 - May 2024

Skills
Python, PyTorch, TensorFlow
    `.trim();

    const profile = parseResume(text);
    expect(profile.firstName).toBe("Jane");
    expect(profile.lastName).toBe("Doe");
    expect(profile.email).toBe("jane@example.com");
    expect(profile.experiences).toHaveLength(0);
    expect(profile.education).toHaveLength(1);
    expect(profile.skills.length).toBeGreaterThanOrEqual(3);
  });
});

describe("extractEmail", () => {
  it("finds email in text", () => {
    expect(extractEmail("Contact: connor@roblox.com or call")).toBe(
      "connor@roblox.com"
    );
  });
  it("handles plus addressing", () => {
    expect(extractEmail("connor+jobs@gmail.com")).toBe(
      "connor+jobs@gmail.com"
    );
  });
  it("returns null when no email", () => {
    expect(extractEmail("no email here")).toBeNull();
  });
});

describe("extractPhone", () => {
  it("finds US phone number", () => {
    expect(extractPhone("Call 555-123-4567")).toBe("555-123-4567");
  });
  it("finds phone with parens", () => {
    expect(extractPhone("(555) 123-4567")).toBe("(555) 123-4567");
  });
  it("returns null when no phone", () => {
    expect(extractPhone("no phone")).toBeNull();
  });
});

describe("extractLinkedInUrl", () => {
  it("finds LinkedIn URL", () => {
    expect(extractLinkedInUrl("linkedin.com/in/connor")).toBe(
      "linkedin.com/in/connor"
    );
  });
  it("finds full URL", () => {
    expect(
      extractLinkedInUrl("https://www.linkedin.com/in/connor")
    ).toBe("https://www.linkedin.com/in/connor");
  });
});

describe("extractGithubUrl", () => {
  it("finds GitHub URL", () => {
    expect(extractGithubUrl("github.com/connor")).toBe("github.com/connor");
  });
});

describe("parseNameLine", () => {
  it("splits first and last name", () => {
    expect(parseNameLine("Connor Smith")).toEqual({
      firstName: "Connor",
      lastName: "Smith",
    });
  });
  it("handles middle names", () => {
    expect(parseNameLine("John Michael Smith")).toEqual({
      firstName: "John",
      lastName: "Michael Smith",
    });
  });
  it("strips titles", () => {
    expect(parseNameLine("Dr. Jane Doe")).toEqual({
      firstName: "Jane",
      lastName: "Doe",
    });
  });
  it("handles single name", () => {
    expect(parseNameLine("Madonna")).toEqual({
      firstName: "Madonna",
      lastName: "",
    });
  });
});

describe("parseSkills", () => {
  it("splits comma-separated skills", () => {
    const skills = parseSkills(["JavaScript, TypeScript, React, Node.js"]);
    expect(skills).toContain("JavaScript");
    expect(skills).toContain("TypeScript");
    expect(skills).toContain("React");
    expect(skills).toContain("Node.js");
  });
  it("deduplicates case-insensitively", () => {
    const skills = parseSkills(["React, react, REACT"]);
    expect(skills).toHaveLength(1);
  });
  it("handles bullet-separated skills", () => {
    const skills = parseSkills(["JavaScript · TypeScript · React"]);
    expect(skills).toHaveLength(3);
  });
});

describe("splitSections", () => {
  it("identifies section headers", () => {
    const lines = [
      "Connor Smith",
      "",
      "Experience",
      "Engineer at Co",
      "",
      "Education",
      "MIT",
    ];
    const sections = splitSections(lines);
    expect(sections.has("_header")).toBe(true);
    expect(sections.has("experience")).toBe(true);
    expect(sections.has("education")).toBe(true);
  });
});

describe("splitEntries", () => {
  it("splits by blank lines", () => {
    const entries = splitEntries([
      "Entry 1 line 1",
      "Entry 1 line 2",
      "",
      "Entry 2 line 1",
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveLength(2);
    expect(entries[1]).toHaveLength(1);
  });
});
