// ============================================================
// THE MIDNIGHT SUN — Type Definitions
// Single source of truth. Every data shape lives here.
// ============================================================

import type { ExtractedMeta } from "./jobTypes";
import type { ProviderConfig } from "../lib/llm/types";
export type { ProviderConfig } from "../lib/llm/types";

// --- Profile (parsed from resume) ---

export interface Profile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  summary: string;
  experiences: Experience[];
  education: Education[];
  skills: string[];
}

export interface Experience {
  id: string;
  title: string;
  company: string;
  location: string;
  startDate: string; // "Jan 2020" or "2020-01"
  endDate: string; // "Present" or "Dec 2023"
  description: string;
  highlights: string[];
}

export interface Education {
  id: string;
  school: string;
  degree: string;
  field: string;
  startDate: string;
  endDate: string;
  gpa: string;
}

export const EMPTY_PROFILE: Profile = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  location: "",
  linkedinUrl: "",
  githubUrl: "",
  portfolioUrl: "",
  summary: "",
  experiences: [],
  education: [],
  skills: [],
};

// --- Applications ---

export type ApplicationStatus =
  | "saved"
  | "applied"
  | "interviewing"
  | "offered"
  | "accepted"
  | "rejected"
  | "ghosted";

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "saved",
  "applied",
  "interviewing",
  "offered",
  "accepted",
  "rejected",
  "ghosted",
];

export interface Application {
  id: string;
  company: string;
  role: string;
  url: string;
  status: ApplicationStatus;
  dateAdded: string; // ISO string
  dateApplied: string; // ISO string
  notes: string;
  salary: string;
  location: string;
  /** Link to auto-detected JobRecord (computed from URL) */
  postingKey?: string | null;
}

// --- Form Detection ---

/** A profile field that can be mapped to a form input */
export type ProfileField =
  | "firstName"
  | "lastName"
  | "fullName"
  | "email"
  | "phone"
  | "location"
  | "city"
  | "state"
  | "zip"
  | "country"
  | "linkedinUrl"
  | "githubUrl"
  | "portfolioUrl"
  | "summary"
  | "currentTitle"
  | "currentCompany"
  | "yearsExperience"
  | "salaryExpectation"
  | "startDate"
  | "middleName"
  | "sponsorship"
  | "authorized"
  | "heardAbout";

/** Structured signals — what we saw that led to a match */
export interface FieldSignals {
  /** Associated <label> text */
  label?: string;
  /** aria-label or aria-labelledby text */
  aria?: string;
  /** input placeholder text */
  placeholder?: string;
  /** input name attribute */
  name?: string;
  /** input id attribute */
  id?: string;
  /** Nearby text (previous sibling, etc.) */
  nearbyText?: string;
  /** data-automation-id or similar test hooks */
  automationId?: string;
}

/** A form field detected on the page */
export interface DetectedField {
  /**
   * Multiple CSS selectors to re-find the element, ordered by specificity.
   * First one is the best (by id > by name > by path).
   * Multiple candidates protect against re-renders invalidating a single selector.
   */
  selectorCandidates: string[];
  /** What type of input: text, email, tel, select, textarea, radio, checkbox, custom */
  inputType: string;
  /** Raw text signals (for keyword matching) */
  signals: string[];
  /** Structured signals (for debugging — see exactly what was found where) */
  structuredSignals: FieldSignals;
  /** Our best guess at what profile field this maps to */
  matchedField: ProfileField | null;
  /** How confident we are (0–1) */
  confidence: number;
  /** Current value (if pre-filled) */
  currentValue: string;
  /** Whether the element is visible (false = display:none / visibility:hidden) */
  visible: boolean;
  /** Tagged category — demographic fields are detected but never auto-filled */
  category?: "demographic";
}

// --- Choice Groups (radio/checkbox) ---

/** A single option in a radio or checkbox group */
export interface ChoiceOption {
  /** CSS selector to find this specific input element */
  selector: string;
  /** Human-readable label text ("Yes", "No", "LinkedIn") */
  label: string;
  /** HTML value attribute */
  value: string;
}

/** A group of radio buttons or checkboxes forming a single question */
export interface ChoiceGroup {
  /** Group identifier (usually the name attribute) */
  groupId: string;
  /** Whether this is a radio (single-select) or checkbox (multi-select) group */
  inputType: "radio" | "checkbox";
  /** The question text for this group */
  question: string;
  /** Available options */
  options: ChoiceOption[];
  /** Raw text signals for matching */
  signals: string[];
  /** Profile field this maps to (null if unmatched) */
  matchedField: ProfileField | null;
  /** Match confidence (0–1) */
  confidence: number;
  /** Category: fillable, demographic (never fill), or manual (no match) */
  category: "fillable" | "demographic" | "manual";
  /** Selectors for the group container (fieldset, radiogroup, etc.) */
  selectorCandidates: string[];
}

/** Result of filling a single choice group */
export interface ChoiceGroupResult {
  groupId: string;
  question: string;
  selectedOption: string;
  success: boolean;
  reason?: string;
}

/** Detection results from a single frame (used by all-frames scan) */
export interface FrameDetectResult {
  frameUrl: string;
  fields: DetectedField[];
  choiceGroups: ChoiceGroup[];
  debugCounts: DebugCounts;
  openQuestionCount: number;
}

/** Raw DOM element counts for diagnosing detection issues */
export interface DebugCounts {
  rawInputs: number;
  rawTextareas: number;
  rawSelects: number;
  roleTextbox: number;
  contenteditable: number;
  iframes: number;
  sameOriginIframes: number;
  filteredByVisibility: number;
}

/** Why a fill failed — analyzable, not just a string */
export type FillFailReason =
  | "custom_control"    // div-based dropdown, etc.
  | "no_match"          // no profile field matched
  | "empty_profile"     // profile field exists but is empty
  | "element_not_found" // selector candidates all failed
  | "low_confidence"    // matched but below threshold
  | "set_value_failed"  // native control but value didn't stick
  | "exception";        // unexpected error

/** Result of filling a single field */
export interface FillResult {
  /** Primary selector used to find the element */
  selector: string;
  matchedField: ProfileField | null;
  filledValue: string;
  success: boolean;
  /** Typed reason for failure — enables "are most failures custom controls or bad matching?" analysis */
  reason?: FillFailReason;
  /** Human-readable error detail */
  error?: string;
  /** Was this a custom control we can't fill? */
  manualRequired?: boolean;
  /** How long the fill took (ms) — useful for spotting slow fills */
  durationMs?: number;
}

// --- FillRun (audit log for every fill attempt) ---

/** Page metadata captured at fill time */
export interface PageMeta {
  title: string;
  hostname: string;
  /** For multi-page wizards (Workday): which step are we on? */
  stepIndex?: number;
  /** Human-readable step label if available */
  stepLabel?: string;
}

/**
 * Complete record of one fill attempt on one page.
 * Stored in chrome.storage, viewable for debugging.
 * This is the single most important debugging tool in the app.
 *
 * Design note: stepIndex + pageMeta exist to support multi-page wizards (Workday)
 * without requiring an architectural change later. In v0, stepIndex is always 0.
 */
export interface FillRun {
  id: string;
  /** When this fill was attempted */
  timestamp: string; // ISO string
  /** The page we were on */
  url: string;
  /** Best-effort company/role extraction */
  company: string;
  role: string;
  /** Page metadata (title, hostname, wizard step) */
  pageMeta: PageMeta;
  /** Every field we detected, including unmatched ones */
  detectedFields: DetectedField[];
  /** Results of the fill attempt */
  fillResults: FillResult[];
  /** Summary stats for quick glance */
  stats: {
    totalFields: number;
    matched: number;
    filled: number;
    failed: number;
    manualRequired: number;
    skipped: number;
    /** Breakdown of failure reasons — answers "why are fills failing?" */
    reasonBreakdown: Partial<Record<FillFailReason, number>>;
  };
  /** Total wall-clock time for the fill operation (ms) */
  totalDurationMs: number;
  /** Optional pointer to associated smart apply run */
  smartApplyRunId?: string;
}

// --- Messages (popup ↔ content ↔ background) ---

export type Message =
  | { type: "DETECT_FIELDS" }
  | { type: "FIELDS_DETECTED"; fields: DetectedField[]; choiceGroups: ChoiceGroup[]; openQuestionCount: number; debugCounts: DebugCounts }
  | { type: "FILL_FIELDS"; profile: Profile; fields: DetectedField[]; choiceGroups?: ChoiceGroup[] }
  | { type: "FILL_COMPLETE"; results: FillResult[]; choiceGroupResults?: ChoiceGroupResult[] }
  | { type: "GET_PAGE_INFO" }
  | {
      type: "PAGE_INFO";
      url: string;
      title: string;
      company: string;
      role: string;
    }
  | { type: "PING" }
  | { type: "PONG" }
  // Smart Apply messages
  | { type: "EXTRACT_JOB_CONTEXT" }
  | { type: "JOB_CONTEXT"; context: JobContext }
  | { type: "GENERATE_SMART_ANSWERS"; context: JobContext; profile: Profile; providerConfig: ProviderConfig; voice?: Voice; existingResume?: string }
  | { type: "SMART_ANSWERS_RESULT"; result: SmartApplyResult | null; error?: string }
  | { type: "FILL_SMART_ANSWERS"; answers: SmartFillEntry[] }
  | { type: "SMART_FILL_COMPLETE"; outcomes: SmartFillOutcome[] }
  // All-frames scanning (popup → background → each frame)
  | { type: "DETECT_ALL_FRAMES" }
  | { type: "ALL_FRAMES_DETECTED"; frames: FrameDetectResult[] }
  // Resume generation messages
  | { type: "GENERATE_RESUME"; context: JobContext; profile: Profile; providerConfig: ProviderConfig; voice?: Voice; existingResume?: string; feedback?: string }
  | { type: "RESUME_RESULT"; content: string | null; model?: string; error?: string }
  // Cover letter generation messages
  | { type: "GENERATE_COVER_LETTER"; context: JobContext; profile: Profile; providerConfig: ProviderConfig; voice?: Voice; existingResume?: string; feedback?: string }
  | { type: "COVER_LETTER_RESULT"; content: string | null; model?: string; error?: string }
  // Profile gap detection messages
  | { type: "DETECT_PROFILE_GAPS"; context: JobContext; profile: Profile; providerConfig: ProviderConfig; existingResume?: string }
  | { type: "PROFILE_GAPS_RESULT"; questions: GapQuestion[]; error?: string }
  // Snapshot messages
  | { type: "CAPTURE_SNAPSHOT" }
  | { type: "SNAPSHOT_DATA"; sections: Array<{ heading: string; text: string }>; meta: ExtractedMeta; fullText: string }
  // File input detection + attachment
  | { type: "DETECT_FILE_INPUTS" }
  | { type: "FILE_INPUTS_DETECTED"; fileInputs: FileInputInfo[] }
  | { type: "ATTACH_FILE"; fileInput: FileInputInfo; fileName: string; content: string; mimeType: string }
  | { type: "ATTACH_FILE_RESULT"; success: boolean; error?: string };

// --- Smart Matcher Interface (future LLM plug-in) ---

/**
 * Interface for "smart" field matching and answer generation.
 * MVP: not implemented. Future: Ollama, OpenAI, or Anthropic.
 *
 * The key contract: every method has a timeout, returns null on failure,
 * and the caller ALWAYS has a deterministic fallback.
 * The LLM never blocks the critical path.
 */
export interface SmartAssist {
  /** Given a field's signals, suggest a profile field match. Returns null if unsure. */
  matchField(signals: string[], profileFields: string[]): Promise<ProfileField | null>;

  /** Generate an answer for a free-text field (cover letter, "why this company", etc.) */
  generateAnswer(params: {
    fieldLabel: string;
    company: string;
    role: string;
    profile: Profile;
  }): Promise<string | null>;

  /** Check if the LLM backend is reachable */
  isAvailable(): Promise<boolean>;
}

// --- Smart Apply (Ollama-powered answer generation) ---

/** Job context extracted from the page */
export interface JobContext {
  url: string;
  title: string;
  company: string;
  description: string; // capped at 12000 chars
  questions: OpenQuestion[];
}

/** An open-ended question detected on the page */
export interface OpenQuestion {
  label: string;
  selectorCandidates: string[];
  signals: string[];
}

/** Result from Ollama smart generation */
export interface SmartApplyResult {
  summary: string;
  whyCompany: string;
  answers: SmartAnswer[];
  model: string;
  durationMs: number;
  promptChars: number;
}

/** A single generated answer paired with its target */
export interface SmartAnswer {
  label: string;
  selectorCandidates: string[];
  answer: string;
}

/** Entry sent to content script for smart fill */
export interface SmartFillEntry {
  targetSelector: string;
  selectorCandidates: string[];
  signals: string[];
  value: string;
  /** Frame ID where the target element lives (0 = top frame) */
  frameId?: number;
}

/** Per-answer fill outcome from smart fill */
export interface SmartFillOutcome {
  label: string;
  filled: boolean;
  repairUsed: boolean;
  failureReason?: string;
}

/** Audit log for a smart generation run */
export interface SmartApplyRun {
  id: string;
  timestamp: string;
  url: string;
  company: string;
  role: string;
  result: SmartApplyResult | null;
  error?: string;
  fillOutcomes?: SmartFillOutcome[];
}

// --- Generation Run (audit log for resume/cover letter generation) ---

/** Audit log for a resume or cover letter generation run */
export interface GenerationRun {
  id: string;
  timestamp: string;
  url: string;
  company: string;
  role: string;
  docType: "resume" | "cover-letter";
  model?: string;
  durationMs: number;
  error?: string;
  /** Length of generated content in chars (0 if failed) */
  contentLength: number;
  /** Where generation was triggered from */
  source: "resumes-tab" | "fill-preview";
}

// --- Voice / Core Answers ---

/** User-authored personality layer injected into LLM prompts */
export interface Voice {
  /** 2-4 sentence personal pitch: "I'm a..." */
  corePitch: string;
  /** Top 3 strengths (bullet points) */
  topStrengths: string[];
  /** Target role titles */
  roleTargets: string[];
  /** Free-text constraints: remote preference, comp targets, etc. */
  constraints: string;
  /** Writing tone for generated answers (preset or custom string) */
  tone: string;
}

export const EMPTY_VOICE: Voice = {
  corePitch: "",
  topStrengths: [],
  roleTargets: [],
  constraints: "",
  tone: "direct",
};

// --- Resume Documents ---

/** A named resume document in the global library */
export interface ResumeDoc {
  resumeId: string; // crypto.randomUUID()
  name: string; // User-given name ("Frontend Resume v2")
  content: string; // Markdown content
  source: "generated" | "uploaded" | "edited";
  docType?: "resume" | "cover-letter"; // undefined = "resume" (backward compat)
  generatedForJob?: string; // postingKey if LLM-generated
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

// --- File Input Detection (for resume attachment) ---

/** A file input detected on the page */
export interface FileInputInfo {
  selectorCandidates: string[];
  label: string;
  accept: string;
  multiple: boolean;
}

// --- Gap Detection ---

/** A question the LLM wants to ask the user to fill profile gaps */
export interface GapQuestion {
  id: string;
  field: "summary" | "experiences" | "education" | "skills" | "other";
  question: string;
  placeholder: string;
  inputType: "text" | "textarea";
}

// --- Answer Library ---

/** A remembered answer for a specific question */
export interface AnswerLibraryEntry {
  /** SHA-256 hash of normalizeText(questionText) */
  questionHash: string;
  /** Human-readable question text for UI display */
  questionText: string;
  /** Input type when this answer was captured */
  inputType: "text" | "textarea" | "radio" | "checkbox" | "select";
  /** The answer value (string for single, string[] for multi-select/checkbox) */
  answer: string | string[];
  /** Available options when answered (for radio/select — useful for fuzzy matching) */
  optionsSeen?: string[];
  /** Scope: global only for now (future: per-company, per-ATS) */
  scope: "global";
  /** When this answer was last used */
  lastUsedAt: string;
  /** When this answer was first saved */
  createdAt: string;
}

// --- Storage Schema ---

export interface StorageSchema {
  profile: Profile;
  applications: Application[];
  fillRuns: FillRun[];
  smartApplyRuns: SmartApplyRun[];
  generationRuns: GenerationRun[];
  settings: Settings;
}

export interface Settings {
  /** Whether to automatically detect fields when visiting job pages */
  autoDetect: boolean;
  /** Theme — just dark for now */
  theme: "dark";
  /**
   * Stateless mode — profile is NOT persisted to disk.
   * Uses chrome.storage.session (survives popup open/close, clears on browser restart).
   * User uploads resume every browser session.
   */
  statelessMode: boolean;
  /** Smart Apply provider configuration */
  providerConfig: ProviderConfig;
}

export const DEFAULT_SETTINGS: Settings = {
  autoDetect: false,
  theme: "dark",
  statelessMode: false,
  providerConfig: {
    id: "ollama",
    model: "llama3.2",
    baseUrl: "http://localhost:11434",
  },
};
