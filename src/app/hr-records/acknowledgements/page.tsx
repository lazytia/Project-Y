"use client";

/**
 * Acknowledgements — one line per document, and how much of the roster has
 * signed the version that is current now.
 *
 * The counting is shared with the HR Records hub and with the per-document
 * page below, so the "3 Pending" on the card, the "4/7 signed" on the row
 * and the list of names behind it are all the same arithmetic.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import Splash from "@/components/Splash";
import { isOwner } from "@/lib/permissions";
import { hrDocumentVersionLabel } from "@/lib/hr-documents";
import { allDocumentStatuses, summarise, type AckDocumentStatus } from "@/lib/hr-acknowledgements";
import { useAcknowledgements } from "@/lib/use-acknowledgements";
import { ChevronLeftIcon, ChevronRightIcon, InfoCircleIcon } from "../icons";
import styles from "../hr.module.css";

function DocumentRow({ status }: { status: AckDocumentStatus }) {
  const { doc } = status;

  const body = (
    <>
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>{doc.label}</span>
        <span className={styles.rowSub}>{hrDocumentVersionLabel(doc)}</span>
      </span>
      <span className={styles.rowRight}>
        {status.requiresSignature ? (
          <>
            <span className={styles.rowCount}>
              {status.signed}/{status.total} signed
            </span>
            {status.complete ? (
              <span className={`${styles.chip} ${styles.chipGood}`}>Complete</span>
            ) : (
              <span className={`${styles.chip} ${styles.chipWarm}`}>Review</span>
            )}
            <span className={styles.chevron}>
              <ChevronRightIcon />
            </span>
          </>
        ) : (
          <span className={`${styles.chip} ${styles.chipMuted}`}>No signature required</span>
        )}
      </span>
    </>
  );

  // A document nobody signs has no list of names to open, so it is a row
  // rather than a link — a chevron on it would promise a page that would
  // only ever say "nothing to sign".
  if (!status.requiresSignature) return <div className={styles.row}>{body}</div>;

  return (
    <Link href={`/hr-records/acknowledgements/${doc.key}`} className={styles.row}>
      {body}
    </Link>
  );
}

export default function AcknowledgementsPage() {
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);
  const { payload, loading, error } = useAcknowledgements(allowed ? user : null);

  const statuses = useMemo(() => (payload ? allDocumentStatuses(payload) : null), [payload]);
  const summary = useMemo(() => (statuses ? summarise(statuses) : null), [statuses]);

  if (authLoading || !allowed) return <Splash />;

  const stat = (n: number | undefined) => (loading || n === undefined ? "—" : n);
  const signable = statuses?.filter((s) => s.requiresSignature) ?? [];
  const unsignable = statuses?.filter((s) => !s.requiresSignature) ?? [];

  return (
    <div className={styles.page}>
      <Link href="/hr-records" className={styles.backLink}>
        <ChevronLeftIcon />
        HR Records
      </Link>

      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Acknowledgements</h1>
        <p className={styles.pageSub}>Track staff signatures for required documents.</p>
      </header>

      <section className={styles.statsCard}>
        <div className={styles.statCol}>
          <p className={styles.statNumber}>{stat(summary?.items)}</p>
          <p className={styles.statLabel}>Items</p>
        </div>
        <div className={styles.statDivider} aria-hidden="true" />
        <div className={styles.statCol}>
          <p className={`${styles.statNumber} ${styles.statNumberGood}`}>
            {stat(summary?.upToDate)}
          </p>
          <p className={styles.statLabel}>Up to date</p>
        </div>
        <div className={styles.statDivider} aria-hidden="true" />
        <div className={styles.statCol}>
          <p className={`${styles.statNumber} ${styles.statNumberWarm}`}>
            {stat(summary?.needsReview)}
          </p>
          <p className={styles.statLabel}>Needs review</p>
        </div>
      </section>

      {error ? (
        <p className={`${styles.status} ${styles.error}`}>{error}</p>
      ) : loading ? (
        <p className={styles.status}>Loading…</p>
      ) : (
        <>
          {signable.length > 0 && (
            <>
              <p className={styles.sectionLabel}>REQUIRES SIGNATURE</p>
              <ul className={styles.list}>
                {signable.map((status) => (
                  <li key={status.doc.key}>
                    <DocumentRow status={status} />
                  </li>
                ))}
              </ul>
            </>
          )}

          {unsignable.length > 0 && (
            <>
              <p className={styles.sectionLabel}>NO SIGNATURE REQUIRED</p>
              <ul className={styles.list}>
                {unsignable.map((status) => (
                  <li key={status.doc.key}>
                    <DocumentRow status={status} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <p className={styles.note}>
        <span className={styles.noteIcon}>
          <InfoCircleIcon />
        </span>
        When a document is updated, previous signatures expire and staff must sign again.
      </p>
    </div>
  );
}
