// ============================================================
// Gemini Provider — Google Gemini models via Generative AI API
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

const DEFAULT_MODEL = "gemini-2.0-flash";
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_TIMEOUT = 180_000;

const MODELS = ["gemini-2.0-flash", "gemini-2.5-flash-preview-05-20"];

const geminiProvider: SmartApplyProvider = {
  id: "gemini",
  name: "Google Gemini",
  requiresApiKey: true,

  async generateApplication(
    context: JobContext,
    profile: Profile,
    config: ProviderConfig,
    voice?: Voice,
    existingResume?: string
  ): Promise<SmartApplyResult> {
    if (!config.apiKey) {
      throw new Error("Gemini requires an API key. Add one in Settings.");
    }

    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const model = config.model || DEFAULT_MODEL;
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;

    const prompt = buildApplicationPrompt(context, profile, voice, existingResume);
    const start = performance.now();

    const resp = await fetch(
      `${baseUrl}/v1beta/models/${model}:generateContent?key=${config.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.7,
          },
        }),
        signal: AbortSignal.timeout(timeout),
      }
    );

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      if (resp.status === 400 && body.includes("API_KEY_INVALID")) {
        throw new Error("Gemini error: Invalid API key \u2014 check your API key");
      }
      if (resp.status === 429) {
        throw new Error("Gemini error: 429 Too Many Requests \u2014 rate limited");
      }
      throw new Error(
        `Gemini error: ${resp.status} ${resp.statusText}${body ? ` \u2014 ${body.slice(0, 200)}` : ""}`
      );
    }

    const data = await resp.json();
    const raw: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const durationMs = Math.round(performance.now() - start);

    const parsed = parseSmartResponse(raw);
    if (!parsed) {
      throw new Error(
        `Failed to parse Gemini response. Raw output:\n${raw.slice(0, 500)}`
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
      throw new Error("Gemini requires an API key. Add one in Settings.");
    }

    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const model = config.model || DEFAULT_MODEL;
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;

    const prompt = buildResumePrompt(context, profile, voice, existingResume, feedback);

    const resp = await fetch(
      `${baseUrl}/v1beta/models/${model}:generateContent?key=${config.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
          },
        }),
        signal: AbortSignal.timeout(timeout),
      }
    );

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(
        `Gemini error: ${resp.status} ${resp.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`
      );
    }

    const data = await resp.json();
    const raw: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    const content = parseResumeResponse(raw);
    if (!content) {
      throw new Error(
        `Failed to parse Gemini resume response. Raw output:\n${raw.slice(0, 500)}`
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
      throw new Error("Gemini requires an API key. Add one in Settings.");
    }

    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const model = config.model || DEFAULT_MODEL;
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;

    const prompt = buildCoverLetterPrompt(context, profile, voice, existingResume, feedback);

    const resp = await fetch(
      `${baseUrl}/v1beta/models/${model}:generateContent?key=${config.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
          },
        }),
        signal: AbortSignal.timeout(timeout),
      }
    );

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(
        `Gemini error: ${resp.status} ${resp.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`
      );
    }

    const data = await resp.json();
    const raw: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    const content = parseResumeResponse(raw);
    if (!content) {
      throw new Error(
        `Failed to parse Gemini cover letter response. Raw output:\n${raw.slice(0, 500)}`
      );
    }

    return { content, model };
  },

  async rawGenerate(prompt: string, config: ProviderConfig): Promise<string> {
    if (!config.apiKey) throw new Error("Gemini requires an API key.");
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const model = config.model || DEFAULT_MODEL;
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;

    const resp = await fetch(
      `${baseUrl}/v1beta/models/${model}:generateContent?key=${config.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7 },
        }),
        signal: AbortSignal.timeout(timeout),
      }
    );

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Gemini error: ${resp.status}${body ? ` — ${body.slice(0, 200)}` : ""}`);
    }

    const data = await resp.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  },

  async isAvailable(config: ProviderConfig): Promise<boolean> {
    if (!config.apiKey) return false;
    try {
      const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
      const resp = await fetch(
        `${baseUrl}/v1beta/models?key=${config.apiKey}`,
        { signal: AbortSignal.timeout(5000) }
      );
      return resp.ok;
    } catch {
      return false;
    }
  },

  async listModels(_config: ProviderConfig): Promise<string[]> {
    return MODELS;
  },
};

registerProvider(geminiProvider, {
  defaultModel: DEFAULT_MODEL,
  models: MODELS,
});

export { geminiProvider };
