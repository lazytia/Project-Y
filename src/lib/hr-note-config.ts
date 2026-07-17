export type HrNoteCategory = "warning" | "review" | "incident" | "other";

export type HrFieldKind = "textarea" | "input" | "time" | "photo";

export type HrFieldConfig = {
  key: string;
  label: string;
  hint: string;
  placeholder?: string;
  kind?: HrFieldKind;
  optional?: boolean;
  maxLength?: number;
};

export type HrCategoryConfig = {
  title: string;
  subtitle: string;
  fields: HrFieldConfig[];
  checkboxes: string[];
  submitLabel: string;
};

export const HR_NOTE_CATEGORY_CONFIG: Record<HrNoteCategory, HrCategoryConfig> = {
  warning: {
    title: "Formal Warning",
    subtitle: "Record a formal warning for the employee.",
    fields: [
      {
        key: "details",
        label: "Details",
        hint: "Describe the issue and why this warning is being issued.",
        placeholder: "e.g. Arrived 25 minutes late on 15 Jun 2026 without prior notice.",
      },
      {
        key: "actionTaken",
        label: "Action Taken",
        hint: "Describe what was discussed and any action taken.",
        placeholder:
          "e.g. Discussed attendance expectations and store policy. A formal warning was issued.",
      },
    ],
    checkboxes: ["Discussed with employee", "Employee given opportunity to respond"],
    submitLabel: "Save Warning",
  },
  review: {
    title: "Performance Review",
    subtitle: "Record a performance review for the employee.",
    fields: [
      {
        key: "concerns",
        label: "Performance Concerns",
        hint: "Describe the performance concerns or areas for improvement.",
        placeholder: "e.g. Discussed punctuality, communication and roster reliability…",
      },
      {
        key: "expectations",
        label: "Action / Expectations",
        hint: "Describe what was discussed and the expected improvements.",
        placeholder:
          "e.g. Employee was advised to improve attendance and prepare for shifts in advance…",
      },
    ],
    checkboxes: ["Discussed with employee", "Employee given opportunity to respond"],
    submitLabel: "Save Review",
  },
  incident: {
    title: "Incident Report",
    subtitle: "Record an incident or workplace issue.",
    fields: [
      { key: "time", label: "Time (Approx.)", hint: "", kind: "time" },
      {
        key: "details",
        label: "Details",
        hint: "Describe what happened.",
        placeholder: "e.g. Customer complained about incorrect order and poor service.",
      },
      {
        key: "witness",
        label: "Witness",
        hint: "Who witnessed the incident?",
        placeholder: "e.g. John Smith",
        kind: "input",
        optional: true,
        maxLength: 100,
      },
      {
        key: "actionTaken",
        label: "Action Taken",
        hint: "Describe what action was taken.",
        placeholder:
          "e.g. Apologised to the customer, corrected the order, and reminded staff of service standards.",
      },
      { key: "photo", label: "Attach Photo", hint: "", kind: "photo", optional: true },
    ],
    checkboxes: [],
    submitLabel: "Save Report",
  },
  other: {
    title: "Other",
    subtitle: "Record other important matters.",
    fields: [
      {
        key: "details",
        label: "Details",
        hint: "Describe the matter.",
        placeholder:
          "e.g. Employee reported that an unknown person visited the store asking questions about staff rosters and management.",
      },
      {
        key: "outcome",
        label: "Action / Outcome",
        hint: "Describe any action taken or next steps.",
        placeholder:
          "e.g. Management was notified and staff were reminded not to disclose internal information.",
        optional: true,
      },
    ],
    checkboxes: ["Discussed with employee", "Employee given opportunity to respond"],
    submitLabel: "Save Note",
  },
};

export function isHrNoteCategory(v: string): v is HrNoteCategory {
  return v in HR_NOTE_CATEGORY_CONFIG;
}

/** Text/checkbox fields used when appending a follow-up on the detail page. */
export function followUpFieldsForCategory(category: string): HrFieldConfig[] {
  if (!isHrNoteCategory(category)) {
    return [
      { key: "details", label: "Details", hint: "" },
      { key: "outcome", label: "Action / Outcome", hint: "", optional: true },
    ];
  }
  return HR_NOTE_CATEGORY_CONFIG[category].fields.filter((f) => f.kind !== "photo");
}

export function followUpCheckboxesForCategory(category: string): string[] {
  if (!isHrNoteCategory(category)) return [];
  return HR_NOTE_CATEGORY_CONFIG[category].checkboxes;
}
