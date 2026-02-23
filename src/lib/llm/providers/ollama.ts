// ============================================================
// Ollama Provider — Local LLM via Ollama API
// Migrated from src/lib/ollama.ts
// ============================================================

import type { JobContext, Profile, SmartApplyResult, Voice } from "../../../shared/types";
import type { SmartApplyProvider, ProviderConfig } from "../types";
import {
  buildApplicationPrompt,
  buildResumePrompt,
  buildCoverLetterPrompt,
  parseSmartResponse,
  parseResumeResponse,
  buildSmartApplyResult,
} from "../prompt";
import { registerProvider } from "../registry";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "llama3.2";
const DEFAULT_TIMEOUT = 180_000;

/**
 * Check if Ollama is running and reachable.
 */
export async function isOllamaRunning(baseUrl = DEFAULT_BASE_URL): Promise<boolean> {
  try {
    const resp = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * List available Ollama models.
 */
export async function listOllamaModels(baseUrl = DEFAULT_BASE_URL): Promise<string[]> {
  try {
    const resp = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await resp.json();
    return (data.models ?? []).map((m: { name: string }) => m.name);
  } catch {
    return [];
  }
}

/**
 * Generate a completion via Ollama. Returns the full response text.
 */
export async function generate(
  prompt: string,
  options: { baseUrl: string; model: string; timeout: number }
): Promise<string> {
  const resp = await fetch(`${options.baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      prompt,
      stream: false,
    }),
    signal: AbortSignal.timeout(options.timeout),
  });

  if (!resp.ok) {
    throw new Error(`Ollama error: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  return data.response ?? "";
}

// --- Provider implementation ---

const ollamaProvider: SmartApplyProvider = {
  id: "ollama",
  name: "Ollama (Local)",
  requiresApiKey: false,

  async generateApplication(
    context: JobContext,
    profile: Profile,
    config: ProviderConfig,
    voice?: Voice,
    existingResume?: string
  ): Promise<SmartApplyResult> {
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const model = config.model || DEFAULT_MODEL;
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;

    const prompt = buildApplicationPrompt(context, profile, voice, existingResume);
    const start = performance.now();

    const raw = await generate(prompt, { baseUrl, model, timeout });
    const durationMs = Math.round(performance.now() - start);

    const parsed = parseSmartResponse(raw);
    if (!parsed) {
      throw new Error(
        `Failed to parse LLM response. Raw output:\n${raw.slice(0, 500)}`
      );
    }

    return buildSmartApplyResult(context, parsed, model, prompt.length, durationMs);
  },

  async generateResume(
    context: JobContext,
    profile: Profile,
    config: ProviderConfig,
    voice?: Voice,
    existingResume?: string,
    feedback?: string
  ): Promise<{ content: string; model: string }> {
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const model = config.model || DEFAULT_MODEL;
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;

    const prompt = buildResumePrompt(context, profile, voice, existingResume, feedback);
    const raw = await generate(prompt, { baseUrl, model, timeout });

    const content = parseResumeResponse(raw);
    if (!content) {
      throw new Error(
        `Failed to parse resume response. Raw output:\n${raw.slice(0, 500)}`
      );
    }

    return { content, model };
  },

  async generateCoverLetter(
    context: JobContext,
    profile: Profile,
    config: ProviderConfig,
    voice?: Voice,
    existingResume?: string,
    feedback?: string
  ): Promise<{ content: string; model: string }> {
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const model = config.model || DEFAULT_MODEL;
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;

    const prompt = buildCoverLetterPrompt(context, profile, voice, existingResume, feedback);
    const raw = await generate(prompt, { baseUrl, model, timeout });

    const content = parseResumeResponse(raw);
    if (!content) {
      throw new Error(
        `Failed to parse cover letter response. Raw output:\n${raw.slice(0, 500)}`
      );
    }

    return { content, model };
  },

  async rawGenerate(prompt: string, config: ProviderConfig): Promise<string> {
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const model = config.model || DEFAULT_MODEL;
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;
    return generate(prompt, { baseUrl, model, timeout });
  },

  async isAvailable(config: ProviderConfig): Promise<boolean> {
    return isOllamaRunning(config.baseUrl ?? DEFAULT_BASE_URL);
  },

  async listModels(config: ProviderConfig): Promise<string[]> {
    return listOllamaModels(config.baseUrl ?? DEFAULT_BASE_URL);
  },
};

registerProvider(ollamaProvider, {
  defaultModel: DEFAULT_MODEL,
  models: [DEFAULT_MODEL], // dynamic — UI should call listModels() for Ollama
  defaultBaseUrl: DEFAULT_BASE_URL,
});

export { ollamaProvider };
