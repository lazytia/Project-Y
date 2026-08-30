"use client";

/**
 * HR Records — the way in to the training material, the policies, the
 * contract, and who has signed them.
 *
 * These hung off the sidebar as four loose links, which said nothing about
 * which of them was waiting on somebody. Gathering them here lets each row
 * carry what is outstanding on it, and the two counts at the top come from
 * the same payload the Acknowledgements page renders — so the summary and
 * the page it links to cannot disagree.
 *
 * HR Notes is deliberately not on this list. It is a running record of
 * conversations rather than a document anyone signs, and it keeps its own
 * place in the menu.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import Splash from "@/components/Splash";
import { isOwner } from "@/lib/permissions";
import { hrDocument, hrDocumentVersionLabel, type HrDocumentKey } from "@/lib/hr-documents";
import {
  allDocumentStatuses,
  summarise,
  type AckDocumentStatus,
} from "@/lib/hr-acknowledgements";
import { useAcknowledgements } from "@/lib/use-acknowledgements";
import { ChevronRightIcon, InfoCircleIcon } from "./icons";
import styles from "./hr.module.css";

const ACKNOWLEDGEMENTS_HREF = "/hr-records/acknowledgements";

/**
 * The document rows, in the order the owner reads them: what a new hire is
 * given, then what they sign, then what they signed on the way in.
 *
 * Labels, links and versions all still come from the catalogue — only the
 * order is decided here. The Beer Guide follows the Training Guide as a row
 * of its own rather than an indented one: it is training material and belongs
 * next to it, but it carries its own version and its own signatures, and
 * setting it in from the margin made it look like a footnote to a document
 * instead of one the roster has to sign.
 */
const DOCUMENT_ROWS: HrDocumentKey[] = [
  "trainingGuide",
  "beerGuide",
  "handbook",
  "privacyPolicy",
  "employmentContract",
];

type Chip = { text: string; tone: "warm" | "good" } | null;

/** What a document row shows on its right-hand side, or nothing. */
function chipFor(status: AckDocumentStatus | undefined): Chip {
  if (!status || !status.requiresSignature) return null;
  if (status.pending > 0) return { text: `${status.pending} Pending`, tone: "warm" };
  return { text: "Signed", tone: "good" };
}

function DocRow({
  href,
  title,
  sub,
  chip,
  feature = false,
}: {
  href: string;
  title: string;
  sub: string;
  chip?: Chip;
  /** The row this page exists to be clicked through to. */
  feature?: boolean;
}) {
  return (
    <Link href={href} className={`${styles.row} ${feature ? styles.rowFeature : ""}`}>
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>{title}</span>
        {sub && <span className={styles.rowSub}>{sub}</span>}
      </span>
      <span className={styles.rowRight}>
        {chip && (
          <span
            className={`${styles.chip} ${chip.tone === "warm" ? styles.chipWarm : styles.chipGood}`}
          >
            {chip.text}
          </span>
        )}
        <span className={styles.chevron}>
          <ChevronRightIcon />
        </span>
      </span>
    </Link>
  );
}

export default function HrRecordsPage() {
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);
  const { payload, loading, error } = useAcknowledgements(allowed ? user : null);

  const statuses = useMemo(() => (payload ? allDocumentStatuses(payload) : null), [payload]);
  const summary = useMemo(() => (statuses ? summarise(statuses) : null), [statuses]);
  const byKey = useMemo(
    () => new Map((statuses ?? []).map((s) => [s.doc.key, s])),
    [statuses],
  );

  if (authLoading || !allowed) return <Splash />;

  // A dash, not a zero, until the counts arrive: "0 Pending" is an answer,
  // and showing it before we have one would say the chase is finished.
  const stat = (n: number | undefined) => (loading || n === undefined ? "—" : n);

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>HR Records</h1>
        <p className={styles.pageSub}>
          Training, policies, contracts and staff acknowledgements.
        </p>
      </header>

      <section className={styles.statsCard}>
        <div className={styles.statCol}>
          <p className={`${styles.statNumber} ${styles.statNumberWarm}`}>
            {stat(summary?.pendingSignatures)}
          </p>
          <p className={styles.statLabel}>Pending Signatures</p>
        </div>
        <div className={styles.statDivider} aria-hidden="true" />
        <div className={styles.statCol}>
          <p className={styles.statNumber}>{stat(summary?.updatedDocuments)}</p>
          <p className={styles.statLabel}>Updated Documents</p>
        </div>
      </section>

      {error && <p className={`${styles.status} ${styles.error}`}>{error}</p>}

      <ul className={styles.list}>
        {DOCUMENT_ROWS.map((key) => {
          const doc = hrDocument(key);
          if (!doc) return null;
          return (
            <li key={key}>
              <DocRow
                href={doc.href}
                title={doc.label}
                sub={hrDocumentVersionLabel(doc)}
                chip={chipFor(byKey.get(key))}
              />
            </li>
          );
        })}

        <li>
          <DocRow
            href={ACKNOWLEDGEMENTS_HREF}
            title="Acknowledgements"
            sub="Track signed and pending items"
            chip={
              summary && summary.pendingSignatures > 0
                ? { text: `${summary.pendingSignatures} Pending`, tone: "warm" }
                : null
            }
            feature
          />
        </li>
      </ul>

      <p className={styles.note}>
        <span className={styles.noteIcon}>
          <InfoCircleIcon />
        </span>
        Use Acknowledgements to track who has signed updated training and policy documents.
      </p>
    </div>
  );
}
