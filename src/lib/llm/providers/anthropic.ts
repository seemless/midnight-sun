// ============================================================
// Anthropic Provider — Claude models via Anthropic API
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

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_TIMEOUT = 180_000;
const API_VERSION = "2023-06-01";

const MODELS = ["claude-sonnet-4-20250514", "claude-haiku-4-20250414"];

const anthropicProvider: SmartApplyProvider = {
  id: "anthropic",
  name: "Anthropic",
  requiresApiKey: true,

  async generateApplication(
    context: JobContext,
    profile: Profile,
    config: ProviderConfig,
    voice?: Voice,
    existingResume?: string
  ): Promise<SmartApplyResult> {
    if (!config.apiKey) {
      throw new Error("Anthropic requires an API key. Add one in Settings.");
    }

    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const model = config.model || DEFAULT_MODEL;
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;

    const prompt = buildApplicationPrompt(context, profile, voice, existingResume);
    const start = performance.now();

    const resp = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": API_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      if (resp.status === 401) {
        throw new Error("Anthropic error: 401 Unauthorized \u2014 check your API key");
      }
      if (resp.status === 429) {
        throw new Error("Anthropic error: 429 Too Many Requests \u2014 rate limited");
      }
      throw new Error(
        `Anthropic error: ${resp.status} ${resp.statusText}${body ? ` \u2014 ${body.slice(0, 200)}` : ""}`
      );
    }

    const data = await resp.json();
    const raw: string = data.content?.[0]?.text ?? "";
    const durationMs = Math.round(performance.now() - start);

    const parsed = parseSmartResponse(raw);
    if (!parsed) {
      throw new Error(
        `Failed to parse Anthropic response. Raw output:\n${raw.slice(0, 500)}`
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
    if (!config.apiKey) {
      throw new Error("Anthropic requires an API key. Add one in Settings.");
    }

    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const model = config.model || DEFAULT_MODEL;
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;

    const prompt = buildResumePrompt(context, profile, voice, existingResume, feedback);

    const resp = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": API_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(
        `Anthropic error: ${resp.status} ${resp.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`
      );
    }

    const data = await resp.json();
    const raw: string = data.content?.[0]?.text ?? "";

    const content = parseResumeResponse(raw);
    if (!content) {
      throw new Error(
        `Failed to parse Anthropic resume response. Raw output:\n${raw.slice(0, 500)}`
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
    if (!config.apiKey) {
      throw new Error("Anthropic requires an API key. Add one in Settings.");
    }

    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const model = config.model || DEFAULT_MODEL;
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;

    const prompt = buildCoverLetterPrompt(context, profile, voice, existingResume, feedback);

    const resp = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": API_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(
        `Anthropic error: ${resp.status} ${resp.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`
      );
    }

    const data = await resp.json();
    const raw: string = data.content?.[0]?.text ?? "";

    const content = parseResumeResponse(raw);
    if (!content) {
      throw new Error(
        `Failed to parse Anthropic cover letter response. Raw output:\n${raw.slice(0, 500)}`
      );
    }

    return { content, model };
  },

  async rawGenerate(prompt: string, config: ProviderConfig): Promise<string> {
    if (!config.apiKey) throw new Error("Anthropic requires an API key.");
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const model = config.model || DEFAULT_MODEL;
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;

    const resp = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": API_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Anthropic error: ${resp.status}${body ? ` — ${body.slice(0, 200)}` : ""}`);
    }

    const data = await resp.json();
    return data.content?.[0]?.text ?? "";
  },

  async isAvailable(config: ProviderConfig): Promise<boolean> {
    if (!config.apiKey) return false;
    try {
      const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
      // Use a minimal message to verify the key works
      const resp = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": API_VERSION,
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-20250414",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  },

  async listModels(_config: ProviderConfig): Promise<string[]> {
    return MODELS;
  },
};

registerProvider(anthropicProvider, {
  defaultModel: DEFAULT_MODEL,
  models: MODELS,
});

export { anthropicProvider };
