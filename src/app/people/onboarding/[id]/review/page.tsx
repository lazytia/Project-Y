"use client";

/**
 * Employee Review — the last look at an onboarding before it is signed off.
 *
 * Reached from New Employees, and it exists for one decision: is this form
 * good enough to activate on. So the page is the five sections and the two
 * verdicts — open one to read it, or send one back — and nothing else. The
 * employee's own detail page shows the same sections afterwards, read-only,
 * because by then the decision has been made.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { actorNameOf, canViewStaffRequest, isChef, isOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import { ONBOARDING_STEP_ICONS } from "@/lib/onboarding-steps";
import {
  MAX_REJECTION_REASON,
  ONBOARDING_SECTIONS,
  isSectionSubmitted,
  readOnboardingSubmission,
  readRejections,
  sectionRejectPatch,
  type OnboardingSection,
  type OnboardingSubmission,
  type SectionKey,
  type SectionRejection,
} from "@/lib/onboarding-review";
import { isActivated, isReadyForReview, staffOnboardingFlags } from "@/lib/staff-active";
import { fmtDate, fullNameOf, initialsOf, positionLabelOf, tsToDate } from "@/lib/staff-display";
import Splash from "@/components/Splash";
import ActivateEmployeeSheet from "@/components/ActivateEmployeeSheet";
import { OnboardingSectionModal } from "@/components/OnboardingSectionModal";
import styles from "./page.module.css";

type Review = {
  name: string;
  positionLabel: string;
  startDate: string;
  submission: OnboardingSubmission;
  /** Sections already sent back, so the owner can see what they asked for. */
  rejections: Partial<Record<SectionKey, SectionRejection>>;
  /** The form is finished and unsigned — the only state Activate is offered in. */
  ready: boolean;
  activated: boolean;
};

/**
 * What the employee did to this section, in their words rather than ours.
 *
 * Policies are signed, not submitted; calling a signature a submission on the
 * one row that carries legal weight reads like the form was filled in for
 * them.
 */
function submittedWord(section: OnboardingSection): string {
  return section.key === "policies" ? "Signed" : "Submitted";
}

export default function EmployeeReviewPage() {
  const router = useRouter();
  const params = useParams();
  const uid = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user) || isChef(user);

  const [review, setReview] = useState<Review | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [openSection, setOpenSection] = useState<SectionKey | null>(null);
  const [rejecting, setRejecting] = useState<OnboardingSection | null>(null);
  const [rejectBusy, setRejectBusy] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [activateOpen, setActivateOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [allowed, authLoading, router]);

  const load = useCallback(async () => {
    const snap = await getDoc(doc(getDb(), "staff_onboarding", uid));
    if (!snap.exists()) {
      setNotFound(true);
      return;
    }
    const raw = snap.data() as Record<string, unknown>;
    // Same visibility rule as the list this page is opened from: a chef may
    // only review the hires they asked for.
    if (
      !canViewStaffRequest(user, {
        requestedByRole: raw.requestedByRole as string | undefined,
        requestedByName: raw.requestedByName as string | undefined,
      })
    ) {
      router.replace("/people/onboarding");
      return;
    }
    const flags = staffOnboardingFlags(raw);
    const name = fullNameOf(raw);
    setReview({
      name,
      positionLabel: positionLabelOf(raw),
      startDate: fmtDate(tsToDate(raw.startDate)),
      submission: readOnboardingSubmission(raw, name),
      rejections: readRejections(raw),
      ready: isReadyForReview(flags),
      activated: isActivated(flags),
    });
  }, [uid, user, router]);

  useEffect(() => {
    if (!allowed || !uid) return;
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, uid, load]);

  async function handleReject(reason: string) {
    if (!rejecting || rejectBusy) return;
    setRejectBusy(true);
    setRejectError(null);
    try {
      await updateDoc(
        doc(getDb(), "staff_onboarding", uid),
        sectionRejectPatch(rejecting, reason, actorNameOf(user)),
      );
      // Re-read rather than patch in place: the write rolls `completedStep`
      // back, which is what decides every other row's state and whether
      // Activate is still on offer.
      await load();
      setRejecting(null);
    } catch (e) {
      console.error("[review] reject failed:", e);
      setRejectError(e instanceof Error ? e.message : "Failed to send. Please try again.");
    } finally {
      setRejectBusy(false);
    }
  }

  if (authLoading || !allowed) return <Splash />;

  if (notFound) {
    return (
      <div className={styles.page}>
        <TopBar onBack={() => router.push("/people/onboarding")} />
        <p className={styles.empty}>This onboarding no longer exists.</p>
      </div>
    );
  }

  if (!review) {
    return (
      <div className={styles.page}>
        <TopBar onBack={() => router.push("/people/onboarding")} />
        {error ? <p className={styles.error}>{error}</p> : <p className={styles.empty}>Loading…</p>}
      </div>
    );
  }

  const { submission } = review;

  return (
    <div className={styles.page}>
      <TopBar onBack={() => router.push("/people/onboarding")} />

      <div className={styles.header}>
        <h1 className={styles.title}>Employee Review</h1>
        <p className={styles.subtitle}>
          Review submitted onboarding items before activation.
        </p>
      </div>

      <section className={styles.summaryCard}>
        <span className={styles.avatar} aria-hidden="true">{initialsOf(review.name)}</span>
        <div className={styles.summaryBody}>
          <p className={styles.summaryName}>{review.name}</p>
          <p className={styles.summaryMeta}>
            {review.positionLabel} · Starts {review.startDate}
          </p>
        </div>
      </section>

      <p className={styles.sectionLabel}>SUBMITTED ITEMS</p>
      <section className={styles.itemsCard}>
        {ONBOARDING_SECTIONS.map((section, i) => {
          const submitted = isSectionSubmitted(section, submission);
          const sentBack = review.rejections[section.key];
          const last = i === ONBOARDING_SECTIONS.length - 1;
          return (
            <div
              key={section.key}
              className={`${styles.item} ${last ? styles.itemLast : ""}`}
            >
              <div className={styles.itemTop}>
                <span className={styles.itemIcon} aria-hidden="true">
                  {ONBOARDING_STEP_ICONS[section.step]}
                </span>
                <span className={styles.itemText}>
                  <span className={styles.itemLabel}>{section.label}</span>
                  <span className={submitted ? styles.itemState : styles.itemStatePending}>
                    {submitted ? submittedWord(section) : "Pending"}
                  </span>
                </span>
                {/* Nothing to open and nothing to send back until it arrives —
                    a live-looking button on an empty section only invites the
                    tap. */}
                {submitted && (
                  <span className={styles.itemActions}>
                    <button
                      type="button"
                      className={styles.viewLink}
                      onClick={() => setOpenSection(section.key)}
                    >
                      View
                    </button>
                    <button
                      type="button"
                      className={styles.rejectBtn}
                      onClick={() => {
                        setRejectError(null);
                        setRejecting(section);
                      }}
                    >
                      Reject
                    </button>
                  </span>
                )}
              </div>

              {/* A section that was sent back keeps its reason on screen: the
                  owner writing a second one should be able to see the first,
                  and it is the only record of why the row went backwards. */}
              {sentBack && (
                <p className={styles.sentBack}>
                  Sent back{sentBack.byName ? ` by ${sentBack.byName}` : ""}
                  {sentBack.at ? ` · ${fmtDate(sentBack.at)}` : ""}
                  {sentBack.reason ? ` — ${sentBack.reason}` : ""}
                </p>
              )}
            </div>
          );
        })}
      </section>

      {error && <p className={styles.error}>{error}</p>}

      <p className={styles.footerNote}>
        {review.activated
          ? "This employee has already been activated."
          : review.ready
            ? "All required onboarding items have been submitted."
            : "Waiting on the employee to finish their onboarding. Anything already submitted can still be sent back."}
      </p>

      {!review.activated && (
        <div className={styles.bottomBar}>
          <button
            type="button"
            className={styles.ctaBtn}
            disabled={!review.ready}
            onClick={() => setActivateOpen(true)}
          >
            Activate Employee
          </button>
        </div>
      )}

      {openSection && (
        <OnboardingSectionModal
          sectionKey={openSection}
          submission={submission}
          onClose={() => setOpenSection(null)}
        />
      )}

      {rejecting && (
        <RejectItemSheet
          // Keyed so opening a second section starts on an empty box rather
          // than the reason typed for the first one.
          key={rejecting.key}
          section={rejecting}
          busy={rejectBusy}
          error={rejectError}
          onCancel={() => setRejecting(null)}
          onSend={handleReject}
        />
      )}

      {activateOpen && (
        <ActivateEmployeeSheet
          uid={uid}
          name={review.name}
          positionLabel={review.positionLabel}
          startDate={review.startDate}
          onClose={() => setActivateOpen(false)}
          onActivated={() => router.push("/people/onboarding")}
        />
      )}
    </div>
  );
}

/**
 * Send one section back, with a reason.
 *
 * The reason is required. Rejecting rolls the employee back to that screen,
 * and landing there again with no explanation reads as the form having lost
 * their work — they resubmit exactly what they sent the first time.
 */
function RejectItemSheet({
  section,
  busy,
  error,
  onCancel,
  onSend,
}: {
  section: OnboardingSection;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSend: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const canSend = reason.trim().length > 0 && !busy;

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className={styles.sheet}>
        <h2 className={styles.sheetTitle}>Reject item</h2>
        <p className={styles.sheetSection}>{section.label}</p>
        <p className={styles.sheetBody}>Add a short reason for the employee.</p>

        <textarea
          className={styles.textarea}
          value={reason}
          maxLength={MAX_REJECTION_REASON}
          rows={4}
          placeholder="e.g. The visa photo is cut off — please upload the full page."
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        />
        <p className={styles.counter}>
          {reason.length}/{MAX_REJECTION_REASON}
        </p>

        {error && <p className={styles.sheetError}>{error}</p>}

        <div className={styles.sheetActions}>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.btnDanger}
            onClick={() => onSend(reason)}
            disabled={!canSend}
          >
            {busy ? "Sending…" : "Send Rejection"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <div className={styles.topBar}>
      <button type="button" className={styles.backBtn} onClick={onBack} aria-label="Back">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
    </div>
  );
}
