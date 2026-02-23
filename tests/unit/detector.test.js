import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { detectFields } from "../../src/content/detector";
function loadFixture(name) {
    const html = readFileSync(resolve(__dirname, "../fixtures", name), "utf-8");
    const parser = new DOMParser();
    return parser.parseFromString(html, "text/html");
}
/** Helper: find a field whose primary selector or signals contain a substring */
function findField(fields, hint) {
    return fields.find((f) => f.selectorCandidates.some((s) => s.includes(hint)) ||
        f.signals.some((s) => s.toLowerCase().includes(hint.toLowerCase())));
}
describe("detectFields", () => {
    describe("with Greenhouse form", () => {
        let doc;
        let fields;
        beforeEach(() => {
            doc = loadFixture("greenhouse-form.html");
            fields = detectFields(doc);
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
        let doc;
        let fields;
        beforeEach(() => {
            doc = loadFixture("lever-form.html");
            fields = detectFields(doc);
        });
        it("detects native input fields", () => {
            const nativeFields = fields.filter((f) => f.inputType !== "custom");
            expect(nativeFields.length).toBeGreaterThanOrEqual(7);
        });
        it("matches full name field", () => {
            const nameField = fields.find((f) => f.structuredSignals.label?.toLowerCase().includes("full name") ||
                f.signals.some((s) => s.toLowerCase().includes("full name")));
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
            const fields = detectFields(doc);
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
            const fields = detectFields(doc);
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
            const fields = detectFields(doc);
            expect(fields[0].selectorCandidates.length).toBeGreaterThanOrEqual(2);
            expect(fields[0].selectorCandidates[0]).toBe("#email"); // ID first
            expect(fields[0].selectorCandidates[1]).toContain("user_email"); // name second
        });
    });
});
