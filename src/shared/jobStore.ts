// ============================================================
// Job Store — Namespaced KV CRUD for job data
// Uses chrome.storage.local with string keys: ms:job:<key>, ms:snapshot:<id>, etc.
// Testable via KVStore interface (swap in MemoryKVStore for tests).
// ============================================================

import type {
  JobRecord,
  JobSnapshot,
  SmartAnswersDoc,
  StorageIndex,
} from "./jobTypes";

// --- KV abstraction ---

export interface KVStore {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

// --- Chrome implementation ---

export const chromeKV: KVStore = {
  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    return chrome.storage.local.get(keys);
  },
  async set(items: Record<string, unknown>): Promise<void> {
    await chrome.storage.local.set(items);
  },
  async remove(keys: string | string[]): Promise<void> {
    await chrome.storage.local.remove(keys);
  },
};

// --- In-memory implementation for tests ---

export function createMemoryKV(): KVStore {
  const store = new Map<string, unknown>();
  return {
    async get(keys: string | string[]): Promise<Record<string, unknown>> {
      const keyList = Array.isArray(keys) ? keys : [keys];
      const result: Record<string, unknown> = {};
      for (const key of keyList) {
        if (store.has(key)) {
          result[key] = store.get(key);
        }
      }
      return result;
    },
    async set(items: Record<string, unknown>): Promise<void> {
      for (const [key, value] of Object.entries(items)) {
        store.set(key, value);
      }
    },
    async remove(keys: string | string[]): Promise<void> {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const key of keyList) {
        store.delete(key);
      }
    },
  };
}

// --- Key helpers ---

const INDEX_KEY = "ms:jobIndex";
const jobKey = (postingKey: string) => `ms:job:${postingKey}`;
const snapshotKey = (snapshotId: string) => `ms:snapshot:${snapshotId}`;
const answersKey = (answersId: string) => `ms:answers:${answersId}`;

// --- Module-level KV store (swappable for tests) ---

let _kv: KVStore = chromeKV;

/** Swap the KV store (for testing) */
export function setKVStore(kv: KVStore): void {
  _kv = kv;
}

// --- Index CRUD ---

export async function getIndex(): Promise<StorageIndex> {
  const result = await _kv.get(INDEX_KEY);
  return (result[INDEX_KEY] as StorageIndex) ?? {
    postingKeys: [],
    updatedAt: new Date().toISOString(),
  };
}

async function setIndex(index: StorageIndex): Promise<void> {
  await _kv.set({ [INDEX_KEY]: index });
}

// --- JobRecord CRUD ---

export async function getJob(
  postingKey: string
): Promise<JobRecord | null> {
  const result = await _kv.get(jobKey(postingKey));
  return (result[jobKey(postingKey)] as JobRecord) ?? null;
}

/**
 * Upsert a JobRecord. Also updates the index.
 * If the record already exists, merges fields (see merge logic below).
 */
export async function upsertJob(job: JobRecord): Promise<void> {
  const existing = await getJob(job.postingKey);

  let merged: JobRecord;
  if (existing) {
    merged = {
      ...existing,
      lastSeenAt: job.lastSeenAt,
      // Merge metadata: prefer non-null new values, don't overwrite existing non-null
      company: job.company ?? existing.company,
      title: job.title ?? existing.title,
      location: job.location ?? existing.location,
      remoteType: job.remoteType ?? existing.remoteType,
      employmentType: job.employmentType ?? existing.employmentType,
      compensation: job.compensation ?? existing.compensation,
      jobIdentityKey: job.jobIdentityKey ?? existing.jobIdentityKey,
      // Status: only update if explicitly set (not "seen" overwriting "filled")
      status: job.status !== "seen" ? job.status : existing.status,
      statusUpdatedAt:
        job.status !== "seen"
          ? job.statusUpdatedAt
          : existing.statusUpdatedAt,
      // Snapshot refs: merge if new ones provided
      latestSnapshotId: job.latestSnapshotId ?? existing.latestSnapshotId,
      snapshotIds: job.snapshotIds.length > 0
        ? job.snapshotIds
        : existing.snapshotIds,
      // Answers refs: merge if new ones provided
      latestAnswersId: job.latestAnswersId ?? existing.latestAnswersId,
      answersIds: job.answersIds.length > 0
        ? job.answersIds
        : existing.answersIds,
      // Content hash
      jobContentHash: job.jobContentHash ?? existing.jobContentHash,
      // Resume link
      linkedResumeId: job.linkedResumeId ?? existing.linkedResumeId,
    };
  } else {
    merged = job;
  }

  await _kv.set({ [jobKey(job.postingKey)]: merged });

  // Update index
  const index = await getIndex();
  if (!index.postingKeys.includes(job.postingKey)) {
    index.postingKeys.unshift(job.postingKey); // newest first
  }
  index.updatedAt = new Date().toISOString();
  await setIndex(index);
}

/**
 * List job records with pagination.
 * Reads from the index, then fetches records in bulk.
 */
export async function listJobs(opts?: {
  limit?: number;
  offset?: number;
}): Promise<JobRecord[]> {
  const index = await getIndex();
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const slice = index.postingKeys.slice(offset, offset + limit);
  if (slice.length === 0) return [];

  const keys = slice.map(jobKey);
  const result = await _kv.get(keys);

  return slice
    .map((pk) => result[jobKey(pk)] as JobRecord | undefined)
    .filter((r): r is JobRecord => r != null);
}

// --- Snapshot CRUD ---

/** Max snapshots per job */
const MAX_SNAPSHOTS_PER_JOB = 5;

export async function getSnapshot(
  snapshotId: string
): Promise<JobSnapshot | null> {
  const result = await _kv.get(snapshotKey(snapshotId));
  return (result[snapshotKey(snapshotId)] as JobSnapshot) ?? null;
}

/**
 * Store a snapshot. Also updates the parent JobRecord's snapshot refs.
 * Caps at MAX_SNAPSHOTS_PER_JOB per job — removes oldest if exceeded.
 */
export async function putSnapshot(snapshot: JobSnapshot): Promise<void> {
  await _kv.set({ [snapshotKey(snapshot.snapshotId)]: snapshot });

  // Update parent job
  const job = await getJob(snapshot.postingKey);
  if (job) {
    job.latestSnapshotId = snapshot.snapshotId;
    job.snapshotIds.unshift(snapshot.snapshotId);

    // Cap snapshot count
    if (job.snapshotIds.length > MAX_SNAPSHOTS_PER_JOB) {
      const removed = job.snapshotIds.splice(MAX_SNAPSHOTS_PER_JOB);
      // Clean up old snapshot data
      await _kv.remove(removed.map(snapshotKey));
    }

    await _kv.set({ [jobKey(job.postingKey)]: job });
  }
}

// --- SmartAnswersDoc CRUD ---

export async function getAnswers(
  answersId: string
): Promise<SmartAnswersDoc | null> {
  const result = await _kv.get(answersKey(answersId));
  return (result[answersKey(answersId)] as SmartAnswersDoc) ?? null;
}

/**
 * Store a SmartAnswersDoc.
 * Also updates the parent JobRecord's answers refs.
 */
export async function putAnswers(doc: SmartAnswersDoc): Promise<void> {
  await _kv.set({ [answersKey(doc.answersId)]: doc });

  // Update parent job
  const job = await getJob(doc.postingKey);
  if (job) {
    job.latestAnswersId = doc.answersId;
    if (!job.answersIds.includes(doc.answersId)) {
      job.answersIds.unshift(doc.answersId);
    }
    await _kv.set({ [jobKey(job.postingKey)]: job });
  }
}
