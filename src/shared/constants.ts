// ============================================================
// Constants
// Shared configuration values, thresholds, and magic strings.
// One place to change — no magic numbers buried in code.
// ============================================================

// --- Fill & Match Thresholds ---

/**
 * Minimum confidence required to auto-fill a field.
 * Fields matched below this threshold get `reason: "low_confidence"` and are skipped.
 * Current value 0.4 was chosen based on real-world data:
 * - Essay penalty drops wrong matches to ~0.23 (correctly skipped)
 * - Legitimate matches (exact keyword) start at 0.7+ (always filled)
 * - Partial matches for real fields sit around 0.5–0.85 (filled)
 */
export const MIN_FILL_CONFIDENCE = 0.4;

/**
 * Confidence multiplier for essay-prompt signals on non-summary fields.
 * Applied when primary signal looks like an essay question (long, interrogative, etc.)
 */
export const ESSAY_CONFIDENCE_PENALTY = 0.3;

// --- Signal Extraction Limits ---

/**
 * Maximum character length for previous-sibling text signals.
 * Prevents country-code dropdowns (15000+ chars) from polluting signals.
 */
export const MAX_SIGNAL_LENGTH = 200;

/**
 * Maximum character length for heading/container text extraction.
 */
export const MAX_HEADING_TEXT_LENGTH = 300;

/**
 * Maximum ancestor depth for heading-scan signal extraction.
 * Used when standard label/aria/container extraction yields only generic text.
 */
export const MAX_HEADING_SCAN_DEPTH = 6;

// --- Infrastructure Exclusion ---

/**
 * Selectors for infrastructure elements that should never be detected or filled.
 * Recaptcha, honeypot fields, bot traps.
 */
export const INFRA_SELECTORS = [
  '[name="g-recaptcha-response"]',
  '[id^="g-recaptcha-response"]',
  '.g-recaptcha textarea',
  '[name*="captcha"]',
  '[name="hp_field"]',
  '[data-hpc]',
];

// --- Search Form Exclusion ---

/**
 * Selectors for elements that are part of job search/filter UI, not application forms.
 * These appear on career pages alongside application forms (e.g., Grammarly's "Search jobs"
 * input and "Locations" filter dropdown were being detected and filled).
 */
export const SEARCH_FORM_SELECTORS = [
  '[name="search"]',
  '[name="q"]',
  '[name="query"]',
  '[name="keywords"]',
  '[name="categories"]',
  '[name="locations"]',
  '[aria-label*="Search jobs"]',
  '[aria-label*="search jobs"]',
  '[aria-label="Categories"]',
  '[aria-label="Locations"]',
];

// --- ATS Detection ---

/** Known ATS URL patterns — used for auto-detection */
export const ATS_PATTERNS: Record<string, RegExp> = {
  greenhouse: /boards\.greenhouse\.io/,
  lever: /jobs\.lever\.co/,
  workday: /\.myworkdayjobs\.com/,
  icims: /\.icims\.com/,
  taleo: /\.taleo\.net/,
  ashby: /jobs\.ashbyhq\.com/,
  bamboohr: /\.bamboohr\.com\/careers/,
};

/** Check if a URL is a known ATS page */
export function isAtsUrl(url: string): string | null {
  for (const [name, pattern] of Object.entries(ATS_PATTERNS)) {
    if (pattern.test(url)) return name;
  }
  return null;
}
