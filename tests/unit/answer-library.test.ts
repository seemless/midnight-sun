import { describe, it, expect, beforeEach } from "vitest";
import {
  getAnswer,
  saveAnswer,
  listAnswers,
  deleteAnswer,
  lookupBySignals,
  batchSaveAnswers,
  computeQuestionHash,
  setKVStore,
} from "../../src/shared/answerLibrary";
import { createMemoryKV } from "../../src/shared/jobStore";
import type { AnswerLibraryEntry } from "../../src/shared/types";

// --- Setup: Use in-memory KV for all tests ---

beforeEach(() => {
  setKVStore(createMemoryKV());
});

// --- Fixtures ---

const NOW = "2025-01-15T10:00:00.000Z";

function makeEntry(overrides: Partial<AnswerLibraryEntry> = {}): AnswerLibraryEntry {
  return {
    questionHash: "abc123",
    questionText: "Why do you want to work here?",
    inputType: "textarea",
    answer: "I'm passionate about the mission.",
    scope: "global",
    lastUsedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

// --- CRUD Tests ---

describe("Answer Library CRUD", () => {
  it("saves and retrieves an answer", async () => {
    const entry = makeEntry();
    await saveAnswer(entry);

    const retrieved = await getAnswer("abc123");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.questionText).toBe("Why do you want to work here?");
    expect(retrieved!.answer).toBe("I'm passionate about the mission.");
  });

  it("returns null for non-existent hash", async () => {
    const result = await getAnswer("nonexistent");
    expect(result).toBeNull();
  });

  it("lists all saved answers", async () => {
    await saveAnswer(makeEntry({ questionHash: "h1", questionText: "Q1" }));
    await saveAnswer(makeEntry({ questionHash: "h2", questionText: "Q2" }));
    await saveAnswer(makeEntry({ questionHash: "h3", questionText: "Q3" }));

    const all = await listAnswers();
    expect(all).toHaveLength(3);
    const texts = all.map((a) => a.questionText);
    expect(texts).toContain("Q1");
    expect(texts).toContain("Q2");
    expect(texts).toContain("Q3");
  });

  it("deletes an answer", async () => {
    await saveAnswer(makeEntry({ questionHash: "h1" }));
    await saveAnswer(makeEntry({ questionHash: "h2" }));

    await deleteAnswer("h1");

    const all = await listAnswers();
    expect(all).toHaveLength(1);
    expect(all[0].questionHash).toBe("h2");

    const deleted = await getAnswer("h1");
    expect(deleted).toBeNull();
  });

  it("updates an existing answer (upsert)", async () => {
    const original = makeEntry({ questionHash: "h1", answer: "Old answer" });
    await saveAnswer(original);

    const updated = makeEntry({ questionHash: "h1", answer: "New answer" });
    await saveAnswer(updated);

    const retrieved = await getAnswer("h1");
    expect(retrieved!.answer).toBe("New answer");

    // Index should not have duplicates
    const all = await listAnswers();
    expect(all).toHaveLength(1);
  });

  it("returns empty list when no answers saved", async () => {
    const all = await listAnswers();
    expect(all).toHaveLength(0);
  });
});

// --- Hash Computation ---

describe("computeQuestionHash", () => {
  it("produces consistent hashes for the same text", async () => {
    const h1 = await computeQuestionHash("Why do you want to work here?");
    const h2 = await computeQuestionHash("Why do you want to work here?");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // SHA-256 hex string
  });

  it("normalizes text before hashing", async () => {
    const h1 = await computeQuestionHash("Why Do You Want To Work Here?");
    const h2 = await computeQuestionHash("why do you want to work here?");
    expect(h1).toBe(h2);
  });

  it("produces different hashes for different questions", async () => {
    const h1 = await computeQuestionHash("Why this company?");
    const h2 = await computeQuestionHash("Describe a challenging project.");
    expect(h1).not.toBe(h2);
  });
});

// --- Lookup by Signals ---

describe("lookupBySignals", () => {
  it("finds an answer by signal text", async () => {
    const hash = await computeQuestionHash("Tell us about yourself");
    await saveAnswer(
      makeEntry({
        questionHash: hash,
        questionText: "Tell us about yourself",
        answer: "I'm an engineer...",
      })
    );

    const result = await lookupBySignals(["Tell us about yourself"]);
    expect(result).not.toBeNull();
    expect(result!.answer).toBe("I'm an engineer...");
  });

  it("returns null for empty signals", async () => {
    const result = await lookupBySignals([]);
    expect(result).toBeNull();
  });

  it("returns null when no match", async () => {
    const result = await lookupBySignals(["Unknown question"]);
    expect(result).toBeNull();
  });
});

// --- Batch Save ---

describe("batchSaveAnswers", () => {
  it("saves multiple answers at once", async () => {
    const count = await batchSaveAnswers([
      { questionText: "Question 1", answer: "Answer 1", inputType: "textarea" },
      { questionText: "Question 2", answer: "Answer 2", inputType: "text" },
      { questionText: "Question 3", answer: "Answer 3", inputType: "textarea" },
    ]);

    expect(count).toBe(3);

    const all = await listAnswers();
    expect(all).toHaveLength(3);
  });

  it("skips entries with empty question or answer", async () => {
    const count = await batchSaveAnswers([
      { questionText: "", answer: "Answer", inputType: "textarea" },
      { questionText: "Question", answer: "", inputType: "textarea" },
      { questionText: "Valid Q", answer: "Valid A", inputType: "textarea" },
    ]);

    expect(count).toBe(1);
    const all = await listAnswers();
    expect(all).toHaveLength(1);
    expect(all[0].questionText).toBe("Valid Q");
  });

  it("preserves createdAt on update", async () => {
    const hash = await computeQuestionHash("Repeat question");
    await saveAnswer(
      makeEntry({
        questionHash: hash,
        questionText: "Repeat question",
        answer: "First answer",
        createdAt: "2024-01-01T00:00:00.000Z",
      })
    );

    await batchSaveAnswers([
      { questionText: "Repeat question", answer: "Updated answer", inputType: "textarea" },
    ]);

    const result = await getAnswer(hash);
    expect(result!.answer).toBe("Updated answer");
    expect(result!.createdAt).toBe("2024-01-01T00:00:00.000Z"); // preserved
  });
});
