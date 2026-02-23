// ============================================================
// Snapshot — Pure extraction functions for job page content
// No side effects, no message handling. Just extraction logic.
// Called from content/index.ts message handler.
// ============================================================

import type { ExtractedMeta, SnapshotSection } from "../shared/jobTypes";
import { detectSource } from "../shared/url";
import { parseCompensation } from "../shared/normalize";

// --- Constants ---

const MAX_FULL_TEXT_CHARS = 40_000;

/** Elements to strip before extracting text */
const STRIP_SELECTORS = [
  "script",
  "style",
  "noscript",
  "nav",
  "footer",
  "header",
  "[aria-hidden='true']",
  "[hidden]",
].join(", ");

// --- Text cleaning ---

/**
 * Extract clean page text by cloning the content root and stripping
 * noise elements (scripts, styles, nav, footer, hidden elements).
 * Returns plain text capped at MAX_FULL_TEXT_CHARS.
 */
export function cleanPageText(doc: Document): string {
  const root =
    doc.querySelector("main, [role='main'], article") ?? doc.body;
  if (!root) return "";

  // Clone so we don't mutate the live DOM
  const clone = root.cloneNode(true) as HTMLElement;

  // Strip noise elements
  const junk = clone.querySelectorAll(STRIP_SELECTORS);
  for (const el of junk) {
    el.remove();
  }

  const text = clone.innerText ?? "";
  return text.slice(0, MAX_FULL_TEXT_CHARS);
}

// --- Section extraction ---

/**
 * Extract structured sections from the page.
 * Walks h1/h2/h3 headings and captures text between them.
 * Falls back to a single "Content" section if no headings found.
 */
export function extractSections(doc: Document): SnapshotSection[] {
  const root =
    doc.querySelector("main, [role='main'], article") ?? doc.body;
  if (!root) return [{ heading: "Content", text: "" }];

  const headings = root.querySelectorAll("h1, h2, h3");
  if (headings.length === 0) {
    return [{ heading: "Content", text: cleanPageText(doc) }];
  }

  const sections: SnapshotSection[] = [];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const headingText = heading.textContent?.trim() ?? "";

    // Collect text nodes between this heading and the next
    const textParts: string[] = [];
    let sibling = heading.nextElementSibling;

    while (sibling) {
      // Stop at the next heading
      if (/^H[1-3]$/i.test(sibling.tagName)) break;

      const text = (sibling as HTMLElement).innerText?.trim();
      if (text) {
        textParts.push(text);
      }
      sibling = sibling.nextElementSibling;
    }

    if (headingText || textParts.length > 0) {
      sections.push({
        heading: headingText,
        text: textParts.join("\n\n"),
      });
    }
  }

  return sections.length > 0
    ? sections
    : [{ heading: "Content", text: cleanPageText(doc) }];
}

// --- Metadata extraction ---

/**
 * Extract company name from URL (reused from content/index.ts pattern).
 */
function extractCompanyFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname;

    if (host.includes("greenhouse.io")) return u.pathname.split("/")[1] || "";
    if (host.includes("lever.co")) return u.pathname.split("/")[1] || "";
    if (host.includes("myworkdayjobs.com")) return host.split(".")[0] || "";
    if (host.includes("ashbyhq.com")) return u.pathname.split("/")[1] || "";
    if (host.startsWith("careers."))
      return host.replace("careers.", "").split(".")[0] || "";

    const parts = host.split(".");
    return parts.length >= 2 ? parts[parts.length - 2] : host;
  } catch {
    return "";
  }
}

/**
 * Generic metadata extraction — works on any page.
 */
export function extractMetaGeneric(
  doc: Document,
  url: string
): ExtractedMeta {
  const title = doc.querySelector("h1")?.textContent?.trim() ?? null;

  const ogSiteName = doc
    .querySelector('meta[property="og:site_name"]')
    ?.getAttribute("content");
  const company = ogSiteName || extractCompanyFromUrl(url) || null;

  // Location: look for common patterns near the title
  let location: string | null = null;
  const locationEl =
    doc.querySelector(".location, [data-testid*='location'], [class*='location']");
  if (locationEl) {
    location = locationEl.textContent?.trim() ?? null;
  }

  // Remote detection
  let remoteType: ExtractedMeta["remoteType"] = null;
  const pageText = cleanPageText(doc).toLowerCase();
  if (/\bfully\s+remote\b/.test(pageText) || /\bremote\b/.test(pageText)) {
    remoteType = "remote";
  } else if (/\bhybrid\b/.test(pageText)) {
    remoteType = "hybrid";
  }

  // Employment type
  let employmentType: ExtractedMeta["employmentType"] = null;
  if (/\bfull[\s-]?time\b/.test(pageText)) employmentType = "full-time";
  else if (/\bpart[\s-]?time\b/.test(pageText)) employmentType = "part-time";
  else if (/\bcontract\b/.test(pageText)) employmentType = "contract";
  else if (/\binternship\b|\bintern\b/.test(pageText))
    employmentType = "internship";

  // Compensation
  let compensationText: string | null = null;
  const comp = parseCompensation(cleanPageText(doc));
  if (comp) {
    compensationText = comp.text;
  }

  return {
    pageTitle: doc.title || null,
    company,
    title,
    location,
    remoteType,
    employmentType,
    compensationText,
  };
}

// --- Site-specific adapters ---

/**
 * Ashby-specific metadata extraction.
 */
function extractAshbyMeta(
  doc: Document,
  url: string
): ExtractedMeta {
  const meta = extractMetaGeneric(doc, url);

  // Ashby company from URL: jobs.ashbyhq.com/<company>/...
  if (!meta.company) {
    try {
      const path = new URL(url).pathname.split("/");
      if (path.length > 1) meta.company = path[1];
    } catch {
      // ignore
    }
  }

  return meta;
}

/**
 * Greenhouse-specific metadata extraction.
 */
function extractGreenhouseMeta(
  doc: Document,
  url: string
): ExtractedMeta {
  const meta = extractMetaGeneric(doc, url);

  // Greenhouse company from URL: boards.greenhouse.io/<company>/...
  if (!meta.company) {
    try {
      const path = new URL(url).pathname.split("/");
      if (path.length > 1) meta.company = path[1];
    } catch {
      // ignore
    }
  }

  // Greenhouse location class
  if (!meta.location) {
    const locEl = doc.querySelector(".location");
    if (locEl) {
      meta.location = locEl.textContent?.trim() ?? null;
    }
  }

  return meta;
}

// --- Top-level orchestrator ---

/**
 * Extract a full snapshot from the current page.
 * Picks the right adapter based on source, falls back to generic.
 * Returns sections, metadata, and cleaned full text.
 */
export function extractSnapshot(
  doc: Document,
  url: string
): {
  sections: SnapshotSection[];
  meta: ExtractedMeta;
  fullText: string;
} {
  const source = detectSource(url);

  let meta: ExtractedMeta;
  try {
    switch (source) {
      case "ashbyhq":
        meta = extractAshbyMeta(doc, url);
        break;
      case "greenhouse":
        meta = extractGreenhouseMeta(doc, url);
        break;
      default:
        meta = extractMetaGeneric(doc, url);
    }
  } catch {
    // Adapter threw — fall back to generic
    meta = extractMetaGeneric(doc, url);
  }

  const sections = extractSections(doc);
  const fullText = cleanPageText(doc);

  return { sections, meta, fullText };
}
