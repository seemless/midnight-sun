// ============================================================
// URL Utilities — canonicalization, source detection, posting keys
// ============================================================

import { sha256 } from "./crypto";

/** Known tracking query params to strip during canonicalization */
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ref",
  "source",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "si",
  "li_fat_id",
]);

/**
 * Detect the ATS source from a URL.
 * Returns a short identifier like "ashbyhq", "greenhouse", "linkedin", etc.
 */
export function detectSource(url: string): string {
  try {
    const host = new URL(url).hostname;

    if (host.includes("ashbyhq.com")) return "ashbyhq";
    if (host.includes("greenhouse.io")) return "greenhouse";
    if (host.includes("lever.co")) return "lever";
    if (host.includes("myworkdayjobs.com")) return "workday";
    if (host.includes("icims.com")) return "icims";
    if (host.includes("taleo.net")) return "taleo";
    if (host.includes("bamboohr.com")) return "bamboohr";
    if (host.includes("linkedin.com")) return "linkedin";
    if (host.includes("indeed.com")) return "indeed";

    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Canonicalize a URL for stable hashing.
 *
 * - Strips hash fragment
 * - Strips known tracking query params (utm_*, fbclid, etc.)
 * - Keeps identity-bearing params (gh_jid, applicationId, etc.)
 * - Sorts surviving query params for determinism
 * - Removes trailing slash (unless root path)
 */
export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url);

    // Strip hash
    u.hash = "";

    // Strip tracking params, keep everything else
    const params = new URLSearchParams(u.search);
    const keysToRemove: string[] = [];
    for (const key of params.keys()) {
      if (
        TRACKING_PARAMS.has(key) ||
        key.startsWith("utm_") // catch any custom utm_ params
      ) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      params.delete(key);
    }

    // Sort surviving params for stability
    params.sort();

    // Rebuild URL
    const search = params.toString();
    let canonical = u.origin + u.pathname;

    // Remove trailing slash (unless root path "/")
    if (canonical.endsWith("/") && u.pathname !== "/") {
      canonical = canonical.slice(0, -1);
    }

    if (search) {
      canonical += "?" + search;
    }

    return canonical;
  } catch {
    // If URL parsing fails, return as-is
    return url;
  }
}

/**
 * Compute a stable posting key from a URL.
 * `postingKey = sha256(canonicalizeUrl(url))`
 */
export async function computePostingKey(url: string): Promise<string> {
  return sha256(canonicalizeUrl(url));
}
