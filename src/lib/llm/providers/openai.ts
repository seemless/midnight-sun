// ============================================================
// OpenAI Provider — GPT models via OpenAI API
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

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com";
const DEFAULT_TIMEOUT = 180_000;

const MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1-nano"];

const openaiProvider: SmartApplyProvider = {
  id: "openai",
  name: "OpenAI",
  requiresApiKey: true,

  async generateApplication(
    context: JobContext,
    profile: Profile,
    config: ProviderConfig,
    voice?: Voice,
    existingResume?: string
  ): Promise<SmartApplyResult> {
    if (!config.apiKey) {
      throw new Error("OpenAI requires an API key. Add one in Settings.");
    }

    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const model = config.model || DEFAULT_MODEL;
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;

    const prompt = buildApplicationPrompt(context, profile, voice, existingResume);
    const start = performance.now();

    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      if (resp.status === 401) {
        throw new Error("OpenAI error: 401 Unauthorized \u2014 check your API key");
      }
      if (resp.status === 429) {
        throw new Error("OpenAI error: 429 Too Many Requests \u2014 rate limited");
      }
      throw new Error(
        `OpenAI error: ${resp.status} ${resp.statusText}${body ? ` \u2014 ${body.slice(0, 200)}` : ""}`
      );
    }

    const data = await resp.json();
    const raw: string = data.choices?.[0]?.message?.content ?? "";
    const durationMs = Math.round(performance.now() - start);

    const parsed = parseSmartResponse(raw);
    if (!parsed) {
      throw new Error(
        `Failed to parse OpenAI response. Raw output:\n${raw.slice(0, 500)}`
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
      throw new Error("OpenAI requires an API key. Add one in Settings.");
    }

    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const model = config.model || DEFAULT_MODEL;
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;

    const prompt = buildResumePrompt(context, profile, voice, existingResume, feedback);

    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(
        `OpenAI error: ${resp.status} ${resp.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`
      );
    }

    const data = await resp.json();
    const raw: string = data.choices?.[0]?.message?.content ?? "";

    const content = parseResumeResponse(raw);
    if (!content) {
      throw new Error(
        `Failed to parse OpenAI resume response. Raw output:\n${raw.slice(0, 500)}`
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
      throw new Error("OpenAI requires an API key. Add one in Settings.");
    }

    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const model = config.model || DEFAULT_MODEL;
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;

    const prompt = buildCoverLetterPrompt(context, profile, voice, existingResume, feedback);

    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(
        `OpenAI error: ${resp.status} ${resp.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`
      );
    }

    const data = await resp.json();
    const raw: string = data.choices?.[0]?.message?.content ?? "";

    const content = parseResumeResponse(raw);
    if (!content) {
      throw new Error(
        `Failed to parse OpenAI cover letter response. Raw output:\n${raw.slice(0, 500)}`
      );
    }

    return { content, model };
  },

  async rawGenerate(prompt: string, config: ProviderConfig): Promise<string> {
    if (!config.apiKey) throw new Error("OpenAI requires an API key.");
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const model = config.model || DEFAULT_MODEL;
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;

    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`OpenAI error: ${resp.status}${body ? ` — ${body.slice(0, 200)}` : ""}`);
    }

    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? "";
  },

  async isAvailable(config: ProviderConfig): Promise<boolean> {
    if (!config.apiKey) return false;
    try {
      const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
      const resp = await fetch(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(5000),
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

registerProvider(openaiProvider, {
  defaultModel: DEFAULT_MODEL,
  models: MODELS,
});

export { openaiProvider };
