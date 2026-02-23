import { useState, useEffect, useRef } from "react";
import type {
  ChoiceGroup,
  DebugCounts,
  DetectedField,
  FileInputInfo,
  FillRun,
  GapQuestion,
  JobContext,
  ResumeDoc,
  SmartApplyResult,
  SmartFillOutcome,
} from "../../shared/types";
import type { JobRecord, SmartAnswersDoc } from "../../shared/jobTypes";
import { JOB_SCHEMA_VERSION } from "../../shared/jobTypes";
import { getProfile, saveProfile, getSettings, getVoice, getRawResume } from "../../shared/storage";
import { saveFillRun, createFillRun, saveSmartApplyRun, saveGenerationRun } from "../../shared/storage";
import { hasProfileGaps } from "../../lib/llm/prompt";
import { sendToActiveTab, sendToBackground } from "../../shared/messages";
import { canonicalizeUrl, computePostingKey, detectSource } from "../../shared/url";
import { normalizeText, computeJobIdentityKey } from "../../shared/normalize";
import { sha256 } from "../../shared/crypto";
import { getJob, upsertJob, putSnapshot, getAnswers, putAnswers } from "../../shared/jobStore";
import { parseCompensation } from "../../shared/normalize";
import { explainMatch, type MatchExplanation } from "../../shared/matchers";
import { batchSaveAnswers } from "../../shared/answerLibrary";
import { listResumes, saveResume } from "../../shared/resumeStore";

type State =
  | { phase: "idle" }
  | { phase: "detecting" }
  | { phase: "detected"; fields: DetectedField[]; openQuestionCount: number; debugCounts: DebugCounts }
  | { phase: "filling" }
  | { phase: "filled"; run: FillRun }
  | { phase: "error"; message: string }
  | { phase: "no-profile" }
  // Smart Apply phases
  | { phase: "generating"; fields: DetectedField[]; context: JobContext; openQuestionCount: number; debugCounts: DebugCounts }
  | {
      phase: "generated";
      fields: DetectedField[];
      context: JobContext;
      result: SmartApplyResult;
      cached: boolean;
      openQuestionCount: number;
      debugCounts: DebugCounts;
      newQuestionCount?: number; // questions not in cache
    }
  | { phase: "smart-filling" }
  | { phase: "smart-filled"; outcomes: SmartFillOutcome[] }
  // Auto-Apply phases
  | { phase: "auto-applying"; status: string }
  | { phase: "auto-applied"; run: FillRun };

export default function FillPreview() {
  const [state, setState] = useState<State>({ phase: "idle" });
  const [pageInfo, setPageInfo] = useState<{
    url: string;
    title: string;
    company: string;
    role: string;
  } | null>(null);
  const [smartError, setSmartError] = useState<string | null>(null);

  // Toast notification for auto-save
  const [toast, setToast] = useState<string | null>(null);

  // Voice nudge (dismissable)
  const [voiceNudgeDismissed, setVoiceNudgeDismissed] = useState(false);

  // Editable smart answers — keyed by index
  const [editedSummary, setEditedSummary] = useState("");
  const [editedWhyCompany, setEditedWhyCompany] = useState("");
  const [editedAnswers, setEditedAnswers] = useState<string[]>([]);

  // For cancel: track generation ID so we can ignore stale results
  const generationIdRef = useRef(0);

  // Track deterministic fill stats during auto-apply for display in generated phase
  const autoFillStatsRef = useRef<{ filled: number; manual: number; failed: number } | null>(null);

  // Choice groups (radio/checkbox) detected during scan — persists across state transitions
  const choiceGroupsRef = useRef<ChoiceGroup[]>([]);

  // Posting key for job record linking (computed on mount)
  const [postingKey, setPostingKey] = useState<string | null>(null);

  // Current SmartAnswersDoc for edit persistence
  const answersDocRef = useRef<SmartAnswersDoc | null>(null);

  // Resume picker state
  const [availableResumes, setAvailableResumes] = useState<ResumeDoc[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
  const [generatingResume, setGeneratingResume] = useState(false);
  const [gapQuestions, setGapQuestions] = useState<GapQuestion[] | null>(null);
  const [gapAnswers, setGapAnswers] = useState<Record<string, string>>({});
  const [checkingGaps, setCheckingGaps] = useState(false);
  const [pendingGapGenType, setPendingGapGenType] = useState<"resume" | "cover-letter">("resume");

  // Attach resume to file input state
  const [attachStatus, setAttachStatus] = useState<"idle" | "detecting" | "attaching" | "success" | "error">("idle");
  const [attachError, setAttachError] = useState<string | null>(null);

  // Load available resumes on mount
  useEffect(() => {
    listResumes().then(setAvailableResumes);
  }, []);

  // Get page info on mount + upsert JobRecord "seen"
  useEffect(() => {
    sendToActiveTab({ type: "GET_PAGE_INFO" })
      .then(async (resp) => {
        if (resp.type === "PAGE_INFO") {
          setPageInfo({
            url: resp.url,
            title: resp.title,
            company: resp.company,
            role: resp.role,
          });

          // Compute postingKey and upsert JobRecord
          try {
            const key = await computePostingKey(resp.url);
            setPostingKey(key);
            const now = new Date().toISOString();
            const source = detectSource(resp.url);

            const existing = await getJob(key);
            if (existing) {
              // Restore linked resume
              if (existing.linkedResumeId) {
                setSelectedResumeId(existing.linkedResumeId);
              }
              // Update lastSeenAt only
              await upsertJob({
                ...existing,
                lastSeenAt: now,
                // Merge metadata: prefer non-null new values
                company: existing.company || resp.company || null,
                title: existing.title || resp.role || null,
              });
            } else {
              // Create new JobRecord
              const newJob: JobRecord = {
                schemaVersion: JOB_SCHEMA_VERSION,
                postingKey: key,
                canonicalUrl: canonicalizeUrl(resp.url),
                source,
                firstSeenAt: now,
                lastSeenAt: now,
                company: resp.company || null,
                title: resp.role || null,
                location: null,
                remoteType: null,
                employmentType: null,
                compensation: null,
                jobIdentityKey: null,
                status: "seen",
                statusUpdatedAt: now,
                latestSnapshotId: null,
                snapshotIds: [],
                latestAnswersId: null,
                answersIds: [],
                jobContentHash: null,
                linkedResumeId: null,
              };
              await upsertJob(newJob);
            }
          } catch (err) {
            console.error("[Midnight Sun] JobRecord upsert failed:", err);
          }
        }
      })
      .catch(() => {
        // Content script not loaded — that's fine
      });
  }, []);

  async function handleDetect() {
    setState({ phase: "detecting" });
    setSmartError(null);
    try {
      // Check if profile exists
      const profile = await getProfile();
      if (!profile.firstName && !profile.email) {
        setState({ phase: "no-profile" });
        return;
      }

      // Log the active tab for debugging
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log("[Midnight Sun] Active tab for scan", activeTab?.id, activeTab?.url);

      let resp = await sendToActiveTab({ type: "DETECT_FIELDS" });

      // If top frame returned 0 fields, try scanning all frames via background
      if (resp.type === "FIELDS_DETECTED" && resp.fields.length === 0) {
        console.log("[Midnight Sun] Top frame returned 0 fields, trying all-frames scan");
        try {
          const allResp = await sendToBackground({ type: "DETECT_ALL_FRAMES" });
          if (allResp.type === "ALL_FRAMES_DETECTED" && allResp.frames.length > 0) {
            // Pick the frame with the most fields
            const best = allResp.frames.reduce((a, b) =>
              b.fields.length > a.fields.length ? b : a
            );
            if (best.fields.length > 0) {
              console.log("[Midnight Sun] All-frames scan found fields in", best.frameUrl);
              resp = {
                type: "FIELDS_DETECTED",
                fields: best.fields,
                choiceGroups: best.choiceGroups ?? [],
                openQuestionCount: best.openQuestionCount,
                debugCounts: best.debugCounts,
              };
            }
          }
        } catch (allFramesErr) {
          console.warn("[Midnight Sun] All-frames scan failed:", allFramesErr);
        }
      }

      if (resp.type === "FIELDS_DETECTED") {
        choiceGroupsRef.current = resp.choiceGroups ?? [];
        console.log("[Midnight Sun] Detection result", {
          fields: resp.fields.length,
          choiceGroups: choiceGroupsRef.current.length,
          openQuestions: resp.openQuestionCount,
          debugCounts: resp.debugCounts,
        });
        setState({
          phase: "detected",
          fields: resp.fields,
          openQuestionCount: resp.openQuestionCount,
          debugCounts: resp.debugCounts,
        });

        // Capture snapshot + enrich JobRecord (non-blocking)
        if (postingKey) {
          captureSnapshotAndEnrich(postingKey).catch((err) => {
            console.error("[Midnight Sun] Snapshot capture failed:", err);
          });
        }
      }
    } catch (err) {
      setState({
        phase: "error",
        message:
          "Can't reach this page. Navigate to a job application and try again.",
      });
    }
  }

  /**
   * Auto-Apply: single pipeline that chains Detect → Deterministic Fill → Smart Generate.
   * Pauses at "generated" phase for user review of smart answers before applying.
   * If no open questions exist, shows "auto-applied" phase with fill results.
   */
  async function handleAutoApply() {
    setState({ phase: "auto-applying", status: "Scanning form fields..." });
    setSmartError(null);
    autoFillStatsRef.current = null;

    try {
      // 1. Check profile
      const profile = await getProfile();
      if (!profile.firstName && !profile.email) {
        setState({ phase: "no-profile" });
        return;
      }

      // 2. Detect fields (same logic as handleDetect)
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log("[Midnight Sun] Auto-Apply: scanning", activeTab?.id, activeTab?.url);

      let resp = await sendToActiveTab({ type: "DETECT_FIELDS" });

      // If top frame returned 0 fields, try scanning all frames
      if (resp.type === "FIELDS_DETECTED" && resp.fields.length === 0) {
        console.log("[Midnight Sun] Auto-Apply: top frame 0 fields, trying all-frames scan");
        try {
          const allResp = await sendToBackground({ type: "DETECT_ALL_FRAMES" });
          if (allResp.type === "ALL_FRAMES_DETECTED" && allResp.frames.length > 0) {
            const best = allResp.frames.reduce((a, b) =>
              b.fields.length > a.fields.length ? b : a
            );
            if (best.fields.length > 0) {
              resp = {
                type: "FIELDS_DETECTED",
                fields: best.fields,
                choiceGroups: best.choiceGroups ?? [],
                openQuestionCount: best.openQuestionCount,
                debugCounts: best.debugCounts,
              };
            }
          }
        } catch (e) {
          console.warn("[Midnight Sun] All-frames scan failed:", e);
        }
      }

      if (resp.type !== "FIELDS_DETECTED") {
        setState({
          phase: "error",
          message: "Can't reach this page. Navigate to a job application and try again.",
        });
        return;
      }

      const { fields, openQuestionCount, debugCounts } = resp;
      choiceGroupsRef.current = resp.choiceGroups ?? [];
      console.log("[Midnight Sun] Auto-Apply: detected", {
        fields: fields.length,
        choiceGroups: choiceGroupsRef.current.length,
        openQuestions: openQuestionCount,
      });

      // Non-blocking snapshot capture
      if (postingKey) {
        captureSnapshotAndEnrich(postingKey).catch((err) => {
          console.error("[Midnight Sun] Snapshot capture failed:", err);
        });
      }

      // 3. Deterministic fill
      const matchedFields = fields.filter(
        (f) => f.matchedField && f.category !== "demographic"
      );
      let fillRun: FillRun | null = null;

      const fillableChoiceGroups = choiceGroupsRef.current.filter(
        (g) => g.category === "fillable" && g.matchedField
      );
      if (matchedFields.length > 0 || fillableChoiceGroups.length > 0) {
        setState({
          phase: "auto-applying",
          status: `Filling ${matchedFields.length} fields${fillableChoiceGroups.length > 0 ? ` + ${fillableChoiceGroups.length} groups` : ""}...`,
        });
        const fillResp = await sendToActiveTab({
          type: "FILL_FIELDS",
          profile,
          fields: matchedFields,
          choiceGroups: fillableChoiceGroups.length > 0 ? fillableChoiceGroups : undefined,
        });
        if (fillResp.type === "FILL_COMPLETE") {
          fillRun = createFillRun({
            url: pageInfo?.url ?? "",
            company: pageInfo?.company ?? "",
            role: pageInfo?.role ?? "",
            pageMeta: {
              title: pageInfo?.title ?? "",
              stepIndex: 0,
            },
            detectedFields: fields,
            fillResults: fillResp.results,
          });
          await saveFillRun(fillRun);

          // Track stats for display in generated phase
          autoFillStatsRef.current = {
            filled: fillResp.results.filter((r) => r.success).length,
            manual: fillResp.results.filter((r) => r.manualRequired).length,
            failed: fillResp.results.filter((r) => !r.success && !r.manualRequired).length,
          };

          // Update JobRecord status
          if (postingKey) {
            const job = await getJob(postingKey);
            if (job && job.status === "seen") {
              await upsertJob({
                ...job,
                status: "filled",
                statusUpdatedAt: new Date().toISOString(),
              });
            }
          }
        }
      }

      // 4. Smart answers (if open questions exist)
      if (openQuestionCount > 0) {
        setState({ phase: "auto-applying", status: "Extracting job context..." });
        try {
          const contextResp = await sendToActiveTab({ type: "EXTRACT_JOB_CONTEXT" });
          if (contextResp.type === "JOB_CONTEXT") {
            const context = contextResp.context;

            // Check answer cache
            if (postingKey) {
              const cacheResult = await checkAnswersCache(postingKey, context);
              if (cacheResult) {
                const { doc, matchedAnswers, newQuestionCount } = cacheResult;
                answersDocRef.current = doc;

                setEditedSummary(
                  doc.answers.find((a) => a.questionId === "__summary__")?.answerText ?? ""
                );
                setEditedWhyCompany(
                  doc.answers.find((a) => a.questionId === "__whyCompany__")?.answerText ?? ""
                );

                const cachedResult: SmartApplyResult = {
                  summary:
                    doc.answers.find((a) => a.questionId === "__summary__")?.answerText ?? "",
                  whyCompany:
                    doc.answers.find((a) => a.questionId === "__whyCompany__")?.answerText ?? "",
                  answers: context.questions.map((q) => {
                    const match = matchedAnswers.get(q.label);
                    return {
                      label: q.label,
                      selectorCandidates: q.selectorCandidates,
                      answer: match?.answerText ?? "",
                    };
                  }),
                  model: doc.model ?? "cached",
                  durationMs: 0,
                  promptChars: 0,
                };

                setEditedAnswers(cachedResult.answers.map((a) => a.answer));
                setState({
                  phase: "generated",
                  fields,
                  context,
                  result: cachedResult,
                  cached: true,
                  openQuestionCount,
                  debugCounts,
                  newQuestionCount,
                });
                return;
              }
            }

            // No cache — generate via LLM
            setState({ phase: "auto-applying", status: "Generating tailored answers..." });
            await generateSmartAnswers(fields, context, openQuestionCount, debugCounts);
            return;
          }
        } catch (err) {
          console.warn("[Midnight Sun] Smart generation failed during auto-apply:", err);
          // Fall through to show deterministic results only
        }
      }

      // 5. No open questions (or smart gen failed) → show deterministic results
      if (fillRun) {
        setState({ phase: "auto-applied", run: fillRun });
      } else {
        // Nothing was filled — show detected view for manual review
        setState({
          phase: "detected",
          fields,
          openQuestionCount,
          debugCounts,
        });
      }
    } catch (err) {
      setState({
        phase: "error",
        message: "Auto-apply failed. Navigate to a job application and try again.",
      });
    }
  }

  /**
   * Capture a page snapshot and enrich the JobRecord with extracted metadata.
   * Called after scan (handleDetect) — non-blocking, errors logged silently.
   */
  async function captureSnapshotAndEnrich(key: string) {
    const snapshotResp = await sendToActiveTab({ type: "CAPTURE_SNAPSHOT" });
    if (snapshotResp.type !== "SNAPSHOT_DATA") return;

    const { sections, meta, fullText } = snapshotResp;

    // Create and store snapshot
    const snapshotId = crypto.randomUUID();
    await putSnapshot({
      schemaVersion: JOB_SCHEMA_VERSION,
      snapshotId,
      postingKey: key,
      capturedAt: new Date().toISOString(),
      meta,
      sections,
      fullText,
    });

    // Enrich JobRecord with extracted metadata
    const job = await getJob(key);
    if (!job) return;

    const now = new Date().toISOString();

    // Parse compensation from extracted meta
    let compensation = job.compensation;
    if (!compensation && meta.compensationText) {
      compensation = parseCompensation(meta.compensationText);
    }

    // Compute content hash
    const jobContentHash = await sha256(normalizeText(fullText));

    // Compute identity key if we have company + title
    const company = meta.company || job.company;
    const title = meta.title || job.title;
    const jobIdentityKey =
      job.jobIdentityKey ||
      (company && title
        ? await computeJobIdentityKey(company, title, meta.location ?? undefined)
        : null);

    await upsertJob({
      ...job,
      lastSeenAt: now,
      company: meta.company || job.company,
      title: meta.title || job.title,
      location: meta.location || job.location,
      remoteType: meta.remoteType || job.remoteType,
      employmentType: meta.employmentType || job.employmentType,
      compensation,
      jobContentHash,
      jobIdentityKey,
      latestSnapshotId: snapshotId,
      snapshotIds: [snapshotId, ...job.snapshotIds],
    });
  }

  async function handleFill() {
    if (state.phase !== "detected") return;

    setState({ phase: "filling" });
    try {
      const profile = await getProfile();
      const fieldsToFill = state.fields.filter((f) => f.matchedField && f.category !== "demographic");
      const fillableGroups = choiceGroupsRef.current.filter(
        (g) => g.category === "fillable" && g.matchedField
      );
      const resp = await sendToActiveTab({
        type: "FILL_FIELDS",
        profile,
        fields: fieldsToFill,
        choiceGroups: fillableGroups.length > 0 ? fillableGroups : undefined,
      });
      if (resp.type === "FILL_COMPLETE") {
        // Create and persist the FillRun log
        const run = createFillRun({
          url: pageInfo?.url ?? "",
          company: pageInfo?.company ?? "",
          role: pageInfo?.role ?? "",
          pageMeta: {
            title: pageInfo?.title ?? "",
            stepIndex: 0, // v0: always single-page
          },
          detectedFields: state.fields,
          fillResults: resp.results,
        });
        await saveFillRun(run);
        setState({ phase: "filled", run });

        // Update JobRecord status to "filled"
        if (postingKey) {
          const job = await getJob(postingKey);
          if (job && job.status === "seen") {
            await upsertJob({
              ...job,
              status: "filled",
              statusUpdatedAt: new Date().toISOString(),
            });
          }
        }
      }
    } catch (err) {
      setState({ phase: "error", message: "Failed to fill fields." });
    }
  }

  async function handleGenerateSmart() {
    if (state.phase !== "detected") return;
    const fields = state.fields;
    const oqCount = state.openQuestionCount;
    const dc = state.debugCounts;

    setSmartError(null);

    // 1. Extract job context from page
    try {
      const contextResp = await sendToActiveTab({ type: "EXTRACT_JOB_CONTEXT" });
      if (contextResp.type !== "JOB_CONTEXT") {
        setSmartError("Failed to extract job context from page.");
        return;
      }

      const context = contextResp.context;

      // 2. Check cache before generating
      if (postingKey) {
        const cacheResult = await checkAnswersCache(postingKey, context);
        if (cacheResult) {
          // Cache hit — populate from cached answers
          const { doc, matchedAnswers, newQuestionCount } = cacheResult;
          answersDocRef.current = doc;

          setEditedSummary(
            doc.answers.find((a) => a.questionId === "__summary__")?.answerText ?? ""
          );
          setEditedWhyCompany(
            doc.answers.find((a) => a.questionId === "__whyCompany__")?.answerText ?? ""
          );

          // Build SmartApplyResult shape from cached answers
          const cachedResult: SmartApplyResult = {
            summary:
              doc.answers.find((a) => a.questionId === "__summary__")?.answerText ?? "",
            whyCompany:
              doc.answers.find((a) => a.questionId === "__whyCompany__")?.answerText ?? "",
            answers: context.questions.map((q) => {
              const match = matchedAnswers.get(q.label);
              return {
                label: q.label,
                selectorCandidates: q.selectorCandidates,
                answer: match?.answerText ?? "",
              };
            }),
            model: doc.model ?? "cached",
            durationMs: 0,
            promptChars: 0,
          };

          setEditedAnswers(cachedResult.answers.map((a) => a.answer));
          setState({
            phase: "generated",
            fields,
            context,
            result: cachedResult,
            cached: true,
            openQuestionCount: oqCount,
            debugCounts: dc,
            newQuestionCount,
          });
          return;
        }
      }

      // 3. No cache hit — generate via Ollama
      await generateSmartAnswers(fields, context, oqCount, dc);
    } catch (err) {
      setSmartError(
        err instanceof Error ? err.message : "Failed to generate smart answers."
      );
      if (state.phase !== "detected") {
        setState({ phase: "detected", fields, openQuestionCount: oqCount, debugCounts: dc });
      }
    }
  }

  /**
   * Check the answers cache for a job.
   * Returns cached answers doc + matched answers map if cache is usable.
   * Uses set containment: if all current questions exist in cache, it's a full hit.
   * If some are missing, returns partial hit with newQuestionCount.
   */
  async function checkAnswersCache(
    key: string,
    context: JobContext
  ): Promise<{
    doc: SmartAnswersDoc;
    matchedAnswers: Map<string, { answerText: string; editedByUser: boolean }>;
    newQuestionCount: number;
  } | null> {
    const job = await getJob(key);
    if (!job?.latestAnswersId) return null;

    const doc = await getAnswers(job.latestAnswersId);
    if (!doc) return null;

    // Compute current question hashes
    const currentHashes = await Promise.all(
      context.questions.map(async (q) => ({
        label: q.label,
        hash: await sha256(normalizeText(q.label)),
      }))
    );

    // Check which current questions have cached answers
    const matchedAnswers = new Map<string, { answerText: string; editedByUser: boolean }>();
    let newQuestionCount = 0;

    for (const { label, hash } of currentHashes) {
      const cachedAnswer = doc.answers.find((a) => a.questionId === hash);
      if (cachedAnswer) {
        matchedAnswers.set(label, {
          answerText: cachedAnswer.answerText,
          editedByUser: cachedAnswer.editedByUser,
        });
      } else {
        newQuestionCount++;
      }
    }

    // Only return cache if we have at least some matches
    if (matchedAnswers.size === 0 && doc.answers.length === 0) {
      // No question matches and no answers at all — cache miss
      // But if we have summary/whyCompany, still use cache
      const hasSummary = doc.answers.some((a) => a.questionId === "__summary__");
      const hasWhyCompany = doc.answers.some((a) => a.questionId === "__whyCompany__");
      if (!hasSummary && !hasWhyCompany) return null;
    }

    return { doc, matchedAnswers, newQuestionCount };
  }

  /**
   * Generate smart answers via Ollama (no cache).
   * Also creates SmartAnswersDoc for future cache hits.
   */
  async function generateSmartAnswers(
    fields: DetectedField[],
    context: JobContext,
    oqCount: number = 0,
    dc: DebugCounts = { rawInputs: 0, rawTextareas: 0, rawSelects: 0, roleTextbox: 0, contenteditable: 0, iframes: 0, sameOriginIframes: 0, filteredByVisibility: 0 }
  ) {
    const genId = ++generationIdRef.current;
    setState({ phase: "generating", fields, context, openQuestionCount: oqCount, debugCounts: dc });

    const [profile, settings, voice, rawResume] = await Promise.all([getProfile(), getSettings(), getVoice(), getRawResume()]);
    const resp = await sendToBackground({
      type: "GENERATE_SMART_ANSWERS",
      context,
      profile,
      providerConfig: settings.providerConfig,
      voice: voice.corePitch ? voice : undefined,
      existingResume: rawResume || undefined,
    });

    // Check if cancelled
    if (generationIdRef.current !== genId) return;

    if (resp.type === "SMART_ANSWERS_RESULT") {
      if (resp.result) {
        // Populate editable fields
        setEditedSummary(resp.result.summary);
        setEditedWhyCompany(resp.result.whyCompany);
        setEditedAnswers(resp.result.answers.map((a) => a.answer));
        setState({
          phase: "generated",
          fields,
          context,
          result: resp.result,
          cached: false,
          openQuestionCount: oqCount,
          debugCounts: dc,
        });

        // Log the run (backward compat)
        await saveSmartApplyRun({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          url: context.url,
          company: context.company,
          role: context.title,
          result: resp.result,
        });

        // Create SmartAnswersDoc for caching
        if (postingKey) {
          try {
            const doc = await createSmartAnswersDoc(
              postingKey,
              context,
              resp.result
            );
            answersDocRef.current = doc;
          } catch (err) {
            console.error("[Midnight Sun] Failed to cache answers:", err);
          }
        }
      } else {
        setSmartError(resp.error ?? "Generation failed.");
        setState({ phase: "detected", fields, openQuestionCount: oqCount, debugCounts: dc });
      }
    }
  }

  /**
   * Create and persist a SmartAnswersDoc from generation results.
   */
  async function createSmartAnswersDoc(
    key: string,
    context: JobContext,
    result: SmartApplyResult
  ): Promise<SmartAnswersDoc> {
    const now = new Date().toISOString();
    const answersId = crypto.randomUUID();

    // Build questions array
    const questions = await Promise.all(
      context.questions.map(async (q) => {
        const hash = await sha256(normalizeText(q.label));
        return { questionId: hash, questionText: q.label, questionHash: hash };
      })
    );

    // Build answers array: summary + whyCompany + per-question
    const answers = [];

    // Summary as a special answer
    if (result.summary) {
      answers.push({
        questionId: "__summary__",
        answerText: result.summary,
        answerHash: await sha256(normalizeText(result.summary)),
        editedByUser: false,
        updatedAt: now,
      });
    }

    // Why Company as a special answer
    if (result.whyCompany) {
      answers.push({
        questionId: "__whyCompany__",
        answerText: result.whyCompany,
        answerHash: await sha256(normalizeText(result.whyCompany)),
        editedByUser: false,
        updatedAt: now,
      });
    }

    // Per-question answers
    for (let i = 0; i < result.answers.length; i++) {
      const q = questions[i];
      const a = result.answers[i];
      if (q && a) {
        answers.push({
          questionId: q.questionId,
          answerText: a.answer,
          answerHash: await sha256(normalizeText(a.answer)),
          editedByUser: false,
          updatedAt: now,
        });
      }
    }

    // Compute job content hash if we have a snapshot
    let jobContentHash: string | null = null;
    const job = await getJob(key);
    if (job?.jobContentHash) {
      jobContentHash = job.jobContentHash;
    }

    const doc: SmartAnswersDoc = {
      schemaVersion: JOB_SCHEMA_VERSION,
      answersId,
      postingKey: key,
      createdAt: now,
      updatedAt: now,
      model: result.model,
      promptVersion: "1",
      jobContentHash,
      questions,
      answers,
    };

    await putAnswers(doc);
    return doc;
  }

  function handleCancelGeneration() {
    if (state.phase !== "generating") return;
    generationIdRef.current++; // ignore result when it arrives
    setState({
      phase: "detected",
      fields: state.fields,
      openQuestionCount: state.openQuestionCount,
      debugCounts: state.debugCounts,
    });
  }

  async function handleSmartFill() {
    if (state.phase !== "generated") return;
    const { context, result } = state;

    setState({ phase: "smart-filling" });

    // Build fill entries from edited answers
    const fillEntries = result.answers.map((a, i) => ({
      targetSelector: a.selectorCandidates[0] ?? "",
      selectorCandidates: a.selectorCandidates,
      signals: context.questions[i]?.signals ?? [],
      value: editedAnswers[i] ?? a.answer,
    }));

    try {
      const resp = await sendToActiveTab({
        type: "FILL_SMART_ANSWERS",
        answers: fillEntries,
      });
      if (resp.type === "SMART_FILL_COMPLETE") {
        setState({ phase: "smart-filled", outcomes: resp.outcomes });

        // Auto-save successful answers to library
        autoSaveSmartAnswers(resp.outcomes, fillEntries, context).catch((err) => {
          console.error("[Midnight Sun] Answer library auto-save failed:", err);
        });
      }
    } catch (err) {
      setState({ phase: "error", message: "Failed to fill smart answers." });
    }
  }

  /**
   * Auto-save filled smart answers to the Answer Library.
   * Only saves answers that were successfully filled.
   */
  async function autoSaveSmartAnswers(
    outcomes: SmartFillOutcome[],
    fillEntries: Array<{ signals: string[]; value: string }>,
    context: JobContext
  ) {
    const toSave: Array<{
      questionText: string;
      answer: string;
      inputType: "textarea";
    }> = [];

    for (let i = 0; i < outcomes.length; i++) {
      const outcome = outcomes[i];
      const entry = fillEntries[i];
      if (!outcome?.filled || !entry) continue;

      const questionText = context.questions[i]?.label ?? entry.signals[0] ?? "";
      if (!questionText || !entry.value) continue;

      toSave.push({
        questionText,
        answer: entry.value,
        inputType: "textarea",
      });
    }

    if (toSave.length > 0) {
      const count = await batchSaveAnswers(toSave);
      if (count > 0) {
        showToast(`Saved ${count} answer${count > 1 ? "s" : ""} for next time`);
      }
    }
  }

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }

  /**
   * Persist an edit to the cached SmartAnswersDoc.
   * Called onBlur from answer textareas.
   */
  async function persistEdit(questionId: string, value: string) {
    const doc = answersDocRef.current;
    if (!doc) return;

    const now = new Date().toISOString();
    const answerIdx = doc.answers.findIndex((a) => a.questionId === questionId);

    if (answerIdx >= 0) {
      doc.answers[answerIdx] = {
        ...doc.answers[answerIdx],
        answerText: value,
        answerHash: await sha256(normalizeText(value)),
        editedByUser: true,
        updatedAt: now,
      };
    } else {
      // New answer entry (e.g., for summary/whyCompany that didn't exist)
      doc.answers.push({
        questionId,
        answerText: value,
        answerHash: await sha256(normalizeText(value)),
        editedByUser: true,
        updatedAt: now,
      });
    }

    doc.updatedAt = now;
    answersDocRef.current = doc;

    try {
      await putAnswers(doc);
    } catch (err) {
      console.error("[Midnight Sun] Edit persist failed:", err);
    }
  }

  /**
   * Regenerate smart answers — creates a NEW SmartAnswersDoc.
   * Old doc is preserved for history.
   */
  async function handleRegenerate() {
    if (state.phase !== "generated") return;
    const { fields, context, openQuestionCount: oqCount, debugCounts: dc } = state;

    // Reset to detected, then generate fresh
    answersDocRef.current = null;
    setState({ phase: "detected", fields, openQuestionCount: oqCount, debugCounts: dc });

    // Small delay to let state settle, then trigger generation
    await generateSmartAnswers(fields, context, oqCount, dc);
  }

  async function handleResumeSelect(resumeId: string | null) {
    setSelectedResumeId(resumeId);
    // Link resume to job record
    if (postingKey) {
      const job = await getJob(postingKey);
      if (job) {
        await upsertJob({ ...job, linkedResumeId: resumeId });
      }
    }
  }

  async function handleGenerateResume(context: JobContext, generateType: "resume" | "cover-letter" = "resume", skipGapCheck = false) {
    setGeneratingResume(true);
    try {
      const [profile, settings, voice, rawResume] = await Promise.all([
        getProfile(),
        getSettings(),
        getVoice(),
        getRawResume(),
      ]);

      if (!profile.firstName && !profile.email) {
        throw new Error("Import your profile first.");
      }

      // Use selected resume content, fall back to stored raw resume text
      let existingResume: string | undefined;
      if (selectedResumeId) {
        const selected = availableResumes.find((r) => r.resumeId === selectedResumeId);
        if (selected?.content) {
          existingResume = selected.content;
        }
      }
      if (!existingResume && rawResume) {
        existingResume = rawResume;
      }

      // --- Gap detection ---
      if (!skipGapCheck && hasProfileGaps(profile, rawResume)) {
        setCheckingGaps(true);
        setPendingGapGenType(generateType);
        try {
          const gapResult = await sendToBackground({
            type: "DETECT_PROFILE_GAPS",
            context,
            profile,
            providerConfig: settings.providerConfig,
            existingResume,
          });
          if (gapResult.type === "PROFILE_GAPS_RESULT" && gapResult.questions.length > 0) {
            setGapQuestions(gapResult.questions);
            setGapAnswers({});
            setCheckingGaps(false);
            setGeneratingResume(false);
            return; // Show gap form
          }
        } catch {
          // Gap detection failed — proceed
        }
        setCheckingGaps(false);
      }

      const messageType = generateType === "cover-letter" ? "GENERATE_COVER_LETTER" : "GENERATE_RESUME";
      const resultType = generateType === "cover-letter" ? "COVER_LETTER_RESULT" : "RESUME_RESULT";

      const genStart = performance.now();
      const result = await sendToBackground({
        type: messageType,
        context,
        profile,
        providerConfig: settings.providerConfig,
        voice: voice.corePitch ? voice : undefined,
        existingResume,
      });
      const genDurationMs = Math.round(performance.now() - genStart);

      if (result.type === resultType && result.content) {
        const now = new Date().toISOString();
        const suffix = generateType === "cover-letter" ? " Cover Letter" : "";
        const doc: ResumeDoc = {
          resumeId: crypto.randomUUID(),
          name: `${profile.firstName} ${profile.lastName} - ${context.company}${suffix}`.trim(),
          content: result.content,
          source: "generated",
          docType: generateType,
          generatedForJob: postingKey ?? undefined,
          createdAt: now,
          updatedAt: now,
        };
        await saveResume(doc);
        setSelectedResumeId(doc.resumeId);
        setAvailableResumes(await listResumes());

        // Link to job record
        if (postingKey) {
          const job = await getJob(postingKey);
          if (job) {
            await upsertJob({ ...job, linkedResumeId: doc.resumeId });
          }
        }

        // Log successful generation
        await saveGenerationRun({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          url: context.url,
          company: context.company,
          role: context.title,
          docType: generateType,
          model: (result as { model?: string }).model,
          durationMs: genDurationMs,
          contentLength: result.content.length,
          source: "fill-preview",
        });
      } else {
        const errMsg = (result as { error?: string }).error || "Generation failed";
        // Log failed generation
        await saveGenerationRun({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          url: context.url,
          company: context.company,
          role: context.title,
          docType: generateType,
          model: (result as { model?: string }).model,
          durationMs: genDurationMs,
          error: errMsg,
          contentLength: 0,
          source: "fill-preview",
        });
        throw new Error(errMsg);
      }
    } catch (err) {
      setSmartError(err instanceof Error ? err.message : "Resume generation failed");
    } finally {
      setGeneratingResume(false);
    }
  }

  async function handleFillPreviewGapSave(context: JobContext) {
    const profile = await getProfile();
    let updated = { ...profile };

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
        updated.experiences[0] = {
          ...updated.experiences[0],
          highlights: [...(updated.experiences[0].highlights ?? []), answer],
        };
      }
      // "education" and "other" answers aren't easily mappable — they improve generation via richer profile
    }

    await saveProfile(updated);
    setGapQuestions(null);
    setGapAnswers({});
    handleGenerateResume(context, pendingGapGenType, true);
  }

  function handleFillPreviewGapSkip(context: JobContext) {
    setGapQuestions(null);
    setGapAnswers({});
    handleGenerateResume(context, pendingGapGenType, true);
  }

  async function handleAttachResume() {
    if (!selectedResumeId) {
      setAttachError("Select a resume first");
      setAttachStatus("error");
      return;
    }

    const resume = availableResumes.find((r) => r.resumeId === selectedResumeId);
    if (!resume?.content) {
      setAttachError("Selected resume has no content");
      setAttachStatus("error");
      return;
    }

    setAttachStatus("detecting");
    setAttachError(null);

    try {
      // 1. Detect file inputs on the page
      const detectResp = await sendToActiveTab({ type: "DETECT_FILE_INPUTS" });
      if (detectResp.type !== "FILE_INPUTS_DETECTED") {
        throw new Error("Failed to scan page for file inputs");
      }

      const { fileInputs } = detectResp;
      if (fileInputs.length === 0) {
        throw new Error("No file upload field found on this page");
      }

      // 2. Pick the best target — prefer label matching resume/cv
      const resumePattern = /resume|cv|curriculum/i;
      let target: FileInputInfo = fileInputs[0];
      for (const fi of fileInputs) {
        if (resumePattern.test(fi.label)) {
          target = fi;
          break;
        }
      }

      // 3. Check accept attribute compatibility
      if (target.accept) {
        const acceptLower = target.accept.toLowerCase();
        const compatible =
          !acceptLower || // empty = any file
          acceptLower.includes(".md") ||
          acceptLower.includes(".txt") ||
          acceptLower.includes("text/") ||
          acceptLower.includes("*/*") ||
          acceptLower.includes(".doc") || // .docx fields often accept text too
          acceptLower.includes("application/");
        if (!compatible) {
          throw new Error(`File input only accepts: ${target.accept}. Try downloading the resume and uploading manually.`);
        }
      }

      // 4. Attach the file
      setAttachStatus("attaching");
      const fileName = `${resume.name.replace(/[^a-zA-Z0-9_\-. ]/g, "_")}.md`;

      const attachResp = await sendToActiveTab({
        type: "ATTACH_FILE",
        fileInput: target,
        fileName,
        content: resume.content,
        mimeType: "text/markdown",
      });

      if (attachResp.type === "ATTACH_FILE_RESULT" && attachResp.success) {
        setAttachStatus("success");
        showToast(`Attached "${resume.name}" to file input`);
        // Reset after a brief moment
        setTimeout(() => setAttachStatus("idle"), 2000);
      } else {
        throw new Error(
          (attachResp as { error?: string }).error || "Failed to attach file"
        );
      }
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : "Attach failed");
      setAttachStatus("error");
    }
  }

  return (
    <div className="p-4 space-y-4">
      {/* Page context */}
      {pageInfo && pageInfo.company && (
        <div className="bg-surface-2 rounded-lg p-3">
          <p className="text-xs text-white/40 uppercase tracking-wider">
            Detected
          </p>
          <p className="text-sm font-medium text-white/90">
            {pageInfo.company}
            {pageInfo.role && ` · ${pageInfo.role}`}
          </p>
        </div>
      )}

      {/* Main action */}
      {state.phase === "idle" && (
        <div className="text-center py-8">
          <p className="text-white/50 text-sm mb-4">
            Navigate to a job application page, then:
          </p>
          <button
            onClick={handleAutoApply}
            className="w-full py-3 bg-aurora-teal/20 hover:bg-aurora-teal/30 text-aurora-teal rounded-lg font-medium text-sm transition-colors"
          >
            Auto-Apply
          </button>
          <button
            onClick={handleDetect}
            className="text-xs text-white/30 hover:text-white/50 mt-3 block mx-auto"
          >
            Scan Only
          </button>
        </div>
      )}

      {state.phase === "detecting" && (
        <div className="text-center py-8">
          <div className="animate-pulse text-aurora-teal text-2xl mb-2">*</div>
          <p className="text-white/50 text-sm">Scanning form fields...</p>
        </div>
      )}

      {state.phase === "no-profile" && (
        <div className="text-center py-8">
          <p className="text-aurora-pink text-sm mb-2">
            No profile found
          </p>
          <p className="text-white/40 text-xs">
            Go to the Profile tab and paste your resume first.
          </p>
        </div>
      )}

      {state.phase === "auto-applying" && (
        <div className="text-center py-8 space-y-3">
          <div className="relative mx-auto w-10 h-10">
            <div className="absolute inset-0 rounded-full bg-aurora-teal/20 animate-ping" />
            <div className="absolute inset-2 rounded-full bg-aurora-teal/40 animate-pulse" />
          </div>
          <p className="text-white/70 text-sm">{state.status}</p>
          <p className="text-white/20 text-[10px]">
            Scanning, filling, and generating in one step.
          </p>
        </div>
      )}

      {state.phase === "detected" && (
        <DetectedPhaseView
          state={state}
          smartError={smartError}
          choiceGroups={choiceGroupsRef.current}
          onRescan={handleDetect}
          onFill={handleFill}
          onGenerateSmart={handleGenerateSmart}
        />
      )}

      {state.phase === "filling" && (
        <div className="text-center py-8">
          <div className="animate-spin text-aurora-teal text-2xl mb-2">*</div>
          <p className="text-white/50 text-sm">Filling fields...</p>
        </div>
      )}

      {/* Smart Apply: Generating */}
      {state.phase === "generating" && (
        <GeneratingView onCancel={handleCancelGeneration} />
      )}

      {/* Smart Apply: Generated — editable previews */}
      {state.phase === "generated" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-xs text-white/40 uppercase tracking-wider">
              {state.cached ? "Cached Answers" : "Generated Answers"}
            </p>
            {state.cached && (
              <span className="text-[10px] bg-aurora-teal/20 text-aurora-teal px-1.5 py-0.5 rounded">
                Cached
              </span>
            )}
          </div>

          {/* Auto-fill stats (shown when auto-apply did deterministic fill before generation) */}
          {autoFillStatsRef.current && autoFillStatsRef.current.filled > 0 && (
            <div className="bg-aurora-teal/10 border border-aurora-teal/20 rounded-lg p-2.5">
              <p className="text-xs text-aurora-teal">
                {autoFillStatsRef.current.filled} field{autoFillStatsRef.current.filled > 1 ? "s" : ""} auto-filled
                {autoFillStatsRef.current.manual > 0 && ` · ${autoFillStatsRef.current.manual} manual`}
                {autoFillStatsRef.current.failed > 0 && ` · ${autoFillStatsRef.current.failed} failed`}
              </p>
              <p className="text-[10px] text-white/30 mt-0.5">
                Review smart answers below before applying.
              </p>
            </div>
          )}

          {/* New questions banner */}
          {state.cached && (state.newQuestionCount ?? 0) > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
              <p className="text-xs text-amber-400">
                {state.newQuestionCount} new question{(state.newQuestionCount ?? 0) > 1 ? "s" : ""} detected since last generation.
              </p>
              <button
                onClick={handleRegenerate}
                className="text-xs text-amber-300 hover:text-amber-200 mt-1 underline"
              >
                Regenerate all answers
              </button>
            </div>
          )}

          {/* Voice nudge */}
          {!voiceNudgeDismissed && !state.result.model?.includes("cached") && (
            <VoiceNudge onDismiss={() => setVoiceNudgeDismissed(true)} />
          )}

          {/* Resume picker */}
          <div className="bg-surface-2 rounded-lg p-2.5 border border-white/5">
            <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1.5">
              Resume for this application
            </label>
            <select
              value={selectedResumeId ?? ""}
              onChange={(e) => handleResumeSelect(e.target.value || null)}
              className="w-full bg-surface-3 text-white/80 text-xs rounded px-2 py-1.5 border border-white/10 focus:border-aurora-purple/50 focus:outline-none mb-2"
            >
              <option value="">None selected</option>
              {availableResumes.map((r) => (
                <option key={r.resumeId} value={r.resumeId}>
                  {r.name}{r.docType === "cover-letter" ? " (CL)" : ""}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => handleGenerateResume(state.context, "resume")}
                disabled={generatingResume}
                className={`flex-1 text-[10px] px-2 py-1.5 bg-aurora-teal/20 hover:bg-aurora-teal/30 text-aurora-teal rounded transition-colors disabled:opacity-50 ${generatingResume ? "animate-pulse" : ""}`}
              >
                {generatingResume ? "Generating..." : "Gen Resume"}
              </button>
              <button
                onClick={() => handleGenerateResume(state.context, "cover-letter")}
                disabled={generatingResume}
                className={`flex-1 text-[10px] px-2 py-1.5 bg-aurora-purple/20 hover:bg-aurora-purple/30 text-aurora-purple rounded transition-colors disabled:opacity-50 ${generatingResume ? "animate-pulse" : ""}`}
                title="Generate a cover letter for this application"
              >
                {generatingResume ? "Generating..." : "Gen Cover Letter"}
              </button>
            </div>
            {selectedResumeId && (
              <div className="mt-2">
                <button
                  onClick={handleAttachResume}
                  disabled={attachStatus === "detecting" || attachStatus === "attaching"}
                  className={`w-full text-[10px] px-2 py-1.5 rounded transition-colors disabled:opacity-50 ${
                    attachStatus === "success"
                      ? "bg-aurora-green/20 text-aurora-green"
                      : attachStatus === "error"
                        ? "bg-aurora-pink/20 text-aurora-pink"
                        : "bg-white/5 hover:bg-white/10 text-white/50"
                  }`}
                >
                  {attachStatus === "detecting" ? "Scanning for file input..." :
                   attachStatus === "attaching" ? "Attaching..." :
                   attachStatus === "success" ? "Attached ✓" :
                   "Attach to File Input"}
                </button>
                {attachStatus === "error" && attachError && (
                  <p className="text-[10px] text-aurora-pink/70 mt-1">{attachError}</p>
                )}
              </div>
            )}
          </div>

          {/* Gap Detection Form */}
          {(gapQuestions || checkingGaps) && (
            <div className="space-y-2">
              {checkingGaps ? (
                <p className="text-[10px] text-white/40 animate-pulse text-center py-2">Checking profile...</p>
              ) : gapQuestions && gapQuestions.length > 0 ? (
                <>
                  <div className="bg-aurora-teal/10 border border-aurora-teal/20 rounded-lg p-2">
                    <p className="text-[10px] text-aurora-teal font-medium">A few details would improve the output</p>
                  </div>
                  {gapQuestions.map((q) => (
                    <div key={q.id} className="space-y-0.5">
                      <label className="text-[10px] text-white/60">{q.question}</label>
                      <textarea
                        value={gapAnswers[q.id] ?? ""}
                        onChange={(e) => setGapAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                        placeholder={q.placeholder}
                        className="w-full bg-surface-2 text-white/80 text-[10px] rounded p-1.5 border border-white/10 focus:border-aurora-teal/40 focus:outline-none resize-none"
                        rows={2}
                      />
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleFillPreviewGapSave(state.context)}
                      className="flex-1 py-1.5 bg-aurora-teal/30 hover:bg-aurora-teal/50 text-aurora-teal text-[10px] rounded transition-colors"
                    >
                      Save &amp; Generate
                    </button>
                    <button
                      onClick={() => handleFillPreviewGapSkip(state.context)}
                      className="py-1.5 px-2 bg-surface-2 hover:bg-surface-3 text-white/40 text-[10px] rounded transition-colors"
                    >
                      Skip
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          )}

          {/* Summary */}
          <div>
            <label className="text-xs text-white/50 block mb-1">
              Work Experience Summary
            </label>
            <textarea
              value={editedSummary}
              onChange={(e) => setEditedSummary(e.target.value)}
              onBlur={() => persistEdit("__summary__", editedSummary)}
              className="w-full bg-surface-2 text-white/90 text-xs rounded-md p-2.5 border border-white/10 focus:border-aurora-purple/50 focus:outline-none resize-y min-h-[80px]"
              rows={4}
            />
          </div>

          {/* Why Company */}
          <div>
            <label className="text-xs text-white/50 block mb-1">
              Why This Company
            </label>
            <textarea
              value={editedWhyCompany}
              onChange={(e) => setEditedWhyCompany(e.target.value)}
              onBlur={() => persistEdit("__whyCompany__", editedWhyCompany)}
              className="w-full bg-surface-2 text-white/90 text-xs rounded-md p-2.5 border border-white/10 focus:border-aurora-purple/50 focus:outline-none resize-y min-h-[60px]"
              rows={3}
            />
          </div>

          {/* Per-question answers */}
          {state.result.answers.map((a, i) => (
            <div key={i}>
              <label className="text-xs text-white/50 block mb-1">
                {a.label}
              </label>
              <textarea
                value={editedAnswers[i] ?? ""}
                onChange={(e) => {
                  const updated = [...editedAnswers];
                  updated[i] = e.target.value;
                  setEditedAnswers(updated);
                }}
                onBlur={() => {
                  // Persist edit using question label hash
                  sha256(normalizeText(a.label)).then((hash) => {
                    persistEdit(hash, editedAnswers[i] ?? "");
                  });
                }}
                className="w-full bg-surface-2 text-white/90 text-xs rounded-md p-2.5 border border-white/10 focus:border-aurora-purple/50 focus:outline-none resize-y min-h-[60px]"
                rows={3}
              />
            </div>
          ))}

          {/* Metadata */}
          <p className="text-[10px] text-white/30 text-center">
            {state.cached
              ? `Cached · ${state.result.model}`
              : `${state.result.model} · ${Math.round(state.result.durationMs / 1000)}s · ${(state.result.promptChars / 1000).toFixed(1)}k prompt chars`}
          </p>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleSmartFill}
              className="flex-1 py-2.5 bg-aurora-purple/20 hover:bg-aurora-purple/30 text-aurora-purple rounded-lg font-medium text-xs transition-colors"
            >
              Apply Answers
            </button>
            <button
              onClick={handleRegenerate}
              className="py-2.5 px-3 bg-surface-2 hover:bg-surface-3 rounded-lg text-xs text-white/50"
            >
              Regenerate
            </button>
            <button
              onClick={() => setState({ phase: "detected", fields: state.fields, openQuestionCount: state.openQuestionCount, debugCounts: state.debugCounts })}
              className="py-2.5 px-3 bg-surface-2 hover:bg-surface-3 rounded-lg text-xs text-white/50"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {/* Smart Apply: Filling */}
      {state.phase === "smart-filling" && (
        <div className="text-center py-8">
          <div className="animate-spin text-aurora-purple text-2xl mb-2">*</div>
          <p className="text-white/50 text-sm">Filling smart answers...</p>
        </div>
      )}

      {/* Smart Apply: Fill results */}
      {state.phase === "smart-filled" && (
        <div className="space-y-3">
          <div className="text-center py-3">
            <p className="text-aurora-green text-lg mb-1">Smart Fill Done</p>
            <div className="flex justify-center gap-3 text-xs">
              <span className="text-aurora-green">
                {state.outcomes.filter((o) => o.filled).length} filled
              </span>
              {state.outcomes.filter((o) => !o.filled).length > 0 && (
                <span className="text-aurora-pink">
                  {state.outcomes.filter((o) => !o.filled).length} failed
                </span>
              )}
              {state.outcomes.filter((o) => o.repairUsed).length > 0 && (
                <span className="text-amber-400">
                  {state.outcomes.filter((o) => o.repairUsed).length} repaired
                </span>
              )}
            </div>
          </div>

          {/* Per-answer outcomes */}
          <div className="space-y-1 max-h-[180px] overflow-y-auto">
            {state.outcomes.map((o, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-xs px-3 py-1.5"
              >
                <span>{o.filled ? "✓" : "✗"}</span>
                <span
                  className={o.filled ? "text-white/70" : "text-aurora-pink/70"}
                >
                  {o.label}
                </span>
                {o.repairUsed && (
                  <span className="text-amber-400/50">(repaired)</span>
                )}
                {o.failureReason && (
                  <span className="text-white/30 truncate flex-1">
                    {o.failureReason}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setState({ phase: "idle" })}
              className="flex-1 py-2 bg-surface-2 hover:bg-surface-3 rounded-lg text-xs text-white/50"
            >
              Start Over
            </button>
            <button
              onClick={handleDetect}
              className="flex-1 py-2 bg-surface-2 hover:bg-surface-3 rounded-lg text-xs text-white/50"
            >
              Re-scan
            </button>
          </div>

          <p className="text-xs text-white/30 text-center">
            Review the form and submit when ready.
          </p>
        </div>
      )}

      {state.phase === "auto-applied" && (
        <div className="space-y-3">
          <div className="text-center py-3">
            <p className="text-aurora-green text-lg mb-1">Auto-Apply Complete</p>
            <div className="flex justify-center gap-3 text-xs">
              <span className="text-aurora-green">
                {state.run.stats.filled} filled
              </span>
              {state.run.stats.manualRequired > 0 && (
                <span className="text-amber-400">
                  {state.run.stats.manualRequired} manual
                </span>
              )}
              {state.run.stats.failed > 0 && (
                <span className="text-aurora-pink">
                  {state.run.stats.failed} failed
                </span>
              )}
              <span className="text-white/30">
                {state.run.stats.skipped} skipped
              </span>
            </div>
          </div>

          {/* Resume picker */}
          <div className="bg-surface-2 rounded-lg p-2.5 border border-white/5">
            <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1.5">
              Resume for this application
            </label>
            <select
              value={selectedResumeId ?? ""}
              onChange={(e) => handleResumeSelect(e.target.value || null)}
              className="w-full bg-surface-3 text-white/80 text-xs rounded px-2 py-1.5 border border-white/10 focus:border-aurora-purple/50 focus:outline-none"
            >
              <option value="">None selected</option>
              {availableResumes.map((r) => (
                <option key={r.resumeId} value={r.resumeId}>
                  {r.name}{r.docType === "cover-letter" ? " (CL)" : ""}
                </option>
              ))}
            </select>
            {selectedResumeId && (
              <div className="mt-2">
                <button
                  onClick={handleAttachResume}
                  disabled={attachStatus === "detecting" || attachStatus === "attaching"}
                  className={`w-full text-[10px] px-2 py-1.5 rounded transition-colors disabled:opacity-50 ${
                    attachStatus === "success"
                      ? "bg-aurora-green/20 text-aurora-green"
                      : attachStatus === "error"
                        ? "bg-aurora-pink/20 text-aurora-pink"
                        : "bg-white/5 hover:bg-white/10 text-white/50"
                  }`}
                >
                  {attachStatus === "detecting" ? "Scanning for file input..." :
                   attachStatus === "attaching" ? "Attaching..." :
                   attachStatus === "success" ? "Attached ✓" :
                   "Attach to File Input"}
                </button>
                {attachStatus === "error" && attachError && (
                  <p className="text-[10px] text-aurora-pink/70 mt-1">{attachError}</p>
                )}
              </div>
            )}
          </div>

          {/* Manual-required warnings */}
          {state.run.fillResults.filter((r) => r.manualRequired).length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
              <p className="text-[10px] text-amber-400 font-medium uppercase tracking-wider mb-1.5">
                Needs Manual Input
              </p>
              {state.run.fillResults
                .filter((r) => r.manualRequired)
                .map((r, i) => (
                  <p key={i} className="text-xs text-amber-300/70">
                    {r.matchedField} — {r.error}
                  </p>
                ))}
            </div>
          )}

          {/* Results detail */}
          <div className="space-y-1 max-h-[180px] overflow-y-auto">
            {state.run.fillResults.map((r, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-xs px-3 py-1.5"
              >
                <span>
                  {r.success ? "\u2713" : r.manualRequired ? "!" : "\u2717"}
                </span>
                <span
                  className={
                    r.success
                      ? "text-white/70"
                      : r.manualRequired
                        ? "text-amber-400/70"
                        : "text-aurora-pink/70"
                  }
                >
                  {r.matchedField || "unknown"}
                </span>
                {r.error && (
                  <span className="text-white/30 truncate flex-1">
                    {r.error}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => setState({ phase: "idle" })}
              className="flex-1 py-2 bg-surface-2 hover:bg-surface-3 rounded-lg text-xs text-white/50"
            >
              Start Over
            </button>
            <button
              onClick={handleDetect}
              className="flex-1 py-2 bg-surface-2 hover:bg-surface-3 rounded-lg text-xs text-white/50"
            >
              Re-scan
            </button>
          </div>

          <p className="text-xs text-white/30 text-center">
            Review the form and submit when ready.
          </p>
        </div>
      )}

      {state.phase === "filled" && (
        <div className="space-y-3">
          {/* Stats summary */}
          <div className="text-center py-3">
            <p className="text-aurora-green text-lg mb-1">Done!</p>
            <div className="flex justify-center gap-3 text-xs">
              <span className="text-aurora-green">
                {state.run.stats.filled} filled
              </span>
              {state.run.stats.manualRequired > 0 && (
                <span className="text-amber-400">
                  {state.run.stats.manualRequired} manual
                </span>
              )}
              {state.run.stats.failed > 0 && (
                <span className="text-aurora-pink">
                  {state.run.stats.failed} failed
                </span>
              )}
              <span className="text-white/30">
                {state.run.stats.skipped} skipped
              </span>
            </div>
          </div>

          {/* Manual-required warnings (these need human attention) */}
          {state.run.fillResults.filter((r) => r.manualRequired).length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
              <p className="text-[10px] text-amber-400 font-medium uppercase tracking-wider mb-1.5">
                Needs Manual Input
              </p>
              {state.run.fillResults
                .filter((r) => r.manualRequired)
                .map((r, i) => (
                  <p key={i} className="text-xs text-amber-300/70">
                    {r.matchedField} — {r.error}
                  </p>
                ))}
            </div>
          )}

          {/* Results detail */}
          <div className="space-y-1 max-h-[180px] overflow-y-auto">
            {state.run.fillResults.map((r, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-xs px-3 py-1.5"
              >
                <span>
                  {r.success ? "✓" : r.manualRequired ? "!" : "✗"}
                </span>
                <span
                  className={
                    r.success
                      ? "text-white/70"
                      : r.manualRequired
                        ? "text-amber-400/70"
                        : "text-aurora-pink/70"
                  }
                >
                  {r.matchedField || "unknown"}
                </span>
                {r.error && (
                  <span className="text-white/30 truncate flex-1">
                    {r.error}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => setState({ phase: "idle" })}
              className="flex-1 py-2 bg-surface-2 hover:bg-surface-3 rounded-lg text-xs text-white/50"
            >
              Start Over
            </button>
            <button
              onClick={handleDetect}
              className="flex-1 py-2 bg-surface-2 hover:bg-surface-3 rounded-lg text-xs text-white/50"
            >
              Re-scan
            </button>
          </div>

          <p className="text-xs text-white/30 text-center">
            Review the form and submit when ready.
          </p>
        </div>
      )}

      {state.phase === "error" && (
        <div className="text-center py-8">
          <p className="text-aurora-pink text-sm mb-3">{state.message}</p>
          <button
            onClick={() => setState({ phase: "idle" })}
            className="text-xs text-white/40 hover:text-white/70"
          >
            Try again
          </button>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-4 left-4 right-4 bg-aurora-teal/20 border border-aurora-teal/30 rounded-lg px-3 py-2 text-xs text-aurora-teal text-center animate-pulse z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

// --- Generating View with elapsed timer ---

function GeneratingView({ onCancel }: { onCancel: () => void }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="text-center py-8 space-y-3">
      <div className="relative mx-auto w-10 h-10">
        <div className="absolute inset-0 rounded-full bg-aurora-purple/20 animate-ping" />
        <div className="absolute inset-2 rounded-full bg-aurora-purple/40 animate-pulse" />
      </div>
      <p className="text-white/70 text-sm">Generating tailored answers...</p>
      <p className="text-white/30 text-xs">{elapsed}s elapsed</p>
      <p className="text-white/20 text-[10px]">
        Generation time depends on model size.
      </p>
      <button
        onClick={onCancel}
        className="text-xs text-white/40 hover:text-white/70 mt-2"
      >
        Cancel
      </button>
    </div>
  );
}

// --- Detected Phase View (field list + diagnostics + actions) ---

function DetectedPhaseView({
  state,
  smartError,
  choiceGroups,
  onRescan,
  onFill,
  onGenerateSmart,
}: {
  state: { fields: DetectedField[]; openQuestionCount: number; debugCounts: DebugCounts };
  smartError: string | null;
  choiceGroups: ChoiceGroup[];
  onRescan: () => void;
  onFill: () => void;
  onGenerateSmart: () => void;
}) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const { fields, openQuestionCount, debugCounts } = state;

  const matchedCount = fields.filter((f) => f.matchedField && f.category !== "demographic").length;
  const demographicCount = fields.filter((f) => f.category === "demographic").length;
  const unmatchedCount = fields.length - matchedCount - demographicCount;
  const fillableGroupCount = choiceGroups.filter((g) => g.category === "fillable" && g.matchedField).length;

  return (
    <div className="space-y-3">
      {/* Multi-segment count breakdown */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-white/70">
          <span className="text-aurora-teal font-medium">{matchedCount}</span>
          <span className="text-white/40"> matched</span>
          {demographicCount > 0 && (
            <>
              {" "}<span className="text-aurora-purple font-medium">{demographicCount}</span>
              <span className="text-white/40"> demographic</span>
            </>
          )}
          {fillableGroupCount > 0 && (
            <>
              {" "}<span className="text-aurora-teal font-medium">{fillableGroupCount}</span>
              <span className="text-white/40"> group{fillableGroupCount > 1 ? "s" : ""}</span>
            </>
          )}
          {" "}<span className="text-white/30">{unmatchedCount}</span>
          <span className="text-white/40"> unmatched</span>
          <span className="text-white/30"> / {fields.length}</span>
        </p>
        <button
          onClick={onRescan}
          className="text-xs text-white/40 hover:text-white/70"
        >
          Re-scan
        </button>
      </div>

      {/* All fields — matched → demographic → unmatched, hidden last within each */}
      <div className="space-y-1 max-h-[320px] overflow-y-auto">
        {[...fields]
          .sort((a, b) => {
            // Sort: matched > demographic > unmatched; within each, visible first
            const categoryOrder = (f: DetectedField) =>
              f.matchedField && f.category !== "demographic" ? 0
              : f.category === "demographic" ? 1
              : 2;
            const aCat = categoryOrder(a);
            const bCat = categoryOrder(b);
            if (aCat !== bCat) return aCat - bCat;
            // Within same category: visible first
            if (a.visible !== b.visible) return a.visible ? -1 : 1;
            return b.confidence - a.confidence;
          })
          .map((field, i) => (
            <FieldDebugRow key={i} field={field} />
          ))}
      </div>

      {/* Diagnostics panel (collapsible) */}
      <button
        onClick={() => setShowDiagnostics(!showDiagnostics)}
        className="w-full flex items-center gap-1.5 text-[10px] text-white/30 hover:text-white/50 transition-colors"
      >
        <span className={`transition-transform ${showDiagnostics ? "rotate-90" : ""}`}>
          ▸
        </span>
        <span>
          Diagnostics: {debugCounts.rawInputs} inputs · {debugCounts.rawTextareas} textareas · {debugCounts.rawSelects} selects
          {debugCounts.iframes > 0 && ` · ${debugCounts.iframes} iframe${debugCounts.iframes > 1 ? "s" : ""} (${debugCounts.sameOriginIframes} same-origin)`}
          {debugCounts.filteredByVisibility > 0 && ` · ${debugCounts.filteredByVisibility} hidden`}
          {debugCounts.roleTextbox > 0 && ` · ${debugCounts.roleTextbox} role=textbox`}
          {debugCounts.contenteditable > 0 && ` · ${debugCounts.contenteditable} contenteditable`}
        </span>
      </button>

      {showDiagnostics && (
        <div className="bg-surface-2 rounded-md p-2.5 space-y-1.5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px]">
            <span className="text-white/30">Raw inputs</span>
            <span className={`text-white/50 ${debugCounts.rawInputs > 0 && matchedCount === 0 ? "text-aurora-pink" : ""}`}>{debugCounts.rawInputs}</span>
            <span className="text-white/30">Raw textareas</span>
            <span className="text-white/50">{debugCounts.rawTextareas}</span>
            <span className="text-white/30">Raw selects</span>
            <span className="text-white/50">{debugCounts.rawSelects}</span>
            <span className="text-white/30">role=textbox</span>
            <span className="text-white/50">{debugCounts.roleTextbox}</span>
            <span className="text-white/30">contenteditable</span>
            <span className="text-white/50">{debugCounts.contenteditable}</span>
            <span className="text-white/30">Iframes</span>
            <span className={`text-white/50 ${debugCounts.iframes > debugCounts.sameOriginIframes ? "text-amber-400" : ""}`}>
              {debugCounts.iframes} ({debugCounts.sameOriginIframes} same-origin)
            </span>
            <span className="text-white/30">Filtered (hidden)</span>
            <span className="text-white/50">{debugCounts.filteredByVisibility}</span>
          </div>
          {debugCounts.rawInputs > 0 && matchedCount === 0 && (
            <p className="text-[10px] text-aurora-pink/70 mt-1">
              Inputs found but none matched — signal extraction may need improvement for this ATS.
            </p>
          )}
          {debugCounts.iframes > debugCounts.sameOriginIframes && (
            <p className="text-[10px] text-amber-400/70 mt-1">
              {debugCounts.iframes - debugCounts.sameOriginIframes} cross-origin iframe(s) — form may be inside an unreachable frame.
            </p>
          )}
        </div>
      )}

      {/* Smart error banner */}
      {smartError && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
          <p className="text-xs text-amber-400">{smartError}</p>
        </div>
      )}

      {/* Action buttons */}
      <button
        onClick={onFill}
        disabled={matchedCount === 0}
        className={`w-full py-3 rounded-lg font-medium text-sm transition-colors ${
          matchedCount > 0
            ? "bg-aurora-teal/20 hover:bg-aurora-teal/30 text-aurora-teal"
            : "bg-surface-2 text-white/30 cursor-not-allowed"
        }`}
      >
        Fill All Matched Fields
        {matchedCount > 0 && ` (${matchedCount})`}
      </button>

      {/* Smart Answers — gated on open question count */}
      {openQuestionCount > 0 ? (
        <button
          onClick={onGenerateSmart}
          className="w-full py-3 bg-aurora-purple/20 hover:bg-aurora-purple/30 text-aurora-purple rounded-lg font-medium text-sm transition-colors"
        >
          Generate Smart Answers ({openQuestionCount} question
          {openQuestionCount > 1 ? "s" : ""})
        </button>
      ) : (
        <div className="w-full py-3 bg-surface-2 text-white/30 rounded-lg text-sm text-center cursor-not-allowed">
          No essay questions detected
        </div>
      )}
    </div>
  );
}

// --- Field Debug Row (expandable) ---

function FieldDebugRow({ field }: { field: DetectedField }) {
  const [expanded, setExpanded] = useState(false);
  const [explanation, setExplanation] = useState<MatchExplanation | null>(null);

  const isMatched = Boolean(field.matchedField);
  const isDemographicField = field.category === "demographic";
  const isHidden = !field.visible;

  // Lazy-load explanation on first expand
  function handleToggle() {
    if (!expanded && !explanation) {
      setExplanation(explainMatch(field.signals));
    }
    setExpanded(!expanded);
  }

  // Pick the best display label
  const displayLabel =
    field.structuredSignals.label ||
    field.structuredSignals.aria ||
    field.structuredSignals.nearbyText ||
    field.signals[0] ||
    field.selectorCandidates[0] ||
    "(unknown)";

  // Confidence dot color
  const dotColor = isDemographicField
    ? "bg-aurora-purple"
    : !isMatched
      ? "bg-white/20"
      : field.confidence > 0.8
        ? "bg-aurora-green"
        : field.confidence > 0.5
          ? "bg-aurora-teal"
          : "bg-aurora-purple";

  // Field name display
  const fieldLabel = isDemographicField
    ? "demographic"
    : isMatched
      ? field.matchedField
      : "unmatched";

  return (
    <div className={`bg-surface-2 rounded-md overflow-hidden ${isHidden ? "opacity-50" : ""}`}>
      {/* Collapsed row */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors"
      >
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
        <span className={`text-xs w-20 truncate flex-shrink-0 ${isDemographicField ? "text-aurora-purple/70" : "text-white/60"}`}>
          {fieldLabel}
        </span>
        {/* Badges */}
        {isDemographicField && (
          <span className="text-[9px] bg-aurora-purple/20 text-aurora-purple px-1 py-0.5 rounded flex-shrink-0">
            EEO
          </span>
        )}
        {isHidden && (
          <span className="text-[9px] bg-white/5 text-white/30 px-1 py-0.5 rounded flex-shrink-0">
            hidden
          </span>
        )}
        <span className="text-xs text-white/30 flex-1 truncate">
          {displayLabel}
        </span>
        {isMatched && (
          <span className="text-[10px] text-white/20 flex-shrink-0">
            {Math.round(field.confidence * 100)}%
          </span>
        )}
        <span
          className={`text-[10px] text-white/30 flex-shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          ▸
        </span>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-2.5 pt-0.5 border-t border-white/5 space-y-2">
          {/* Structured signals table */}
          <div>
            <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">
              Signals
            </p>
            <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px]">
              {renderSignalRow("label", field.structuredSignals.label)}
              {renderSignalRow("aria", field.structuredSignals.aria)}
              {renderSignalRow("name", field.structuredSignals.name)}
              {renderSignalRow("id", field.structuredSignals.id)}
              {renderSignalRow("placeholder", field.structuredSignals.placeholder)}
              {renderSignalRow("nearbyText", field.structuredSignals.nearbyText)}
              {renderSignalRow("automationId", field.structuredSignals.automationId)}
            </div>
          </div>

          {/* Match explanation */}
          {explanation && (
            <div>
              <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">
                Match Reason
              </p>
              {explanation.candidates.length === 0 ? (
                <p className="text-[10px] text-white/20 italic">
                  No keywords matched any signal
                </p>
              ) : (
                <div className="space-y-0.5">
                  {explanation.candidates.slice(0, 5).map((c, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]">
                      <span
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          c.confidence > 0.8
                            ? "bg-aurora-green"
                            : c.confidence > 0.5
                              ? "bg-aurora-teal"
                              : "bg-aurora-purple"
                        }`}
                      />
                      <span className="text-white/50">
                        {c.field}
                      </span>
                      <span className="text-white/20">
                        "{c.keyword}" {c.matchType} "{c.signal}"
                      </span>
                      <span className="text-white/20 ml-auto flex-shrink-0">
                        {Math.round(c.confidence * 100)}%
                      </span>
                    </div>
                  ))}
                  {explanation.candidates.length > 5 && (
                    <p className="text-[10px] text-white/15 italic">
                      +{explanation.candidates.length - 5} more candidates
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Selectors */}
          <div>
            <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">
              Selectors
            </p>
            <div className="space-y-0.5">
              {field.selectorCandidates.slice(0, 3).map((sel, i) => (
                <p
                  key={i}
                  className="text-[10px] text-white/20 font-mono truncate"
                >
                  {sel}
                </p>
              ))}
            </div>
          </div>

          {/* Meta */}
          <div className="flex gap-3 text-[10px] text-white/20">
            <span>type: {field.inputType}</span>
            <span>visible: {field.visible ? "yes" : "no"}</span>
            {field.category && <span>category: {field.category}</span>}
            {field.currentValue && (
              <span className="truncate">
                value: "{field.currentValue.slice(0, 40)}"
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Voice nudge banner — shown in generated phase when voice.corePitch is empty.
 * Loads voice on mount to check; renders nothing if voice is already set.
 */
function VoiceNudge({ onDismiss }: { onDismiss: () => void }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    getVoice().then((v) => {
      if (!v.corePitch) setShow(true);
    });
  }, []);

  if (!show) return null;

  return (
    <div className="bg-aurora-purple/10 border border-aurora-purple/20 rounded-lg p-2.5 flex items-start gap-2">
      <div className="flex-1">
        <p className="text-xs text-aurora-purple">
          Set up your Voice for personalized answers
        </p>
        <p className="text-[10px] text-white/30 mt-0.5">
          Add your pitch and tone in the Profile tab.
        </p>
      </div>
      <button
        onClick={onDismiss}
        className="text-white/30 hover:text-white/50 text-xs flex-shrink-0"
      >
        ✕
      </button>
    </div>
  );
}

function renderSignalRow(label: string, value?: string) {
  if (!value) return null;
  return (
    <>
      <span className="text-white/30">{label}</span>
      <span className="text-white/50 truncate">{value}</span>
    </>
  );
}
