import { describe, it, expect, beforeEach } from "vitest";
import type { ResumeDoc } from "../../src/shared/types";
import { createMemoryKV } from "../../src/shared/jobStore";
import {
  setResumeKVStore,
  getResume,
  saveResume,
  listResumes,
  deleteResume,
} from "../../src/shared/resumeStore";

function makeDoc(overrides: Partial<ResumeDoc> = {}): ResumeDoc {
  const now = new Date().toISOString();
  return {
    resumeId: overrides.resumeId ?? crypto.randomUUID(),
    name: overrides.name ?? "Test Resume",
    content: overrides.content ?? "# John Doe\n\n## Summary\nExperienced engineer.",
    source: overrides.source ?? "uploaded",
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...overrides,
  };
}

describe("resumeStore", () => {
  beforeEach(() => {
    setResumeKVStore(createMemoryKV());
  });

  it("returns null for nonexistent resume", async () => {
    const result = await getResume("nonexistent");
    expect(result).toBeNull();
  });

  it("saves and retrieves a resume", async () => {
    const doc = makeDoc({ name: "Frontend v2" });
    await saveResume(doc);

    const result = await getResume(doc.resumeId);
    expect(result).toBeDefined();
    expect(result?.name).toBe("Frontend v2");
    expect(result?.content).toContain("John Doe");
  });

  it("lists resumes in newest-first order", async () => {
    const doc1 = makeDoc({ resumeId: "r1", name: "First" });
    const doc2 = makeDoc({ resumeId: "r2", name: "Second" });
    const doc3 = makeDoc({ resumeId: "r3", name: "Third" });

    await saveResume(doc1);
    await saveResume(doc2);
    await saveResume(doc3);

    const list = await listResumes();
    expect(list).toHaveLength(3);
    // Newest first (last inserted = first in list)
    expect(list[0].name).toBe("Third");
    expect(list[1].name).toBe("Second");
    expect(list[2].name).toBe("First");
  });

  it("returns empty array when no resumes exist", async () => {
    const list = await listResumes();
    expect(list).toEqual([]);
  });

  it("updates an existing resume", async () => {
    const doc = makeDoc({ name: "Original" });
    await saveResume(doc);

    const updated = { ...doc, name: "Updated", content: "# Updated content" };
    await saveResume(updated);

    const result = await getResume(doc.resumeId);
    expect(result?.name).toBe("Updated");
    expect(result?.content).toBe("# Updated content");

    // Should still be one entry in the list
    const list = await listResumes();
    expect(list).toHaveLength(1);
  });

  it("deletes a resume", async () => {
    const doc = makeDoc();
    await saveResume(doc);
    expect(await getResume(doc.resumeId)).toBeDefined();

    await deleteResume(doc.resumeId);
    expect(await getResume(doc.resumeId)).toBeNull();

    const list = await listResumes();
    expect(list).toHaveLength(0);
  });

  it("deleting one resume doesn't affect others", async () => {
    const doc1 = makeDoc({ resumeId: "keep", name: "Keep" });
    const doc2 = makeDoc({ resumeId: "remove", name: "Remove" });

    await saveResume(doc1);
    await saveResume(doc2);

    await deleteResume("remove");

    const list = await listResumes();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Keep");
  });

  it("preserves source and generatedForJob", async () => {
    const doc = makeDoc({
      source: "generated",
      generatedForJob: "pk:1234",
    });
    await saveResume(doc);

    const result = await getResume(doc.resumeId);
    expect(result?.source).toBe("generated");
    expect(result?.generatedForJob).toBe("pk:1234");
  });
});
