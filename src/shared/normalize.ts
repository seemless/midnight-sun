// ============================================================
// Text Normalization + Compensation Parsing
// Pure functions for normalizing job metadata.
// ============================================================

import { sha256 } from "./crypto";

/** Corporate suffixes to strip during normalization */
const CORP_SUFFIXES = /\b(inc|llc|corp|corporation|ltd|co|company|gmbh|plc)\b/gi;

/**
 * Normalize text for comparison / hashing.
 * Lowercase, collapse whitespace, strip punctuation, remove corporate suffixes.
 */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(CORP_SUFFIXES, "")
    .replace(/[^\w\s]/g, "") // strip punctuation (keep letters/numbers/spaces)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compute a job identity key from company + title + optional location.
 * Used for cross-URL deduplication (same job posted on multiple boards).
 * Returns null if company or title are missing.
 */
export async function computeJobIdentityKey(
  company: string,
  title: string,
  location?: string
): Promise<string | null> {
  if (!company || !title) return null;

  const key =
    normalizeText(company) +
    "|" +
    normalizeText(title) +
    "|" +
    normalizeText(location ?? "");

  return sha256(key);
}

// --- Compensation parsing ---

export interface CompensationInfo {
  min?: number | null;
  max?: number | null;
  currency?: string | null;
  interval?: "year" | "hour" | null;
  /** The raw matched text from the page */
  text: string;
}

/**
 * Parse compensation information from text.
 *
 * Handles patterns like:
 * - "$170K – $215K"
 * - "$170,000 - $215,000"
 * - "$80/hr - $120/hr"
 * - "$150,000/year"
 * - "$170K"
 */
export function parseCompensation(text: string): CompensationInfo | null {
  // Range pattern: $170K – $215K or $170,000 - $215,000 or $80/hr - $120/hr
  const rangePattern =
    /\$\s*([\d,]+(?:\.\d+)?)\s*[Kk]?\s*(?:\/\s*(?:hr|hour|yr|year))?\s*[-–—to]+\s*\$\s*([\d,]+(?:\.\d+)?)\s*[Kk]?\s*(?:\/\s*(?:hr|hour|yr|year))?/;

  // Single value: $170K or $170,000
  const singlePattern =
    /\$\s*([\d,]+(?:\.\d+)?)\s*[Kk]?\s*(?:\/\s*(?:hr|hour|yr|year))?/;

  const rangeMatch = text.match(rangePattern);
  if (rangeMatch) {
    const rawText = rangeMatch[0];
    const min = parseAmount(rangeMatch[1], rawText);
    const max = parseAmount(rangeMatch[2], rawText);
    const interval = detectInterval(rawText);
    const currency = rawText.includes("$") ? "USD" : null;

    return { min, max, currency, interval, text: rawText };
  }

  const singleMatch = text.match(singlePattern);
  if (singleMatch) {
    const rawText = singleMatch[0];
    const amount = parseAmount(singleMatch[1], rawText);
    const interval = detectInterval(rawText);
    const currency = rawText.includes("$") ? "USD" : null;

    return { min: amount, max: null, currency, interval, text: rawText };
  }

  return null;
}

/** Parse a numeric amount, handling commas and K suffix */
function parseAmount(raw: string, fullText: string): number {
  let num = parseFloat(raw.replace(/,/g, ""));

  // Check if K/k suffix follows this number in the full text
  const kPattern = new RegExp(
    raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[Kk]"
  );
  if (kPattern.test(fullText)) {
    num *= 1000;
  }

  return num;
}

/** Detect whether compensation is hourly or yearly */
function detectInterval(text: string): "year" | "hour" | null {
  const lower = text.toLowerCase();
  if (/\/\s*hr|\/\s*hour|per\s+hour|hourly/i.test(lower)) {
    return "hour";
  }
  if (/\/\s*yr|\/\s*year|per\s+year|annual|yearly/i.test(lower)) {
    return "year";
  }
  // Default: if it looks like a large number, assume yearly
  return "year";
}
