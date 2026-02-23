import { useState, useEffect, useRef, useCallback } from "react";
import type { ResumeDoc, JobContext, GapQuestion } from "../../shared/types";
import { listResumes, saveResume, deleteResume } from "../../shared/resumeStore";
import { getProfile, saveProfile, getSettings, getVoice, getRawResume, getResumeDraft, saveResumeDraft, clearResumeDraft, saveGenerationRun } from "../../shared/storage";
import type { ResumeDraft } from "../../shared/storage";
import { sendToActiveTab, sendToBackground } from "../../shared/messages";
import { hasProfileGaps } from "../../lib/llm/prompt";

type View =
  | { mode: "list" }
  | { mode: "edit"; doc: ResumeDoc }
  | { mode: "create" }
  | { mode: "draft"; draft: ResumeDraft };

export default function ResumesPage() {
  const [resumes, setResumes] = useState<ResumeDoc[]>([]);
  const [view, setView] = useState<View>({ mode: "list" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadResumes();
    // Check for an in-progress draft from a previous popup session
    getResumeDraft().then((draft) => {
      if (draft && (draft.content.trim() || draft.name.trim())) {
        setView({ mode: "draft", draft });
      }
    });
  }, []);

  async function loadResumes() {
    setLoading(true);
    const docs = await listResumes();
    setResumes(docs);
    setLoading(false);
  }

  async function handleDelete(resumeId: string) {
    await deleteResume(resumeId);
    await loadResumes();
  }

  function handleNew() {
    setView({ mode: "create" });
  }

  function handleEdit(doc: ResumeDoc) {
    setView({ mode: "edit", doc });
  }

  async function handleSaved() {
    await clearResumeDraft();
    await loadResumes();
    setView({ mode: "list" });
  }

  async function handleCancel() {
    await clearResumeDraft();
    setView({ mode: "list" });
  }

  if (view.mode === "edit" || view.mode === "create" || view.mode === "draft") {
    const existing = view.mode === "edit" ? view.doc : undefined;
    const draft = view.mode === "draft" ? view.draft : undefined;
    return (
      <ResumeEditor
        existing={existing}
        draft={draft}
        onSave={handleSaved}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white/80">Resume Library</h2>
        <button
          onClick={handleNew}
          className="text-xs px-3 py-1.5 bg-aurora-purple/30 hover:bg-aurora-purple/50 text-aurora-purple rounded-lg transition-colors"
        >
          + New
        </button>
      </div>

      {loading && (
        <p className="text-xs text-white/40 text-center py-6">Loading...</p>
      )}

      {!loading && resumes.length === 0 && (
        <div className="text-center py-8">
          <p className="text-white/40 text-sm mb-2">No resumes yet</p>
          <p className="text-white/25 text-xs">
            Create a resume manually or generate one tailored to a job posting.
          </p>
        </div>
      )}

      {!loading && resumes.length > 0 && (
        <div className="space-y-2">
          {resumes.map((doc) => (
            <div
              key={doc.resumeId}
              className="bg-surface-2 rounded-lg p-3 border border-white/5"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white/90 font-medium truncate">
                    {doc.name || "Untitled Resume"}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      doc.docType === "cover-letter"
                        ? "bg-aurora-teal/20 text-aurora-teal"
                        : "bg-aurora-purple/20 text-aurora-purple"
                    }`}>
                      {doc.docType === "cover-letter" ? "cover letter" : "resume"}
                    </span>
                    <span className="text-[10px] text-white/30 capitalize">
                      {doc.source}
                    </span>
                    <span className="text-[10px] text-white/20">
                      {formatDate(doc.updatedAt)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={() => handleEdit(doc)}
                    className="text-white/30 hover:text-white/70 p-1 text-sm"
                    title="Edit"
                  >
                    &#9998;
                  </button>
                  <button
                    onClick={() => handleDownload(doc)}
                    className="text-white/30 hover:text-white/70 p-1 text-sm"
                    title="Download"
                  >
                    &#8615;
                  </button>
                  <button
                    onClick={() => handleDelete(doc.resumeId)}
                    className="text-white/30 hover:text-aurora-pink/70 p-1 text-sm"
                    title="Delete"
                  >
                    &#10005;
                  </button>
                </div>
              </div>
              {/* Preview first line */}
              <p className="text-[10px] text-white/20 mt-1.5 truncate">
                {doc.content.split("\n").find((l) => l.trim() && !l.startsWith("#")) || ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Resume Editor ---

function ResumeEditor({
  existing,
  draft,
  onSave,
  onCancel,
}: {
  existing?: ResumeDoc;
  draft?: ResumeDraft;
  onSave: () => void;
  onCancel: () => void;
}) {
  // Restore from draft if available, otherwise use existing doc or defaults
  const [name, setName] = useState(draft?.name ?? existing?.name ?? "");
  const [content, setContent] = useState(draft?.content ?? existing?.content ?? "");
  const [docType, setDocType] = useState<"resume" | "cover-letter">(draft?.docType ?? existing?.docType ?? "resume");
  const [showPreview, setShowPreview] = useState(false);
  const [generating, setGenerating] = useState<false | "resume" | "cover-letter">(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genNotes, setGenNotes] = useState(draft?.genNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [gapQuestions, setGapQuestions] = useState<GapQuestion[] | null>(null);
  const [gapAnswers, setGapAnswers] = useState<Record<string, string>>({});
  const [checkingGaps, setCheckingGaps] = useState(false);
  const [pendingGenType, setPendingGenType] = useState<"resume" | "cover-letter">("resume");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-save draft to session storage on changes (debounced)
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistDraft = useCallback(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      saveResumeDraft({
        name,
        content,
        docType,
        genNotes,
        existingResumeId: existing?.resumeId ?? draft?.existingResumeId,
        updatedAt: new Date().toISOString(),
      });
    }, 500); // debounce 500ms
  }, [name, content, docType, genNotes, existing?.resumeId, draft?.existingResumeId]);

  useEffect(() => {
    persistDraft();
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [persistDraft]);

  async function handleSave() {
    if (!name.trim() && !content.trim()) return;
    setSaving(true);

    const now = new Date().toISOString();
    const doc: ResumeDoc = {
      resumeId: existing?.resumeId ?? crypto.randomUUID(),
      name: name.trim() || (docType === "cover-letter" ? "Untitled Cover Letter" : "Untitled Resume"),
      content,
      source: existing ? (existing.source === "generated" && content !== existing.content ? "edited" : existing.source) : "uploaded",
      docType,
      generatedForJob: existing?.generatedForJob,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await saveResume(doc);
    setSaving(false);
    onSave();
  }

  async function handleGenerate(type: "resume" | "cover-letter", skipGapCheck = false) {
    setGenerating(type);
    setGenError(null);

    try {
      // Get job context from active tab
      const contextResp = await sendToActiveTab({ type: "EXTRACT_JOB_CONTEXT" });
      if (contextResp.type !== "JOB_CONTEXT") {
        throw new Error("Could not extract job context from current page. Navigate to a job posting first.");
      }

      const context: JobContext = contextResp.context;
      const [profile, settings, voice, rawResume] = await Promise.all([
        getProfile(),
        getSettings(),
        getVoice(),
        getRawResume(),
      ]);

      if (!profile.firstName && !profile.email) {
        throw new Error("Import your profile first (Profile tab).");
      }

      // Use editor content as primary source, fall back to stored raw resume text
      const existingResumeText = content.trim() || rawResume || undefined;

      // --- Gap detection (hybrid: deterministic pre-check + LLM questions) ---
      if (!skipGapCheck && hasProfileGaps(profile, rawResume)) {
        setCheckingGaps(true);
        setPendingGenType(type);
        try {
          const gapResult = await sendToBackground({
            type: "DETECT_PROFILE_GAPS",
            context,
            profile,
            providerConfig: settings.providerConfig,
            existingResume: existingResumeText,
          });
          if (gapResult.type === "PROFILE_GAPS_RESULT" && gapResult.questions.length > 0) {
            setGapQuestions(gapResult.questions);
            setGapAnswers({});
            setCheckingGaps(false);
            setGenerating(false);
            return; // Show gap form instead of generating
          }
        } catch {
          // Gap detection failed — proceed with generation anyway
        }
        setCheckingGaps(false);
      }

      const messageType = type === "cover-letter" ? "GENERATE_COVER_LETTER" : "GENERATE_RESUME";
      const resultType = type === "cover-letter" ? "COVER_LETTER_RESULT" : "RESUME_RESULT";

      // Send to background for LLM generation
      const genStart = performance.now();
      const result = await sendToBackground({
        type: messageType,
        context,
        profile,
        providerConfig: settings.providerConfig,
        voice: voice.corePitch ? voice : undefined,
        existingResume: existingResumeText,
        feedback: genNotes.trim() || undefined,
      });
      const genDurationMs = Math.round(performance.now() - genStart);

      if (result.type === resultType) {
        if (result.error || !result.content) {
          // Log failed generation
          await saveGenerationRun({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            url: context.url,
            company: context.company,
            role: context.title,
            docType: type,
            model: (result as { model?: string }).model,
            durationMs: genDurationMs,
            error: result.error || "No content generated",
            contentLength: 0,
            source: "resumes-tab",
          });
          throw new Error(result.error || "No content generated");
        }
        setContent(result.content);
        setDocType(type);
        if (!name.trim()) {
          const suffix = type === "cover-letter" ? "Cover Letter" : "";
          setName(`${profile.firstName} ${profile.lastName} - ${context.company}${suffix ? ` ${suffix}` : ""}`.trim());
        }

        // Log successful generation
        await saveGenerationRun({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          url: context.url,
          company: context.company,
          role: context.title,
          docType: type,
          model: (result as { model?: string }).model,
          durationMs: genDurationMs,
          contentLength: result.content.length,
          source: "resumes-tab",
        });
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleGapSaveAndGenerate() {
    // Map answers to profile fields and save
    const profile = await getProfile();
    let updated = { ...profile };
    const extraNotes: string[] = [];

    for (const q of gapQuestions ?? []) {
      const answer = (gapAnswers[q.id] ?? "").trim();
      if (!answer) continue;

      if (q.field === "summary") {
        updated.summary = answer;
      } else if (q.field === "skills") {
        const newSkills = answer.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
        const existingLower = new Set(updated.skills.map((s) => s.toLowerCase()));
        for (const skill of newSkills) {
          if (!existingLower.has(skill.toLowerCase())) {
            updated.skills.push(skill);
          }
        }
      } else if (q.field === "experiences" && updated.experiences.length > 0) {
        // Append to most recent experience highlights
        updated.experiences[0] = {
          ...updated.experiences[0],
          highlights: [...(updated.experiences[0].highlights ?? []), answer],
        };
      } else {
        // "education", "other", or unmapped — pass as generation notes
        extraNotes.push(`${q.question}: ${answer}`);
      }
    }

    await saveProfile(updated);

    // Merge extra notes into genNotes for this generation
    if (extraNotes.length > 0) {
      const combined = [genNotes.trim(), ...extraNotes].filter(Boolean).join("\n");
      setGenNotes(combined);
    }

    setGapQuestions(null);
    setGapAnswers({});
    handleGenerate(pendingGenType, true); // Skip gap check on re-run
  }

  function handleGapSkip() {
    setGapQuestions(null);
    setGapAnswers({});
    handleGenerate(pendingGenType, true);
  }

  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onCancel}
          className="text-xs text-white/40 hover:text-white/70"
        >
          &larr; Back
        </button>
        <h2 className="text-sm font-semibold text-white/80">
          {existing ? `Edit ${docType === "cover-letter" ? "Cover Letter" : "Resume"}` : "New Document"}
        </h2>
        <div className="w-12" /> {/* spacer */}
      </div>

      {/* Gap Detection Form */}
      {(gapQuestions || checkingGaps) && (
        <div className="space-y-3">
          {checkingGaps ? (
            <div className="text-center py-6">
              <p className="text-xs text-white/50 animate-pulse">Checking profile completeness...</p>
            </div>
          ) : gapQuestions && gapQuestions.length > 0 ? (
            <>
              <div className="bg-aurora-teal/10 border border-aurora-teal/20 rounded-lg p-3">
                <p className="text-xs text-aurora-teal font-medium mb-1">A few details would improve the output</p>
                <p className="text-[10px] text-white/40">Answer what you can. Your answers will be saved to your profile.</p>
              </div>
              {gapQuestions.map((q) => (
                <div key={q.id} className="space-y-1">
                  <label className="text-xs text-white/70">{q.question}</label>
                  {q.inputType === "textarea" ? (
                    <textarea
                      value={gapAnswers[q.id] ?? ""}
                      onChange={(e) => setGapAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                      placeholder={q.placeholder}
                      className="w-full bg-surface-2 text-white/80 text-xs rounded-md p-2 border border-white/10 focus:border-aurora-teal/40 focus:outline-none resize-y min-h-[60px] max-h-[120px]"
                      rows={3}
                    />
                  ) : (
                    <input
                      type="text"
                      value={gapAnswers[q.id] ?? ""}
                      onChange={(e) => setGapAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                      placeholder={q.placeholder}
                      className="w-full bg-surface-2 text-white/80 text-xs rounded-md px-2 py-1.5 border border-white/10 focus:border-aurora-teal/40 focus:outline-none"
                    />
                  )}
                </div>
              ))}
              <div className="flex gap-2">
                <button
                  onClick={handleGapSaveAndGenerate}
                  className="flex-1 py-2 bg-aurora-teal/30 hover:bg-aurora-teal/50 text-aurora-teal text-xs rounded-lg transition-colors"
                >
                  Save &amp; Generate
                </button>
                <button
                  onClick={handleGapSkip}
                  className="py-2 px-3 bg-surface-2 hover:bg-surface-3 text-white/40 text-xs rounded-lg transition-colors"
                >
                  Skip
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* Name */}
      {!gapQuestions && (
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Resume name (e.g. Frontend v2)"
        className="w-full bg-surface-2 text-white/90 text-xs rounded-md px-3 py-2 border border-white/10 focus:border-aurora-purple/50 focus:outline-none"
      />
      )}

      {/* Normal editor UI — hidden when gap form is showing */}
      {!gapQuestions && !checkingGaps && (<>
      {/* Source buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            setShowPreview(false);
            textareaRef.current?.focus();
          }}
          className={`flex-1 py-1.5 text-xs rounded-lg transition-colors ${
            !showPreview
              ? "bg-aurora-purple/30 text-aurora-purple"
              : "bg-surface-2 text-white/40 hover:text-white/60"
          }`}
        >
          Edit
        </button>
        <button
          onClick={() => setShowPreview(true)}
          className={`flex-1 py-1.5 text-xs rounded-lg transition-colors ${
            showPreview
              ? "bg-aurora-purple/30 text-aurora-purple"
              : "bg-surface-2 text-white/40 hover:text-white/60"
          }`}
        >
          Preview
        </button>
      </div>

      {/* Generation notes */}
      <textarea
        value={genNotes}
        onChange={(e) => setGenNotes(e.target.value)}
        placeholder="Notes for generation (optional) — e.g. 'emphasize React experience', 'make it more concise', 'mention I'm relocating to SF'"
        className="w-full bg-surface-2 text-white/70 text-[11px] rounded-md p-2 border border-white/10 focus:border-aurora-teal/40 focus:outline-none resize-y min-h-[40px] max-h-[100px]"
        rows={2}
      />

      {/* Generate buttons */}
      <div className="flex gap-2 min-w-0">
        <button
          onClick={() => handleGenerate("resume")}
          disabled={!!generating}
          className={`flex-1 min-w-0 py-2 text-xs rounded-lg transition-colors disabled:opacity-50 overflow-hidden truncate ${
            generating === "resume"
              ? "bg-aurora-teal/30 text-aurora-teal animate-pulse"
              : "bg-aurora-teal/20 hover:bg-aurora-teal/30 text-aurora-teal"
          }`}
        >
          {generating === "resume" ? "Generating..." : content.trim() ? "Regen Resume" : "Gen Resume"}
        </button>
        <button
          onClick={() => handleGenerate("cover-letter")}
          disabled={!!generating}
          className={`flex-1 min-w-0 py-2 text-xs rounded-lg transition-colors disabled:opacity-50 overflow-hidden truncate ${
            generating === "cover-letter"
              ? "bg-aurora-purple/30 text-aurora-purple animate-pulse"
              : "bg-aurora-purple/20 hover:bg-aurora-purple/30 text-aurora-purple"
          }`}
        >
          {generating === "cover-letter" ? "Generating..." : "Gen Cover Letter"}
        </button>
      </div>

      {genError && (
        <p className="text-xs text-aurora-pink bg-aurora-pink/10 rounded-lg p-2">
          {genError}
        </p>
      )}

      {/* Content area */}
      {showPreview ? (
        <div
          className="bg-surface-2 rounded-lg p-3 border border-white/10 text-xs text-white/80 min-h-[300px] max-h-[400px] overflow-y-auto prose-invert"
          dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }}
        />
      ) : (
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Paste or type your resume in markdown format..."
          className="w-full bg-surface-2 text-white/90 text-xs rounded-md p-3 border border-white/10 focus:border-aurora-purple/50 focus:outline-none resize-y min-h-[300px] font-mono"
          rows={20}
        />
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving || (!name.trim() && !content.trim())}
          className="flex-1 py-2 bg-aurora-green/30 hover:bg-aurora-green/50 text-aurora-green text-xs rounded-lg transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={() => handleDownloadContent(name || "resume", content)}
          disabled={!content.trim()}
          className="py-2 px-3 bg-surface-2 hover:bg-surface-3 text-white/50 text-xs rounded-lg transition-colors disabled:opacity-50"
        >
          Download .md
        </button>
      </div>
      </>)}
    </div>
  );
}

// --- Helpers ---

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return d.toLocaleDateString();
}

function handleDownload(doc: ResumeDoc) {
  handleDownloadContent(doc.name || "resume", doc.content);
}

function handleDownloadContent(name: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^a-zA-Z0-9-_ ]/g, "")}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Simple markdown to HTML (headings, bold, italic, bullets, paragraphs) */
function markdownToHtml(md: string): string {
  if (!md) return "<p class='text-white/30'>Nothing to preview</p>";

  return md
    .split("\n")
    .map((line) => {
      // Headings
      if (line.startsWith("# ")) return `<h1 class="text-base font-bold text-white/90 mt-3 mb-1">${esc(line.slice(2))}</h1>`;
      if (line.startsWith("## ")) return `<h2 class="text-sm font-semibold text-white/80 mt-2.5 mb-1">${esc(line.slice(3))}</h2>`;
      if (line.startsWith("### ")) return `<h3 class="text-xs font-semibold text-white/70 mt-2 mb-0.5">${esc(line.slice(4))}</h3>`;
      // Bullets
      if (line.match(/^[-*] /)) return `<li class="ml-4 text-white/70">${formatInline(line.slice(2))}</li>`;
      // Bold/italic line
      if (line.startsWith("**") && line.endsWith("**")) return `<p class="font-semibold text-white/80">${formatInline(line)}</p>`;
      // Blank
      if (!line.trim()) return "";
      // Regular
      return `<p class="text-white/70">${formatInline(line)}</p>`;
    })
    .join("\n");
}

function formatInline(text: string): string {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
