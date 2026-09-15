"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { doc, getDoc, setDoc, serverTimestamp, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { useLang } from "@/components/LanguageProvider";
import {
  fetchDocumentSignatures,
  SIGNABLE_DOCUMENTS,
  TRAINING_DOCUMENT_KEYS,
  type SignableDocumentKey,
} from "@/lib/document-signatures";
import { CLOCK_IN_GUIDE_HREF, isWithinGettingStarted } from "@/lib/clock-in-guide";
import { needsRsaCertificate } from "@/lib/staff-display";
import styles from "./page.module.css";

/* ── types ── */

type StoredShift = { iso: string; meal: "lunch" | "dinner"; start: string };

type RosterDoc = {
  weekStartISO: string;
  publishedAt?: Timestamp;
  shifts: StoredShift[];
};

type StoredNotification = {
  id: string;
  kind?: string;
  title?: string;
  detail?: string;
  createdAt?: Timestamp;
};

type Notification = {
  id: string;
  label: string;
  detail: string;
  createdAt: Date | null;
  ago: string;
};

type NextShiftInfo = {
  date: Date;
  meal: "lunch" | "dinner";
  startTime: string;
  startDate: Date;
};

/* ── helpers ── */

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // 0=Mon
  x.setDate(x.getDate() - dow);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtShiftDate(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function fmtTime12h(t: string): string {
  if (!/^\d{1,2}:\d{2}$/.test(t)) return t;
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mStr} ${period}`;
}

function mealLabelKey(m: "lunch" | "dinner"): string {
  return m === "lunch" ? "staff.lunch" : "staff.dinner";
}

/**
 * "1h 29m" — how long until the shift starts.
 *
 * Coarsens as it gets further out: minutes matter when you are about to
 * leave, days are all anyone reads a week ahead.
 */
function fmtCountdown(fromMs: number, toMs: number): string {
  const mins = Math.floor((toMs - fromMs) / 60000);
  if (mins <= 0) return "";
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

function greetingKey(hour: number): string {
  if (hour < 12) return "staff.greeting.morning";
  if (hour < 18) return "staff.greeting.afternoon";
  return "staff.greeting.evening";
}

function tsToDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null && "toDate" in (v as object)) {
    try { return (v as Timestamp).toDate(); } catch { return null; }
  }
  return null;
}

function fmtRelative(
  d: Date | null,
  t: (key: string) => string,
): string {
  if (!d) return "";
  const diff = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (diff < 60) return t("staff.time.justNow");
  if (diff < 3600) return `${Math.floor(diff / 60)}${t("staff.time.mAgo")}`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}${t("staff.time.hAgo")}`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days}${t("staff.time.dAgo")}`;
  const weeks = Math.floor(days / 7);
  return `${weeks}${t("staff.time.wAgo")}`;
}

/** Find the nearest upcoming shift across this week and next week rosters. */
function findNextShift(
  thisWeekRoster: RosterDoc | null,
  nextWeekRoster: RosterDoc | null,
): NextShiftInfo | null {
  const now = new Date();
  const candidates: NextShiftInfo[] = [];

  for (const roster of [thisWeekRoster, nextWeekRoster]) {
    if (!roster) continue;
    for (const s of roster.shifts) {
      const [y, m, d] = s.iso.split("-").map(Number);
      const [hh, mm] = s.start.split(":").map(Number);
      const date = new Date(y, m - 1, d, 0, 0, 0, 0);
      const startDate = new Date(y, m - 1, d, hh, mm, 0, 0);
      candidates.push({ date, meal: s.meal, startTime: s.start, startDate });
    }
  }

  candidates.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  // Only show future shifts — never fall back to past ones
  return candidates.find((c) => c.startDate.getTime() >= now.getTime()) ?? null;
}

/* ── page ── */

export default function StaffDashboardPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [nextShift, setNextShift] = useState<NextShiftInfo | null>(null);
  const [shiftLoaded, setShiftLoaded] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [position, setPosition] = useState("");
  const [weekShiftCount, setWeekShiftCount] = useState<number | null>(null);
  // How many of the documents this person is asked to upload are still not
  // there. `null` until the record has been read, so the tile says "—"
  // instead of claiming everything is in order before it knows.
  const [missingUploads, setMissingUploads] = useState<number | null>(null);
  // When the owner signed this employee off, and the four digits they type
  // into the POS. Both feed the Getting Started card and nothing else.
  const [activatedAt, setActivatedAt] = useState<Date | null>(null);
  const [staffId, setStaffId] = useState("");

  const [today, setTodayDate] = useState<Date>(() => {
    const d = new Date(0);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  useEffect(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    setTodayDate(d);
  }, []);

  // `null` until mounted, so the server and the first client render agree —
  // the wall clock is the one thing the server cannot know. Everything keyed
  // off it (the greeting, the countdown) has a neutral form for that frame.
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const thisWeekISO = useMemo(() => isoDate(startOfWeek(today)), [today]);
  const nextWeekISO = useMemo(() => isoDate(addDays(startOfWeek(today), 7)), [today]);

  // Load roster + notifications from staff_onboarding/{uid}
  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const ref = doc(getDb(), "staff_onboarding", user.uid);
      const snap = await getDoc(ref);
      const data = snap.data() ?? {};

      const given = typeof data.firstName === "string" ? data.firstName.trim() : "";
      const full = typeof data.fullName === "string" ? data.fullName.trim() : "";
      setFirstName(given || full.split(" ")[0] || "");
      setPosition(typeof data.position === "string" ? data.position : "");

      // The documents tile opens the upload page, so it has to count what
      // that page asks for: the visa from everyone, the RSA only from the
      // people who serve. It used to count unsigned training instead, which
      // is why tapping "1 to sign" landed on a screen about certificates.
      const uploaded = (data.documents ?? {}) as Record<string, unknown>;
      const wanted: string[] = ["visaUrl"];
      if (needsRsaCertificate(data as Record<string, unknown>)) wanted.push("rsaUrl");
      setMissingUploads(wanted.filter((key) => !uploaded[key]).length);

      setActivatedAt(tsToDate(data.activatedAt));
      setStaffId(String(data.squareStaffId ?? "").trim());

      // Roster — check this week + next week
      const thisRoster = (data.roster?.[thisWeekISO] ?? null) as RosterDoc | null;
      const nextRoster = (data.roster?.[nextWeekISO] ?? null) as RosterDoc | null;
      setNextShift(findNextShift(thisRoster, nextRoster));
      setWeekShiftCount(thisRoster?.shifts?.length ?? 0);
      setShiftLoaded(true);

      // Notifications
      const arr = (data.notifications ?? []) as StoredNotification[];
      const parsed: Notification[] = arr
        .map((n) => {
          const d = tsToDate(n.createdAt);
          return {
            id: n.id,
            label: n.title ?? t("staff.notif.title"),
            detail: n.detail ?? "",
            createdAt: d,
            ago: fmtRelative(d, t),
          };
        })
        .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      setNotifications(parsed);

      // Best-effort: mark notifications as read.
      await setDoc(ref, { notificationsReadAt: serverTimestamp() }, { merge: true }).catch(() => {});
    } catch {
      setShiftLoaded(true);
    }
  }, [user, thisWeekISO, nextWeekISO, t]);

  useEffect(() => {
    if (!user) return;
    void loadData();
  }, [user, loadData]);

  // Training this account still owes a signature for. Read from the same
  // record the document itself writes to, so signing the beer guide is what
  // removes the card — nothing has to be dismissed by hand.
  const [unsignedTraining, setUnsignedTraining] = useState<SignableDocumentKey[]>([]);
  const loadTraining = useCallback(async () => {
    if (!user) return;
    try {
      const signatures = await fetchDocumentSignatures(user);
      setUnsignedTraining(TRAINING_DOCUMENT_KEYS.filter((key) => !signatures[key]));
    } catch {
      // Stay silent on a read failure. A "not signed" card that signing
      // cannot clear is worse than showing no card at all.
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void loadTraining();
  }, [user, loadTraining]);

  // Re-fetch data when the app becomes visible (e.g. after tapping a push
  // notification, or on returning from the beer guide in a standalone PWA
  // where the dashboard is resumed rather than re-mounted).
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      loadData();
      void loadTraining();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadData, loadTraining]);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    if (!notifOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [notifOpen]);

  // Close on Escape.
  useEffect(() => {
    if (!notifOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setNotifOpen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [notifOpen]);

  // Next Friday pay date
  const [nextPayDate, setNextPayDate] = useState<Date | null>(null);

  useEffect(() => {
    const d = new Date();
    const dow = d.getDay(); // 0=Sun
    const daysUntilFri = (5 - dow + 7) % 7 || 7; // if today is Fri, show next Fri
    const fri = new Date(d);
    fri.setDate(d.getDate() + daysUntilFri);
    fri.setHours(0, 0, 0, 0);
    setNextPayDate(fri);
  }, []);

  const greeting =
    nowMs === null ? t("staff.greeting.hello") : t(greetingKey(new Date(nowMs).getHours()));
  const countdown =
    nowMs !== null && nextShift ? fmtCountdown(nowMs, nextShift.startDate.getTime()) : "";

  // The first fortnight after activation, when nobody has the POS by heart
  // yet. False until `nowMs` is set, which is also what keeps the card out of
  // the server-rendered HTML where there is no clock to compare against.
  const gettingStarted = isWithinGettingStarted(activatedAt, nowMs);

  /**
   * What has been announced to this employee, newest first.
   *
   * Kept apart from the unsigned documents above it in the same card. Both
   * are things to attend to, but a notice is read and finished with while a
   * signature is owed until it is given — so the documents get a button that
   * says what to do, and these stay rows you tap.
   */
  const attention = notifications.map((n) => ({
    id: `notif:${n.id}`,
    href: `/staff/notifications/${n.id}`,
    title: n.label,
    detail: n.detail,
    ago: n.ago,
  }));
  const attentionPreview = attention.slice(0, 3);
  // The pill counts everything owed, not the three that fit — "1 item" beside
  // a list of one is a label; "3 items" beside a list of three when eleven
  // are waiting is a lie the View all link then contradicts.
  const attentionCount = unsignedTraining.length + notifications.length;

  return (
    <div className={styles.page}>
      <header className={styles.greetBlock}>
        <h1 className={styles.greetTitle}>
          {greeting}
          {firstName ? `, ${firstName}` : ""} <span aria-hidden="true">👋</span>
        </h1>
        <p className={styles.greetSub}>{t("staff.greeting.sub")}</p>
      </header>

      {/* Getting Started — the POS time clock, for the first fortnight only.
          Above the roster on purpose: a shift you forgot to clock into is a
          shift you were not paid for, and that is the mistake week one makes. */}
      {gettingStarted && (
        <section className={styles.startCard}>
          <div className={styles.startTop}>
            <div className={styles.startHeading}>
              <p className={styles.startKicker}>{t("staff.start.kicker")}</p>
              <p className={styles.startTitle}>{t("staff.start.title")}</p>
              <p className={styles.startSub}>{t("staff.start.sub")}</p>
            </div>
            <span className={styles.startIcon} aria-hidden="true">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15.5 14" />
              </svg>
            </span>
          </div>

          <div className={styles.startDivider} />

          <div className={styles.startBottom}>
            {/* No chip when the owner has not set a clock-in ID yet: a blank
                one would send them to the POS to type nothing. */}
            {staffId && (
              <p className={styles.startId}>
                <span className={styles.startIdIcon} aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <circle cx="9" cy="10" r="2" />
                    <path d="M6 16c.6-1.6 1.8-2.4 3-2.4s2.4.8 3 2.4" />
                    <line x1="15" y1="10" x2="18" y2="10" />
                    <line x1="15" y1="14" x2="18" y2="14" />
                  </svg>
                </span>
                {t("staff.start.staffId")} <strong>{staffId}</strong>
              </p>
            )}
            <Link href={CLOCK_IN_GUIDE_HREF} className={styles.startBtn}>
              {t("staff.start.viewGuide")} <span aria-hidden="true">›</span>
            </Link>
          </div>
        </section>
      )}

      {/* Next Shift */}
      <Link href="/staff/schedule/roster" className={styles.shiftCard}>
        <div className={styles.shiftTop}>
          <span className={styles.shiftLabel}>{t("staff.nextShift")}</span>
          {countdown && <span className={styles.shiftCountdown}>
            {t("staff.shiftIn.prefix")}{countdown}{t("staff.shiftIn.suffix")}
          </span>}
        </div>
        {!shiftLoaded ? (
          <p className={styles.shiftDate}>{t("staff.loading")}</p>
        ) : nextShift ? (
          <>
            <p className={styles.shiftDate}>{fmtShiftDate(nextShift.date)}</p>
            <p className={styles.shiftTime}>
              {fmtTime12h(nextShift.startTime)} · {t(mealLabelKey(nextShift.meal))}
            </p>
            {position && <p className={styles.shiftPosition}>{position}</p>}
          </>
        ) : (
          <p className={styles.shiftDate}>{t("staff.noUpcoming")}</p>
        )}
      </Link>

      {/* At-a-glance tiles */}
      <div className={styles.tileRow}>
        <Link href="/staff/schedule/roster" className={styles.tile}>
          <span className={styles.tileLabel}>{t("staff.tile.schedule")}</span>
          <span className={styles.tileValue}>
            {weekShiftCount === null ? "—" : weekShiftCount}
          </span>
          <span className={styles.tileSub}>{t("staff.tile.thisWeek")}</span>
        </Link>

        <Link href="/staff/payslips" className={styles.tile}>
          <span className={styles.tileLabel}>{t("staff.tile.payslip")}</span>
          <span className={styles.tileValueSmall}>
            {nextPayDate ? fmtShiftDate(nextPayDate) : "—"}
          </span>
          <span className={styles.tileSub}>{t("staff.nextPay")}</span>
        </Link>

        <Link href="/staff/documents" className={styles.tile}>
          <span className={styles.tileLabel}>{t("staff.tile.documents")}</span>
          <span className={styles.tileValueSmall}>
            {missingUploads === null
              ? "—"
              : missingUploads > 0
                ? `${missingUploads} ${t("staff.tile.toUpload")}`
                : t("staff.tile.allUploaded")}
          </span>
          <span className={styles.tileSub}>
            {missingUploads ? t("staff.tile.actionNeeded") : t("staff.tile.upToDate")}
          </span>
        </Link>
      </div>

      {/* Needs Your Attention — documents still owed a signature first, then
          what has been announced. */}
      {attentionCount > 0 && (
        <section className={styles.attentionCard}>
          <div className={styles.attentionHeader}>
            <p className={styles.attentionTitle}>{t("staff.attention.title")}</p>
            <span className={styles.attentionPill}>
              <span className={styles.attentionPillDot} aria-hidden="true" />
              {attentionCount}{" "}
              {t(attentionCount === 1 ? "staff.attention.item" : "staff.attention.items")}
            </span>
          </div>

          <ul className={styles.attentionList}>
            {unsignedTraining.map((key) => (
              <li key={`training:${key}`} className={styles.attentionRow}>
                <span className={styles.attentionIcon} aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="8" y1="13" x2="16" y2="13" />
                    <line x1="8" y1="17" x2="13" y2="17" />
                  </svg>
                </span>
                <div className={styles.attentionBody}>
                  <span className={styles.attentionName}>
                    {t(SIGNABLE_DOCUMENTS[key].labelKey, SIGNABLE_DOCUMENTS[key].label)}
                  </span>
                  <span className={styles.attentionDetail}>
                    {t("staff.attention.reviewAndSign")}
                  </span>
                </div>
                <Link href={SIGNABLE_DOCUMENTS[key].href} className={styles.attentionBtn}>
                  {t("staff.action.review")} <span aria-hidden="true">›</span>
                </Link>
              </li>
            ))}

            {attentionPreview.map((item) => (
              <li key={item.id} className={styles.attentionRow}>
                <span className={styles.attentionIcon} aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
                  </svg>
                </span>
                <Link href={item.href} className={styles.attentionBody}>
                  <span className={styles.attentionName}>{item.title}</span>
                  {item.detail && (
                    <span className={styles.attentionDetail}>{item.detail}</span>
                  )}
                </Link>
                {item.ago && <span className={styles.attentionAgo}>{item.ago}</span>}
              </li>
            ))}
          </ul>

          {notifications.length > attentionPreview.length && (
            <button
              type="button"
              className={styles.attentionViewAll}
              onClick={() => setNotifOpen(true)}
            >
              {t("staff.notif.viewAll")} <span aria-hidden="true">›</span>
            </button>
          )}
        </section>
      )}

      {/* Quick Actions */}
      <section className={styles.quickSection}>
        <h2 className={styles.quickTitle}>{t("staff.quickActions")}</h2>

        <Link href="/staff/schedule/request-holiday" className={styles.quickRow}>
          <span className={styles.quickIcon} aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </span>
          <span className={styles.quickLabel}>{t("staff.requestHoliday")}</span>
          <span className={styles.chevron} aria-hidden="true">›</span>
        </Link>

        <Link href="/staff/schedule/availability-change" className={styles.quickRow}>
          <span className={styles.quickIcon} aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </span>
          <span className={styles.quickLabel}>{t("staff.availabilityChange")}</span>
          <span className={styles.chevron} aria-hidden="true">›</span>
        </Link>
      </section>

      {notifOpen && (
        <div
          className={styles.modalBackdrop}
          onClick={() => setNotifOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="All notifications"
        >
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>{t("staff.notif.modalTitle")}</h2>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setNotifOpen(false)}
                aria-label="Close"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <ul className={styles.modalList}>
              {notifications.map((n) => (
                <li key={n.id} className={styles.modalItem}>
                  <span className={styles.modalDot} aria-hidden="true" />
                  <Link
                    href={`/staff/notifications/${n.id}`}
                    className={styles.modalItemBody}
                    onClick={() => setNotifOpen(false)}
                  >
                    <div className={styles.modalItemTopRow}>
                      <span className={styles.modalItemTitle}>{n.label}</span>
                      <span className={styles.modalItemAgo}>{n.ago}</span>
                    </div>
                    <p className={styles.modalItemDetail}>{n.detail}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
