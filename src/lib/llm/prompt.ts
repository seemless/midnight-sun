// ============================================================
// Shared Prompt Builder + Response Parser
// Used by ALL providers. Provider-agnostic.
// ============================================================

import type {
  JobContext,
  SmartApplyResult,
  SmartAnswer,
  Profile,
  Voice,
} from "../../shared/types";

/** Parsed LLM response before being zipped with question metadata */
export interface ParsedResponse {
  summary: string;
  whyCompany: string;
  answers: Array<{ label: string; answer: string }>;
}

/**
 * Build the prompt for generating job application answers.
 * Every provider sends this same prompt text — they just wrap it
 * differently (raw text for Ollama, messages array for OpenAI/Anthropic/Gemini).
 */
export function buildApplicationPrompt(
  context: JobContext,
  profile: Profile,
  voice?: Voice,
  existingResume?: string
): string {
  const questionsBlock =
    context.questions.length > 0
      ? context.questions
          .map(
            (q, i) =>
              `    { "label": "${q.label.replace(/"/g, '\\"')}", "answer": "your answer for question ${i + 1}" }`
          )
          .join(",\n")
      : '    { "label": "No additional questions", "answer": "" }';

  const voiceBlock = buildVoiceBlock(voice);

  const existingResumeBlock = existingResume
    ? `
Candidate's Existing Resume (THIS IS YOUR PRIMARY SOURCE — it contains the candidate's real companies, titles, accomplishments, and skills. Use it as the ground truth for all answers):
${existingResume}
`
    : "";

  return `You are helping a candidate apply for a job. Respond ONLY with valid JSON, no other text.

Job Title: ${context.title}
Company: ${context.company}

Job Description (truncated):
${context.description}
${voiceBlock}${existingResumeBlock}
Candidate Profile:
${JSON.stringify(profile, null, 2)}

Generate a JSON object with these exact keys:
{
  "summary": "3-4 sentences about this candidate's relevant experience for THIS role. Use their REAL job titles, companies, and skills from the resume/profile.",
  "whyCompany": "A concise paragraph on why this company/role is compelling based on the job description. Reference SPECIFIC things from the JD — product names, tech stack, team mission. Do NOT write generic enthusiasm.",
  "answers": [
${questionsBlock}
  ]
}

STRICT RULES — failure to follow these will make the output useless:
1. YOUR PRIMARY SOURCE is the existing resume text (if provided). It contains the candidate's real companies, titles, accomplishments, and skills. Use it as ground truth.
2. ONLY reference experience, skills, companies, and job titles that ACTUALLY EXIST in the resume or candidate profile above.
3. NEVER use bracket placeholders like [project], [company], [technology], [X years], [specific example]. If you don't have specific information, write a general but honest statement instead.
4. NEVER invent job titles, companies, metrics (percentages, dollar amounts), or achievements not found in the resume/profile. It is BETTER to be vague than to fabricate.
5. For open-ended questions ("describe something you've built", "tell us about yourself", etc.), draw from the candidate's REAL experiences in the resume. Reference actual companies (e.g. Roblox, Walmart, etc.) and real projects they describe.
6. For "additional information" or "cover letter" fields, write a brief tailored paragraph connecting the candidate's real background to this specific role. Reference specific details from the job description.
7. Be direct. No fluff. BANNED PHRASES: "I am excited to apply", "I believe I would be a great fit", "I am enthusiastic about joining", "fostering a culture of innovation", "passionate about". Write like a real human, not a form letter.
8. Keep answers concise but substantive — 2-4 sentences per answer unless the question asks for more.
9. Reference specific things from the job description (product names, tech stack, team, mission) to show the application is tailored — do NOT just repeat the company name with generic praise.`;
}

/**
 * Parse the LLM response into structured data.
 * Handles: raw JSON, JSON in code fences, partial JSON extraction.
 * Used by ALL providers — response text always goes through this.
 */
export function parseSmartResponse(raw: string): ParsedResponse | null {
  let text = raw.trim();

  // Strip markdown code fences
  text = text
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "");

  // Try direct parse
  try {
    const parsed = JSON.parse(text);
    if (parsed.summary && parsed.whyCompany && Array.isArray(parsed.answers)) {
      return parsed;
    }
  } catch {
    // Fall through to extraction
  }

  // Try extracting first { ... } block
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed.summary && parsed.whyCompany && Array.isArray(parsed.answers)) {
        return parsed;
      }
    } catch {
      // Fall through
    }
  }

  return null;
}

// ============================================================
// Resume Prompt Builder + Response Parser
// ============================================================

/** Build voice block shared by all prompts */
function buildVoiceBlock(voice?: Voice): string {
  if (!voice || !voice.corePitch) return "";
  return `
Candidate Voice & Preferences:
- Core Pitch: ${voice.corePitch}${voice.topStrengths.length > 0 ? `\n- Top Strengths: ${voice.topStrengths.join(", ")}` : ""}${voice.roleTargets.length > 0 ? `\n- Target Roles: ${voice.roleTargets.join(", ")}` : ""}${voice.constraints ? `\n- Constraints: ${voice.constraints}` : ""}
- Tone: Write in a ${voice.tone} tone.

Use the candidate's own words from "Core Pitch" as the foundation. Don't be generic.
`;
}

/**
 * Build the prompt for generating a tailored resume.
 * Returns markdown — no JSON parsing needed.
 */
export function buildResumePrompt(
  context: JobContext,
  profile: Profile,
  voice?: Voice,
  existingResume?: string,
  feedback?: string
): string {
  const voiceBlock = buildVoiceBlock(voice);

  const existingResumeBlock = existingResume
    ? `
Candidate's Existing Resume (use as primary source material — preserve accomplishments and phrasing where relevant):
${existingResume}
`
    : "";

  const feedbackBlock = feedback
    ? `
User Notes / Feedback:
${feedback}
`
    : "";

  return `You are creating a tailored resume for a job application. Respond ONLY with markdown, no other text.

Job Title: ${context.title}
Company: ${context.company}

Job Description (truncated):
${context.description}
${voiceBlock}
Candidate Profile (structured data):
${JSON.stringify(profile, null, 2)}
${existingResumeBlock}${feedbackBlock}
Generate a professional resume in markdown format with these sections:

# ${profile.firstName} ${profile.lastName}
${profile.email}${profile.phone ? ` | ${profile.phone}` : ""}${profile.linkedinUrl ? ` | ${profile.linkedinUrl}` : ""}${profile.location ? ` | ${profile.location}` : ""}

## Summary
2-3 sentences tailored to this role, using the candidate's REAL experience.

## Experience
List ONLY the experiences from the source material. Reword bullet points to emphasize skills matching the job.

## Education
List ONLY the education entries from the source material. If none exist, OMIT this section entirely.

## Skills
Skills from the source material relevant to this job, prioritized.

STRICT RULES — these are non-negotiable:
1. YOUR PRIMARY SOURCE IS THE EXISTING RESUME TEXT (if provided). It contains the candidate's real companies, titles, accomplishments, and education. Use it verbatim where appropriate, rewording only to tailor for this role.
2. The structured profile JSON is a secondary reference. If the existing resume has richer detail than the JSON, PREFER the resume text.
3. ONLY use experience, education, skills, companies, and job titles that ACTUALLY EXIST in the source material. Count the experiences — your resume must have exactly the same ones, not more.
4. NEVER invent or fabricate metrics (percentages, dollar amounts, time savings). If the source material doesn't include a metric, don't add one. "Improved performance" is fine without "by 20%".
5. NEVER invent companies, job titles, or projects not in the source material.
6. NEVER use bracket placeholders like [project], [company], [X%], [University Name]. Everything must be concrete text from the source material.
7. If education is empty in ALL source material, do NOT write "None listed" or make up education — just skip the Education section entirely.
8. Keep to 1 page equivalent (roughly 400-600 words).
9. It is BETTER to write fewer, honest bullet points than to pad with fabricated achievements. Quality over quantity.
10. If the candidate voice is provided, reflect that tone in the writing.
11. Do NOT append any commentary, notes, explanation, or meta-text after the resume. Your response must end with resume content — nothing else.`;
}

/**
 * Build the prompt for generating a tailored cover letter.
 * Returns markdown — no JSON parsing needed.
 */
export function buildCoverLetterPrompt(
  context: JobContext,
  profile: Profile,
  voice?: Voice,
  existingResume?: string,
  feedback?: string
): string {
  const voiceBlock = buildVoiceBlock(voice);

  const existingResumeBlock = existingResume
    ? `
Candidate's Resume (reference for specific accomplishments and details):
${existingResume}
`
    : "";

  const feedbackBlock = feedback
    ? `
User Notes / Feedback:
${feedback}
`
    : "";

  return `You are writing a cover letter for a job application. Respond ONLY with markdown, no other text.

Job Title: ${context.title}
Company: ${context.company}

Job Description (truncated):
${context.description}
${voiceBlock}
Candidate Profile (structured data):
${JSON.stringify(profile, null, 2)}
${existingResumeBlock}${feedbackBlock}
Write a professional cover letter in markdown with this structure:

**Paragraph 1 — Opening:** Start by referencing something SPECIFIC from the job description — a product feature, a technical challenge, a company mission statement. Then connect it to why you're a fit. Do NOT open with "I am writing to express my interest" or "I am excited to apply" — start with substance.

**Paragraph 2 — Body:** Connect 2-3 of the candidate's most relevant experiences to the specific requirements in the job description. Name real companies, real technologies, real projects from the resume/profile. For each point, tie it to a specific requirement from the JD.

**Paragraph 3 — Closing:** Brief, confident close with a call to action.

STRICT RULES:
1. YOUR PRIMARY SOURCE IS THE EXISTING RESUME TEXT (if provided). It contains the candidate's real companies, titles, and accomplishments. The structured JSON is a secondary reference.
2. ONLY reference experience, skills, and achievements that ACTUALLY EXIST in the source material.
3. NEVER invent metrics (percentages, dollar amounts, time savings). If the source material doesn't include a metric, don't add one.
4. NEVER invent companies, job titles, or projects not in the source material.
5. NEVER use bracket placeholders like [project], [company], [specific example].
6. Reference specific things from the JD — product names, tech stack mentioned, team descriptions, mission statements. Show you read it.
7. Keep it under 350 words — concise and impactful.
8. BANNED PHRASES: "I am writing to express my interest", "I am excited to apply", "I believe I would be a great fit", "I am confident that", "thrilled to apply", "passionate about". These are empty filler. Start with substance instead.
9. Address it to "Dear Hiring Manager," unless the job description names a specific person.
10. Sign off with the candidate's name: ${profile.firstName} ${profile.lastName}.
11. If user notes/feedback are provided, incorporate them into the letter.
12. Do NOT append any commentary, notes, explanation, or meta-text after the cover letter. End with the candidate's name — nothing else.`;
}

/**
 * Parse the resume LLM response. Strips code fences and trailing LLM commentary.
 * Returns raw markdown string or null on failure.
 */
export function parseResumeResponse(raw: string): string | null {
  let text = raw.trim();
  if (!text) return null;

  // Strip markdown code fences
  text = text
    .replace(/^```(?:markdown|md)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "");

  // Strip trailing LLM commentary
  text = stripTrailingCommentary(text);

  return text.trim() || null;
}

/**
 * Commentary patterns that LLMs append after generating resume/CL content.
 * Case-insensitive. Matched against trailing paragraph blocks.
 */
const COMMENTARY_PATTERNS = [
  /this resume/i,
  /this cover letter/i,
  /adheres to/i,
  /provided guidelines/i,
  /source material/i,
  /as instructed/i,
  /as requested/i,
  /i have ensured/i,
  /i have followed/i,
  /i have maintained/i,
  /i've ensured/i,
  /i've followed/i,
  /i've maintained/i,
  /note:/i,
  /please note/i,
  /the above/i,
  /no fabricat/i,
  /maintains? a professional/i,
  /emphasiz(?:es?|ing) accomplishments/i,
  /existing (?:resume|profile|source)/i,
  /real (?:companies|job titles)/i,
];

/**
 * Detect whether a line is a markdown structural element (heading, bullet, bold, table, hr).
 * These should never be stripped — they're resume/CL content.
 */
function isMarkdownStructure(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith("#") ||
    trimmed.startsWith("-") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("|") ||
    /^\*\*/.test(trimmed) ||
    /^---/.test(trimmed)
  );
}

/**
 * Walk backward through trailing paragraph blocks and strip LLM commentary.
 * A "paragraph block" is text separated by blank lines.
 * Only strips blocks that match commentary patterns AND are not markdown structure.
 */
export function stripTrailingCommentary(text: string): string {
  // Split into paragraph blocks (separated by blank lines)
  const blocks = text.split(/\n\s*\n/);

  // Walk backward from the end
  let lastContentIdx = blocks.length - 1;

  while (lastContentIdx >= 0) {
    const block = blocks[lastContentIdx].trim();
    if (!block) {
      lastContentIdx--;
      continue;
    }

    // Check if any line in this block is markdown structure
    const lines = block.split("\n");
    const hasStructure = lines.some((line) => isMarkdownStructure(line));
    if (hasStructure) break; // Stop — this is content

    // Check if block matches commentary patterns
    const isCommentary = COMMENTARY_PATTERNS.some((pattern) =>
      pattern.test(block)
    );

    if (isCommentary) {
      lastContentIdx--;
    } else {
      break; // This block doesn't look like commentary — stop
    }
  }

  // If we stripped everything, return original (safety)
  if (lastContentIdx < 0) return text;

  // Rejoin remaining blocks
  return blocks.slice(0, lastContentIdx + 1).join("\n\n");
}

/**
 * Zip parsed answers back onto question metadata (selectorCandidates, etc.).
 * Matches by index — the LLM response preserves question order.
 */
export function zipAnswers(
  context: JobContext,
  parsed: ParsedResponse
): SmartAnswer[] {
  return context.questions.map((q, i) => ({
    label: q.label,
    selectorCandidates: q.selectorCandidates,
    answer: parsed.answers[i]?.answer ?? "",
  }));
}

/**
 * Build a SmartApplyResult from parsed response + timing metadata.
 */
export function buildSmartApplyResult(
  context: JobContext,
  parsed: ParsedResponse,
  model: string,
  promptChars: number,
  durationMs: number
): SmartApplyResult {
  return {
    summary: parsed.summary,
    whyCompany: parsed.whyCompany,
    answers: zipAnswers(context, parsed),
    model,
    durationMs,
    promptChars,
  };
}

// ============================================================
// Gap Detection — Profile Completeness Check
// ============================================================

import type { GapQuestion } from "../../shared/types";

/**
 * Deterministic pre-check: does the profile have critical gaps?
 * Returns true if the profile is too sparse for a good generation.
 * If rawResume has substantial content, returns false (LLM has source material).
 */
export function hasProfileGaps(profile: Profile, rawResume: string): boolean {
  // If raw resume has substantial content, LLM has enough source material
  if (rawResume.length > 200) return false;

  const hasExperiences = profile.experiences.length > 0;
  const hasSkills = profile.skills.length > 0;
  const hasSummary = profile.summary.trim().length > 20;

  // Trigger if 2+ critical sections are empty
  const emptyCount = [!hasExperiences, !hasSkills, !hasSummary].filter(Boolean).length;
  return emptyCount >= 2;
}

/**
 * Build the prompt for LLM-powered gap detection.
 * The LLM analyzes the profile against the JD and returns
 * targeted questions to fill critical gaps.
 */
export function buildGapDetectionPrompt(
  profile: Profile,
  context: JobContext,
  existingResume?: string
): string {
  const resumeBlock = existingResume
    ? `\nCandidate's Existing Resume:\n${existingResume}\n`
    : "";

  return `You are analyzing a candidate's profile to identify missing information needed for a strong job application. Respond ONLY with valid JSON, no other text.

Job Title: ${context.title}
Company: ${context.company}

Job Description (truncated):
${context.description.slice(0, 6000)}

Candidate Profile:
${JSON.stringify(profile, null, 2)}
${resumeBlock}
Analyze this profile and identify what critical information is MISSING or too sparse to create a strong, tailored resume for this specific role.

Respond with this JSON format:
{
  "questions": [
    {
      "id": "unique_id",
      "field": "summary" | "experiences" | "education" | "skills" | "other",
      "question": "A specific question to ask the candidate",
      "placeholder": "Example of what a good answer looks like",
      "inputType": "text" | "textarea"
    }
  ]
}

RULES:
1. Maximum 5 questions. Fewer is better — only ask about CRITICAL gaps.
2. If the profile + resume have enough data for this role, return: {"questions": []}
3. Questions must be SPECIFIC to this role and JD — not generic.
   - BAD: "What are your skills?"
   - GOOD: "Do you have experience with contract analysis AI or legal tech platforms?"
4. Focus on gaps that would cause hallucination:
   - Missing work experience details (no bullet points for a role)
   - Missing skills that the JD specifically requires
   - No education listed when the role requires a degree
   - Summary is empty or too generic
5. For "field", use:
   - "summary" — if the candidate needs a professional summary
   - "experiences" — if experience details are too sparse
   - "education" — if education is missing
   - "skills" — if critical skills are missing
   - "other" — for JD-specific questions that don't map to a profile field
6. Use "textarea" for open-ended answers, "text" for short answers (skills, education name, etc.)`;
}

/**
 * Parse the gap detection LLM response into GapQuestion[].
 * Handles JSON in code fences, partial extraction.
 */
export function parseGapDetectionResponse(raw: string): GapQuestion[] {
  let text = raw.trim();

  // Strip code fences
  text = text
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "");

  // Try direct parse
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed.questions)) {
      return validateGapQuestions(parsed.questions);
    }
  } catch {
    // Fall through
  }

  // Try extracting first { ... } block
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed.questions)) {
        return validateGapQuestions(parsed.questions);
      }
    } catch {
      // Fall through
    }
  }

  return [];
}

/** Validate and normalize gap questions from LLM response */
function validateGapQuestions(questions: unknown[]): GapQuestion[] {
  const validFields = new Set(["summary", "experiences", "education", "skills", "other"]);

  return questions
    .filter((q): q is Record<string, unknown> =>
      typeof q === "object" && q !== null &&
      typeof (q as Record<string, unknown>).question === "string"
    )
    .slice(0, 5) // Max 5
    .map((q, i) => ({
      id: (typeof q.id === "string" ? q.id : `gap_${i}`),
      field: (validFields.has(q.field as string) ? q.field : "other") as GapQuestion["field"],
      question: q.question as string,
      placeholder: (typeof q.placeholder === "string" ? q.placeholder : ""),
      inputType: (q.inputType === "text" ? "text" : "textarea") as "text" | "textarea",
    }));
}
