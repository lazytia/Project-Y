/**
 * The documents HR Records tracks, and what version of each is current.
 *
 * A signature is only worth anything against a version: when a document is
 * revised, everyone who signed the old one has to sign again. That means the
 * version has to be readable from the server (to work out who is behind) as
 * well as from the page that renders the document — so it lives here rather
 * than beside the document body, which is a client component.
 *
 * Five documents, but only four are signed and only two of those are signed
 * through `document_signatures`; the privacy policy and the employment
 * contract are both agreed inside the onboarding form and the training guide
 * asks for nothing at all. Rather than three lists that have to be kept in
 * step, each row says where its own signature comes from.
 */

import type { SignableDocumentKey } from "./document-signatures";

/** Recorded alongside a signature so a later revision can be told apart from
 *  the version somebody actually acknowledged. */
export const HANDBOOK_VERSION = "1.0";
export const HANDBOOK_UPDATED = "June 2026";

export const BEER_GUIDE_VERSION = "1.0";
export const BEER_GUIDE_UPDATED = "June 2026";

/** The version the onboarding form signs against. It lives here rather than
 *  beside the policy text so the server can tell a current signature from one
 *  taken against an earlier wording. */
export const PRIVACY_POLICY_VERSION = "1.0";

/** Superset of SignableDocumentKey — the two signable keys are reused verbatim
 *  so a signature can be looked up by document key with no translation. */
export type HrDocumentKey =
  | SignableDocumentKey
  | "trainingGuide"
  | "privacyPolicy"
  | "employmentContract";

/**
 * Where a signature for a document is kept.
 *  - `signatures`: the `document_signatures` collection, signed in the app
 *  - `onboarding`: `policies.agreementSignedAt`, agreed during onboarding
 *  - `null`: nothing to sign
 */
export type HrSignatureSource = "signatures" | "onboarding" | null;

export type HrDocument = {
  key: HrDocumentKey;
  label: string;
  href: string;
  /** Current version, or null for a document that is not versioned yet. */
  version: string | null;
  /** When that version was published — "June 2026". */
  updated: string | null;
  /** Stands in for the version line when there is no version. */
  unversionedLabel: string;
  signedVia: HrSignatureSource;
};

export const HR_DOCUMENTS: readonly HrDocument[] = [
  {
    // "Employee Handbook" here, "Staff Handbook" in `document-signatures`:
    // these are the owner's words for the document and the employee's, and the
    // two audiences never share a screen. The document itself is titled for
    // the employee, so the staff-facing label is the one that matches it.
    key: "handbook",
    label: "Employee Handbook",
    href: "/staff/handbook",
    version: HANDBOOK_VERSION,
    updated: HANDBOOK_UPDATED,
    unversionedLabel: "",
    signedVia: "signatures",
  },
  {
    key: "beerGuide",
    label: "Beer Guide",
    href: "/staff/beer-guide",
    version: BEER_GUIDE_VERSION,
    updated: BEER_GUIDE_UPDATED,
    unversionedLabel: "",
    signedVia: "signatures",
  },
  {
    // Unversioned on purpose: the guide is still a set of pages nobody has cut
    // a release of, and stamping it "Version 1.0" would start a signature
    // chase for a document that has never been declared finished.
    key: "trainingGuide",
    label: "Training Guide",
    href: "/staff/training-manual",
    version: null,
    updated: null,
    unversionedLabel: "No update yet",
    signedVia: null,
  },
  {
    // Signed inside the onboarding form, on the first of its three policy
    // pages. Versioned like the handbook because it is the kind of document
    // that gets reworded: when it is, everyone who signed the old wording has
    // to sign again, and only a version recorded alongside the signature can
    // tell us who that is.
    key: "privacyPolicy",
    label: "Privacy Policy",
    href: "/hr-records/acknowledgements/privacyPolicy",
    version: PRIVACY_POLICY_VERSION,
    updated: null,
    unversionedLabel: "",
    signedVia: "onboarding",
  },
  {
    // Signed once, inside the onboarding form. There is no second version to
    // re-sign — a changed contract is a new contract, not a new revision.
    //
    // Alone among these it has no published document of its own, so — like
    // the privacy policy above it — the row opens who has signed it rather
    // than a copy of what they signed.
    key: "employmentContract",
    label: "Employment Contract",
    href: "/hr-records/acknowledgements/employmentContract",
    version: null,
    updated: null,
    unversionedLabel: "Current template",
    signedVia: "onboarding",
  },
] as const;

export function hrDocument(key: HrDocumentKey): HrDocument | undefined {
  return HR_DOCUMENTS.find((d) => d.key === key);
}

/** "Version 1.0 · Updated June 2026", or what stands in for it. */
export function hrDocumentVersionLabel(doc: HrDocument): string {
  if (!doc.version) return doc.unversionedLabel;
  const version = `Version ${doc.version}`;
  return doc.updated ? `${version} · Updated ${doc.updated}` : version;
}

/**
 * Whether a stored signature still counts.
 *
 * An unversioned document accepts any signature — there is nothing to have
 * fallen behind. A versioned one wants a signature taken against the version
 * that is current now.
 *
 * A signature with no version recorded is accepted rather than rejected: it
 * was taken before the version was written alongside it, so we cannot tell
 * what it was against, and calling it stale would send people to sign a
 * document that has never actually changed.
 */
export function isSignatureCurrent(doc: HrDocument, signedVersion: string | null): boolean {
  if (!doc.version) return true;
  if (!signedVersion) return true;
  return signedVersion === doc.version;
}
