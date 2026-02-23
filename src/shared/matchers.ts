import type { ProfileField } from "./types";
import { ESSAY_CONFIDENCE_PENALTY } from "./constants";

// ============================================================
// Field Matchers
// Maps text signals (labels, names, placeholders) to profile fields.
// Pure functions — no DOM, no side effects.
// ============================================================

/**
 * Keywords for each profile field, ordered by specificity.
 * The matcher checks if any keyword appears in the normalized signal text.
 */
const FIELD_KEYWORDS: Record<ProfileField, string[]> = {
  firstName: [
    "first name",
    "first_name",
    "firstname",
    "given name",
    "given_name",
    "fname",
    "name_first",
  ],
  lastName: [
    "last name",
    "last_name",
    "lastname",
    "family name",
    "family_name",
    "surname",
    "lname",
    "name_last",
  ],
  fullName: ["name", "full name", "full_name", "fullname", "your name", "candidate name"],
  email: [
    "email",
    "e-mail",
    "email address",
    "email_address",
    "emailaddress",
  ],
  phone: [
    "phone",
    "telephone",
    "tel",
    "mobile",
    "cell",
    "phone number",
    "phone_number",
  ],
  location: [
    "location",
    "address",
    "current location",
    "where are you based",
    "city, state",
  ],
  city: ["city", "town"],
  state: ["state", "province", "region"],
  zip: ["zip", "postal", "postcode", "zip code", "postal code"],
  country: ["country", "nation"],
  linkedinUrl: [
    "linkedin",
    "linkedin url",
    "linkedin profile",
    "linkedin.com",
  ],
  githubUrl: ["github", "github url", "github profile", "github.com"],
  portfolioUrl: [
    "portfolio",
    "website",
    "personal website",
    "personal site",
    "portfolio url",
    "blog",
    "homepage",
  ],
  summary: [
    "summary",
    "cover letter",
    "coverletter",
    "cover_letter",
    "tell us about yourself",
    "additional information",
    "about",
    "about you",
    "message",
    "comments",
  ],
  currentTitle: [
    "current title",
    "job title",
    "current role",
    "title",
    "position",
    "current position",
  ],
  currentCompany: [
    "current company",
    "current employer",
    "company",
    "employer",
    "organization",
    "company name",
  ],
  yearsExperience: [
    "years of experience",
    "years experience",
    "experience years",
    "total experience",
    "how many years",
  ],
  salaryExpectation: [
    "salary",
    "compensation",
    "salary expectation",
    "expected salary",
    "desired salary",
    "pay expectation",
  ],
  startDate: [
    "start date",
    "earliest start",
    "available from",
    "availability",
    "when can you start",
    "available start",
  ],
  middleName: [
    "middle name",
    "middle_name",
    "middlename",
    "middle initial",
    "middle_initial",
  ],
  sponsorship: [
    "sponsorship",
    "visa sponsorship",
    "require sponsorship",
    "need sponsorship",
    "immigration sponsorship",
  ],
  authorized: [
    "authorized to work",
    "work authorization",
    "legally authorized",
    "eligible to work",
    "right to work",
    "work permit",
    "authorized to be employed",
    "legally eligible",
  ],
  heardAbout: [
    "how did you hear",
    "heard about",
    "referral source",
    "how did you find",
    "where did you hear",
    "how did you learn",
  ],
};

/**
 * Normalize text for matching: lowercase, collapse whitespace, trim.
 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[_\-]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Detect if a label/signal looks like an essay prompt rather than a simple field label.
 * Essay prompts should NOT be matched to profile fields (except "summary").
 */
export const ESSAY_PATTERN = /^(why|what|how|describe|tell us|explain|please|in \d+ words)/i;

function isEssayPrompt(signal: string): boolean {
  return (
    signal.length > 40 ||
    ESSAY_PATTERN.test(signal) ||
    signal.includes("?") ||
    /\d+\s*(sentence|word|paragraph)/i.test(signal)
  );
}

/**
 * Match a set of text signals to a profile field.
 * Returns the best match with a confidence score.
 *
 * @param signals - Array of text clues from the form field (label, name, id, placeholder, etc.)
 * @returns { field, confidence } or null if no match
 */
export function matchField(
  signals: string[]
): { field: ProfileField; confidence: number } | null {
  const normalizedSignals = signals.map(normalize).filter(Boolean);
  if (normalizedSignals.length === 0) return null;

  // Check if the primary signal looks like an essay prompt.
  // If so, we apply a heavy confidence penalty to prevent matching
  // "Describe your work experience in 3-4 sentences" to "currentTitle".
  const primarySignal = normalizedSignals[0] ?? "";
  const essayPrompt = isEssayPrompt(primarySignal);

  let bestMatch: { field: ProfileField; confidence: number } | null = null;

  for (const [field, keywords] of Object.entries(FIELD_KEYWORDS) as [
    ProfileField,
    string[],
  ][]) {
    for (const signal of normalizedSignals) {
      for (let ki = 0; ki < keywords.length; ki++) {
        const keyword = keywords[ki];
        let confidence = 0;

        // Exact match on a signal — highest confidence
        if (signal === keyword) {
          confidence = 1.0 - ki * 0.02; // slight penalty for later keywords
        }
        // Signal contains the keyword
        else if (signal.includes(keyword)) {
          confidence = 0.85 - ki * 0.02;
        }
        // Keyword contains the signal (e.g., signal="email", keyword="email address")
        else if (keyword.includes(signal) && signal.length >= 3) {
          confidence = 0.7 - ki * 0.02;
        }

        if (confidence > 0) {
          confidence = Math.max(Math.min(confidence, 1), 0.1);

          // Essay prompt penalty: heavily penalize all fields except "summary"
          // which is the one field that legitimately expects long-form content.
          if (essayPrompt && field !== "summary") {
            confidence *= ESSAY_CONFIDENCE_PENALTY;
          }

          if (!bestMatch || confidence > bestMatch.confidence) {
            bestMatch = { field, confidence };
          }
        }
      }
    }
  }

  return bestMatch;
}

/**
 * Given a profile field and a profile, extract the value to fill.
 */
export function getProfileValue(
  field: ProfileField,
  profile: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    location: string;
    linkedinUrl: string;
    githubUrl: string;
    portfolioUrl: string;
    summary: string;
    experiences: Array<{ title: string; company: string }>;
  }
): string {
  switch (field) {
    case "firstName":
      return profile.firstName;
    case "lastName":
      return profile.lastName;
    case "fullName":
      return `${profile.firstName} ${profile.lastName}`.trim();
    case "email":
      return profile.email;
    case "phone":
      return profile.phone;
    case "location":
    case "city":
      return profile.location;
    case "linkedinUrl":
      return profile.linkedinUrl;
    case "githubUrl":
      return profile.githubUrl;
    case "portfolioUrl":
      return profile.portfolioUrl;
    case "summary":
      return profile.summary;
    case "currentTitle":
      return profile.experiences[0]?.title ?? "";
    case "currentCompany":
      return profile.experiences[0]?.company ?? "";
    case "middleName":
    default:
      return "";
  }
}

// --- Debug: Match Explanation ---

export interface MatchExplanation {
  /** The winning match, if any */
  result: { field: ProfileField; confidence: number } | null;
  /** Every keyword that was checked and produced a match */
  candidates: Array<{
    field: ProfileField;
    keyword: string;
    signal: string;
    matchType: "exact" | "contains" | "reverse-contains";
    confidence: number;
  }>;
}

/**
 * Explain why signals matched (or didn't match) any profile field.
 * Returns the winning match plus all candidates that were close.
 * Used only for debug UI — not on the critical fill path.
 * Called lazily (on expand) so zero perf impact on detection.
 */
export function explainMatch(signals: string[]): MatchExplanation {
  const normalizedSignals = signals.map(normalize).filter(Boolean);
  const candidates: MatchExplanation["candidates"] = [];
  let bestMatch: { field: ProfileField; confidence: number } | null = null;

  const primarySignal = normalizedSignals[0] ?? "";
  const essayPrompt = isEssayPrompt(primarySignal);

  for (const [field, keywords] of Object.entries(FIELD_KEYWORDS) as [
    ProfileField,
    string[],
  ][]) {
    for (const signal of normalizedSignals) {
      for (let ki = 0; ki < keywords.length; ki++) {
        const keyword = keywords[ki];
        let matchType: "exact" | "contains" | "reverse-contains" | null = null;
        let confidence = 0;

        if (signal === keyword) {
          matchType = "exact";
          confidence = 1.0 - ki * 0.02;
        } else if (signal.includes(keyword)) {
          matchType = "contains";
          confidence = 0.85 - ki * 0.02;
        } else if (keyword.includes(signal) && signal.length >= 3) {
          matchType = "reverse-contains";
          confidence = 0.7 - ki * 0.02;
        }

        if (matchType) {
          let clampedConfidence = Math.max(Math.min(confidence, 1), 0.1);
          if (essayPrompt && field !== "summary") {
            clampedConfidence *= ESSAY_CONFIDENCE_PENALTY;
          }
          candidates.push({
            field,
            keyword,
            signal,
            matchType,
            confidence: clampedConfidence,
          });
          if (!bestMatch || clampedConfidence > bestMatch.confidence) {
            bestMatch = { field, confidence: clampedConfidence };
          }
        }
      }
    }
  }

  // Sort candidates by confidence descending
  candidates.sort((a, b) => b.confidence - a.confidence);

  return { result: bestMatch, candidates };
}

export { FIELD_KEYWORDS, normalize };
