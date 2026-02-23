import type { Profile, Experience, Education } from "./types";
import { EMPTY_PROFILE } from "./types";

// ============================================================
// Resume Parser — Deterministic
// Pure function: string in, Profile out. No LLM, no network.
// ============================================================

let nextId = 1;
function genId(): string {
  return `parsed-${nextId++}`;
}

/** Reset ID counter (for tests) */
export function resetIdCounter(): void {
  nextId = 1;
}

/**
 * Parse raw resume text into a structured Profile.
 * Works with plain text, LinkedIn PDF exports, and general resume formats.
 */
export function parseResume(text: string): Profile {
  const profile: Profile = { ...EMPTY_PROFILE, experiences: [], education: [], skills: [] };
  const lines = text.split("\n").map((l) => l.trim());

  // Extract contact info from anywhere in the text
  profile.email = extractEmail(text) ?? "";
  profile.phone = extractPhone(text) ?? "";
  profile.linkedinUrl = extractLinkedInUrl(text) ?? "";
  profile.githubUrl = extractGithubUrl(text) ?? "";

  // Split into sections
  const sections = splitSections(lines);

  // Name: usually the first non-empty line before any section header
  const headerLines = sections.get("_header") ?? [];
  if (headerLines.length > 0) {
    const nameLine = headerLines[0];
    const nameParts = parseNameLine(nameLine);
    profile.firstName = nameParts.firstName;
    profile.lastName = nameParts.lastName;
  }

  // Location from header area
  for (const line of headerLines) {
    const loc = extractLocation(line);
    if (loc) {
      profile.location = loc;
      break;
    }
  }

  // Summary / About
  const summaryLines = sections.get("summary") ?? sections.get("about") ?? [];
  profile.summary = summaryLines.join(" ").trim();

  // Experience
  const expLines = sections.get("experience") ?? [];
  profile.experiences = parseExperiences(expLines);

  // Fallback: if no experience section found (or it parsed nothing),
  // scan non-education sections for date-range patterns and try to extract entries.
  // Exclude education/skills/summary to avoid false positives from degree date ranges.
  const EXPERIENCE_ONLY_SECTIONS = new Set(["education", "skills", "summary", "about", "certifications", "projects"]);
  if (profile.experiences.length === 0) {
    const allLines: string[] = [];
    for (const [sectionName, sectionLines] of sections) {
      if (!EXPERIENCE_ONLY_SECTIONS.has(sectionName)) {
        allLines.push(...sectionLines, ""); // blank line separator between sections
      }
    }
    profile.experiences = parseExperiences(allLines);
  }

  // Education
  const eduLines = sections.get("education") ?? [];
  profile.education = parseEducation(eduLines);

  // Skills
  const skillLines = sections.get("skills") ?? [];
  profile.skills = parseSkills(skillLines);

  return profile;
}

// --- Section Splitting ---

const SECTION_PATTERNS: Record<string, RegExp> = {
  experience: /^(work\s+)?experience|^professional\s+experience|^employment/i,
  education: /^education/i,
  skills: /^(technical\s+)?skills|^core\s+competencies|^technologies/i,
  summary: /^(professional\s+)?summary|^objective|^profile/i,
  about: /^about(\s+me)?$/i,
  projects: /^projects|^personal\s+projects/i,
  certifications: /^certifications?|^licenses?/i,
};

function splitSections(lines: string[]): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let currentSection = "_header";
  sections.set(currentSection, []);

  for (const line of lines) {
    // Check if this line is a section header
    let foundSection = false;
    for (const [name, pattern] of Object.entries(SECTION_PATTERNS)) {
      if (pattern.test(line) && line.length < 50) {
        currentSection = name;
        if (!sections.has(currentSection)) {
          sections.set(currentSection, []);
        }
        foundSection = true;
        break;
      }
    }

    if (!foundSection) {
      const sectionLines = sections.get(currentSection) ?? [];
      sectionLines.push(line);
      sections.set(currentSection, sectionLines);
    }
  }

  return sections;
}

// --- Contact Extraction ---

function extractEmail(text: string): string | null {
  const match = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0] : null;
}

function extractPhone(text: string): string | null {
  const match = text.match(
    /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/
  );
  return match ? match[0] : null;
}

function extractLinkedInUrl(text: string): string | null {
  const match = text.match(
    /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+\/?/
  );
  return match ? match[0] : null;
}

function extractGithubUrl(text: string): string | null {
  const match = text.match(
    /(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+\/?/
  );
  return match ? match[0] : null;
}

function extractLocation(line: string): string | null {
  // Pattern: City, ST or City, State or City, ST ZIP
  const match = line.match(
    /([A-Z][a-zA-Z\s]+,\s*[A-Z]{2}(?:\s+\d{5})?)/
  );
  return match ? match[1].trim() : null;
}

// --- Name Parsing ---

function parseNameLine(line: string): { firstName: string; lastName: string } {
  // Remove common prefixes/suffixes
  const cleaned = line
    .replace(/^(mr|mrs|ms|dr|prof)\.?\s*/i, "")
    .replace(/,?\s*(jr|sr|ii|iii|iv|phd|md|esq)\.?\s*$/i, "")
    .trim();

  const parts = cleaned.split(/\s+/);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

// --- Experience Parsing ---

/** Date range pattern: "Jan 2020 - Present", "01/2020 - 12/2023", "2020 - 2023" */
const DATE_RANGE_RE =
  /(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+)?\d{4}\s*[-–—to]+\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+)?\d{4}|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+)?\d{4}\s*[-–—to]+\s*[Pp]resent/i;

function parseExperiences(lines: string[]): Experience[] {
  const experiences: Experience[] = [];
  const entries = splitEntries(lines);

  for (const entry of entries) {
    const exp = parseExperienceEntry(entry);
    if (exp) experiences.push(exp);
  }

  return experiences;
}

function parseExperienceEntry(lines: string[]): Experience | null {
  // Find the date range — could be on its own line OR embedded in a title line
  let dateLineIdx = -1;
  let dateMatch: RegExpMatchArray | null = null;

  for (let i = 0; i < lines.length; i++) {
    dateMatch = lines[i].match(DATE_RANGE_RE);
    if (dateMatch) {
      dateLineIdx = i;
      break;
    }
  }

  if (dateLineIdx === -1 || !dateMatch) return null;

  const dates = dateMatch[0].split(/\s*[-–—]\s*|\s+to\s+/i);
  const startDate = dates[0]?.trim() ?? "";
  const endDate = dates[1]?.trim() ?? "";

  let title = "";
  let company = "";
  let location = "";

  const dateLine = lines[dateLineIdx];
  const textBeforeDate = dateLine.slice(0, dateMatch.index).trim();
  const textAfterDate = dateLine.slice((dateMatch.index ?? 0) + dateMatch[0].length).trim();

  if (textBeforeDate) {
    // Date is embedded in a line: "Title DateRange | Location"
    // e.g. "Senior Software Engineer Aug 2025 – Present | San Mateo, CA (Hybrid)"
    title = textBeforeDate.replace(/[|·—–,]\s*$/, "").trim();

    // Location from after date (e.g., "| San Mateo, CA (Hybrid)")
    if (textAfterDate) {
      location = textAfterDate.replace(/^[|·—–,]\s*/, "").trim();
    }

    // Company is the line above
    if (dateLineIdx >= 1) {
      const lineAbove = lines[dateLineIdx - 1].trim();
      // Only treat as company if it's not a bullet point or empty
      if (lineAbove && !lineAbove.startsWith("*") && !lineAbove.startsWith("-") && !lineAbove.startsWith("•")) {
        company = lineAbove;
      }
    }
  } else {
    // Date is on its own line (or starts the line)
    // Original logic: title 1 above, company 2 above (or on date line)
    if (dateLineIdx >= 1) {
      const lineAbove = lines[dateLineIdx - 1];

      if (dateLineIdx >= 2) {
        title = lines[dateLineIdx - 2];
        const companyParts = lineAbove.split(/\s*[|·—–]\s*/);
        company = companyParts[0]?.trim() ?? "";
        if (companyParts.length > 1) {
          location = companyParts[companyParts.length - 1]?.trim() ?? "";
        }
      } else {
        title = lineAbove;
      }
    }

    // Location from after date if not found yet
    if (!location && textAfterDate) {
      location = textAfterDate.replace(/^[|·—–,]\s*/, "").trim();
    }
  }

  // Description: everything after the date line
  const descLines = lines.slice(dateLineIdx + 1).filter(Boolean);
  const description = descLines.join("\n").trim();

  // Extract bullet points as highlights
  const highlights = descLines
    .filter((l) => l.startsWith("•") || l.startsWith("-") || l.startsWith("*"))
    .map((l) => l.replace(/^[•\-*]\s*/, "").trim());

  return {
    id: genId(),
    title: title.trim(),
    company: company.trim(),
    location: location.trim(),
    startDate,
    endDate,
    description,
    highlights,
  };
}

// --- Education Parsing ---

const DEGREE_KEYWORDS = [
  "bachelor",
  "master",
  "phd",
  "doctorate",
  "associate",
  "b.s.",
  "b.a.",
  "m.s.",
  "m.a.",
  "m.b.a.",
  "mba",
  "bs",
  "ba",
  "ms",
  "ma",
];

function parseEducation(lines: string[]): Education[] {
  const entries = splitEntries(lines);
  const results: Education[] = [];

  for (const entry of entries) {
    const edu = parseEducationEntry(entry);
    if (edu) results.push(edu);
  }

  return results;
}

function parseEducationEntry(lines: string[]): Education | null {
  if (lines.length === 0) return null;

  let school = "";
  let degree = "";
  let field = "";
  let startDate = "";
  let endDate = "";
  let gpa = "";

  for (const line of lines) {
    const lower = line.toLowerCase();

    // Date range
    const dateMatch = line.match(DATE_RANGE_RE);
    if (dateMatch) {
      const dates = dateMatch[0].split(/\s*[-–—]\s*|\s+to\s+/i);
      startDate = dates[0]?.trim() ?? "";
      endDate = dates[1]?.trim() ?? "";
      continue;
    }

    // GPA
    const gpaMatch = line.match(/(?:GPA|gpa)[:\s]*(\d+\.?\d*)/);
    if (gpaMatch) {
      gpa = gpaMatch[1];
    }

    // Degree line
    if (DEGREE_KEYWORDS.some((kw) => lower.includes(kw))) {
      degree = line.trim();
      // Often "B.S. in Computer Science"
      const fieldMatch = line.match(/\bin\s+(.+)/i);
      if (fieldMatch) {
        field = fieldMatch[1].trim();
      }
      continue;
    }

    // School name (usually the first non-date, non-degree line)
    if (!school && line.length > 2) {
      school = line.trim();
    }
  }

  if (!school && !degree) return null;

  return {
    id: genId(),
    school,
    degree,
    field,
    startDate,
    endDate,
    gpa,
  };
}

// --- Skills Parsing ---

function parseSkills(lines: string[]): string[] {
  const allText = lines.join(" ");
  const skills = allText
    .split(/[,;·•|]|\s{2,}/)
    .map((s) => s.replace(/^[-*]\s*/, "").trim())
    .filter((s) => s.length > 0 && s.length < 60);

  // Deduplicate (case-insensitive)
  const seen = new Set<string>();
  return skills.filter((s) => {
    const key = s.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --- Utilities ---

/**
 * Split lines into entries separated by blank lines.
 */
function splitEntries(lines: string[]): string[][] {
  const entries: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line === "") {
      if (current.length > 0) {
        entries.push(current);
        current = [];
      }
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) {
    entries.push(current);
  }

  return entries;
}

export {
  splitSections,
  extractEmail,
  extractPhone,
  extractLinkedInUrl,
  extractGithubUrl,
  parseNameLine,
  parseExperiences,
  parseEducation,
  parseSkills,
  splitEntries,
  DATE_RANGE_RE,
};
