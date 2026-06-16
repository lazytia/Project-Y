"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { emailToUsername } from "@/lib/username";
import styles from "./ManagerDashboard.module.css";

/* ──────────────────────────────────────────────────────────────────────
 * Placeholder counts — will be wired up to real Firestore queries (and
 * the Square / system_yurica integrations the owner dashboard already
 * uses) in a follow-up. The shape and order match the design.
 * ──────────────────────────────────────────────────────────────────── */

const ATTENTION = {
  holidayRequests: 2,
  availabilityChanges: 1,
  newOnboarding: 1,
  visaExpiring: 1,
};

const TODAY_OPS = {
  reservationsPax: 34,
  cateringOrders: 3,
};

const SALES = {
  today: 4250,
  target: 6000,
};

const PEAK_HOUR = {
  range: "12:00 PM – 1:30 PM",
  reservations: 18,
};

const TODAYS_TEAM = {
  kitchen: 5,
  hall: 7,
};

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(n);
}

function greetingForNow(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 18) return "Good Afternoon";
  return "Good Evening";
}

function firstNameFromUsername(username: string): string {
  if (!username) return "there";
  // "yurina" → "Yuri" is the screenshot expectation but we can't infer
  // a nickname from the username alone. Default to capitalised username.
  return username.charAt(0).toUpperCase() + username.slice(1);
}

export default function ManagerDashboard() {
  const { user } = useAuth();
  const [firstName, setFirstName] = useState<string>("");

  useEffect(() => {
    setFirstName(firstNameFromUsername(emailToUsername(user?.email)));
  }, [user]);

  const attentionTotal =
    ATTENTION.holidayRequests +
    ATTENTION.availabilityChanges +
    ATTENTION.newOnboarding +
    ATTENTION.visaExpiring;

  const greeting = greetingForNow();
  const team = TODAYS_TEAM.kitchen + TODAYS_TEAM.hall;

  return (
    <div className={styles.page}>
      {/* Greeting */}
      <header className={styles.greeting}>
        <h1 className={styles.greetingTitle}>
          {greeting}, {firstName || "there"}
        </h1>
        <p className={styles.greetingRole}>Store Manager</p>
      </header>

      {/* Attention Required */}
      <section>
        <div className={styles.sectionHead}>
          <p className={styles.sectionLabel}>ATTENTION REQUIRED</p>
          <span className={styles.attentionBadge}>{attentionTotal}</span>
          <Link href="/attention-required" className={styles.sectionChev} aria-label="View all">›</Link>
        </div>
        <div className={styles.attentionCard}>
          <Link href="/scheduling/holiday-requests" className={styles.attentionCell}>
            <svg className={styles.attentionIcon} width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <p className={styles.attentionValue}>{ATTENTION.holidayRequests}</p>
            <p className={styles.attentionLabel}>Holiday<br />Requests</p>
          </Link>

          <Link href="/scheduling/availability-requests" className={styles.attentionCell}>
            <svg className={styles.attentionIcon} width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <circle cx="19" cy="8" r="3" />
            </svg>
            <p className={styles.attentionValue}>{ATTENTION.availabilityChanges}</p>
            <p className={styles.attentionLabel}>Availability<br />Change</p>
          </Link>

          <Link href="/people/onboarding" className={styles.attentionCell}>
            <svg className={styles.attentionIcon} width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </svg>
            <p className={styles.attentionValue}>{ATTENTION.newOnboarding}</p>
            <p className={styles.attentionLabel}>New<br />Onboarding</p>
          </Link>

          <Link href="/people/active-staff" className={styles.attentionCell}>
            <svg className={styles.attentionIcon} width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <circle cx="9" cy="11" r="2.2" />
              <path d="M5.5 17c0-1.6 1.6-2.7 3.5-2.7s3.5 1.1 3.5 2.7" />
              <line x1="14" y1="9" x2="18" y2="9" />
              <line x1="14" y1="13" x2="18" y2="13" />
            </svg>
            <p className={styles.attentionValue}>{ATTENTION.visaExpiring}</p>
            <p className={styles.attentionLabel}>Visa Expiring<br />Soon</p>
          </Link>
        </div>
      </section>

      {/* Today's Operations */}
      <section>
        <p className={styles.sectionLabel}>TODAY&rsquo;S OPERATIONS</p>
        <div className={styles.opsRow}>
          <Link href="/operations/reservations" className={styles.opsCard}>
            <svg className={styles.opsIcon} width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <p className={styles.opsValue}>
              {TODAY_OPS.reservationsPax}
              <span className={styles.opsUnit}> Pax</span>
            </p>
            <p className={styles.opsLabel}>Reservations</p>
          </Link>

          <Link href="/operations/catering-orders" className={styles.opsCard}>
            <svg className={styles.opsIcon} width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 18h18" />
              <path d="M5 18a7 7 0 0 1 14 0" />
              <circle cx="12" cy="6" r="1.6" />
              <line x1="12" y1="7.6" x2="12" y2="9" />
            </svg>
            <p className={styles.opsValue}>{TODAY_OPS.cateringOrders}</p>
            <p className={styles.opsLabel}>Catering Orders</p>
          </Link>
        </div>
      </section>

      {/* Sales */}
      <section>
        <p className={styles.sectionLabel}>SALES</p>
        <div className={styles.salesCard}>
          <div className={styles.salesBlock}>
            <p className={styles.salesLabel}>Today Sales</p>
            <p className={styles.salesValue}>{fmtCurrency(SALES.today)}</p>
          </div>
          <div className={styles.salesDivider} />
          <div className={styles.salesBlock}>
            <p className={styles.salesLabel}>Target Sales</p>
            <p className={styles.salesValue}>{fmtCurrency(SALES.target)}</p>
          </div>
        </div>
      </section>

      {/* Peak Hour */}
      <section>
        <p className={styles.sectionLabel}>PEAK HOUR</p>
        <div className={styles.peakCard}>
          <span className={styles.peakIcon} aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </span>
          <div className={styles.peakBody}>
            <p className={styles.peakRange}>{PEAK_HOUR.range}</p>
            <p className={styles.peakSub}>{PEAK_HOUR.reservations} Reservations</p>
          </div>
        </div>
      </section>

      {/* Today's Team */}
      <section>
        <p className={styles.sectionLabel}>TODAY&rsquo;S TEAM</p>
        <div className={styles.teamCard}>
          <div className={styles.teamRow}>
            <div className={styles.teamBlock}>
              <svg className={styles.teamIcon} width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9a4 4 0 1 1 5-3 4 4 0 1 1 5 3v6H6V9z" />
                <line x1="6" y1="15" x2="18" y2="15" />
                <line x1="7" y1="19" x2="17" y2="19" />
              </svg>
              <p className={styles.teamValue}>{TODAYS_TEAM.kitchen}</p>
              <p className={styles.teamLabel}>Kitchen</p>
            </div>
            <div className={styles.teamDivider} />
            <div className={styles.teamBlock}>
              <svg className={styles.teamIcon} width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="7" r="3.2" />
                <path d="M5 21v-2a5 5 0 0 1 4-4.9" />
                <path d="M19 21v-2a5 5 0 0 0-4-4.9" />
                <path d="M10 12l2 2 2-2" />
              </svg>
              <p className={styles.teamValue}>{TODAYS_TEAM.hall}</p>
              <p className={styles.teamLabel}>Hall</p>
            </div>
          </div>
          <Link href="/scheduling/roster" className={styles.teamFooter}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
              <circle cx="10" cy="7" r="4" />
              <path d="M21 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>{team} Staff Scheduled</span>
            <span className={styles.teamChev} aria-hidden="true">›</span>
          </Link>
        </div>
      </section>

      {/* Footer note */}
      <div className={styles.note}>
        <span className={styles.noteIcon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <p className={styles.noteBody}>
          Keep the team informed and the floor ready.<br />
          You&rsquo;ve got this!
        </p>
      </div>
    </div>
  );
}
