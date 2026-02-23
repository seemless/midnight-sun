import { describe, it, expect, beforeEach } from "vitest";
import {
  createMemoryStorage,
  setStorageAdapter,
  createFillRun,
  saveFillRun,
  getFillRuns,
} from "../../src/shared/storage";
import type { DetectedField, FillResult } from "../../src/shared/types";

beforeEach(() => {
  setStorageAdapter(createMemoryStorage());
});

describe("createFillRun", () => {
  const mockFields: DetectedField[] = [
    {
      selectorCandidates: ["#first_name", 'input[name="first_name"]'],
      inputType: "text",
      signals: ["First Name", "first_name"],
      structuredSignals: { label: "First Name", name: "first_name", id: "first_name" },
      matchedField: "firstName",
      confidence: 0.98,
      currentValue: "",
      visible: true,
    },
    {
      selectorCandidates: ["#email", 'input[name="email"]'],
      inputType: "email",
      signals: ["Email", "email"],
      structuredSignals: { label: "Email", id: "email" },
      matchedField: "email",
      confidence: 0.95,
      currentValue: "",
      visible: true,
    },
    {
      selectorCandidates: ["#weird_field"],
      inputType: "text",
      signals: ["xyzzy"],
      structuredSignals: { id: "weird_field" },
      matchedField: null,
      confidence: 0,
      currentValue: "",
      visible: true,
    },
    {
      selectorCandidates: ["div.custom-select"],
      inputType: "custom",
      signals: ["Location preference"],
      structuredSignals: { aria: "Location preference" },
      matchedField: "location",
      confidence: 0.4,
      currentValue: "",
      visible: true,
    },
  ];

  const mockResults: FillResult[] = [
    {
      selector: "#first_name",
      matchedField: "firstName",
      filledValue: "Connor",
      success: true,
      durationMs: 2,
    },
    {
      selector: "#email",
      matchedField: "email",
      filledValue: "connor@example.com",
      success: true,
      durationMs: 1,
    },
    {
      selector: "div.custom-select",
      matchedField: "location",
      filledValue: "",
      success: false,
      reason: "custom_control",
      manualRequired: true,
      error: "Custom control — fill manually",
      durationMs: 0,
    },
  ];

  it("computes correct stats", () => {
    const run = createFillRun({
      url: "https://boards.greenhouse.io/acme/jobs/123",
      company: "acme",
      role: "Software Engineer",
      detectedFields: mockFields,
      fillResults: mockResults,
    });

    expect(run.stats.totalFields).toBe(4);
    expect(run.stats.matched).toBe(3);
    expect(run.stats.filled).toBe(2);
    expect(run.stats.failed).toBe(0);
    expect(run.stats.manualRequired).toBe(1);
    expect(run.stats.skipped).toBe(1);
  });

  it("computes reasonBreakdown for failure analysis", () => {
    const run = createFillRun({
      url: "https://example.com",
      company: "test",
      role: "test",
      detectedFields: mockFields,
      fillResults: mockResults,
    });

    expect(run.stats.reasonBreakdown.custom_control).toBe(1);
    // Successful fills have no reason, so they shouldn't appear
    expect(run.stats.reasonBreakdown.no_match).toBeUndefined();
  });

  it("extracts hostname into pageMeta", () => {
    const run = createFillRun({
      url: "https://boards.greenhouse.io/acme/jobs/123",
      company: "acme",
      role: "Engineer",
      detectedFields: [],
      fillResults: [],
    });

    expect(run.pageMeta.hostname).toBe("boards.greenhouse.io");
    expect(run.pageMeta.stepIndex).toBe(0); // default for v0
  });

  it("accepts custom pageMeta with stepIndex for wizard support", () => {
    const run = createFillRun({
      url: "https://workday.com/apply",
      company: "acme",
      role: "Engineer",
      pageMeta: { title: "Step 2: Experience", stepIndex: 1, stepLabel: "Experience" },
      detectedFields: [],
      fillResults: [],
    });

    expect(run.pageMeta.stepIndex).toBe(1);
    expect(run.pageMeta.stepLabel).toBe("Experience");
    expect(run.pageMeta.title).toBe("Step 2: Experience");
  });

  it("computes totalDurationMs from per-field timings", () => {
    const run = createFillRun({
      url: "https://example.com",
      company: "test",
      role: "test",
      detectedFields: mockFields,
      fillResults: mockResults,
    });

    expect(run.totalDurationMs).toBe(3); // 2 + 1 + 0
  });

  it("preserves structured signals for debugging", () => {
    const run = createFillRun({
      url: "https://example.com",
      company: "",
      role: "",
      detectedFields: mockFields,
      fillResults: mockResults,
    });

    const firstNameField = run.detectedFields.find(
      (f) => f.matchedField === "firstName"
    );
    expect(firstNameField?.structuredSignals.label).toBe("First Name");
    expect(firstNameField?.structuredSignals.name).toBe("first_name");
    expect(firstNameField?.selectorCandidates).toHaveLength(2);
  });
});

describe("FillRun storage", () => {
  it("saves and retrieves fill runs", async () => {
    const run = createFillRun({
      url: "https://example.com",
      company: "test",
      role: "test",
      detectedFields: [],
      fillResults: [],
    });

    await saveFillRun(run);
    const runs = await getFillRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe(run.id);
  });

  it("newest run is first", async () => {
    const run1 = createFillRun({
      url: "https://first.com",
      company: "first",
      role: "",
      detectedFields: [],
      fillResults: [],
    });
    const run2 = createFillRun({
      url: "https://second.com",
      company: "second",
      role: "",
      detectedFields: [],
      fillResults: [],
    });

    await saveFillRun(run1);
    await saveFillRun(run2);
    const runs = await getFillRuns();
    expect(runs[0].company).toBe("second");
    expect(runs[1].company).toBe("first");
  });
});
