import { useState, useEffect } from "react";
import type { Profile, Voice } from "../../shared/types";
import { EMPTY_PROFILE, EMPTY_VOICE, DEFAULT_SETTINGS } from "../../shared/types";
import type { ProviderConfig, ProviderId, ProviderInfo } from "../../lib/llm/types";
import { getProfile, saveProfile, getSettings, saveSettings, migrateProfileStorage, getVoice, saveVoice, saveRawResume } from "../../shared/storage";
import { parseResume, resetIdCounter } from "../../shared/parser";
import { listProviders, getProvider } from "../../lib/llm";

type View = "import" | "view" | "edit";

/** All registered providers — computed once */
const PROVIDERS: ProviderInfo[] = listProviders();

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [view, setView] = useState<View>("import");
  const [resumeText, setResumeText] = useState("");
  const [editField, setEditField] = useState<keyof Profile | null>(null);
  const [editValue, setEditValue] = useState("");
  const [statelessMode, setStatelessMode] = useState(false);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>(
    DEFAULT_SETTINGS.providerConfig
  );
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [dynamicModels, setDynamicModels] = useState<string[]>([]);
  const [voice, setVoice] = useState<Voice>(EMPTY_VOICE);
  const [voiceExpanded, setVoiceExpanded] = useState(false);

  // Load profile + settings + voice on mount
  useEffect(() => {
    Promise.all([getProfile(), getSettings(), getVoice()]).then(([p, s, v]) => {
      setProfile(p);
      setStatelessMode(s.statelessMode);
      setProviderConfig(s.providerConfig);
      setVoice(v);
      if (v.corePitch) setVoiceExpanded(true);
      if (p.firstName || p.email) {
        setView("view");
      }
    });
  }, []);

  // Dynamically fetch models when provider changes
  useEffect(() => {
    let cancelled = false;
    async function fetchModels() {
      try {
        const provider = getProvider(providerConfig.id);
        const models = await provider.listModels(providerConfig);
        if (!cancelled && models.length > 0) {
          setDynamicModels(models);
          // If current model isn't in the list, switch to first available
          if (!models.includes(providerConfig.model)) {
            updateProviderConfig({ model: models[0] });
          }
        }
      } catch {
        // Provider may not support dynamic listing
        if (!cancelled) setDynamicModels([]);
      }
    }
    fetchModels();
    return () => { cancelled = true; };
  }, [providerConfig.id, providerConfig.baseUrl]);

  async function handleImport() {
    if (!resumeText.trim()) return;
    resetIdCounter();
    const parsed = parseResume(resumeText);
    setProfile(parsed);
    await saveProfile(parsed);
    // Store raw text so the LLM always has full context, even when the parser missed details
    await saveRawResume(resumeText.trim());
    setView("view");
  }

  async function handleEditSave() {
    if (!editField) return;
    const updated = { ...profile, [editField]: editValue };
    setProfile(updated);
    await saveProfile(updated);
    setEditField(null);
    setEditValue("");
  }

  function startEdit(field: keyof Profile) {
    const val = profile[field];
    if (typeof val === "string") {
      setEditField(field);
      setEditValue(val);
    }
  }

  async function handleClear() {
    setProfile(EMPTY_PROFILE);
    await saveProfile(EMPTY_PROFILE);
    setView("import");
    setResumeText("");
  }

  async function handleToggleStateless() {
    const newValue = !statelessMode;
    setStatelessMode(newValue);
    const settings = await getSettings();
    await saveSettings({ ...settings, statelessMode: newValue });
    await migrateProfileStorage(newValue);
  }

  // --- Voice handlers ---

  async function updateVoice(updates: Partial<Voice>) {
    const updated = { ...voice, ...updates };
    setVoice(updated);
    await saveVoice(updated);
  }

  // --- Provider settings handlers ---

  async function updateProviderConfig(updates: Partial<ProviderConfig>) {
    const updated = { ...providerConfig, ...updates };
    setProviderConfig(updated);
    setConnectionStatus("idle");
    const settings = await getSettings();
    await saveSettings({ ...settings, providerConfig: updated });
  }

  function handleProviderChange(id: ProviderId) {
    const info = PROVIDERS.find((p) => p.id === id);
    if (!info) return;
    updateProviderConfig({
      id,
      model: info.defaultModel,
      baseUrl: info.defaultBaseUrl,
      apiKey: id === providerConfig.id ? providerConfig.apiKey : undefined,
    });
  }

  async function handleTestConnection() {
    setConnectionStatus("testing");
    try {
      const provider = getProvider(providerConfig.id);
      const ok = await provider.isAvailable(providerConfig);
      setConnectionStatus(ok ? "ok" : "fail");
      // Refresh models on successful connection
      if (ok) {
        const models = await provider.listModels(providerConfig);
        if (models.length > 0) {
          setDynamicModels(models);
        }
      }
    } catch {
      setConnectionStatus("fail");
    }
  }

  const selectedProvider = PROVIDERS.find((p) => p.id === providerConfig.id);

  // --- Voice Settings Section ---
  const PRESET_TONES = ["direct", "warm", "technical", "enthusiastic"];
  const isCustomTone = voice.tone && !PRESET_TONES.includes(voice.tone);

  function renderVoiceSettings() {
    return (
      <div className="space-y-2">
        <button
          onClick={() => setVoiceExpanded(!voiceExpanded)}
          className="w-full flex items-center justify-between bg-surface-2 rounded-md px-3 py-2 hover:bg-surface-0 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/70">Voice</span>
            {voice.corePitch && (
              <span className="text-[9px] bg-aurora-teal/20 text-aurora-teal px-1.5 py-0.5 rounded-full">
                Set
              </span>
            )}
          </div>
          <span
            className={`text-[10px] text-white/30 transition-transform ${voiceExpanded ? "rotate-90" : ""}`}
          >
            ▸
          </span>
        </button>

        {voiceExpanded && (
          <div className="space-y-2 pl-1">
            {/* Core Pitch */}
            <div className="bg-surface-2 rounded-md px-3 py-2">
              <label className="text-[10px] text-white/30 uppercase tracking-wider">
                Core Pitch
              </label>
              <p className="text-[10px] text-white/20 mb-1">
                2-4 sentences: who you are, what you bring
              </p>
              <textarea
                value={voice.corePitch}
                onChange={(e) => updateVoice({ corePitch: e.target.value })}
                placeholder="I'm a full-stack engineer with 5 years building..."
                className="w-full bg-surface-0 rounded px-2 py-1.5 text-xs text-white/80 placeholder-white/20 resize-none h-16 focus:outline-none focus:ring-1 focus:ring-aurora-teal/50"
              />
            </div>

            {/* Top Strengths */}
            <div className="bg-surface-2 rounded-md px-3 py-2">
              <label className="text-[10px] text-white/30 uppercase tracking-wider">
                Top Strengths
              </label>
              <p className="text-[10px] text-white/20 mb-1">
                Comma-separated (e.g. system design, React, team leadership)
              </p>
              <input
                type="text"
                defaultValue={voice.topStrengths.join(", ")}
                onBlur={(e) =>
                  updateVoice({
                    topStrengths: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="system design, React, team leadership"
                className="w-full bg-surface-0 rounded px-2 py-1.5 text-xs text-white/80 placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-aurora-teal/50"
              />
            </div>

            {/* Target Roles */}
            <div className="bg-surface-2 rounded-md px-3 py-2">
              <label className="text-[10px] text-white/30 uppercase tracking-wider">
                Target Roles
              </label>
              <input
                type="text"
                defaultValue={voice.roleTargets.join(", ")}
                onBlur={(e) =>
                  updateVoice({
                    roleTargets: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="Senior Frontend Engineer, Staff Engineer"
                className="w-full mt-1 bg-surface-0 rounded px-2 py-1.5 text-xs text-white/80 placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-aurora-teal/50"
              />
            </div>

            {/* Constraints */}
            <div className="bg-surface-2 rounded-md px-3 py-2">
              <label className="text-[10px] text-white/30 uppercase tracking-wider">
                Constraints
              </label>
              <p className="text-[10px] text-white/20 mb-1">
                Remote preference, comp targets, work auth, etc.
              </p>
              <textarea
                value={voice.constraints}
                onChange={(e) => updateVoice({ constraints: e.target.value })}
                placeholder="Remote-first preferred, authorized to work in US..."
                className="w-full bg-surface-0 rounded px-2 py-1.5 text-xs text-white/80 placeholder-white/20 resize-none h-12 focus:outline-none focus:ring-1 focus:ring-aurora-teal/50"
              />
            </div>

            {/* Tone */}
            <div className="bg-surface-2 rounded-md px-3 py-2">
              <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1.5 block">
                Tone
              </label>
              <select
                value={isCustomTone ? "__other__" : voice.tone}
                onChange={(e) => {
                  if (e.target.value === "__other__") {
                    updateVoice({ tone: "" });
                  } else {
                    updateVoice({ tone: e.target.value });
                  }
                }}
                className="w-full bg-surface-0 rounded px-2 py-1.5 text-xs text-white/80 focus:outline-none focus:ring-1 focus:ring-aurora-teal/50 appearance-none cursor-pointer"
              >
                {PRESET_TONES.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
                <option value="__other__">Other</option>
              </select>
              {(isCustomTone || voice.tone === "") && (
                <input
                  type="text"
                  value={isCustomTone ? voice.tone : ""}
                  onChange={(e) => updateVoice({ tone: e.target.value })}
                  placeholder="e.g. peppy, smart, funny"
                  className="w-full mt-1.5 bg-surface-0 rounded px-2 py-1.5 text-xs text-white/80 placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-aurora-teal/50"
                />
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- Shared Provider Settings Section ---
  function renderProviderSettings() {
    return (
      <div className="space-y-2">
        <div className="bg-surface-2 rounded-md px-3 py-2">
          <label className="text-[10px] text-white/30 uppercase tracking-wider">
            Smart Apply Provider
          </label>

          {/* Provider selector */}
          <select
            value={providerConfig.id}
            onChange={(e) => handleProviderChange(e.target.value as ProviderId)}
            className="w-full mt-1 bg-surface-0 rounded px-2 py-1.5 text-xs text-white/80 focus:outline-none focus:ring-1 focus:ring-aurora-teal/50 appearance-none cursor-pointer"
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Model selector */}
        <div className="bg-surface-2 rounded-md px-3 py-2">
          <label className="text-[10px] text-white/30 uppercase tracking-wider">
            Model
          </label>
          <select
            value={providerConfig.model}
            onChange={(e) => updateProviderConfig({ model: e.target.value })}
            className="w-full mt-1 bg-surface-0 rounded px-2 py-1.5 text-xs text-white/80 focus:outline-none focus:ring-1 focus:ring-aurora-teal/50 appearance-none cursor-pointer"
          >
            {(dynamicModels.length > 0 ? dynamicModels : selectedProvider?.models ?? []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {dynamicModels.length > 0 && (
            <p className="text-[9px] text-white/20 mt-1">
              {dynamicModels.length} model{dynamicModels.length !== 1 ? "s" : ""} available
            </p>
          )}
        </div>

        {/* API Key (cloud providers only) */}
        {selectedProvider?.requiresApiKey && (
          <div className="bg-surface-2 rounded-md px-3 py-2">
            <label className="text-[10px] text-white/30 uppercase tracking-wider">
              API Key
            </label>
            <input
              type="password"
              value={providerConfig.apiKey ?? ""}
              onChange={(e) => updateProviderConfig({ apiKey: e.target.value })}
              placeholder={`Enter ${selectedProvider.name} API key`}
              className="w-full mt-1 bg-surface-0 rounded px-2 py-1.5 text-xs text-white/80 placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-aurora-teal/50"
            />
            {statelessMode && (
              <p className="text-[9px] text-aurora-teal/60 mt-1">
                Key is session-only (clears on browser restart)
              </p>
            )}
          </div>
        )}

        {/* Base URL (Ollama only) */}
        {providerConfig.id === "ollama" && (
          <div className="bg-surface-2 rounded-md px-3 py-2">
            <label className="text-[10px] text-white/30 uppercase tracking-wider">
              Ollama URL
            </label>
            <input
              type="text"
              value={providerConfig.baseUrl ?? "http://localhost:11434"}
              onChange={(e) => updateProviderConfig({ baseUrl: e.target.value })}
              placeholder="http://localhost:11434"
              className="w-full mt-1 bg-surface-0 rounded px-2 py-1.5 text-xs text-white/80 placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-aurora-teal/50"
            />
          </div>
        )}

        {/* Test Connection */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleTestConnection}
            disabled={connectionStatus === "testing"}
            className="px-3 py-1.5 bg-surface-2 hover:bg-surface-0 disabled:opacity-50 rounded text-xs text-white/60 hover:text-white/80 transition-colors"
          >
            {connectionStatus === "testing" ? "Testing..." : "Test Connection"}
          </button>
          {connectionStatus === "ok" && (
            <span className="text-xs text-aurora-green">Connected</span>
          )}
          {connectionStatus === "fail" && (
            <span className="text-xs text-aurora-pink">
              {selectedProvider?.requiresApiKey && !providerConfig.apiKey
                ? "No API key"
                : "Connection failed"}
            </span>
          )}
        </div>
      </div>
    );
  }

  // --- Import View ---
  if (view === "import") {
    return (
      <div className="p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white/80 mb-1">
            Import Your Resume
          </h2>
          <p className="text-xs text-white/40">
            Paste your resume text below. We'll extract your info instantly —
            no AI, no network calls.
          </p>
        </div>

        <textarea
          value={resumeText}
          onChange={(e) => setResumeText(e.target.value)}
          placeholder="Paste your resume text here..."
          className="w-full h-48 bg-surface-2 border border-white/10 rounded-lg p-3 text-xs text-white/80 placeholder-white/20 resize-none focus:outline-none focus:border-aurora-teal/50"
        />

        <button
          onClick={handleImport}
          disabled={!resumeText.trim()}
          className="w-full py-3 bg-midnight-600 hover:bg-midnight-500 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg font-medium text-sm transition-colors"
        >
          {statelessMode ? "Parse (Session Only)" : "Parse & Save Profile"}
        </button>

        {/* Voice settings */}
        {renderVoiceSettings()}

        {/* Provider settings */}
        {renderProviderSettings()}
      </div>
    );
  }

  // --- Profile View ---
  const fields: { label: string; key: keyof Profile; multiline?: boolean }[] = [
    { label: "First Name", key: "firstName" },
    { label: "Last Name", key: "lastName" },
    { label: "Email", key: "email" },
    { label: "Phone", key: "phone" },
    { label: "Location", key: "location" },
    { label: "LinkedIn", key: "linkedinUrl" },
    { label: "GitHub", key: "githubUrl" },
    { label: "Portfolio", key: "portfolioUrl" },
    { label: "Summary", key: "summary", multiline: true },
  ];

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white/80">Your Profile</h2>
          {statelessMode && (
            <span className="text-[9px] bg-aurora-teal/20 text-aurora-teal px-1.5 py-0.5 rounded-full">
              SESSION
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setView("import")}
            className="text-xs text-white/40 hover:text-white/70"
          >
            Re-import
          </button>
          <button
            onClick={handleClear}
            className="text-xs text-aurora-pink/60 hover:text-aurora-pink"
          >
            Clear
          </button>
        </div>
      </div>


      {/* Stateless mode toggle */}
      <div className="flex items-center justify-between bg-surface-2 rounded-md px-3 py-2">
        <div>
          <p className="text-xs text-white/70">Stateless Mode</p>
          <p className="text-[10px] text-white/30">
            {statelessMode
              ? "Profile clears when browser restarts"
              : "Profile is saved permanently"}
          </p>
        </div>
        <button
          onClick={handleToggleStateless}
          className={`relative w-9 h-5 rounded-full transition-colors ${statelessMode ? "bg-aurora-teal" : "bg-white/10"
            }`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${statelessMode ? "translate-x-4" : "translate-x-0.5"
              }`}
          />
        </button>
      </div>
      {/* Editable fields — auto-save on blur or Enter */}
      <div className="space-y-2">
        {fields.map(({ label, key, multiline }) => {
          const val = profile[key];
          const displayVal = typeof val === "string" ? val : "";
          const isEditing = editField === key;

          return (
            <div key={key} className="bg-surface-2 rounded-md px-3 py-2">
              <label className="text-[10px] text-white/30 uppercase tracking-wider">
                {label}
              </label>
              {isEditing ? (
                <div className="mt-1">
                  {multiline ? (
                    <textarea
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={handleEditSave}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") { setEditField(null); }
                      }}
                      className="w-full bg-surface-0 rounded px-2 py-1 text-xs text-white/80 resize-none h-16 focus:outline-none focus:ring-1 focus:ring-aurora-teal/50"
                      autoFocus
                    />
                  ) : (
                    <input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={handleEditSave}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleEditSave();
                        if (e.key === "Escape") setEditField(null);
                      }}
                      className="w-full bg-surface-0 rounded px-2 py-1 text-xs text-white/80 focus:outline-none focus:ring-1 focus:ring-aurora-teal/50"
                      autoFocus
                    />
                  )}
                </div>
              ) : (
                <p
                  onClick={() => startEdit(key)}
                  className={`text-xs mt-0.5 cursor-pointer hover:text-aurora-teal transition-colors ${displayVal ? "text-white/70" : "text-white/20 italic"
                    }`}
                >
                  {displayVal || "Click to edit"}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Skills */}
      {profile.skills.length > 0 && (
        <div className="bg-surface-2 rounded-md px-3 py-2">
          <label className="text-[10px] text-white/30 uppercase tracking-wider">
            Skills
          </label>
          <div className="flex flex-wrap gap-1 mt-1">
            {profile.skills.map((skill, i) => (
              <span
                key={i}
                className="text-[10px] bg-midnight-700/50 text-midnight-300 px-2 py-0.5 rounded-full"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Experience count */}
      {profile.experiences.length > 0 && (
        <div className="bg-surface-2 rounded-md px-3 py-2">
          <label className="text-[10px] text-white/30 uppercase tracking-wider">
            Experience
          </label>
          <p className="text-xs text-white/50 mt-0.5">
            {profile.experiences.length} entries ·{" "}
            {profile.experiences[0]?.title} at {profile.experiences[0]?.company}
          </p>
        </div>
      )}

      {/* Education count */}
      {profile.education.length > 0 && (
        <div className="bg-surface-2 rounded-md px-3 py-2">
          <label className="text-[10px] text-white/30 uppercase tracking-wider">
            Education
          </label>
          <p className="text-xs text-white/50 mt-0.5">
            {profile.education.length} entries · {profile.education[0]?.school}
          </p>
        </div>
      )}

      {/* Voice settings */}
      {renderVoiceSettings()}

      {/* Provider settings */}
      {renderProviderSettings()}
    </div>
  );
}
