// ============================================================
// Job Storage Types — JobRecord, JobSnapshot, SmartAnswersDoc
// All types for the namespaced KV layer (ms:job:*, ms:snapshot:*, etc.)
// ============================================================

import type { CompensationInfo } from "./normalize";

// --- Schema version (for future migrations) ---

export const JOB_SCHEMA_VERSION = 1;

// --- Extracted metadata from page ---

export interface ExtractedMeta {
  pageTitle?: string | null;
  company?: string | null;
  title?: string | null;
  location?: string | null;
  remoteType?: "remote" | "hybrid" | "onsite" | null;
  employmentType?: "full-time" | "part-time" | "contract" | "internship" | null;
  compensationText?: string | null;
}

// --- JobRecord ---

export type JobStatus = "seen" | "filled" | "submitted" | "archived";

export interface JobRecord {
  schemaVersion: number;
  postingKey: string;
  canonicalUrl: string;
  source: string; // "ashbyhq", "greenhouse", "linkedin", etc.

  // Timestamps
  firstSeenAt: string; // ISO string
  lastSeenAt: string; // ISO string

  // Metadata (all nullable — filled progressively)
  company: string | null;
  title: string | null;
  location: string | null;
  remoteType: "remote" | "hybrid" | "onsite" | null;
  employmentType:
    | "full-time"
    | "part-time"
    | "contract"
    | "internship"
    | null;
  compensation: CompensationInfo | null;

  // Cross-URL dedup key
  jobIdentityKey: string | null;

  // Status
  status: JobStatus;
  statusUpdatedAt: string; // ISO string

  // Snapshot references
  latestSnapshotId: string | null;
  snapshotIds: string[];

  // Smart answers references
  latestAnswersId: string | null;
  answersIds: string[];

  // Content hash (for detecting if job description changed)
  jobContentHash: string | null;

  // Resume linked to this application
  linkedResumeId: string | null;
}

// --- JobSnapshot ---

export interface SnapshotSection {
  heading: string;
  text: string;
}

export interface JobSnapshot {
  schemaVersion: number;
  snapshotId: string;
  postingKey: string;
  capturedAt: string; // ISO string

  // Metadata at capture time
  meta: ExtractedMeta;

  // Structured sections (heading + text pairs)
  sections: SnapshotSection[];

  // Raw text content (capped at 40k chars)
  fullText: string;
}

// --- SmartAnswersDoc ---

export interface SmartQuestion {
  questionId: string; // sha256(normalizeText(questionText))
  questionText: string;
  questionHash: string; // same as questionId for now
}

export interface SmartAnswerEntry {
  questionId: string;
  answerText: string;
  answerHash: string; // sha256(normalizeText(answerText))
  editedByUser: boolean;
  updatedAt: string; // ISO string
}

export interface SmartAnswersDoc {
  schemaVersion: number;
  answersId: string;
  postingKey: string;

  createdAt: string; // ISO string
  updatedAt: string; // ISO string

  // Generation metadata
  model: string | null;
  promptVersion: string;
  jobContentHash: string | null;

  // Questions at generation time
  questions: SmartQuestion[];

  // Generated (and possibly edited) answers
  answers: SmartAnswerEntry[];
}

// --- Storage Index ---

export interface StorageIndex {
  /** Posting keys, newest-first */
  postingKeys: string[];
  updatedAt: string; // ISO string
}
