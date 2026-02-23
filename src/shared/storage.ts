import type {
  StorageSchema,
  Profile,
  Application,
  Settings,
  Voice,
} from "./types";
import { EMPTY_PROFILE, DEFAULT_SETTINGS, EMPTY_VOICE } from "./types";

// ============================================================
// Storage Adapter — mockable interface for testing
// ============================================================

export interface StorageAdapter {
  get<K extends keyof StorageSchema>(key: K): Promise<StorageSchema[K] | null>;
  set<K extends keyof StorageSchema>(
    key: K,
    value: StorageSchema[K]
  ): Promise<void>;
  remove(key: keyof StorageSchema): Promise<void>;
}

// --- Chrome implementation ---

export const chromeStorage: StorageAdapter = {
  async get<K extends keyof StorageSchema>(
    key: K
  ): Promise<StorageSchema[K] | null> {
    const result = await chrome.storage.local.get(key);
    return (result[key] as StorageSchema[K]) ?? null;
  },
  async set<K extends keyof StorageSchema>(
    key: K,
    value: StorageSchema[K]
  ): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },
  async remove(key: keyof StorageSchema): Promise<void> {
    await chrome.storage.local.remove(key);
  },
};

// --- In-memory implementation for tests ---

export function createMemoryStorage(): StorageAdapter {
  const store = new Map<string, unknown>();
  return {
    async get<K extends keyof StorageSchema>(
      key: K
    ): Promise<StorageSchema[K] | null> {
      return (store.get(key) as StorageSchema[K]) ?? null;
    },
    async set<K extends keyof StorageSchema>(
      key: K,
      value: StorageSchema[K]
    ): Promise<void> {
      store.set(key, value);
    },
    async remove(key: keyof StorageSchema): Promise<void> {
      store.delete(key);
    },
  };
}

// --- High-level helpers (used by UI) ---

let _adapter: StorageAdapter = chromeStorage;

/** Swap the storage adapter (for testing) */
export function setStorageAdapter(adapter: StorageAdapter): void {
  _adapter = adapter;
}

// --- Stateless mode support ---
// In stateless mode, profile is stored in chrome.storage.session
// (survives popup open/close, clears on browser restart).
// Settings themselves are always persisted to local storage.

async function isStatelessMode(): Promise<boolean> {
  const settings = await getSettings();
  return settings.statelessMode;
}

export async function getProfile(): Promise<Profile> {
  if (typeof chrome !== "undefined" && chrome.storage?.session && await isStatelessMode()) {
    const result = await chrome.storage.session.get("profile");
    return (result.profile as Profile) ?? EMPTY_PROFILE;
  }
  return (await _adapter.get("profile")) ?? EMPTY_PROFILE;
}

export async function saveProfile(profile: Profile): Promise<void> {
  if (typeof chrome !== "undefined" && chrome.storage?.session && await isStatelessMode()) {
    await chrome.storage.session.set({ profile });
    // Also clear from local storage to avoid stale data
    await _adapter.remove("profile");
    return;
  }
  await _adapter.set("profile", profile);
}

/**
 * Migrate profile between local ↔ session storage when stateless mode changes.
 * Call this after toggling the setting.
 */
export async function migrateProfileStorage(toStateless: boolean): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.storage?.session) return;

  if (toStateless) {
    // Move from local → session
    const profile = (await _adapter.get("profile")) ?? EMPTY_PROFILE;
    await chrome.storage.session.set({ profile });
    await _adapter.remove("profile");
  } else {
    // Move from session → local
    const result = await chrome.storage.session.get("profile");
    const profile = (result.profile as Profile) ?? EMPTY_PROFILE;
    await _adapter.set("profile", profile);
    await chrome.storage.session.remove("profile");
  }
}

export async function getApplications(): Promise<Application[]> {
  return (await _adapter.get("applications")) ?? [];
}

export async function saveApplications(apps: Application[]): Promise<void> {
  await _adapter.set("applications", apps);
}

export async function addApplication(app: Application): Promise<void> {
  const apps = await getApplications();
  apps.push(app);
  await saveApplications(apps);
}

export async function updateApplication(
  id: string,
  updates: Partial<Application>
): Promise<void> {
  const apps = await getApplications();
  const index = apps.findIndex((a) => a.id === id);
  if (index !== -1) {
    apps[index] = { ...apps[index], ...updates };
    await saveApplications(apps);
  }
}

export async function deleteApplication(id: string): Promise<void> {
  const apps = await getApplications();
  await saveApplications(apps.filter((a) => a.id !== id));
}

export async function getSettings(): Promise<Settings> {
  const raw = (await _adapter.get("settings")) ?? DEFAULT_SETTINGS;

  // Migration: ollamaUrl → providerConfig (one-time upgrade)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawAny = raw as any;
  if (!raw.providerConfig && rawAny.ollamaUrl) {
    const ollamaUrl = rawAny.ollamaUrl as string;
    raw.providerConfig = {
      id: "ollama",
      model: "llama3.2",
      baseUrl: ollamaUrl,
    };
    // Persist the migrated settings
    await _adapter.set("settings", raw);
  }

  // Ensure providerConfig exists (fresh installs or corrupted storage)
  if (!raw.providerConfig) {
    raw.providerConfig = DEFAULT_SETTINGS.providerConfig;
  }

  return raw;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await _adapter.set("settings", settings);
}

// --- Voice (separate storage key — survives resume re-parsing) ---

/**
 * Get voice configuration.
 * Stored separately from profile (facts ≠ preferences).
 * Respects stateless mode.
 */
export async function getVoice(): Promise<Voice> {
  // In stateless mode, use session storage if available
  const settings = await getSettings();
  if (settings.statelessMode && typeof chrome !== "undefined" && chrome.storage?.session) {
    const result = await chrome.storage.session.get("voice");
    return (result.voice as Voice) ?? EMPTY_VOICE;
  }

  // Normal mode: use the adapter (chrome.storage.local or mock)
  // Voice uses a special key outside StorageSchema — read via chrome.storage.local directly
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const result = await chrome.storage.local.get("voice");
      return (result.voice as Voice) ?? EMPTY_VOICE;
    }
  } catch {
    // Test environment — use adapter
  }

  return EMPTY_VOICE;
}

/**
 * Save voice configuration.
 * Stored separately from profile.
 */
export async function saveVoice(voice: Voice): Promise<void> {
  const settings = await getSettings();
  if (settings.statelessMode && typeof chrome !== "undefined" && chrome.storage?.session) {
    await chrome.storage.session.set({ voice });
    return;
  }

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ voice });
      return;
    }
  } catch {
    // Test environment
  }
}

// --- Raw Resume Text (the original pasted text, preserved for LLM context) ---

/**
 * Get the user's raw resume text (the original pasted import text).
 * This is stored separately from the parsed Profile so the LLM
 * always has full context even when the deterministic parser
 * missed details. Respects stateless mode.
 */
export async function getRawResume(): Promise<string> {
  const settings = await getSettings();
  if (settings.statelessMode && typeof chrome !== "undefined" && chrome.storage?.session) {
    const result = await chrome.storage.session.get("rawResume");
    return (result.rawResume as string) ?? "";
  }

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const result = await chrome.storage.local.get("rawResume");
      return (result.rawResume as string) ?? "";
    }
  } catch {
    // Test environment
  }

  return "";
}

/**
 * Save the user's raw resume text.
 */
export async function saveRawResume(text: string): Promise<void> {
  const settings = await getSettings();
  if (settings.statelessMode && typeof chrome !== "undefined" && chrome.storage?.session) {
    await chrome.storage.session.set({ rawResume: text });
    return;
  }

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ rawResume: text });
      return;
    }
  } catch {
    // Test environment
  }
}

// --- Resume Editor Draft (survives popup close via session storage) ---

export interface ResumeDraft {
  name: string;
  content: string;
  docType: "resume" | "cover-letter";
  genNotes: string;
  existingResumeId?: string; // undefined = creating new
  updatedAt: string;
}

/**
 * Get the in-progress resume editor draft.
 * Always uses session storage (clears on browser restart, survives popup close).
 */
export async function getResumeDraft(): Promise<ResumeDraft | null> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.session) {
      const result = await chrome.storage.session.get("resumeDraft");
      return (result.resumeDraft as ResumeDraft) ?? null;
    }
  } catch {
    // Not available
  }
  return null;
}

/**
 * Save resume editor draft to session storage.
 */
export async function saveResumeDraft(draft: ResumeDraft): Promise<void> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.session) {
      await chrome.storage.session.set({ resumeDraft: draft });
    }
  } catch {
    // Not available
  }
}

/**
 * Clear the resume editor draft (on explicit save or cancel).
 */
export async function clearResumeDraft(): Promise<void> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.session) {
      await chrome.storage.session.remove("resumeDraft");
    }
  } catch {
    // Not available
  }
}

// --- FillRun logging ---

import type { FillRun, DetectedField, FillResult, PageMeta, FillFailReason, SmartApplyRun, GenerationRun } from "./types";

/** Max fill runs to keep (prevent unbounded storage growth) */
const MAX_FILL_RUNS = 100;

export async function getFillRuns(): Promise<FillRun[]> {
  return (await _adapter.get("fillRuns")) ?? [];
}

export async function saveFillRun(run: FillRun): Promise<void> {
  const runs = await getFillRuns();
  runs.unshift(run); // newest first
  if (runs.length > MAX_FILL_RUNS) {
    runs.length = MAX_FILL_RUNS;
  }
  await _adapter.set("fillRuns", runs);
}

// --- SmartApplyRun logging ---

const MAX_SMART_APPLY_RUNS = 30;

export async function getSmartApplyRuns(): Promise<SmartApplyRun[]> {
  return (await _adapter.get("smartApplyRuns")) ?? [];
}

export async function saveSmartApplyRun(run: SmartApplyRun): Promise<void> {
  const runs = await getSmartApplyRuns();
  runs.unshift(run);
  if (runs.length > MAX_SMART_APPLY_RUNS) {
    runs.length = MAX_SMART_APPLY_RUNS;
  }
  await _adapter.set("smartApplyRuns", runs);
}

// --- GenerationRun logging (resume / cover letter generation) ---

const MAX_GENERATION_RUNS = 20;

export async function getGenerationRuns(): Promise<GenerationRun[]> {
  return (await _adapter.get("generationRuns")) ?? [];
}

export async function saveGenerationRun(run: GenerationRun): Promise<void> {
  const runs = await getGenerationRuns();
  runs.unshift(run);
  if (runs.length > MAX_GENERATION_RUNS) {
    runs.length = MAX_GENERATION_RUNS;
  }
  await _adapter.set("generationRuns", runs);
}

/**
 * Create a FillRun from detection + fill results.
 * This is the main logging function — called after every fill attempt.
 */
export function createFillRun(params: {
  url: string;
  company: string;
  role: string;
  pageMeta?: Partial<PageMeta>;
  detectedFields: DetectedField[];
  fillResults: FillResult[];
}): FillRun {
  const { url, company, role, detectedFields, fillResults, pageMeta } = params;

  const matched = detectedFields.filter((f) => f.matchedField !== null).length;
  const filled = fillResults.filter((r) => r.success).length;
  const failed = fillResults.filter((r) => !r.success && !r.manualRequired).length;
  const manualRequired = fillResults.filter((r) => r.manualRequired).length;
  const totalDurationMs = fillResults.reduce(
    (sum, r) => sum + (r.durationMs ?? 0),
    0
  );

  // Compute reason breakdown for failure analysis
  const reasonBreakdown: Partial<Record<FillFailReason, number>> = {};
  for (const r of fillResults) {
    if (r.reason) {
      reasonBreakdown[r.reason] = (reasonBreakdown[r.reason] ?? 0) + 1;
    }
  }

  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    // invalid URL, leave empty
  }

  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    url,
    company,
    role,
    pageMeta: {
      title: pageMeta?.title ?? "",
      hostname,
      stepIndex: pageMeta?.stepIndex ?? 0,
      stepLabel: pageMeta?.stepLabel,
    },
    detectedFields,
    fillResults,
    stats: {
      totalFields: detectedFields.length,
      matched,
      filled,
      failed,
      manualRequired,
      skipped: detectedFields.length - matched,
      reasonBreakdown,
    },
    totalDurationMs,
  };
}
