import type { DetectedField, FillResult, Profile, SmartFillOutcome, ChoiceGroup, ChoiceGroupResult } from "../shared/types";
import { getProfileValue } from "../shared/matchers";
import { resolveElement, extractSignals, isInfrastructure } from "./detector";
import { MIN_FILL_CONFIDENCE } from "../shared/constants";

// ============================================================
// Form Filler
// Fills detected form fields with profile data.
// Dispatches proper DOM events (input, change, blur) so React/Angular/etc. pick up changes.
// ============================================================

/**
 * Set a value on an element and fire the right events.
 * Handles React's synthetic event system, Angular, and vanilla JS.
 */
export function setNativeValue(el: HTMLElement, value: string): void {
  const inputEl = el as HTMLInputElement | HTMLTextAreaElement;
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set;

  const setter =
    el instanceof HTMLTextAreaElement
      ? nativeTextareaValueSetter
      : nativeInputValueSetter;

  if (setter) {
    setter.call(inputEl, value);
  } else {
    inputEl.value = value;
  }

  // Fire events in the order a real user interaction would
  el.dispatchEvent(new Event("focus", { bubbles: true }));
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
}

/**
 * Set a select element's value by matching option text or value.
 */
function setSelectValue(el: HTMLSelectElement, value: string): boolean {
  const normalizedValue = value.toLowerCase().trim();

  // Try matching option value first, then text content
  for (const option of el.options) {
    if (
      option.value.toLowerCase() === normalizedValue ||
      option.textContent?.toLowerCase().trim() === normalizedValue
    ) {
      el.value = option.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
  }

  // Partial match
  for (const option of el.options) {
    if (
      option.value.toLowerCase().includes(normalizedValue) ||
      option.textContent?.toLowerCase().includes(normalizedValue)
    ) {
      el.value = option.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
  }

  return false;
}

/** Helper: primary selector from candidates (for result logging) */
function primarySelector(field: DetectedField): string {
  return field.selectorCandidates[0] ?? "unknown";
}

/**
 * Fill all detected fields with values from the profile.
 *
 * @param fields - Detected fields from detector.ts
 * @param profile - User's profile data
 * @param doc - The Document to operate on (for testability)
 * @returns Results for each field (with per-field timing)
 */
export function fillFields(
  fields: DetectedField[],
  profile: Profile,
  doc: Document
): FillResult[] {
  const results: FillResult[] = [];

  for (const field of fields) {
    const start = performance.now();

    if (!field.matchedField) {
      results.push({
        selector: primarySelector(field),
        matchedField: null,
        filledValue: "",
        success: false,
        reason: "no_match",
        error: "No matched profile field",
        durationMs: Math.round(performance.now() - start),
      });
      continue;
    }

    // Low-confidence matches — skip to avoid wrong fills
    // e.g., "Are you willing to relocate?" matching "currentTitle" at 0.23
    if (field.confidence < MIN_FILL_CONFIDENCE) {
      results.push({
        selector: primarySelector(field),
        matchedField: field.matchedField,
        filledValue: "",
        success: false,
        reason: "low_confidence",
        error: `Confidence ${field.confidence.toFixed(2)} below threshold ${MIN_FILL_CONFIDENCE}`,
        durationMs: Math.round(performance.now() - start),
      });
      continue;
    }

    // Custom controls — flag but don't attempt
    if (field.inputType === "custom") {
      results.push({
        selector: primarySelector(field),
        matchedField: field.matchedField,
        filledValue: "",
        success: false,
        reason: "custom_control",
        manualRequired: true,
        error: "Custom control — fill manually",
        durationMs: Math.round(performance.now() - start),
      });
      continue;
    }

    const value = getProfileValue(field.matchedField, profile);
    if (!value) {
      results.push({
        selector: primarySelector(field),
        matchedField: field.matchedField,
        filledValue: "",
        success: false,
        reason: "empty_profile",
        error: "Profile field is empty",
        durationMs: Math.round(performance.now() - start),
      });
      continue;
    }

    try {
      // Use resolveElement to try all selector candidates
      const el = resolveElement(field, doc);
      if (!el) {
        results.push({
          selector: primarySelector(field),
          matchedField: field.matchedField,
          filledValue: "",
          success: false,
          reason: "element_not_found",
          error: `Element not found (tried ${field.selectorCandidates.length} selectors)`,
          durationMs: Math.round(performance.now() - start),
        });
        continue;
      }

      let success = true;

      if (el instanceof HTMLSelectElement) {
        success = setSelectValue(el, value);
      } else if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement
      ) {
        setNativeValue(el, value);
      } else {
        success = false;
      }

      results.push({
        selector: primarySelector(field),
        matchedField: field.matchedField,
        filledValue: success ? value : "",
        success,
        reason: success ? undefined : "set_value_failed",
        error: success ? undefined : "Could not set value",
        durationMs: Math.round(performance.now() - start),
      });
    } catch (err) {
      results.push({
        selector: primarySelector(field),
        matchedField: field.matchedField,
        filledValue: "",
        success: false,
        reason: "exception",
        error: err instanceof Error ? err.message : "Unknown error",
        durationMs: Math.round(performance.now() - start),
      });
    }
  }

  return results;
}

// ============================================================
// Choice Group Filler (radio buttons + checkboxes)
// Matches profile values to option labels and clicks the correct option.
// ============================================================

/**
 * Fill radio button and checkbox groups with profile values.
 * Matches profile value against option labels (exact, then fuzzy).
 * Uses el.click() to trigger proper event handling.
 *
 * @param groups - Choice groups from detectChoiceGroups
 * @param profile - User's profile data
 * @param doc - The Document to operate on
 * @returns Results for each group
 */
export function fillChoiceGroups(
  groups: ChoiceGroup[],
  profile: Profile,
  doc: Document
): ChoiceGroupResult[] {
  const results: ChoiceGroupResult[] = [];

  for (const group of groups) {
    // Skip demographic fields — never auto-fill
    if (group.category === "demographic") {
      results.push({
        groupId: group.groupId,
        question: group.question,
        selectedOption: "",
        success: false,
        reason: "Demographic field — skipped",
      });
      continue;
    }

    // Skip unmatched groups
    if (group.category === "manual" || !group.matchedField) {
      results.push({
        groupId: group.groupId,
        question: group.question,
        selectedOption: "",
        success: false,
        reason: "No profile field matched",
      });
      continue;
    }

    // Get profile value
    const value = getProfileValue(group.matchedField, profile);
    if (!value) {
      results.push({
        groupId: group.groupId,
        question: group.question,
        selectedOption: "",
        success: false,
        reason: "Profile field is empty",
      });
      continue;
    }

    // Find matching option
    const normalizedValue = value.toLowerCase().trim();
    let matchedOption: typeof group.options[number] | null = null;

    // Exact match (case-insensitive)
    for (const opt of group.options) {
      const optLabel = opt.label.toLowerCase().trim();
      const optValue = opt.value.toLowerCase().trim();
      if (optLabel === normalizedValue || optValue === normalizedValue) {
        matchedOption = opt;
        break;
      }
    }

    // Fuzzy: option label contains value or vice versa
    if (!matchedOption) {
      for (const opt of group.options) {
        const optLabel = opt.label.toLowerCase().trim();
        if (optLabel.includes(normalizedValue) || normalizedValue.includes(optLabel)) {
          matchedOption = opt;
          break;
        }
      }
    }

    // Yes/No shorthand: "yes" matches "Yes, I am authorized to work..."
    if (!matchedOption && (normalizedValue === "yes" || normalizedValue === "no")) {
      for (const opt of group.options) {
        const optLabel = opt.label.toLowerCase().trim();
        if (optLabel.startsWith(normalizedValue)) {
          matchedOption = opt;
          break;
        }
      }
    }

    if (!matchedOption) {
      results.push({
        groupId: group.groupId,
        question: group.question,
        selectedOption: "",
        success: false,
        reason: `No option matched profile value "${value}"`,
      });
      continue;
    }

    // Click the option
    try {
      const el = doc.querySelector(matchedOption.selector);
      if (!el) {
        results.push({
          groupId: group.groupId,
          question: group.question,
          selectedOption: matchedOption.label,
          success: false,
          reason: "Element not found",
        });
        continue;
      }

      // Use click() to trigger proper framework event handling
      (el as HTMLElement).click();
      el.dispatchEvent(new Event("change", { bubbles: true }));

      results.push({
        groupId: group.groupId,
        question: group.question,
        selectedOption: matchedOption.label,
        success: true,
      });
    } catch (err) {
      results.push({
        groupId: group.groupId,
        question: group.question,
        selectedOption: matchedOption.label,
        success: false,
        reason: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return results;
}

// ============================================================
// Smart Fill — fills LLM-generated answers into open-question fields.
// Separate from fillFields() — deterministic path stays untouched.
// Handles textarea, input, contenteditable, and role=textbox.
// ============================================================

/** Selector for open-ended target elements (used by repair scan) */
const SMART_FILL_SELECTOR =
  'textarea, [role="textbox"], [contenteditable="true"], input[type="text"]';

/**
 * Set value on a contenteditable or role=textbox element.
 * These aren't standard inputs — we write textContent and fire input/change.
 */
export function setContentEditableValue(el: HTMLElement, value: string): void {
  el.focus();
  // Clear existing content and set new value
  el.textContent = value;
  // Fire events so frameworks (React, Angular, etc.) pick up the change
  el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.blur();
}

/**
 * Fill smart-generated answers into page elements.
 * Tries selectors first, falls back to signal-based repair matching.
 *
 * Supports: textarea, input, contenteditable, role=textbox.
 *
 * @param answers - Smart fill entries from the popup/background
 * @param doc - The Document to operate on
 * @returns Per-answer fill outcomes
 */
export function fillSmartEntries(
  answers: Array<{
    targetSelector: string;
    selectorCandidates: string[];
    signals: string[];
    value: string;
  }>,
  doc: Document
): SmartFillOutcome[] {
  const outcomes: SmartFillOutcome[] = [];

  for (const entry of answers) {
    let el: Element | null = null;
    let repairUsed = false;

    // 1. Try targetSelector first
    try {
      el = doc.querySelector(entry.targetSelector);
    } catch {
      // invalid selector, try candidates
    }

    // 2. Try remaining selector candidates
    if (!el) {
      for (const sel of entry.selectorCandidates) {
        try {
          el = doc.querySelector(sel);
          if (el) break;
        } catch {
          continue;
        }
      }
    }

    // 3. Repair: find open-question element whose label matches stored signals
    if (!el) {
      repairUsed = true;
      const allTargets = doc.querySelectorAll(SMART_FILL_SELECTOR);
      for (const target of allTargets) {
        // Skip infrastructure elements (recaptcha, honeypots)
        if (isInfrastructure(target)) continue;

        const { flat: targetSignals } = extractSignals(target, doc);
        const matchCount = entry.signals.filter((s) =>
          targetSignals.some(
            (ts) =>
              ts.toLowerCase().includes(s.toLowerCase()) ||
              s.toLowerCase().includes(ts.toLowerCase())
          )
        ).length;
        if (matchCount > 0) {
          el = target;
          break;
        }
      }
    }

    // 4. Fill the element based on its type
    if (el) {
      if (
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLInputElement
      ) {
        // Standard form elements — use native value setter
        setNativeValue(el, entry.value);
        outcomes.push({
          label: entry.signals[0] ?? "unknown",
          filled: true,
          repairUsed,
        });
      } else if (
        el instanceof HTMLElement &&
        (el.getAttribute("contenteditable") === "true" ||
          el.getAttribute("role") === "textbox")
      ) {
        // Contenteditable / role=textbox (Ashby, Gem, modern ATS)
        setContentEditableValue(el, entry.value);
        outcomes.push({
          label: entry.signals[0] ?? "unknown",
          filled: true,
          repairUsed,
        });
      } else {
        outcomes.push({
          label: entry.signals[0] ?? "unknown",
          filled: false,
          repairUsed,
          failureReason: "Element is not a fillable type (textarea, input, contenteditable, or role=textbox)",
        });
      }
    } else {
      outcomes.push({
        label: entry.signals[0] ?? "unknown",
        filled: false,
        repairUsed,
        failureReason: "Element not found (all selectors + repair failed)",
      });
    }
  }

  return outcomes;
}
