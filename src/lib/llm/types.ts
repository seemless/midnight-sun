// ============================================================
// LLM Provider Types
// Shared interface for all Smart Apply providers.
// ============================================================

import type { JobContext, SmartApplyResult, Profile, Voice } from "../../shared/types";

/** Unique provider identifier */
export type ProviderId = "ollama" | "openai" | "anthropic" | "gemini";

/** What the user configures per provider */
export interface ProviderConfig {
  id: ProviderId;
  apiKey?: string; // cloud providers only
  baseUrl?: string; // Ollama custom URL, or custom API proxy
  model: string; // e.g. "llama3.2", "gpt-4o", "claude-sonnet-4-20250514", "gemini-2.0-flash"
  timeout?: number; // ms, default 90_000
}

/** Provider interface — every provider implements this */
export interface SmartApplyProvider {
  readonly id: ProviderId;
  readonly name: string; // "Ollama", "OpenAI", etc.
  readonly requiresApiKey: boolean;

  /** Generate application answers */
  generateApplication(
    context: JobContext,
    profile: Profile,
    config: ProviderConfig,
    voice?: Voice,
    existingResume?: string
  ): Promise<SmartApplyResult>;

  /** Generate a tailored resume (markdown) */
  generateResume(
    context: JobContext,
    profile: Profile,
    config: ProviderConfig,
    voice?: Voice,
    existingResume?: string,
    feedback?: string
  ): Promise<{ content: string; model: string }>;

  /** Generate a tailored cover letter (markdown) */
  generateCoverLetter(
    context: JobContext,
    profile: Profile,
    config: ProviderConfig,
    voice?: Voice,
    existingResume?: string,
    feedback?: string
  ): Promise<{ content: string; model: string }>;

  /** Send a raw prompt and return the text response. Used for gap detection and future features. */
  rawGenerate(prompt: string, config: ProviderConfig): Promise<string>;

  /** Check if the provider is reachable with given config */
  isAvailable(config: ProviderConfig): Promise<boolean>;

  /** List available models (Ollama discovers dynamically, cloud providers return static list) */
  listModels(config: ProviderConfig): Promise<string[]>;
}

/** Provider metadata for UI display */
export interface ProviderInfo {
  id: ProviderId;
  name: string;
  requiresApiKey: boolean;
  defaultModel: string;
  models: string[]; // known model list (static for cloud, dynamic for Ollama)
  defaultBaseUrl?: string; // only Ollama
}
