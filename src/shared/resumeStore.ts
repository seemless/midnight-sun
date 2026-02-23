// ============================================================
// Resume Store — Namespaced KV CRUD for resume documents
// Uses chrome.storage.local with string keys: ms:resume:<id>
// Testable via KVStore interface (swap in MemoryKVStore for tests).
// ============================================================

import type { ResumeDoc } from "./types";
import type { KVStore } from "./jobStore";
import { chromeKV } from "./jobStore";

// --- Key helpers ---

const RESUME_INDEX_KEY = "ms:resumeIndex";
const resumeKey = (id: string) => `ms:resume:${id}`;

interface ResumeIndex {
  resumeIds: string[];
  updatedAt: string;
}

// --- Module-level KV store (swappable for tests) ---

let _kv: KVStore = chromeKV;

/** Swap the KV store (for testing) */
export function setResumeKVStore(kv: KVStore): void {
  _kv = kv;
}

// --- Index helpers ---

async function getIndex(): Promise<ResumeIndex> {
  const result = await _kv.get(RESUME_INDEX_KEY);
  return (result[RESUME_INDEX_KEY] as ResumeIndex) ?? {
    resumeIds: [],
    updatedAt: new Date().toISOString(),
  };
}

async function setIndex(index: ResumeIndex): Promise<void> {
  await _kv.set({ [RESUME_INDEX_KEY]: index });
}

// --- Resume CRUD ---

/** Get a single resume by ID */
export async function getResume(resumeId: string): Promise<ResumeDoc | null> {
  const result = await _kv.get(resumeKey(resumeId));
  return (result[resumeKey(resumeId)] as ResumeDoc) ?? null;
}

/** Save (create or update) a resume document */
export async function saveResume(doc: ResumeDoc): Promise<void> {
  await _kv.set({ [resumeKey(doc.resumeId)]: doc });

  // Update index
  const index = await getIndex();
  if (!index.resumeIds.includes(doc.resumeId)) {
    index.resumeIds.unshift(doc.resumeId); // newest first
  }
  index.updatedAt = new Date().toISOString();
  await setIndex(index);
}

/** List all resumes, newest first */
export async function listResumes(): Promise<ResumeDoc[]> {
  const index = await getIndex();
  if (index.resumeIds.length === 0) return [];

  const keys = index.resumeIds.map(resumeKey);
  const result = await _kv.get(keys);

  return index.resumeIds
    .map((id) => result[resumeKey(id)] as ResumeDoc | undefined)
    .filter((r): r is ResumeDoc => r != null);
}

/** Delete a resume by ID */
export async function deleteResume(resumeId: string): Promise<void> {
  await _kv.remove(resumeKey(resumeId));

  // Update index
  const index = await getIndex();
  index.resumeIds = index.resumeIds.filter((id) => id !== resumeId);
  index.updatedAt = new Date().toISOString();
  await setIndex(index);
}
