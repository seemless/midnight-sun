import type { DetectedField, DebugCounts, FieldSignals, ChoiceGroup, ChoiceOption } from "../shared/types";
import { matchField } from "../shared/matchers";
import { INFRA_SELECTORS, SEARCH_FORM_SELECTORS, MAX_SIGNAL_LENGTH, MAX_HEADING_TEXT_LENGTH, MAX_HEADING_SCAN_DEPTH } from "../shared/constants";

// ============================================================
// Form Field Detector
// Scans a Document for fillable form fields and maps them to profile fields.
// Takes Document as a parameter — testable with happy-dom/jsdom.
// ============================================================

/** Selectors for common field wrapper patterns in ATS UIs */
const WRAPPER_SELECTORS = [
  "[data-field]",
  ".field",
  ".form-field",
  ".form-group",
  '[role="group"]',
  "fieldset",
  '[class*="field"]',
  '[class*="form-row"]',
  '[class*="form-item"]',
].join(", ");

/**
 * Walk up from an input to find its container/wrapper, then extract
 * the container's text content minus the input's own value/placeholder.
 * Returns cleaned text or null.
 */
function extractContainerText(el: Element): string | null {
  // Strategy 1: find a known wrapper via .closest()
  let wrapper: Element | null = el.closest(WRAPPER_SELECTORS);

  // Strategy 2: if no known wrapper, walk up 2–3 levels
  if (!wrapper) {
    let candidate = el.parentElement;
    for (let depth = 0; depth < 3 && candidate; depth++) {
      // Stop at form/body/section — too broad
      if (
        candidate.tagName === "FORM" ||
        candidate.tagName === "BODY" ||
        candidate.tagName === "SECTION"
      ) {
        break;
      }
      // If the container has more than one input, it's probably a form row, not a field wrapper
      const inputCount = candidate.querySelectorAll(
        "input, textarea, select"
      ).length;
      if (inputCount <= 1) {
        wrapper = candidate;
        break;
      }
      candidate = candidate.parentElement;
    }
  }

  if (!wrapper) return null;

  // Clone the wrapper so we don't mutate the live DOM
  const clone = wrapper.cloneNode(true) as HTMLElement;

  // Remove input/textarea/select elements from the clone to isolate label text
  // Use parentNode.removeChild() instead of .remove() because
  // HTMLSelectElement.remove() is overridden to remove <option> children
  for (const input of clone.querySelectorAll("input, textarea, select")) {
    input.parentNode?.removeChild(input);
  }

  // Get remaining text content
  let cleaned = (clone.textContent ?? "").replace(/\s+/g, " ").trim();

  // Remove placeholder text if it leaked into the container
  const placeholder = el.getAttribute("placeholder");
  if (placeholder && cleaned.includes(placeholder)) {
    cleaned = cleaned.replace(placeholder, "").replace(/\s+/g, " ").trim();
  }

  // Reject if too short (noise) or too long (grabbed a whole section)
  if (cleaned.length < 2 || cleaned.length > 200) return null;

  return cleaned;
}

/** Selectors for elements we can fill (excludes radio/checkbox — handled by detectChoiceGroups) */
const FILLABLE_SELECTOR = [
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="file"]):not([type="reset"]):not([type="radio"]):not([type="checkbox"])',
  "textarea",
  "select",
].join(", ");

/** Selectors for custom controls that we detect but CAN'T fill */
const CUSTOM_CONTROL_SELECTOR = [
  '[role="listbox"]',
  '[role="combobox"]:not(input):not(select)',
  '[class*="select"]:not(select)[role]',
].join(", ");

/** Keywords that indicate demographic/EEO fields — never auto-fill these */
const DEMOGRAPHIC_KEYWORDS = [
  "race", "ethnicity", "gender", "sex ", "veteran", "disability",
  "eeo", "equal employment", "voluntary self-identification",
  "sexual orientation", "pronoun", "accommodation",
  "protected class", "national origin", "marital status",
  "lgbtq",
];

/**
 * Check if an element is infrastructure (recaptcha, honeypot, bot trap).
 * These should be excluded from detection and filling entirely.
 */
export function isInfrastructure(el: Element): boolean {
  return INFRA_SELECTORS.some((sel) => {
    try { return el.matches(sel); } catch { return false; }
  });
}

/**
 * Check if an element is part of a job search/filter form, not an application form.
 * These appear on career pages (e.g., "Search jobs" input, "Locations" filter dropdown)
 * and should be excluded from detection to prevent false positives.
 */
export function isSearchFormElement(el: Element): boolean {
  // Check if element matches search-form selectors
  if (SEARCH_FORM_SELECTORS.some((sel) => {
    try { return el.matches(sel); } catch { return false; }
  })) return true;
  // Check if element is inside a [role="search"] ancestor
  if (el.closest('[role="search"]')) return true;
  return false;
}

/**
 * Check if signals indicate a demographic/EEO field.
 * These are detected but never auto-filled.
 */
export function isDemographic(signals: string[]): boolean {
  const joined = signals.join(" ").toLowerCase();
  return DEMOGRAPHIC_KEYWORDS.some((kw) => joined.includes(kw));
}

/**
 * Generate multiple CSS selectors for an element, ordered by reliability.
 * Having multiple candidates protects against React/SPA re-renders
 * invalidating a single selector.
 */
function getSelectorCandidates(el: Element): string[] {
  const candidates: string[] = [];

  // 1. Best: by ID (most stable)
  if (el.id) {
    candidates.push(`#${CSS.escape(el.id)}`);
  }

  // 2. Good: by name attribute
  const name = el.getAttribute("name");
  const tag = el.tagName.toLowerCase();
  if (name) {
    candidates.push(`${tag}[name="${CSS.escape(name)}"]`);
  }

  // 3. By data-automation-id (common in Workday)
  const autoId = el.getAttribute("data-automation-id");
  if (autoId) {
    candidates.push(`[data-automation-id="${CSS.escape(autoId)}"]`);
  }

  // 4. By aria-label
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) {
    candidates.push(`${tag}[aria-label="${CSS.escape(ariaLabel)}"]`);
  }

  // 5. Fallback: nth-of-type path (always works but fragile)
  const path: string[] = [];
  let current: Element | null = el;
  while (current && current !== current.ownerDocument?.body) {
    const parentEl: Element | null = current.parentElement;
    if (!parentEl) break;

    const currentTag = current.tagName;
    const siblings = (Array.from(parentEl.children) as Element[]).filter(
      (sib: Element) => sib.tagName === currentTag
    );
    const index = siblings.indexOf(current) + 1;
    path.unshift(
      `${current.tagName.toLowerCase()}:nth-of-type(${index})`
    );
    current = parentEl;
  }
  if (path.length > 0) {
    candidates.push(path.join(" > "));
  }

  return candidates;
}

/**
 * Extract both flat signals (for matching) and structured signals (for debugging).
 */
function extractSignals(
  el: Element,
  doc: Document
): { flat: string[]; structured: FieldSignals } {
  const flat: string[] = [];
  const structured: FieldSignals = {};

  // 1. Associated <label>
  const id = el.id;
  if (id) {
    const label = doc.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent) {
      const text = label.textContent.trim();
      flat.push(text);
      structured.label = text;
    }
  }

  // 2. Parent/ancestor label
  const parentLabel = el.closest("label");
  if (parentLabel?.textContent) {
    const text = parentLabel.textContent.trim();
    if (!structured.label) {
      flat.push(text);
      structured.label = text;
    }
  }

  // 3. HTML attributes
  const nameAttr = el.getAttribute("name");
  if (nameAttr) {
    flat.push(nameAttr);
    structured.name = nameAttr;
  }

  if (id) {
    flat.push(id);
    structured.id = id;
  }

  const placeholder = el.getAttribute("placeholder");
  if (placeholder) {
    flat.push(placeholder);
    structured.placeholder = placeholder;
  }

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) {
    flat.push(ariaLabel);
    structured.aria = ariaLabel;
  }

  const title = el.getAttribute("title");
  if (title) flat.push(title);

  const automationId = el.getAttribute("data-automation-id");
  if (automationId) {
    flat.push(automationId);
    structured.automationId = automationId;
  }

  // 4. Previous sibling text (walk up to 3 siblings, skip generic text)
  let prevSibling = el.previousElementSibling;
  for (let sibDepth = 0; sibDepth < 3 && prevSibling; sibDepth++) {
    if (prevSibling.tagName === "INPUT" || prevSibling.tagName === "TEXTAREA") break;
    const prevText = prevSibling.textContent?.trim();
    if (prevText && prevText.length >= 2 && prevText.length <= MAX_SIGNAL_LENGTH) {
      // Skip generic placeholder-like text (Google Forms "Your answer", etc.)
      if (!/^(your answer|type here\.{0,3}|enter|n\/a)$/i.test(prevText)) {
        flat.push(prevText);
        structured.nearbyText = prevText;
        break;
      }
    }
    prevSibling = prevSibling.previousElementSibling;
  }

  // 4b. Container/wrapper text (for modern ATS UIs like Gem)
  if (!structured.nearbyText) {
    const containerText = extractContainerText(el);
    if (containerText) {
      flat.push(containerText);
      structured.nearbyText = containerText;
    }
  }

  // 4c. Heading scan — for platforms like Google Forms where question text
  // lives in a [role="heading"] or <h*> within a shared ancestor, not in a label
  if (!structured.label && (!structured.nearbyText || /^(your answer|type here\.{0,3})$/i.test(structured.nearbyText ?? ""))) {
    let ancestor = el.parentElement;
    for (let depth = 0; depth < MAX_HEADING_SCAN_DEPTH && ancestor; depth++) {
      if (ancestor.tagName === "FORM" || ancestor.tagName === "BODY") break;

      const headings = ancestor.querySelectorAll(
        'h1, h2, h3, h4, h5, h6, [role="heading"], [data-initial-value]'
      );

      for (const heading of headings) {
        const headingText = heading.textContent?.trim();
        if (headingText && headingText.length >= 3 && headingText.length <= MAX_HEADING_TEXT_LENGTH) {
          // Only use if this ancestor doesn't contain many inputs (avoids grabbing a sibling field's heading)
          const inputCount = ancestor.querySelectorAll("input, textarea, select").length;
          if (inputCount <= 2) {
            flat.push(headingText);
            structured.nearbyText = headingText;
            break;
          }
        }
      }

      if (structured.nearbyText && !/^(your answer|type here\.{0,3})$/i.test(structured.nearbyText)) break;
      ancestor = ancestor.parentElement;
    }
  }

  // 5. aria-labelledby target
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const labelEl = doc.getElementById(labelledBy);
    if (labelEl?.textContent) {
      const text = labelEl.textContent.trim();
      flat.push(text);
      structured.aria = structured.aria
        ? `${structured.aria} | ${text}`
        : text;
    }
  }

  return { flat: flat.filter(Boolean), structured };
}

/**
 * Detect all fillable form fields on the page.
 * Returns fields + raw debug counts for diagnostics.
 */
export function detectFields(doc: Document): {
  fields: DetectedField[];
  debugCounts: DebugCounts;
} {
  // --- Collect raw counts for diagnostics ---
  const debugCounts: DebugCounts = {
    rawInputs: doc.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="file"]):not([type="reset"])').length,
    rawTextareas: doc.querySelectorAll("textarea").length,
    rawSelects: doc.querySelectorAll("select").length,
    roleTextbox: doc.querySelectorAll('[role="textbox"]').length,
    contenteditable: doc.querySelectorAll('[contenteditable="true"]').length,
    iframes: doc.querySelectorAll("iframe").length,
    sameOriginIframes: 0,
    filteredByVisibility: 0,
  };

  const elements = doc.querySelectorAll(FILLABLE_SELECTOR);
  const results: DetectedField[] = [];
  const seenSelectors = new Set<string>();

  for (const el of elements) {
    // Only hard-skip if aria-hidden="true" directly on the element
    if (el.getAttribute("aria-hidden") === "true") continue;

    // Skip infrastructure elements (recaptcha, honeypots, bot traps)
    if (isInfrastructure(el)) continue;

    // Skip search/filter form elements (job search UI, not application forms)
    if (isSearchFormElement(el)) continue;

    // Skip elements that are options inside a listbox/combobox/menu
    // (e.g., country code <li> items in a phone dropdown)
    const listAncestor = el.closest('[role="listbox"], [role="combobox"], [role="menu"]');
    if (listAncestor && el !== listAncestor) continue;

    // Soft visibility: tag but don't skip
    let visible = true;
    if (el instanceof HTMLElement && doc.defaultView) {
      const style = doc.defaultView.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") {
        visible = false;
        debugCounts.filteredByVisibility++;
      }
    }

    const { flat: signals, structured: structuredSignals } = extractSignals(el, doc);
    const match = matchField(signals);
    const candidates = getSelectorCandidates(el);
    const demographic = isDemographic(signals);

    const inputType =
      el instanceof HTMLSelectElement
        ? "select"
        : el instanceof HTMLTextAreaElement
          ? "textarea"
          : (el as HTMLInputElement).type || "text";

    const currentValue =
      el instanceof HTMLSelectElement
        ? el.value
        : el instanceof HTMLTextAreaElement
          ? el.value
          : (el as HTMLInputElement).value || "";

    const primarySelector = candidates[0] ?? "";
    seenSelectors.add(primarySelector);

    results.push({
      selectorCandidates: candidates,
      inputType,
      signals,
      structuredSignals,
      matchedField: demographic ? null : match?.field ?? null,
      confidence: demographic ? 0 : match?.confidence ?? 0,
      currentValue,
      visible,
      category: demographic ? "demographic" : undefined,
    });
  }

  // Custom controls — detect but flag as manual required
  const customControls = doc.querySelectorAll(CUSTOM_CONTROL_SELECTOR);
  for (const el of customControls) {
    // Skip infrastructure elements
    if (isInfrastructure(el)) continue;

    // Skip child custom controls (e.g., listbox options nested inside a combobox)
    if (el.parentElement?.closest('[role="listbox"], [role="combobox"], [role="menu"]')) continue;

    const candidates = getSelectorCandidates(el);
    const primarySelector = candidates[0] ?? "";
    if (seenSelectors.has(primarySelector)) continue;
    seenSelectors.add(primarySelector);

    const { flat: signals, structured: structuredSignals } = extractSignals(el, doc);
    const match = matchField(signals);
    if (!match) continue;

    const demographic = isDemographic(signals);

    results.push({
      selectorCandidates: candidates,
      inputType: "custom",
      signals,
      structuredSignals,
      matchedField: demographic ? null : match.field,
      confidence: demographic ? 0 : match.confidence * 0.5,
      currentValue: "",
      visible: true,
      category: demographic ? "demographic" : undefined,
    });
  }

  // --- Same-origin iframe scanning ---
  const iframes = doc.querySelectorAll("iframe");
  for (const iframe of iframes) {
    try {
      const iframeDoc = (iframe as HTMLIFrameElement).contentDocument;
      if (!iframeDoc) continue; // cross-origin or not loaded

      debugCounts.sameOriginIframes++;

      const iframeElements = iframeDoc.querySelectorAll(FILLABLE_SELECTOR);
      for (const el of iframeElements) {
        // Only hard-skip aria-hidden
        if (el.getAttribute("aria-hidden") === "true") continue;

        // Skip infrastructure elements
        if (isInfrastructure(el)) continue;

        // Skip listbox/combobox option children
        const iframeListAncestor = el.closest('[role="listbox"], [role="combobox"], [role="menu"]');
        if (iframeListAncestor && el !== iframeListAncestor) continue;

        // Soft visibility
        let visible = true;
        if (el instanceof HTMLElement && iframeDoc.defaultView) {
          const style = iframeDoc.defaultView.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") {
            visible = false;
            debugCounts.filteredByVisibility++;
          }
        }

        const { flat: signals, structured: structuredSignals } = extractSignals(el, iframeDoc);
        const match = matchField(signals);
        const candidates = getSelectorCandidates(el);
        const demographic = isDemographic(signals);

        const inputType =
          el instanceof HTMLSelectElement
            ? "select"
            : el instanceof HTMLTextAreaElement
              ? "textarea"
              : (el as HTMLInputElement).type || "text";

        const currentValue =
          el instanceof HTMLSelectElement
            ? el.value
            : el instanceof HTMLTextAreaElement
              ? el.value
              : (el as HTMLInputElement).value || "";

        const primarySelector = candidates[0] ?? "";
        if (seenSelectors.has(primarySelector)) continue;
        seenSelectors.add(primarySelector);

        results.push({
          selectorCandidates: candidates,
          inputType,
          signals,
          structuredSignals,
          matchedField: demographic ? null : match?.field ?? null,
          confidence: demographic ? 0 : match?.confidence ?? 0,
          currentValue,
          visible,
          category: demographic ? "demographic" : undefined,
        });
      }
    } catch {
      // cross-origin — silently skip
      continue;
    }
  }

  return { fields: results, debugCounts };
}

/**
 * Resolve a DetectedField to a DOM element using its selector candidates.
 * Tries each candidate in order until one matches.
 */
export function resolveElement(
  field: DetectedField,
  doc: Document
): Element | null {
  for (const selector of field.selectorCandidates) {
    try {
      const el = doc.querySelector(selector);
      if (el) return el;
    } catch {
      continue;
    }
  }
  return null;
}

// ============================================================
// Choice Group Detector (radio buttons + checkboxes)
// Groups inputs by name attribute, extracts question + option labels.
// ============================================================

/**
 * Extract the question/label for a group of radio/checkbox inputs.
 * Looks at fieldset legend, radiogroup aria-label, nearby headings, etc.
 */
function extractGroupQuestion(inputs: HTMLInputElement[], doc: Document): string | null {
  const first = inputs[0];

  // 1. Fieldset legend
  const fieldset = first.closest("fieldset");
  if (fieldset) {
    const legend = fieldset.querySelector("legend");
    if (legend?.textContent?.trim()) return legend.textContent.trim();
  }

  // 2. Radiogroup aria-label or aria-labelledby
  const radiogroup = first.closest('[role="radiogroup"], [role="group"]');
  if (radiogroup) {
    const ariaLabel = radiogroup.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel;

    const labelledBy = radiogroup.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelEl = doc.getElementById(labelledBy);
      if (labelEl?.textContent?.trim()) return labelEl.textContent.trim();
    }
  }

  // 3. Look for a label/heading in the nearest container
  const container = first.closest('.form-group, .field, [data-field], [class*="field"], [class*="form-row"]');
  if (container) {
    const heading = container.querySelector('label:not([for]), h1, h2, h3, h4, h5, h6, [role="heading"]');
    if (heading?.textContent?.trim()) {
      const text = heading.textContent.trim();
      if (text.length >= 3 && text.length <= 200) return text;
    }
  }

  // 4. Previous sibling text of the group's wrapper
  const wrapper = first.closest("div, fieldset");
  if (wrapper) {
    let prev = wrapper.previousElementSibling;
    for (let i = 0; i < 3 && prev; i++) {
      const text = prev.textContent?.trim();
      if (text && text.length >= 3 && text.length <= 200) return text;
      prev = prev.previousElementSibling;
    }
  }

  // 5. Name attribute as last resort (convert to readable text)
  const name = first.name;
  if (name && name.length >= 3) {
    return name.replace(/[_-]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  }

  return null;
}

/**
 * Extract the human-readable label for a single radio/checkbox option.
 */
function extractOptionLabel(el: HTMLInputElement, doc: Document): string {
  // 1. Associated label via for attribute
  if (el.id) {
    const label = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }

  // 2. Parent label
  const parentLabel = el.closest("label");
  if (parentLabel) {
    // Get text content excluding the input element itself
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    for (const input of clone.querySelectorAll("input")) {
      input.parentNode?.removeChild(input);
    }
    const text = clone.textContent?.trim();
    if (text) return text;
  }

  // 3. Next sibling text
  const nextSibling = el.nextSibling;
  if (nextSibling?.textContent?.trim()) {
    const text = nextSibling.textContent.trim();
    if (text.length >= 1 && text.length <= 100) return text;
  }
  const nextEl = el.nextElementSibling;
  if (nextEl?.textContent?.trim()) {
    const text = nextEl.textContent.trim();
    if (text.length >= 1 && text.length <= 100) return text;
  }

  // 4. Value attribute
  if (el.value && el.value !== "on") return el.value;

  return "Unknown";
}

/**
 * Detect radio button and checkbox groups on the page.
 * Groups inputs by name attribute, extracts the question label and option labels,
 * and runs field matching to determine what profile field they map to.
 */
export function detectChoiceGroups(doc: Document): ChoiceGroup[] {
  const groups: ChoiceGroup[] = [];
  const groupMap = new Map<string, HTMLInputElement[]>();

  // 1. Query all radio and checkbox inputs, group by name
  const choiceInputs = doc.querySelectorAll('input[type="radio"], input[type="checkbox"]');

  for (const input of choiceInputs) {
    const el = input as HTMLInputElement;
    if (el.getAttribute("aria-hidden") === "true") continue;
    if (isInfrastructure(el)) continue;

    // Group by name; unnamed inputs grouped by container
    const groupKey = el.name || `__unnamed_${el.type}_${crypto.randomUUID?.() ?? Math.random()}`;
    if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
    groupMap.get(groupKey)!.push(el);
  }

  // 2. Process each group
  for (const [groupName, inputs] of groupMap) {
    // Single radio is meaningless (need at least 2 options)
    if (inputs.length < 2 && inputs[0]?.type === "radio") continue;

    const inputType = inputs[0].type as "radio" | "checkbox";

    // Extract group question
    const question = extractGroupQuestion(inputs, doc);
    if (!question) continue;

    // Extract options
    const options: ChoiceOption[] = inputs.map((el) => ({
      selector: getSelectorCandidates(el)[0] ?? "",
      label: extractOptionLabel(el, doc),
      value: el.value,
    }));

    // Build signals from question + option labels
    const signals = [question, ...options.map((o) => o.label)].filter(Boolean);

    // Check demographic
    const demographic = isDemographic(signals);

    // Match against profile fields using the question text
    const match = matchField([question]);

    // Determine category
    let category: "fillable" | "demographic" | "manual" = "fillable";
    if (demographic) {
      category = "demographic";
    } else if (!match) {
      category = "manual";
    }

    // Get container selectors
    const selectorCandidates: string[] = [];
    const container = inputs[0].closest('fieldset, [role="radiogroup"], [role="group"]');
    if (container) {
      selectorCandidates.push(...getSelectorCandidates(container));
    }

    groups.push({
      groupId: groupName,
      inputType,
      question,
      options,
      signals,
      matchedField: demographic ? null : match?.field ?? null,
      confidence: demographic ? 0 : match?.confidence ?? 0,
      category,
      selectorCandidates,
    });
  }

  return groups;
}

export { extractSignals, getSelectorCandidates, FILLABLE_SELECTOR };
