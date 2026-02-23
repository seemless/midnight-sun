import type { Message, OpenQuestion, FileInputInfo } from "../shared/types";
import { detectFields, detectChoiceGroups, extractSignals, getSelectorCandidates, isDemographic, isInfrastructure } from "./detector";
import { fillFields, fillChoiceGroups, fillSmartEntries } from "./filler";
import { matchField, ESSAY_PATTERN } from "../shared/matchers";
import { extractSnapshot } from "./snapshot";

// ============================================================
// Content Script — Entry Point
// Injected into every page. Listens for messages from popup/background.
// ============================================================

console.log("[Midnight Sun] Content script loaded", {
  href: location.href,
  frame: window === window.top ? "top" : "iframe",
});

chrome.runtime.onMessage.addListener(
  (
    message: Message,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: Message) => void
  ) => {
    switch (message.type) {
      case "PING": {
        sendResponse({ type: "PONG" });
        return true;
      }

      case "DETECT_FIELDS": {
        console.log("[Midnight Sun] DETECT_FIELDS received", {
          href: location.href,
          frame: window === window.top ? "top" : "iframe",
          readyState: document.readyState,
          inputs: document.querySelectorAll("input").length,
          textareas: document.querySelectorAll("textarea").length,
          selects: document.querySelectorAll("select").length,
          iframes: document.querySelectorAll("iframe").length,
        });

        const { fields, debugCounts } = detectFields(document);
        const choiceGroups = detectChoiceGroups(document);
        const openQuestions = extractOpenQuestions();

        console.log("[Midnight Sun] DETECT_FIELDS result", {
          fields: fields.length,
          choiceGroups: choiceGroups.length,
          openQuestions: openQuestions.length,
          debugCounts,
        });

        sendResponse({
          type: "FIELDS_DETECTED",
          fields,
          choiceGroups,
          openQuestionCount: openQuestions.length,
          debugCounts,
        });
        return true;
      }

      case "FILL_FIELDS": {
        const results = fillFields(
          message.fields,
          message.profile,
          document
        );
        const choiceGroupResults = message.choiceGroups
          ? fillChoiceGroups(message.choiceGroups, message.profile, document)
          : undefined;
        sendResponse({ type: "FILL_COMPLETE", results, choiceGroupResults });
        return true;
      }

      case "GET_PAGE_INFO": {
        sendResponse({
          type: "PAGE_INFO",
          url: window.location.href,
          title: document.title,
          company: extractCompanyFromUrl(window.location.href),
          role: extractRoleFromTitle(document.title),
        });
        return true;
      }

      case "EXTRACT_JOB_CONTEXT": {
        const context = extractJobContext();
        sendResponse({ type: "JOB_CONTEXT", context });
        return true;
      }

      case "FILL_SMART_ANSWERS": {
        const outcomes = fillSmartEntries(message.answers, document);
        sendResponse({ type: "SMART_FILL_COMPLETE", outcomes });
        return true;
      }

      case "CAPTURE_SNAPSHOT": {
        const { sections, meta, fullText } = extractSnapshot(
          document,
          window.location.href
        );
        sendResponse({ type: "SNAPSHOT_DATA", sections, meta, fullText });
        return true;
      }

      case "DETECT_FILE_INPUTS": {
        const fileInputs = detectFileInputs(document);
        sendResponse({ type: "FILE_INPUTS_DETECTED", fileInputs });
        return true;
      }

      case "ATTACH_FILE": {
        try {
          attachFileToInput(message.fileInput, message.fileName, message.content, message.mimeType);
          sendResponse({ type: "ATTACH_FILE_RESULT", success: true });
        } catch (err) {
          sendResponse({
            type: "ATTACH_FILE_RESULT",
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
        return true;
      }

      default:
        console.log("[Midnight Sun] unhandled message type", message.type);
    }

    return false;
  }
);

// --- Helpers ---

/**
 * Best-effort company name extraction from URL.
 * e.g., "boards.greenhouse.io/stripe" → "stripe"
 *        "jobs.lever.co/openai" → "openai"
 *        "careers.google.com" → "google"
 */
function extractCompanyFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname;

    // Greenhouse: boards.greenhouse.io/company
    if (host.includes("greenhouse.io")) {
      return u.pathname.split("/")[1] || "";
    }
    // Lever: jobs.lever.co/company
    if (host.includes("lever.co")) {
      return u.pathname.split("/")[1] || "";
    }
    // Workday: company.myworkdayjobs.com
    if (host.includes("myworkdayjobs.com")) {
      return host.split(".")[0] || "";
    }
    // Generic: careers.company.com or company.com/careers
    if (host.startsWith("careers.")) {
      return host.replace("careers.", "").split(".")[0] || "";
    }

    // Fallback: second-level domain
    const parts = host.split(".");
    return parts.length >= 2 ? parts[parts.length - 2] : host;
  } catch {
    return "";
  }
}

/**
 * Best-effort role extraction from page title.
 * Many ATS pages have titles like "Software Engineer - Stripe"
 */
function extractRoleFromTitle(title: string): string {
  // Common patterns: "Role - Company", "Role | Company", "Role at Company"
  const separators = [" - ", " | ", " — ", " at "];
  for (const sep of separators) {
    if (title.includes(sep)) {
      return title.split(sep)[0].trim();
    }
  }
  return title.trim();
}

// --- Smart Apply helpers ---

/**
 * Extract job context from the current page.
 * Prefers semantic content containers (main, article) over body.
 */
function extractJobContext() {
  const title =
    document.querySelector("h1")?.textContent?.trim() ?? "";

  const company =
    document
      .querySelector('meta[property="og:site_name"]')
      ?.getAttribute("content") ??
    extractCompanyFromUrl(window.location.href);

  const root =
    document.querySelector("main, [role='main'], article") ?? document.body;
  const description = (root as HTMLElement).innerText.slice(0, 12000);

  const questions = extractOpenQuestions();

  return {
    url: window.location.href,
    title,
    company,
    description,
    questions,
  };
}

/** Expanded selector for open-ended question elements */
const OPEN_QUESTION_SELECTOR =
  'textarea, [role="textbox"], [contenteditable="true"]';

/**
 * Find open-ended text fields that are NOT covered by the deterministic matcher.
 * Pass 1: Scans textarea, role=textbox, and contenteditable elements.
 * Pass 2: Scans input[type="text"] with essay-like labels (Ashby uses these for essay questions).
 */
function extractOpenQuestions(): OpenQuestion[] {
  const questions: OpenQuestion[] = [];

  function scanDocument(doc: Document) {
    // --- Pass 1: Standard open-question elements ---
    const elements = doc.querySelectorAll(OPEN_QUESTION_SELECTOR);
    for (const el of elements) {
      if (el.getAttribute("aria-hidden") === "true") continue;
      if (isInfrastructure(el)) continue;

      const { flat: signals } = extractSignals(el, doc);
      const selectorCandidates = getSelectorCandidates(el);

      if (isDemographic(signals)) continue;

      const deterministicMatch = matchField(signals);
      const label =
        signals[0] ?? el.getAttribute("placeholder") ?? "Open question";
      const threshold =
        ESSAY_PATTERN.test(label.trim()) || label.includes("?") ? 0.7 : 0.5;
      if (deterministicMatch && deterministicMatch.confidence > threshold) {
        continue;
      }

      questions.push({ label, selectorCandidates, signals });
    }

    // --- Pass 2: input[type="text"] with essay-like labels ---
    // Many ATS (Ashby, some Greenhouse custom questions) use plain text inputs
    // for essay questions. We detect them by their label signals.
    const textInputs = doc.querySelectorAll('input[type="text"]');
    for (const el of textInputs) {
      if (el.getAttribute("aria-hidden") === "true") continue;
      if (isInfrastructure(el)) continue;

      const { flat: signals } = extractSignals(el, doc);
      if (isDemographic(signals)) continue;

      const label = signals[0] ?? el.getAttribute("placeholder") ?? "";

      // Only include if the label looks like an essay prompt
      const isEssay =
        ESSAY_PATTERN.test(label.trim()) ||
        label.includes("?") ||
        (label.length > 50 && /\b(experience|describe|explain|why|how|tell)\b/i.test(label));
      if (!isEssay) continue;

      // Skip if already matched by deterministic matcher with high confidence
      const deterministicMatch = matchField(signals);
      if (deterministicMatch && deterministicMatch.confidence > 0.7) continue;

      const selectorCandidates = getSelectorCandidates(el);

      // Avoid duplicates
      const alreadyDetected = questions.some(
        (q) => q.selectorCandidates[0] === selectorCandidates[0]
      );
      if (alreadyDetected) continue;

      questions.push({ label, selectorCandidates, signals });
    }
  }

  // Scan main document
  scanDocument(document);

  // Scan same-origin iframes
  const iframes = document.querySelectorAll("iframe");
  for (const iframe of iframes) {
    try {
      const iframeDoc = (iframe as HTMLIFrameElement).contentDocument;
      if (!iframeDoc) continue;
      scanDocument(iframeDoc);
    } catch {
      continue; // cross-origin — skip
    }
  }

  return questions;
}


// --- File Input Detection + Attachment ---

/**
 * Detect all file inputs on the page (including same-origin iframes).
 * Returns label, accept attribute, and selector candidates for each.
 */
function detectFileInputs(doc: Document): FileInputInfo[] {
  const results: FileInputInfo[] = [];

  function scanDoc(d: Document) {
    const fileInputs = d.querySelectorAll('input[type="file"]');
    for (const el of fileInputs) {
      const input = el as HTMLInputElement;
      const selectorCandidates = getSelectorCandidates(input);
      const { flat: signals } = extractSignals(input, d);
      const label = signals[0] || input.getAttribute("aria-label") || input.getAttribute("name") || "File upload";
      const accept = input.getAttribute("accept") ?? "";
      const multiple = input.hasAttribute("multiple");

      results.push({ selectorCandidates, label, accept, multiple });
    }
  }

  scanDoc(doc);

  // Scan same-origin iframes
  const iframes = doc.querySelectorAll("iframe");
  for (const iframe of iframes) {
    try {
      const iframeDoc = (iframe as HTMLIFrameElement).contentDocument;
      if (iframeDoc) scanDoc(iframeDoc);
    } catch {
      // cross-origin — skip
    }
  }

  return results;
}

/**
 * Programmatically attach a file to a file input using the DataTransfer API.
 * Creates a File from the provided content string, sets it on the input,
 * and dispatches change + input events.
 */
function attachFileToInput(
  fileInput: FileInputInfo,
  fileName: string,
  content: string,
  mimeType: string
): void {
  // Resolve the file input element by trying selector candidates
  let input: HTMLInputElement | null = null;
  for (const selector of fileInput.selectorCandidates) {
    try {
      const el = document.querySelector(selector) as HTMLInputElement | null;
      if (el && el.type === "file") {
        input = el;
        break;
      }
    } catch {
      // invalid selector — try next
    }
  }

  // Also check same-origin iframes
  if (!input) {
    const iframes = document.querySelectorAll("iframe");
    for (const iframe of iframes) {
      try {
        const iframeDoc = (iframe as HTMLIFrameElement).contentDocument;
        if (!iframeDoc) continue;
        for (const selector of fileInput.selectorCandidates) {
          try {
            const el = iframeDoc.querySelector(selector) as HTMLInputElement | null;
            if (el && el.type === "file") {
              input = el;
              break;
            }
          } catch {
            // try next
          }
        }
        if (input) break;
      } catch {
        // cross-origin — skip
      }
    }
  }

  if (!input) {
    throw new Error("Could not find file input element on page");
  }

  // Create File from content string
  const blob = new Blob([content], { type: mimeType });
  const file = new File([blob], fileName, { type: mimeType });

  // Use DataTransfer API to set files (direct .value assignment is blocked by browsers)
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  input.files = dataTransfer.files;

  // Dispatch events so frameworks (React, Angular, etc.) detect the change
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export { extractCompanyFromUrl, extractRoleFromTitle };
