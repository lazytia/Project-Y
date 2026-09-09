/**
 * The owner's side of the onboarding form: what the employee submitted, and
 * what sending a section back or signing the whole thing off writes.
 *
 * Two screens read this. New Employees reviews the form before the employee
 * is activated, and the employee's own detail page keeps showing it
 * afterwards so the documents stay readable. They were about to keep separate
 * copies of the section table and the field-reading, and a section that
 * clears one field on one screen and a different one on the other is a bug
 * you only find months later, in the one row that went through the wrong
 * screen.
 */

import { deleteField, serverTimestamp } from "firebase/firestore";
import { type OnboardingStepNumber } from "./onboarding-steps";
import { tsToDate } from "./staff-display";

/** The five sections of the onboarding form, in the order staff meet them. */
export type SectionKey = "personal" | "tfn" | "bank" | "documents" | "policies";

/**
 * The TFN declaration, as the employee filled it in.
 *
 * All of it, not just the number. This is the form that decides what is
 * withheld from every pay the business runs: whether they are claiming the
 * tax-free threshold, whether there is a HELP debt to withhold against,
 * which residency they declared. The owner used to be shown the nine digits
 * alone, which is the one part of it payroll can look up anyway — the answers
 * she actually has to check were on the page and never read back.
 *
 * `declarationDate` is the date the employee put to their declaration, which
 * the form lets them set, and so is not the date the row was written.
 */
export type TfnDeclaration = {
  fullLegalName: string;
  dateOfBirth: string;
  homeAddress: string;
  suburb: string;
  state: string;
  postcode: string;
  taxFileNumber: string;
  taxResident: string;
  taxFreeThreshold: string;
  helpDebt: string;
  otherGovDebt: string;
  declarationAgreed: boolean;
  declarationDate: string;
};

export type OnboardingSubmission = {
  name: string;
  phone: string;
  personal: {
    firstName: string;
    lastName: string;
    preferredName: string;
    dateOfBirth: string;
    gender: string;
    email: string;
  };
  tfn: TfnDeclaration;
  taxFileNumber: string;
  signatureDataUrl: string;
  bank: {
    bsb?: string;
    accountNumber?: string;
    accountName?: string;
    superFundName?: string;
    usi?: string;
    memberNumber?: string;
  };
  handbookSignedAt: Date | null;
  agreementSignedAt: Date | null;
  privacySignedAt: Date | null;
  documents: { label: string; url: string }[];
  /** Null on rows written before the form existed. */
  completedStep: number | null;
};

export type OnboardingSection = {
  key: SectionKey;
  /** Also picks the row's icon, so it matches the screen the employee saw. */
  step: OnboardingStepNumber;
  label: string;
  clearPaths: string[];
  hasData: (s: OnboardingSubmission) => boolean;
};

/**
 * `step` does double duty. Rejecting a section rolls `completedStep` back to
 * `step - 1`, which is what puts the employee back on exactly that screen —
 * so the rollback target can't drift away from the row it belongs to.
 *
 * `hasData` is the fallback for telling a submitted section from an empty
 * one — see isSectionSubmitted below.
 *
 * Kept as one table because every fact in a row has to agree with the others
 * — label, rollback target, what to clear, how to tell it is filled in — and
 * they only stay in agreement while they are written next to each other.
 */
export const ONBOARDING_SECTIONS: readonly OnboardingSection[] = [
  {
    key: "personal",
    step: 1,
    label: "Personal Information",
    // Deliberately clears nothing. The employee's name, DOB and mobile are
    // what the rest of the app identifies them by — rosters, HR notes and
    // the people lists all read them — so wiping the section would turn a
    // "please fix this" into an employee who reads as Unknown everywhere
    // until they re-type it. The step rollback alone sends them back, and
    // the form pre-fills, so they correct rather than start over.
    clearPaths: [],
    hasData: (s) => Boolean(s.personal.firstName || s.personal.lastName),
  },
  {
    key: "tfn",
    step: 2,
    label: "TFN Declaration",
    clearPaths: ["tfn"],
    hasData: (s) => Boolean(s.taxFileNumber),
  },
  {
    key: "bank",
    step: 3,
    label: "Bank & Super Details",
    // `bankSuper`, not `bank` — the onboarding step writes the former, and
    // clearing the latter deleted a field that has never existed, so a
    // rejected section came back with the old account still in it.
    clearPaths: ["bankSuper"],
    hasData: (s) => Boolean(s.bank.bsb || s.bank.accountNumber || s.bank.superFundName),
  },
  {
    key: "documents",
    step: 4,
    label: "Documents (Photo ID, Visa, RSA)",
    // Clears nothing, for the same reason as personal above. This section is
    // three sets of photos taken off a passport, a visa grant and an RSA
    // card, and a rejection is almost always about one of them being blurred
    // or cropped. Deleting the URLs made the employee produce all three
    // documents again to fix the one, and the step rollback already reopens
    // the screen — the upload page pre-fills from these fields, so they
    // replace the photo that was wrong and leave the rest alone.
    clearPaths: [],
    hasData: (s) => s.documents.length > 0,
  },
  {
    key: "policies",
    step: 5,
    label: "Policies (Staff Handbook, Privacy Policy, Employee Agreement)",
    clearPaths: [
      "policies.handbookSignedAt",
      "policies.privacySignedAt",
      "policies.agreementSignedAt",
    ],
    hasData: (s) =>
      Boolean(s.handbookSignedAt || s.privacySignedAt || s.agreementSignedAt),
  },
];

export function sectionByKey(key: SectionKey): OnboardingSection {
  // Non-null: SectionKey is exactly the set of keys in the table above.
  return ONBOARDING_SECTIONS.find((s) => s.key === key)!;
}

/** The section the employee is sitting on, given how far they have got. */
export function sectionForStep(completedStep: number): OnboardingSection | null {
  return ONBOARDING_SECTIONS.find((s) => s.step === completedStep + 1) ?? null;
}

/**
 * Has the employee submitted this section?
 *
 * `completedStep` is their own progress marker and the very thing Reject
 * moves, so it is the answer whenever the document carries one — that is
 * what makes a rejected row fall back to Pending straight away instead of
 * sitting there still offering a View button.
 *
 * Rows written before that field existed have no marker, and reading a
 * missing one as 0 would show a fully onboarded employee as five Pending
 * rows with nothing to open. Those fall back to asking whether the section
 * actually holds anything.
 */
export function isSectionSubmitted(
  section: OnboardingSection,
  submission: OnboardingSubmission,
): boolean {
  return submission.completedStep === null
    ? section.hasData(submission)
    : submission.completedStep >= section.step;
}

/** The three upload slots, and both field names each has been written under. */
const DOCUMENT_SLOTS = [
  { key: "passport", singular: "passportUrl", plural: "passportUrls", label: "Passport" },
  { key: "visa",     singular: "visaUrl",     plural: "visaUrls",     label: "Visa" },
  { key: "rsa",      singular: "rsaUrl",      plural: "rsaUrls",      label: "RSA Certificate" },
] as const;

export type DocumentSlot = (typeof DOCUMENT_SLOTS)[number]["key"];

/**
 * Every uploaded photo URL, kept per slot and in order.
 *
 * Employees can attach several photos per section (the plural `*Urls`
 * arrays); rows written before that could only hold one, under the singular
 * `*Url`, so fall back to it when the array has nothing usable in it.
 *
 * The onboarding upload screen reads this to pre-fill itself, which is the
 * whole of why a sent-back section does not cost the employee their photos.
 * It shares the reader with the owner's review below on purpose — the two
 * disagreeing about where a photo lives would show the owner a document the
 * employee's own screen thinks it never received.
 */
export function readDocumentUrls(
  raw: Record<string, unknown>,
): Record<DocumentSlot, string[]> {
  const docs = (raw.documents ?? {}) as Record<string, unknown>;
  const out = { passport: [], visa: [], rsa: [] } as Record<DocumentSlot, string[]>;
  for (const { key, singular, plural } of DOCUMENT_SLOTS) {
    const arr = docs[plural];
    if (Array.isArray(arr)) {
      out[key] = arr.filter((v): v is string => typeof v === "string" && v.length > 0);
      if (out[key].length > 0) continue;
    }
    const v = docs[singular];
    if (typeof v === "string" && v) out[key] = [v];
  }
  return out;
}

/** The same photos, flattened and labelled for the owner's review list. */
export function collectDocuments(raw: Record<string, unknown>): { label: string; url: string }[] {
  const urls = readDocumentUrls(raw);
  const out: { label: string; url: string }[] = [];
  for (const { key, label } of DOCUMENT_SLOTS) {
    const list = urls[key];
    list.forEach((url, i) => {
      out.push({ label: list.length > 1 ? `${label} (${i + 1})` : label, url });
    });
  }
  return out;
}

function strField(raw: Record<string, unknown>, key: string): string {
  const v = raw[key];
  return typeof v === "string" ? v : "";
}

/**
 * Read the TFN declaration off a staff_onboarding document.
 *
 * The step nests everything under `tfn`. Rows written before it did kept a
 * few of the same names at the top level, so each field falls back there —
 * except the state, which the form calls `auState` locally to stay clear of
 * React's reserved prop and writes as `tfn.state`.
 */
export function readTfnDeclaration(raw: Record<string, unknown>): TfnDeclaration {
  const t = (raw.tfn ?? {}) as Record<string, unknown>;
  const pick = (key: string) => strField(t, key) || strField(raw, key);
  return {
    fullLegalName: pick("fullLegalName"),
    dateOfBirth: pick("dateOfBirth"),
    homeAddress: pick("homeAddress"),
    suburb: pick("suburb"),
    state: strField(t, "state") || strField(raw, "auState"),
    postcode: pick("postcode"),
    taxFileNumber: pick("taxFileNumber"),
    taxResident: pick("taxResident"),
    taxFreeThreshold: pick("taxFreeThreshold"),
    helpDebt: pick("helpDebt"),
    otherGovDebt: pick("otherGovDebt"),
    declarationAgreed: t.declarationAgreed === true || raw.declarationAgreed === true,
    declarationDate: pick("declarationDate"),
  };
}

/** Everything the review screens read out of a staff_onboarding document. */
export function readOnboardingSubmission(
  raw: Record<string, unknown>,
  name: string,
): OnboardingSubmission {
  const policies = (raw.policies ?? {}) as Record<string, unknown>;
  const tfnBlock = (raw.tfn ?? {}) as Record<string, unknown>;
  const tfn = readTfnDeclaration(raw);
  return {
    name,
    phone: strField(raw, "mobileNumber"),
    personal: {
      firstName: strField(raw, "firstName"),
      lastName: strField(raw, "lastName"),
      preferredName: strField(raw, "preferredName"),
      dateOfBirth: strField(raw, "dateOfBirth"),
      gender: strField(raw, "gender"),
      email: strField(raw, "email"),
    },
    tfn,
    // Kept alongside the block it came from: the section table's hasData and
    // the employee detail pages both read it directly.
    taxFileNumber: tfn.taxFileNumber,
    signatureDataUrl: strField(tfnBlock, "signatureDataUrl"),
    bank: (raw.bankSuper ?? {}) as OnboardingSubmission["bank"],
    handbookSignedAt: tsToDate(policies.handbookSignedAt),
    agreementSignedAt: tsToDate(policies.agreementSignedAt),
    privacySignedAt: tsToDate(policies.privacySignedAt),
    documents: collectDocuments(raw),
    completedStep: typeof raw.completedStep === "number" ? raw.completedStep : null,
  };
}

/* ── What the owner's two verdicts write ── */

export const MAX_REJECTION_REASON = 200;

export type SectionRejection = { reason: string; byName: string; at: Date | null };

/** Where a sent-back section's reason is stored, keyed by section. */
export function readRejections(
  raw: Record<string, unknown>,
): Partial<Record<SectionKey, SectionRejection>> {
  const stored = (raw.rejections ?? {}) as Record<string, unknown>;
  const out: Partial<Record<SectionKey, SectionRejection>> = {};
  for (const section of ONBOARDING_SECTIONS) {
    const entry = stored[section.key] as Record<string, unknown> | undefined;
    if (!entry || typeof entry !== "object") continue;
    out[section.key] = {
      reason: typeof entry.reason === "string" ? entry.reason : "",
      byName: typeof entry.byName === "string" ? entry.byName : "",
      at: tsToDate(entry.at),
    };
  }
  return out;
}

/**
 * Send one section back to the employee: roll `completedStep` to just before
 * it so they land on that screen again, drop the answers it holds so the
 * section reads as unsubmitted here too, and keep the reason so the employee
 * is told what to change rather than left to guess.
 */
export function sectionRejectPatch(
  section: OnboardingSection,
  reason: string,
  byName: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    completedStep: section.step - 1,
    step: section.step,
    status: "in_progress",
    [`rejections.${section.key}`]: {
      reason: reason.trim().slice(0, MAX_REJECTION_REASON),
      byName,
      at: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  };
  for (const path of section.clearPaths) patch[path] = deleteField();
  return patch;
}

/**
 * Sign the onboarding off. `activatedAt` is what takes the employee off New
 * Employees — see isOnboardingListEmployee — and it is stamped rather than
 * inferred so that the established team, who never filled this form in, are
 * not dragged back onto the list by a rule that guesses.
 *
 * Any sent-back sections are cleared out at the same time: they have all been
 * resubmitted and read by the time anyone can press this, and leaving them
 * behind would have the employee's own page still showing a correction they
 * made weeks ago.
 */
export function activationPatch(byUid: string, byName: string): Record<string, unknown> {
  return {
    activatedAt: serverTimestamp(),
    activatedByUid: byUid,
    activatedByName: byName,
    status: "active",
    addedToScheduling: true,
    rejections: deleteField(),
    updatedAt: serverTimestamp(),
  };
}
