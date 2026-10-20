"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useLang } from "@/components/LanguageProvider";
import {
  fetchOwnRequests,
  type RequestRecord,
  type RequestStatus,
} from "@/lib/staff-requests";
import styles from "./page.module.css";

/** Shared geometry for the icons, so one edit moves them all. */
const ICON_PROPS = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

type RequestKind = RequestRecord["kind"];

/** One drawing per kind of request, shared by the card that files it and the rows that record it. */
const KIND_ICONS: Record<RequestKind, React.ReactNode> = {
  holiday: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </>
  ),
  availability: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </>
  ),
};

/**
 * The two things a staff member can ask the owner for.
 *
 * Both forms already existed and hung off the sidebar's Schedule group; this
 * page is what replaced that group when the menu went flat. Titles reuse the
 * `nav.*` keys the rows carried there, so the wording is corrected once.
 */
const REQUEST_CARDS: readonly {
  kind: RequestKind;
  href: string;
  titleKey: string;
  descKey: string;
}[] = [
  {
    kind: "holiday",
    href: "/staff/schedule/request-holiday",
    titleKey: "nav.requestHoliday",
    descKey: "req.holidayDesc",
  },
  {
    kind: "availability",
    href: "/staff/schedule/availability-change",
    titleKey: "nav.availabilityChange",
    descKey: "req.availabilityDesc",
  },
];

const KIND_LABEL_KEYS: Record<RequestKind, string> = {
  holiday: "req.history.holiday",
  availability: "req.history.availability",
};

const STATUS_LABEL_KEYS: Record<RequestStatus, string> = {
  pending: "rh.status.pending",
  approved: "rh.status.approved",
  declined: "rh.status.declined",
};

const STATUS_CLASSES: Record<RequestStatus, string> = {
  pending: styles.statusPending,
  approved: styles.statusApproved,
  declined: styles.statusDeclined,
};

function fmtDay(d: Date, locale: string, withYear = true): string {
  return d.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: withYear ? "numeric" : undefined,
  });
}

/** "12 – 15 Nov 2026"; one date when the holiday is a single day. */
function fmtRange(a: Date, b: Date, locale: string): string {
  if (a.toDateString() === b.toDateString()) return fmtDay(a, locale);
  const sameYear = a.getFullYear() === b.getFullYear();
  const sameMonth = sameYear && a.getMonth() === b.getMonth();
  if (sameMonth) return `${a.getDate()} – ${fmtDay(b, locale)}`;
  return `${fmtDay(a, locale, !sameYear)} – ${fmtDay(b, locale)}`;
}

export default function StaffRequestsPage() {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const locale = lang === "ja" ? "ja-JP" : "en-AU";

  // null until the first read lands, so "no requests" is never claimed for a
  // list that has simply not arrived yet.
  const [records, setRecords] = useState<RequestRecord[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setRecords(await fetchOwnRequests(user.uid));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  // A request is decided while the app sits open in the background, so read
  // again on return rather than showing it as pending until the next visit.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") void load();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  /** The dates the request is about: the holiday's span, or when the availability starts. */
  function datesLine(r: RequestRecord): string {
    if (r.kind === "holiday") {
      return r.startDate && r.endDate ? fmtRange(r.startDate, r.endDate, locale) : "—";
    }
    return r.effectiveDate
      ? t("req.history.effective").replace("{date}", fmtDay(r.effectiveDate, locale))
      : "—";
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t("req.title")}</h1>
      <p className={styles.subtitle}>{t("req.subtitle")}</p>

      {REQUEST_CARDS.map(({ kind, href, titleKey, descKey }) => (
        <Link href={href} key={href} className={styles.card}>
          <span className={styles.cardIcon} aria-hidden="true">
            <svg {...ICON_PROPS}>{KIND_ICONS[kind]}</svg>
          </span>
          <span className={styles.cardBody}>
            <span className={styles.cardTitle}>{t(titleKey)}</span>
            <span className={styles.cardDesc}>{t(descKey)}</span>
          </span>
          <span className={styles.chevron} aria-hidden="true">
            ›
          </span>
        </Link>
      ))}

      <section className={styles.history}>
        <h2 className={styles.historyTitle}>{t("req.history.title")}</h2>

        {records === null ? (
          <p className={styles.historyNote}>
            {loadFailed ? t("req.history.error") : t("staff.loading")}
          </p>
        ) : records.length === 0 ? (
          <p className={styles.historyNote}>{t("req.history.empty")}</p>
        ) : (
          <ul className={styles.historyList}>
            {records.map((r) => (
              <li key={`${r.kind}:${r.id}`} className={styles.historyRow}>
                <span className={styles.historyIcon} aria-hidden="true">
                  <svg {...ICON_PROPS} width={18} height={18}>
                    {KIND_ICONS[r.kind]}
                  </svg>
                </span>
                <span className={styles.historyBody}>
                  <span className={styles.historyMain}>{t(KIND_LABEL_KEYS[r.kind])}</span>
                  <span className={styles.historyDates}>{datesLine(r)}</span>
                  {r.createdAt && (
                    <span className={styles.historySub}>
                      {t("req.history.submitted").replace("{date}", fmtDay(r.createdAt, locale))}
                    </span>
                  )}
                </span>
                <span className={`${styles.badge} ${STATUS_CLASSES[r.status]}`}>
                  {t(STATUS_LABEL_KEYS[r.status])}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className={styles.infoBox}>
        <span className={styles.infoIcon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <p className={styles.infoBody}>{t("req.note")}</p>
      </div>
    </div>
  );
}
