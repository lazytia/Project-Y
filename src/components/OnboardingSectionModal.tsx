"use client";

/**
 * What the employee actually wrote in one onboarding section.
 *
 * Opened from the section list on two screens — the owner's Employee Review
 * page before activation, and the employee's own detail page afterwards — and
 * it is the same document in both places, so it is the same sheet. Splitting
 * it in two would let the reviewer and the record disagree about, say,
 * whether the super fund is shown, and only one of the two would be right.
 *
 * Reads an OnboardingSubmission, so it never touches Firestore or knows which
 * screen it is on; both callers parse the document with
 * readOnboardingSubmission first.
 */

import type { SectionKey, OnboardingSubmission } from "@/lib/onboarding-review";
import { fmtDate } from "@/lib/staff-display";
import styles from "./OnboardingSectionModal.module.css";

/**
 * The date of birth as the employee typed it on the form.
 *
 * Kept as a string split rather than a Date: `dateOfBirth` is a calendar fact
 * with no time zone, and parsing it would let the Sydney/UTC boundary move it
 * by a day.
 *
 * Returns "" rather than a dash for a missing value — DefRow already renders
 * the dash, and doing it here too would print it twice.
 */
function fmtDobDisplay(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d} / ${m} / ${y}`;
}

/**
 * The tax questions as words, not as the radio value that was stored.
 *
 * Empty stays empty so DefRow prints its dash: a section the employee has
 * not reached yet must not read as though they answered "No", which is a
 * real answer with a real effect on their pay.
 */
function yesNoLabel(v: string): string {
  if (v === "yes") return "Yes";
  if (v === "no") return "No";
  return "";
}

function residencyLabel(v: string): string {
  if (v === "working_holiday") return "Working holiday maker";
  return yesNoLabel(v);
}

export function OnboardingSectionModal({
  sectionKey,
  submission,
  onClose,
}: {
  sectionKey: SectionKey;
  submission: OnboardingSubmission;
  onClose: () => void;
}) {
  const { title, body } = sectionModalContent(sectionKey, submission);
  return (
    <div
      className={styles.modalBackdrop}
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{title}</h3>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className={styles.modalBody}>{body}</div>
      </div>
    </div>
  );
}

function sectionModalContent(
  sectionKey: SectionKey,
  s: OnboardingSubmission,
): { title: string; body: React.ReactNode } {
  switch (sectionKey) {
    case "personal":
      return {
        title: "Personal Information",
        body: (
          <dl className={styles.modalDefs}>
            <DefRow label="Legal First Name" value={s.personal.firstName} />
            <DefRow label="Legal Last Name" value={s.personal.lastName} />
            <DefRow label="Preferred Name" value={s.personal.preferredName} />
            <DefRow label="Date of Birth" value={fmtDobDisplay(s.personal.dateOfBirth)} />
            <DefRow label="Gender" value={s.personal.gender} />
            <DefRow label="Mobile Number" value={s.phone} />
            <DefRow label="Email" value={s.personal.email} />
          </dl>
        ),
      };
    // The whole declaration, laid out in the four parts the employee filled
    // in, rather than the number on its own. Payroll can find a TFN; what
    // needs reading back is what they declared around it, because those four
    // answers are what the withholding is calculated from and a wrong one
    // shows up as an employee under- or over-taxed all year.
    case "tfn": {
      const d = s.tfn;
      return {
        title: "TFN Declaration",
        body: (
          <>
            <p className={styles.modalSectionTitle}>Employee Details</p>
            <dl className={styles.modalDefs}>
              <DefRow label="Full Legal Name" value={d.fullLegalName || s.name} />
              <DefRow
                label="Date of Birth"
                value={fmtDobDisplay(d.dateOfBirth || s.personal.dateOfBirth)}
              />
              <DefRow label="Home Address" value={d.homeAddress} />
              <DefRow label="Suburb" value={d.suburb} />
              <DefRow label="State" value={d.state} />
              <DefRow label="Postcode" value={d.postcode} />
            </dl>

            <p className={styles.modalSectionTitle}>Tax File Number</p>
            <dl className={styles.modalDefs}>
              <DefRow label="TFN" value={d.taxFileNumber || s.taxFileNumber} />
            </dl>

            <p className={styles.modalSectionTitle}>Tax Details</p>
            <dl className={styles.modalDefs}>
              <DefRow label="Australian tax resident" value={residencyLabel(d.taxResident)} />
              <DefRow
                label="Claiming the tax-free threshold"
                value={yesNoLabel(d.taxFreeThreshold)}
              />
              <DefRow label="HELP / HECS debt" value={yesNoLabel(d.helpDebt)} />
              <DefRow label="Other government debt" value={yesNoLabel(d.otherGovDebt)} />
            </dl>

            <p className={styles.modalSectionTitle}>Declaration</p>
            <dl className={styles.modalDefs}>
              <DefRow
                label="Declared true and correct"
                value={d.declarationAgreed ? "Yes — agreed" : "Not agreed"}
              />
              <DefRow label="Dated" value={fmtDobDisplay(d.declarationDate)} />
            </dl>
            {s.signatureDataUrl && (
              <SignatureBlock label="Signed by" name={s.name} src={s.signatureDataUrl} />
            )}
            <p className={styles.modalHint}>
              Signed electronically during onboarding by ticking the declaration.
              Visible to owner and manager only.
            </p>
          </>
        ),
      };
    }
    case "bank":
      return {
        title: "Bank & Super Details",
        body: (
          <dl className={styles.modalDefs}>
            <DefRow label="BSB" value={s.bank.bsb} />
            <DefRow label="Account Number" value={s.bank.accountNumber} />
            <DefRow label="Account Name" value={s.bank.accountName} />
            <DefRow label="Super Fund" value={s.bank.superFundName} />
            <DefRow label="USI" value={s.bank.usi} />
            <DefRow label="Member Number" value={s.bank.memberNumber} />
          </dl>
        ),
      };
    case "documents":
      return {
        title: "Documents (Photo ID, Visa, RSA)",
        body:
          s.documents.length === 0 ? (
            <p className={styles.modalHint}>No documents uploaded yet.</p>
          ) : (
            <ul className={styles.modalList}>
              {s.documents.map((d) => (
                <li key={d.url} className={styles.modalListRow}>
                  <span className={styles.modalListName}>{d.label}</span>
                  <a
                    className={styles.modalListLink}
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open ↗
                  </a>
                </li>
              ))}
            </ul>
          ),
      };
    // One sheet for all three documents. They are collected together on the
    // single onboarding "Policies" step and rolled back together on reject,
    // so splitting them across two sheets only made the owner open both to
    // answer one question: has this person signed everything?
    //
    // With the signature each time, not just the date. These are the three
    // documents the employee signed their name to, and the sheet used to show
    // three dates and then reach for tfn.signatureDataUrl — a field no screen
    // in the app has ever written, so the block never rendered and the owner
    // had no way to see a signature she is holding on file. Each document
    // carries its own, drawn on its own screen, so all three are shown: they
    // are three separate agreements, and "signed the handbook" is not
    // evidence for the employment agreement.
    case "policies":
      return {
        title: "Policies",
        body: (
          <>
            {s.policies.map((p) => (
              <section key={p.key} className={styles.policyBlock}>
                <p className={styles.modalSectionTitle}>{p.label}</p>
                <dl className={styles.modalDefs}>
                  <DefRow
                    label="Signed"
                    value={p.signedAt ? fmtDate(p.signedAt) : "Not signed"}
                  />
                  <DefRow label="Version" value={p.version} />
                </dl>
                {p.signature ? (
                  <SignatureBlock label="Signature" name={s.name} src={p.signature} />
                ) : p.signedAt ? (
                  // Agreed, but before the step drew a signature. Say so —
                  // an empty space under a signed date reads as a sheet that
                  // failed to load, and gets chased as one.
                  <p className={styles.modalHint}>
                    Agreed without a drawn signature, so there is no image on file.
                  </p>
                ) : null}
              </section>
            ))}
          </>
        ),
      };
  }
}

function DefRow({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className={styles.modalDefRow}>
      <dt className={styles.modalDefLabel}>{label}</dt>
      <dd className={styles.modalDefValue}>{value?.trim() ? value : "—"}</dd>
    </div>
  );
}

function SignatureBlock({ label, name, src }: { label: string; name: string; src: string }) {
  return (
    <div className={styles.signatureBlock}>
      <p className={styles.signatureLabel}>{label}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`${name} signature`} className={styles.signatureImg} />
      <p className={styles.signatureName}>{name}</p>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
