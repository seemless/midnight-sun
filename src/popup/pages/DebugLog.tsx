import { useState, useEffect } from "react";
import type { FillRun, SmartApplyRun, GenerationRun, Profile } from "../../shared/types";
import { getFillRuns, getSmartApplyRuns, getGenerationRuns, getProfile } from "../../shared/storage";

// ============================================================
// Debug Log — View, copy, and export fill/smart apply/generation runs
// ============================================================

export default function DebugLog() {
  const [fillRuns, setFillRuns] = useState<FillRun[]>([]);
  const [smartRuns, setSmartRuns] = useState<SmartApplyRun[]>([]);
  const [genRuns, setGenRuns] = useState<GenerationRun[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  useEffect(() => {
    loadRuns();
  }, []);

  async function loadRuns() {
    const [fills, smarts, gens] = await Promise.all([
      getFillRuns(),
      getSmartApplyRuns(),
      getGenerationRuns(),
    ]);
    setFillRuns(fills.slice(0, 10));
    setSmartRuns(smarts.slice(0, 5));
    setGenRuns(gens.slice(0, 10));
  }

  // --- Copy / Export helpers ---

  function showFeedback(msg: string) {
    setCopyFeedback(msg);
    setTimeout(() => setCopyFeedback(null), 2000);
  }

  async function copyToClipboard(data: unknown, label: string) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      showFeedback(`Copied ${label}`);
    } catch {
      showFeedback("Copy failed");
    }
  }

  async function buildDebugBundle() {
    let profile: Partial<Profile> = {};
    try {
      const p = await getProfile();
      // Sanitize: only include field presence, not actual PII
      profile = {
        firstName: p.firstName ? "[set]" : "",
        lastName: p.lastName ? "[set]" : "",
        email: p.email ? "[set]" : "",
        phone: p.phone ? "[set]" : "",
        location: p.location || "",
        linkedinUrl: p.linkedinUrl ? "[set]" : "",
        githubUrl: p.githubUrl ? "[set]" : "",
        portfolioUrl: p.portfolioUrl ? "[set]" : "",
        summary: p.summary ? `[${p.summary.length} chars]` : "",
      };
    } catch {
      // No profile
    }

    return {
      version: "0.1.0",
      exportedAt: new Date().toISOString(),
      fillRuns,
      smartApplyRuns: smartRuns,
      generationRuns: genRuns,
      profileSummary: profile,
    };
  }

  async function handleCopyAll() {
    const bundle = await buildDebugBundle();
    await copyToClipboard(bundle, "debug bundle");
  }

  async function handleExport() {
    const bundle = await buildDebugBundle();
    const json = JSON.stringify(bundle, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `midnight-sun-debug-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showFeedback("Exported");
  }

  function toggleExpand(id: string) {
    setExpandedId(expandedId === id ? null : id);
  }

  // --- Time formatting ---

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  // --- Render ---

  const hasAnyRuns = fillRuns.length > 0 || smartRuns.length > 0 || genRuns.length > 0;

  return (
    <div className="p-4 space-y-4">
      {/* Header actions */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white/60">Debug Logs</h2>
        <div className="flex gap-2">
          <button
            onClick={handleCopyAll}
            disabled={!hasAnyRuns}
            className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/20 text-white/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Copy All
          </button>
          <button
            onClick={handleExport}
            disabled={!hasAnyRuns}
            className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/20 text-white/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Export .json
          </button>
        </div>
      </div>

      {/* Feedback toast */}
      {copyFeedback && (
        <div className="text-xs text-center text-aurora-teal bg-aurora-teal/10 rounded py-1">
          {copyFeedback}
        </div>
      )}

      {!hasAnyRuns && (
        <p className="text-xs text-white/30 text-center py-8">
          No fill, smart apply, or generation runs yet. Scan a page to get started.
        </p>
      )}

      {/* Generation Runs */}
      {genRuns.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-white/40 mb-2 uppercase tracking-wider">
            Generation Runs ({genRuns.length})
          </h3>
          <div className="space-y-2">
            {genRuns.map((run) => (
              <GenRunCard
                key={run.id}
                run={run}
                expanded={expandedId === run.id}
                onToggle={() => toggleExpand(run.id)}
                onCopy={() => copyToClipboard(run, "generation run")}
                timeAgo={timeAgo}
              />
            ))}
          </div>
        </section>
      )}

      {/* Fill Runs */}
      {fillRuns.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-white/40 mb-2 uppercase tracking-wider">
            Fill Runs ({fillRuns.length})
          </h3>
          <div className="space-y-2">
            {fillRuns.map((run) => (
              <FillRunCard
                key={run.id}
                run={run}
                expanded={expandedId === run.id}
                onToggle={() => toggleExpand(run.id)}
                onCopy={() => copyToClipboard(run, "fill run")}
                timeAgo={timeAgo}
              />
            ))}
          </div>
        </section>
      )}

      {/* Smart Apply Runs */}
      {smartRuns.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-white/40 mb-2 uppercase tracking-wider">
            Smart Apply Runs ({smartRuns.length})
          </h3>
          <div className="space-y-2">
            {smartRuns.map((run) => (
              <SmartRunCard
                key={run.id}
                run={run}
                expanded={expandedId === run.id}
                onToggle={() => toggleExpand(run.id)}
                onCopy={() => copyToClipboard(run, "smart run")}
                timeAgo={timeAgo}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// --- GenerationRun Card ---

function GenRunCard({
  run,
  expanded,
  onToggle,
  onCopy,
  timeAgo,
}: {
  run: GenerationRun;
  expanded: boolean;
  onToggle: () => void;
  onCopy: () => void;
  timeAgo: (iso: string) => string;
}) {
  const isError = Boolean(run.error);
  const typeLabel = run.docType === "cover-letter" ? "CL" : "Resume";

  return (
    <div className="rounded bg-surface-2 border border-white/5">
      <button
        onClick={onToggle}
        className="w-full text-left px-3 py-2 flex items-center justify-between"
      >
        <div className="min-w-0">
          <div className="text-xs font-medium text-white/80 truncate flex items-center gap-1.5">
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
              run.docType === "cover-letter"
                ? "bg-aurora-teal/20 text-aurora-teal"
                : "bg-aurora-purple/20 text-aurora-purple"
            }`}>
              {typeLabel}
            </span>
            {run.company || "Unknown"} — {run.role || "Unknown role"}
          </div>
          <div className="text-[10px] text-white/30 mt-0.5 flex gap-2">
            <span>{timeAgo(run.timestamp)}</span>
            {run.model && <span>{run.model}</span>}
            <span>{Math.round(run.durationMs / 1000)}s</span>
            {isError ? (
              <span className="text-red-400">Error</span>
            ) : (
              <span className="text-aurora-green">{(run.contentLength / 1000).toFixed(1)}k chars</span>
            )}
            <span className="text-white/20">{run.source}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
            className="px-1.5 py-0.5 text-[10px] rounded bg-white/5 hover:bg-white/15 text-white/50 transition-colors"
          >
            Copy
          </button>
          <span className="text-white/30 text-xs">{expanded ? "\u25be" : "\u25b8"}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-white/5">
          <div className="flex gap-3 mt-2 text-[10px] text-white/50">
            <span>Duration: <span className="text-aurora-teal">{(run.durationMs / 1000).toFixed(1)}s</span></span>
            <span>Output: <span className="text-white/60">{run.contentLength} chars</span></span>
            {run.model && <span>Model: <span className="text-white/60">{run.model}</span></span>}
          </div>
          <div className="mt-1 text-[10px] text-white/40">
            Source: {run.source} · URL: {run.url.slice(0, 80)}{run.url.length > 80 ? "..." : ""}
          </div>
          {run.error && (
            <div className="mt-1.5 text-[10px] text-red-400 bg-red-400/10 rounded p-1.5">
              {run.error}
            </div>
          )}

          {/* Full JSON toggle */}
          <details className="mt-2">
            <summary className="text-[10px] text-white/30 cursor-pointer hover:text-white/50">
              View full JSON
            </summary>
            <pre className="mt-1 text-[9px] text-white/40 bg-black/30 rounded p-2 overflow-auto max-h-60 whitespace-pre-wrap break-all">
              {JSON.stringify(run, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

// --- FillRun Card ---

function FillRunCard({
  run,
  expanded,
  onToggle,
  onCopy,
  timeAgo,
}: {
  run: FillRun;
  expanded: boolean;
  onToggle: () => void;
  onCopy: () => void;
  timeAgo: (iso: string) => string;
}) {
  const hostname = run.pageMeta?.hostname ?? new URL(run.url).hostname;

  return (
    <div className="rounded bg-surface-2 border border-white/5">
      <button
        onClick={onToggle}
        className="w-full text-left px-3 py-2 flex items-center justify-between"
      >
        <div className="min-w-0">
          <div className="text-xs font-medium text-white/80 truncate">
            {hostname}
          </div>
          <div className="text-[10px] text-white/30 mt-0.5 flex gap-2">
            <span>{timeAgo(run.timestamp)}</span>
            <span>
              {run.stats.filled}/{run.stats.totalFields} filled
            </span>
            {run.stats.failed > 0 && (
              <span className="text-red-400">{run.stats.failed} failed</span>
            )}
            {run.stats.manualRequired > 0 && (
              <span className="text-amber-400">
                {run.stats.manualRequired} manual
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
            className="px-1.5 py-0.5 text-[10px] rounded bg-white/5 hover:bg-white/15 text-white/50 transition-colors"
          >
            Copy
          </button>
          <span className="text-white/30 text-xs">{expanded ? "\u25be" : "\u25b8"}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-white/5">
          {/* Stats summary */}
          <div className="flex gap-3 mt-2 text-[10px] text-white/50">
            <span>
              Matched: <span className="text-aurora-teal">{run.stats.matched}</span>
            </span>
            <span>
              Filled: <span className="text-green-400">{run.stats.filled}</span>
            </span>
            <span>
              Skipped: <span className="text-white/30">{run.stats.skipped}</span>
            </span>
            <span>{run.totalDurationMs}ms</span>
          </div>

          {/* Failure reason breakdown */}
          {Object.keys(run.stats.reasonBreakdown).length > 0 && (
            <div className="mt-1.5 text-[10px] text-white/40">
              Reasons:{" "}
              {Object.entries(run.stats.reasonBreakdown)
                .map(([reason, count]) => `${reason}: ${count}`)
                .join(", ")}
            </div>
          )}

          {/* Per-field results */}
          <div className="mt-2 space-y-1">
            {run.fillResults.map((result, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-[10px] text-white/50"
              >
                <span className={result.success ? "text-green-400" : result.manualRequired ? "text-amber-400" : "text-red-400"}>
                  {result.success ? "\u2713" : result.manualRequired ? "\u26a0" : "\u2717"}
                </span>
                <span className="text-white/60 font-mono truncate">
                  {result.matchedField ?? "\u2014"}
                </span>
                {result.reason && (
                  <span className="text-white/30">{result.reason}</span>
                )}
              </div>
            ))}
          </div>

          {/* Full JSON toggle */}
          <details className="mt-2">
            <summary className="text-[10px] text-white/30 cursor-pointer hover:text-white/50">
              View full JSON
            </summary>
            <pre className="mt-1 text-[9px] text-white/40 bg-black/30 rounded p-2 overflow-auto max-h-60 whitespace-pre-wrap break-all">
              {JSON.stringify(run, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

// --- SmartApplyRun Card ---

function SmartRunCard({
  run,
  expanded,
  onToggle,
  onCopy,
  timeAgo,
}: {
  run: SmartApplyRun;
  expanded: boolean;
  onToggle: () => void;
  onCopy: () => void;
  timeAgo: (iso: string) => string;
}) {
  return (
    <div className="rounded bg-surface-2 border border-white/5">
      <button
        onClick={onToggle}
        className="w-full text-left px-3 py-2 flex items-center justify-between"
      >
        <div className="min-w-0">
          <div className="text-xs font-medium text-white/80 truncate">
            {run.company || "Unknown"} — {run.role || "Unknown role"}
          </div>
          <div className="text-[10px] text-white/30 mt-0.5 flex gap-2">
            <span>{timeAgo(run.timestamp)}</span>
            {run.result && (
              <>
                <span>{run.result.model}</span>
                <span>{run.result.durationMs}ms</span>
                <span>{run.result.answers.length} answers</span>
              </>
            )}
            {run.error && <span className="text-red-400">Error</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
            className="px-1.5 py-0.5 text-[10px] rounded bg-white/5 hover:bg-white/15 text-white/50 transition-colors"
          >
            Copy
          </button>
          <span className="text-white/30 text-xs">{expanded ? "\u25be" : "\u25b8"}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-white/5">
          {run.error && (
            <div className="mt-2 text-[10px] text-red-400">{run.error}</div>
          )}

          {run.result && (
            <div className="mt-2 space-y-1.5 text-[10px]">
              <div className="text-white/50">
                <span className="text-white/30">Summary: </span>
                {run.result.summary.slice(0, 100)}
                {run.result.summary.length > 100 ? "..." : ""}
              </div>
              <div className="text-white/50">
                <span className="text-white/30">Why company: </span>
                {run.result.whyCompany.slice(0, 100)}
                {run.result.whyCompany.length > 100 ? "..." : ""}
              </div>
              {run.result.answers.map((a, i) => (
                <div key={i} className="text-white/40">
                  <span className="text-white/30">{a.label}: </span>
                  {a.answer.slice(0, 80)}
                  {a.answer.length > 80 ? "..." : ""}
                </div>
              ))}
            </div>
          )}

          {/* Fill outcomes if present */}
          {run.fillOutcomes && run.fillOutcomes.length > 0 && (
            <div className="mt-2 space-y-0.5">
              <div className="text-[10px] text-white/30 font-medium">
                Fill outcomes:
              </div>
              {run.fillOutcomes.map((o, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-[10px] text-white/50"
                >
                  <span className={o.filled ? "text-green-400" : "text-red-400"}>
                    {o.filled ? "\u2713" : "\u2717"}
                  </span>
                  <span className="truncate">{o.label}</span>
                  {o.repairUsed && (
                    <span className="text-amber-400">(repaired)</span>
                  )}
                  {o.failureReason && (
                    <span className="text-white/30">{o.failureReason}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Full JSON toggle */}
          <details className="mt-2">
            <summary className="text-[10px] text-white/30 cursor-pointer hover:text-white/50">
              View full JSON
            </summary>
            <pre className="mt-1 text-[9px] text-white/40 bg-black/30 rounded p-2 overflow-auto max-h-60 whitespace-pre-wrap break-all">
              {JSON.stringify(run, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
