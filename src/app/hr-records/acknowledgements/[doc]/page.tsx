"use client";

/**
 * One document's acknowledgement status — who has signed it, when, and who
 * has not.
 *
 * The counts at the top are the same ones the Acknowledgements list shows on
 * this document's row; they are recomputed from the same payload rather than
 * passed through a query string, so a bookmarked link can never show a total
 * that has since moved on.
 *
 * Signature images are not fetched. The question here is who and when, and a
 * PNG per person would be megabytes of payload to answer it.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import Splash from "@/components/Splash";
import { isOwner } from "@/lib/permissions";
import { hrDocument, hrDocumentVersionLabel, type HrDocumentKey } from "@/lib/hr-documents";
import { documentStatus, type AckPerson } from "@/lib/hr-acknowledgements";
import { useAcknowledgements } from "@/lib/use-acknowledgements";
import { fmtDate, initialsOf } from "@/lib/staff-display";
import { ChevronLeftIcon } from "../../icons";
import styles from "../../hr.module.css";

type Tab = "all" | "signed" | "pending";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "signed", label: "Signed" },
  { key: "pending", label: "Pending" },
];

/** "Signed 26 Aug 2026", or what to say when there is no date. */
function signedLine(person: AckPerson): string {
  if (!person.signed) return "Not signed yet";
  if (!person.signedAtISO) return "Signed";
  const when = new Date(person.signedAtISO);
  return Number.isNaN(when.getTime()) ? "Signed" : `Signed ${fmtDate(when)}`;
}

export default function DocumentAcknowledgementPage() {
  const params = useParams<{ doc: string }>();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);
  const { payload, loading, error } = useAcknowledgements(allowed ? user : null);
  const [tab, setTab] = useState<Tab>("all");

  // Unknown keys reach here from a hand-edited or stale URL. hrDocument
  // returns undefined for them rather than us trusting the segment.
  const doc = hrDocument(params.doc as HrDocumentKey);

  const status = useMemo(
    () => (doc && payload ? documentStatus(doc, payload) : null),
    [doc, payload],
  );

  const people = useMemo(() => {
    const all = status?.people ?? [];
    if (tab === "signed") return all.filter((p) => p.signed);
    if (tab === "pending") return all.filter((p) => !p.signed);
    return all;
  }, [status, tab]);

  if (authLoading || !allowed) return <Splash />;

  if (!doc) {
    return (
      <div className={styles.page}>
        <Link href="/hr-records/acknowledgements" className={styles.backLink}>
          <ChevronLeftIcon />
          Acknowledgements
        </Link>
        <p className={styles.status}>That document is not tracked.</p>
      </div>
    );
  }

  const stat = (n: number | undefined) => (loading || n === undefined ? "—" : n);

  return (
    <div className={styles.page}>
      <Link href="/hr-records/acknowledgements" className={styles.backLink}>
        <ChevronLeftIcon />
        Acknowledgements
      </Link>

      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{doc.label}</h1>
        <p className={styles.pageSub}>Acknowledgement status</p>
      </header>

      <section className={styles.statsCard}>
        <div className={styles.statCol}>
          <p className={styles.statNumber}>{stat(status?.total)}</p>
          <p className={styles.statLabel}>Total Staff</p>
        </div>
        <div className={styles.statDivider} aria-hidden="true" />
        <div className={styles.statCol}>
          <p className={`${styles.statNumber} ${styles.statNumberGood}`}>
            {stat(status?.signed)}
          </p>
          <p className={styles.statLabel}>Signed</p>
        </div>
        <div className={styles.statDivider} aria-hidden="true" />
        <div className={styles.statCol}>
          <p className={`${styles.statNumber} ${styles.statNumberWarm}`}>
            {stat(status?.pending)}
          </p>
          <p className={styles.statLabel}>Pending</p>
        </div>
      </section>

      <p className={styles.metaLine}>{hrDocumentVersionLabel(doc)}</p>

      {/* Order matters: "nobody signs this" is an answer, and showing it
          while the payload is still in flight would be the wrong one. */}
      {error ? (
        <p className={`${styles.status} ${styles.error}`}>{error}</p>
      ) : loading || !status ? (
        <p className={styles.status}>Loading…</p>
      ) : !status.requiresSignature ? (
        <p className={styles.status}>Nobody is asked to sign this document.</p>
      ) : (
        <>
          <div className={styles.tabs}>
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={`${styles.tab} ${tab === key ? styles.tabActive : ""}`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {people.length === 0 ? (
            <p className={styles.status}>Nobody in this list.</p>
          ) : (
            <ul className={styles.list}>
              {people.map((person) => (
                <li key={person.uid} className={styles.row}>
                  <span className={styles.avatar} aria-hidden="true">
                    {initialsOf(person.name)}
                  </span>
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>{person.name}</span>
                    <span className={styles.rowSub}>{person.position}</span>
                    <span className={styles.personWhen}>{signedLine(person)}</span>
                  </span>
                  <span className={styles.rowRight}>
                    <span
                      className={`${styles.chip} ${person.signed ? styles.chipGood : styles.chipWarm}`}
                    >
                      {person.signed ? "Signed" : "Pending"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
