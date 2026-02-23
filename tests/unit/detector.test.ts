import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { detectFields } from "../../src/content/detector";
import type { DetectedField } from "../../src/shared/types";

function loadFixture(name: string): Document {
  const html = readFileSync(
    resolve(__dirname, "../fixtures", name),
    "utf-8"
  );
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
}

/** Helper: find a field whose primary selector or signals contain a substring */
function findField(fields: DetectedField[], hint: string) {
  return fields.find(
    (f) =>
      f.selectorCandidates.some((s) => s.includes(hint)) ||
      f.signals.some((s) => s.toLowerCase().includes(hint.toLowerCase()))
  );
}

describe("detectFields", () => {
  describe("with Greenhouse form", () => {
    let doc: Document;
    let fields: DetectedField[];

    beforeEach(() => {
      doc = loadFixture("greenhouse-form.html");
      ({ fields } = detectFields(doc));
    });

    it("detects all visible input fields", () => {
      expect(fields.length).toBeGreaterThanOrEqual(10);
    });

    it("returns selectorCandidates (not a single selector)", () => {
      for (const field of fields) {
        expect(field.selectorCandidates.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("returns structuredSignals with label info", () => {
      const firstNameField = findField(fields, "first_name");
      expect(firstNameField).toBeDefined();
      expect(firstNameField?.structuredSignals.label).toContain("First Name");
    });

    it("matches first name field", () => {
      const f = findField(fields, "first_name");
      expect(f?.matchedField).toBe("firstName");
      expect(f?.confidence).toBeGreaterThan(0.7);
    });

    it("matches last name field", () => {
      const f = findField(fields, "last_name");
      expect(f?.matchedField).toBe("lastName");
    });

    it("matches email field", () => {
      const f = findField(fields, "email");
      expect(f?.matchedField).toBe("email");
    });

    it("matches phone field", () => {
      const f = findField(fields, "phone");
      expect(f?.matchedField).toBe("phone");
    });

    it("matches LinkedIn field", () => {
      const f = findField(fields, "linkedin");
      expect(f?.matchedField).toBe("linkedinUrl");
    });

    it("matches GitHub field", () => {
      const f = findField(fields, "github");
      expect(f?.matchedField).toBe("githubUrl");
    });

    it("matches cover letter textarea", () => {
      const f = findField(fields, "cover_letter");
      expect(f?.matchedField).toBe("summary");
      expect(f?.inputType).toBe("textarea");
    });

    it("matches work authorization select", () => {
      const f = findField(fields, "work_authorization");
      expect(f?.matchedField).toBe("authorized");
      expect(f?.inputType).toBe("select");
    });

    it("matches sponsorship field", () => {
      const f = findField(fields, "sponsorship");
      expect(f?.matchedField).toBe("sponsorship");
    });

    it("excludes file input (resume upload)", () => {
      const fileField = fields.find((f) => f.inputType === "file");
      expect(fileField).toBeUndefined();
    });
  });

  describe("with Lever form", () => {
    let doc: Document;
    let fields: DetectedField[];

    beforeEach(() => {
      doc = loadFixture("lever-form.html");
      ({ fields } = detectFields(doc));
    });

    it("detects native input fields", () => {
      const nativeFields = fields.filter((f) => f.inputType !== "custom");
      expect(nativeFields.length).toBeGreaterThanOrEqual(7);
    });

    it("matches full name field", () => {
      const nameField = fields.find(
        (f) =>
          f.structuredSignals.label?.toLowerCase().includes("full name") ||
          f.signals.some((s) => s.toLowerCase().includes("full name"))
      );
      expect(nameField).toBeDefined();
      expect(nameField?.matchedField).toBe("fullName");
    });

    it("matches LinkedIn URL", () => {
      const f = findField(fields, "linkedin");
      expect(f).toBeDefined();
      expect(f?.matchedField).toBe("linkedinUrl");
    });

    it("matches GitHub URL", () => {
      const f = findField(fields, "github");
      expect(f).toBeDefined();
      expect(f?.matchedField).toBe("githubUrl");
    });

    it("detects custom dropdown as custom control", () => {
      const customFields = fields.filter((f) => f.inputType === "custom");
      expect(customFields.length).toBeGreaterThanOrEqual(1);
      for (const field of customFields) {
        expect(field.confidence).toBeLessThan(0.6);
      }
    });

    it("excludes file input", () => {
      const fileField = fields.find((f) => f.inputType === "file");
      expect(fileField).toBeUndefined();
    });
  });

  describe("with minimal form", () => {
    it("handles a form with just name and email", () => {
      const html = `
        <html><body>
          <label for="name">Your Name</label>
          <input id="name" name="name" type="text" />
          <label for="email">Email Address</label>
          <input id="email" name="email" type="email" />
        </body></html>
      `;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const { fields } = detectFields(doc);

      expect(fields.length).toBe(2);
      const nameField = findField(fields, "name");
      expect(nameField?.matchedField).toBe("fullName");
    });
  });

  describe("custom control detection", () => {
    it("flags role=listbox as custom control", () => {
      const html = `
        <html><body>
          <label id="loc-label">Location</label>
          <div role="listbox" aria-labelledby="loc-label">
            <div role="option">NYC</div>
            <div role="option">SF</div>
          </div>
        </body></html>
      `;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const { fields } = detectFields(doc);

      const custom = fields.find((f) => f.inputType === "custom");
      expect(custom).toBeDefined();
      expect(custom?.matchedField).toBe("location");
    });
  });

  describe("selectorCandidates resilience", () => {
    it("generates multiple candidates for fields with id + name", () => {
      const html = `
        <html><body>
          <input id="email" name="user_email" type="email" />
        </body></html>
      `;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const { fields } = detectFields(doc);

      expect(fields[0].selectorCandidates.length).toBeGreaterThanOrEqual(2);
      expect(fields[0].selectorCandidates[0]).toBe("#email"); // ID first
      expect(fields[0].selectorCandidates[1]).toContain("user_email"); // name second
    });
  });

  describe("debug counts", () => {
    it("returns raw element counts", () => {
      const html = `
        <html><body>
          <input name="name" type="text" />
          <textarea name="bio"></textarea>
          <select name="country"><option>US</option></select>
          <input type="hidden" name="token" />
        </body></html>
      `;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const { fields, debugCounts } = detectFields(doc);

      expect(fields.length).toBe(3); // hidden excluded
      expect(debugCounts.rawInputs).toBe(1); // hidden excluded by selector
      expect(debugCounts.rawTextareas).toBe(1);
      expect(debugCounts.rawSelects).toBe(1);
    });
  });

  describe("demographic detection", () => {
    it("tags demographic fields and nullifies matchedField", () => {
      const html = `
        <html><body>
          <label for="race">Race / Ethnicity</label>
          <select id="race" name="race">
            <option>Prefer not to say</option>
          </select>
          <label for="gender">Gender Identity</label>
          <select id="gender" name="gender">
            <option>Prefer not to say</option>
          </select>
          <label for="name">First Name</label>
          <input id="name" name="first_name" type="text" />
        </body></html>
      `;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const { fields } = detectFields(doc);

      const raceField = fields.find((f) => f.signals.some((s) => s.toLowerCase().includes("race")));
      expect(raceField).toBeDefined();
      expect(raceField?.category).toBe("demographic");
      expect(raceField?.matchedField).toBeNull();
      expect(raceField?.confidence).toBe(0);

      const genderField = fields.find((f) => f.signals.some((s) => s.toLowerCase().includes("gender")));
      expect(genderField?.category).toBe("demographic");

      const nameField = fields.find((f) => f.signals.some((s) => s.toLowerCase().includes("first")));
      expect(nameField?.category).toBeUndefined();
      expect(nameField?.matchedField).toBe("firstName");
    });
  });

  describe("visible tagging", () => {
    it("tags all fields as visible: true in basic forms", () => {
      const html = `
        <html><body>
          <input name="name" type="text" />
          <input name="email" type="email" />
        </body></html>
      `;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const { fields } = detectFields(doc);

      for (const field of fields) {
        expect(field.visible).toBe(true);
      }
    });
  });

  describe("infrastructure exclusion (Bug 1)", () => {
    it("excludes g-recaptcha-response textarea", () => {
      const html = `
        <html><body>
          <label for="email">Email</label>
          <input id="email" name="email" type="email" />
          <textarea name="g-recaptcha-response" style="display:none"></textarea>
        </body></html>
      `;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const { fields } = detectFields(doc);

      expect(fields.length).toBe(1);
      expect(fields[0].matchedField).toBe("email");
    });

    it("excludes captcha-named inputs", () => {
      const html = `
        <html><body>
          <input name="first_name" type="text" />
          <input name="captcha_response" type="hidden" />
          <textarea id="g-recaptcha-response-100000" name="g-recaptcha-response"></textarea>
        </body></html>
      `;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const { fields } = detectFields(doc);

      const captchaField = fields.find((f) =>
        f.signals.some((s) => s.includes("captcha") || s.includes("recaptcha"))
      );
      expect(captchaField).toBeUndefined();
    });
  });

  describe("country code dropdown explosion (Bug 2)", () => {
    it("does not detect listbox option children as separate fields", () => {
      const countries = Array.from({ length: 50 }, (_, i) =>
        `<li role="option" id="country-${i}" aria-label="Country ${i} +${i}">Country ${i} +${i}</li>`
      ).join("\n");

      const html = `
        <html><body>
          <label for="phone">Phone</label>
          <input id="phone" name="phone" type="tel" />
          <div role="combobox">
            <ul role="listbox">
              ${countries}
            </ul>
          </div>
        </body></html>
      `;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const { fields } = detectFields(doc);

      // Should detect phone input + combobox custom control, NOT 50 li options
      expect(fields.length).toBeLessThan(5);
      const phoneField = findField(fields, "phone");
      expect(phoneField).toBeDefined();
    });
  });

  describe("Google Forms heading extraction (Bug 3)", () => {
    it("extracts question text from heading in ancestor container", () => {
      const html = `
        <html><body>
          <div>
            <div role="heading" aria-level="3">What programming languages do you know?</div>
            <div>
              <input type="text" placeholder="Your answer" />
            </div>
          </div>
        </body></html>
      `;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const { fields } = detectFields(doc);

      expect(fields.length).toBe(1);
      expect(fields[0].signals).toEqual(
        expect.arrayContaining([
          expect.stringContaining("programming languages"),
        ])
      );
    });

    it("prefers heading text over generic 'Your answer' sibling", () => {
      const html = `
        <html><body>
          <div>
            <div role="heading">What is your favorite color?</div>
            <div>
              <span>Your answer</span>
              <input type="text" name="q1" placeholder="Your answer" />
            </div>
          </div>
        </body></html>
      `;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const { fields } = detectFields(doc);

      // The heading text should win over generic "Your answer"
      const field = fields[0];
      expect(field?.signals).toEqual(
        expect.arrayContaining([
          expect.stringContaining("favorite color"),
        ])
      );
    });
  });

  describe("Search form exclusion (Bug 5)", () => {
    it("excludes elements with name='search'", () => {
      const html = `
        <html><body>
          <label for="name">First Name</label>
          <input id="name" name="first_name" type="text" />
          <input name="search" type="text" aria-label="Search jobs" />
        </body></html>
      `;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const { fields } = detectFields(doc);

      expect(fields.length).toBe(1);
      expect(fields[0].matchedField).toBe("firstName");
      const searchField = fields.find((f) =>
        f.signals.some((s) => s.includes("search"))
      );
      expect(searchField).toBeUndefined();
    });

    it("excludes elements with name='categories' or name='locations'", () => {
      const html = `
        <html><body>
          <input name="email" type="email" />
          <select name="categories" aria-label="Categories">
            <option>All</option><option>Engineering</option>
          </select>
          <select name="locations" aria-label="Locations">
            <option>All</option><option>San Francisco</option>
          </select>
        </body></html>
      `;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const { fields } = detectFields(doc);

      expect(fields.length).toBe(1);
      expect(fields[0].matchedField).toBe("email");
    });

    it("excludes elements inside [role='search'] ancestor", () => {
      const html = `
        <html><body>
          <form role="search">
            <input name="query" type="text" placeholder="Search..." />
            <select name="department"><option>All</option></select>
          </form>
          <form>
            <label for="phone">Phone</label>
            <input id="phone" name="phone" type="tel" />
          </form>
        </body></html>
      `;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const { fields } = detectFields(doc);

      expect(fields.length).toBe(1);
      expect(fields[0].matchedField).toBe("phone");
    });
  });

  describe("LGBTQ+ demographic detection", () => {
    it("tags LGBTQ+ community field as demographic", () => {
      const html = `
        <html><body>
          <label for="lgbtq">I consider myself a member of the LGBTQ+ community</label>
          <input id="lgbtq" name="lgbtq_member" type="text" />
          <label for="name">First Name</label>
          <input id="name" name="first_name" type="text" />
        </body></html>
      `;
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const { fields } = detectFields(doc);

      const lgbtqField = fields.find((f) =>
        f.signals.some((s) => s.toLowerCase().includes("lgbtq"))
      );
      expect(lgbtqField).toBeDefined();
      expect(lgbtqField?.category).toBe("demographic");
      expect(lgbtqField?.matchedField).toBeNull();

      const nameField = fields.find((f) =>
        f.signals.some((s) => s.toLowerCase().includes("first"))
      );
      expect(nameField?.category).toBeUndefined();
      expect(nameField?.matchedField).toBe("firstName");
    });
  });
});
