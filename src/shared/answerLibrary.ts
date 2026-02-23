// ============================================================
// Answer Library — Per-question memory
// Hash-based storage: sha256(normalizeText(question)) → AnswerLibraryEntry
// After each fill, auto-saves successful answers. On next visit, auto-fills
// from library before checking profile.
// Uses the same KVStore abstraction as jobStore.ts.
// ============================================================

import type { AnswerLibraryEntry } from "./types";
import { sha256 } from "./crypto";
import { normalizeText } from "./normalize";
import type { KVStore } from "./jobStore";
import { chromeKV } from "./jobStore";

// --- Namespace ---

const LIBRARY_PREFIX = "ms:anslib:";
const INDEX_KEY = "ms:anslib:__index__";

function libraryKey(hash: string): string {
  return `${LIBRARY_PREFIX}${hash}`;
}

// --- Swappable store (testable) ---

let _kv: KVStore = chromeKV;

/** Override KVStore for testing */
export function setKVStore(kv: KVStore): void {
  _kv = kv;
}

// --- Core CRUD ---

/**
 * Compute the question hash for library lookup.
 * Uses sha256(normalizeText(questionText)).
 */
export async function computeQuestionHash(questionText: string): Promise<string> {
  return sha256(normalizeText(questionText));
}

/**
 * Get a library entry by question hash.
 */
export async function getAnswer(questionHash: string): Promise<AnswerLibraryEntry | null> {
  const key = libraryKey(questionHash);
  const result = await _kv.get(key);
  return (result[key] as AnswerLibraryEntry) ?? null;
}

/**
 * Save or update a library entry.
 * Also updates the index for listing.
 */
export async function saveAnswer(entry: AnswerLibraryEntry): Promise<void> {
  const key = libraryKey(entry.questionHash);
  await _kv.set({ [key]: entry });

  // Update index
  const index = await getIndex();
  if (!index.includes(entry.questionHash)) {
    index.push(entry.questionHash);
    await _kv.set({ [INDEX_KEY]: index });
  }
}

/**
 * List all saved answers.
 */
export async function listAnswers(): Promise<AnswerLibraryEntry[]> {
  const index = await getIndex();
  if (index.length === 0) return [];

  const keys = index.map(libraryKey);
  const result = await _kv.get(keys);

  return keys
    .map((k) => result[k] as AnswerLibraryEntry | undefined)
    .filter((e): e is AnswerLibraryEntry => e != null);
}

/**
 * Delete a library entry by question hash.
 */
export async function deleteAnswer(questionHash: string): Promise<void> {
  const key = libraryKey(questionHash);
  await _kv.remove(key);

  // Remove from index
  const index = await getIndex();
  const updated = index.filter((h) => h !== questionHash);
  await _kv.set({ [INDEX_KEY]: updated });
}

// --- Lookup helpers ---

/**
 * Look up a library entry by question signals.
 * Computes hash from the first signal (primary label) and checks the library.
 */
export async function lookupBySignals(signals: string[]): Promise<AnswerLibraryEntry | null> {
  if (signals.length === 0) return null;
  const hash = await computeQuestionHash(signals[0]);
  return getAnswer(hash);
}

/**
 * Batch-save answers from fill results.
 * Takes an array of { questionText, answer, inputType } and saves each.
 * Returns the count of saved answers.
 */
export async function batchSaveAnswers(
  entries: Array<{
    questionText: string;
    answer: string;
    inputType: AnswerLibraryEntry["inputType"];
    optionsSeen?: string[];
  }>
): Promise<number> {
  const now = new Date().toISOString();
  let count = 0;

  for (const { questionText, answer, inputType, optionsSeen } of entries) {
    if (!questionText || !answer) continue;

    const hash = await computeQuestionHash(questionText);
    const existing = await getAnswer(hash);

    const entry: AnswerLibraryEntry = {
      questionHash: hash,
      questionText,
      inputType,
      answer,
      optionsSeen,
      scope: "global",
      lastUsedAt: now,
      createdAt: existing?.createdAt ?? now,
    };

    await saveAnswer(entry);
    count++;
  }

  return count;
}

// --- Internal ---

async function getIndex(): Promise<string[]> {
  const result = await _kv.get(INDEX_KEY);
  return (result[INDEX_KEY] as string[]) ?? [];
}
