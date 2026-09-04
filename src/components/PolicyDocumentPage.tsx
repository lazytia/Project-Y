"use client";

/**
 * The frame around a policy document being read rather than signed.
 *
 * HR Records lists five documents and, until now, two of them opened a tally
 * of who had signed instead of the thing they had signed — the owner could
 * see that six people had agreed to the privacy policy without being able to
 * read a word of it. Those rows open the document; the tally is what
 * Acknowledgements is for.
 *
 * Title and version line are read from the document catalogue rather than
 * written again here, so the row you tapped and the page you land on cannot
 * end up disagreeing about which version this is.
 */

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useLang } from "@/components/LanguageProvider";
import { hrDocument, hrDocumentVersionLabel, type HrDocumentKey } from "@/lib/hr-documents";
import styles from "@/app/staff/handbook/page.module.css";

export default function PolicyDocumentPage({
  docKey,
  children,
}: {
  docKey: HrDocumentKey;
  children: ReactNode;
}) {
  const router = useRouter();
  const { t } = useLang();
  const doc = hrDocument(docKey);
  const subtitle = doc ? hrDocumentVersionLabel(doc) : "";

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => router.back()}
        aria-label={t("common.back")}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>{t("common.back")}</span>
      </button>

      <header className={styles.header}>
        <h1 className={styles.title}>{doc?.label}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </header>

      {children}
    </div>
  );
}
