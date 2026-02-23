// ============================================================
// LLM Provider — Barrel Export
// Import this module to register all providers and access the registry.
// ============================================================

// Re-export types
export type {
  ProviderId,
  ProviderConfig,
  SmartApplyProvider,
  ProviderInfo,
} from "./types";

// Re-export registry
export { getProvider, listProviders } from "./registry";

// Re-export prompt utilities (for testing)
export {
  buildApplicationPrompt,
  parseSmartResponse,
  buildSmartApplyResult,
} from "./prompt";

// Import all providers to trigger self-registration
import "./providers/ollama";
import "./providers/openai";
import "./providers/anthropic";
import "./providers/gemini";
