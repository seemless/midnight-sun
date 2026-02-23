// ============================================================
// Background Service Worker
// Handles: badge updates, storage coordination, LLM proxy
// ============================================================

import { getApplications } from "../shared/storage";
import { getProvider } from "../lib/llm";
import { buildGapDetectionPrompt, parseGapDetectionResponse } from "../lib/llm/prompt";
import type { Message, FrameDetectResult } from "../shared/types";

// Update badge with application count on install/startup
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[Midnight Sun] Extension installed");
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await updateBadge();
});

// Listen for storage changes to update badge
chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.applications) {
    await updateBadge();
  }
});

// --- LLM Provider Proxy ---
// Popup can't reliably fetch localhost in MV3. Background proxies all LLM requests.

chrome.runtime.onMessage.addListener(
  (
    message: Message,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: Message) => void
  ) => {
    if (message.type === "GENERATE_SMART_ANSWERS") {
      const provider = getProvider(message.providerConfig.id);
      provider
        .generateApplication(message.context, message.profile, message.providerConfig, message.voice, message.existingResume)
        .then((result) => {
          sendResponse({ type: "SMART_ANSWERS_RESULT", result });
        })
        .catch((err) => {
          sendResponse({
            type: "SMART_ANSWERS_RESULT",
            result: null,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        });
      return true; // async response
    }

    if (message.type === "GENERATE_RESUME") {
      const provider = getProvider(message.providerConfig.id);
      provider
        .generateResume(message.context, message.profile, message.providerConfig, message.voice, message.existingResume, message.feedback)
        .then((result) => {
          sendResponse({ type: "RESUME_RESULT", content: result.content, model: result.model });
        })
        .catch((err) => {
          sendResponse({
            type: "RESUME_RESULT",
            content: null,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        });
      return true; // async response
    }

    if (message.type === "GENERATE_COVER_LETTER") {
      const provider = getProvider(message.providerConfig.id);
      provider
        .generateCoverLetter(message.context, message.profile, message.providerConfig, message.voice, message.existingResume, message.feedback)
        .then((result) => {
          sendResponse({ type: "COVER_LETTER_RESULT", content: result.content, model: result.model });
        })
        .catch((err) => {
          sendResponse({
            type: "COVER_LETTER_RESULT",
            content: null,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        });
      return true; // async response
    }

    if (message.type === "DETECT_PROFILE_GAPS") {
      const provider = getProvider(message.providerConfig.id);
      const prompt = buildGapDetectionPrompt(message.profile, message.context, message.existingResume);
      provider
        .rawGenerate(prompt, message.providerConfig)
        .then((raw) => {
          const questions = parseGapDetectionResponse(raw);
          sendResponse({ type: "PROFILE_GAPS_RESULT", questions });
        })
        .catch((err) => {
          // On failure, don't block generation — return empty questions
          console.error("[Midnight Sun] Gap detection failed:", err);
          sendResponse({
            type: "PROFILE_GAPS_RESULT",
            questions: [],
            error: err instanceof Error ? err.message : "Gap detection failed",
          });
        });
      return true; // async response
    }

    if (message.type === "DETECT_ALL_FRAMES") {
      detectAllFrames()
        .then((frames) => {
          sendResponse({ type: "ALL_FRAMES_DETECTED", frames });
        })
        .catch((err) => {
          console.error("[Midnight Sun] DETECT_ALL_FRAMES failed:", err);
          sendResponse({ type: "ALL_FRAMES_DETECTED", frames: [] });
        });
      return true; // async response
    }

    return false;
  }
);

/**
 * Scan all frames in the active tab for form fields.
 * Sends DETECT_FIELDS to each frame individually via frameId,
 * then merges results. This catches forms inside iframes that
 * sendToActiveTab (frameId: 0) would miss.
 */
async function detectAllFrames(): Promise<FrameDetectResult[]> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id) return [];

  const allFrames = await chrome.webNavigation.getAllFrames({
    tabId: tab.id,
  });
  if (!allFrames) return [];

  console.log(
    "[Midnight Sun] detectAllFrames: scanning",
    allFrames.length,
    "frames"
  );

  const results: FrameDetectResult[] = [];

  for (const frame of allFrames) {
    try {
      const resp: Message = await chrome.tabs.sendMessage(
        tab.id,
        { type: "DETECT_FIELDS" },
        { frameId: frame.frameId }
      );
      if (resp?.type === "FIELDS_DETECTED") {
        results.push({
          frameUrl: frame.url,
          fields: resp.fields,
          choiceGroups: resp.choiceGroups ?? [],
          debugCounts: resp.debugCounts,
          openQuestionCount: resp.openQuestionCount,
        });
      }
    } catch {
      // Frame may not have content script (cross-origin, about:blank, etc.)
    }
  }

  return results;
}

async function updateBadge(): Promise<void> {
  try {
    const apps = await getApplications();
    const activeCount = apps.filter(
      (a) => a.status === "applied" || a.status === "interviewing"
    ).length;

    if (activeCount > 0) {
      chrome.action.setBadgeText({ text: String(activeCount) });
      chrome.action.setBadgeBackgroundColor({ color: "#4c6ef5" });
    } else {
      chrome.action.setBadgeText({ text: "" });
    }
  } catch (err) {
    console.error("[Midnight Sun] Badge update failed:", err);
  }
}
