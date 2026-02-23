// ============================================================
// Provider Registry
// Central lookup for all registered Smart Apply providers.
// ============================================================

import type { ProviderId, SmartApplyProvider, ProviderInfo } from "./types";

const providers = new Map<ProviderId, SmartApplyProvider>();

/** Maps provider ID → default model + static model list for UI */
const providerMeta = new Map<
  ProviderId,
  { defaultModel: string; models: string[]; defaultBaseUrl?: string }
>();

/**
 * Register a provider. Called at module load time by each provider file.
 */
export function registerProvider(
  provider: SmartApplyProvider,
  meta: {
    defaultModel: string;
    models: string[];
    defaultBaseUrl?: string;
  }
): void {
  providers.set(provider.id, provider);
  providerMeta.set(provider.id, meta);
}

/**
 * Get a provider by ID. Throws if not registered.
 */
export function getProvider(id: ProviderId): SmartApplyProvider {
  const provider = providers.get(id);
  if (!provider) {
    throw new Error(
      `Unknown provider: "${id}". Available: ${[...providers.keys()].join(", ")}`
    );
  }
  return provider;
}

/**
 * List all registered providers with metadata for UI display.
 */
export function listProviders(): ProviderInfo[] {
  return [...providers.entries()].map(([id, provider]) => {
    const meta = providerMeta.get(id)!;
    return {
      id,
      name: provider.name,
      requiresApiKey: provider.requiresApiKey,
      defaultModel: meta.defaultModel,
      models: meta.models,
      defaultBaseUrl: meta.defaultBaseUrl,
    };
  });
}
