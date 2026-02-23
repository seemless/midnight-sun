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
