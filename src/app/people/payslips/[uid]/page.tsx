"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import {
  fmtCurrency,
  fmtDateLong,
  fmtPeriod,
  type Payslip,
} from "@/app/staff/payslips/_data";
import styles from "./page.module.css";

/**
 * Owner/manager view of a single employee's payslip history. Same shape
 * as /staff/payslips but the API is called with ?uid=<staffUid> so the
 * caller sees the target employee's rows instead of their own. Rows
 * link into /people/payslips/[uid]/[id] for the detailed breakdown.
 */

type PayslipsResponse = {
  employeeName: string | null;
  nextPayDateISO: string | null;
  payFrequency: string;
  payslips: Payslip[];
};

export default function ManagerPayslipDetailPage({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const { uid } = use(params);
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);

  const [data, setData] = useState<PayslipsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [allowed, authLoading, router]);

  useEffect(() => {
    if (!allowed || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(
          `/api/staff/payslips?uid=${encodeURIComponent(uid)}`,
          {
            headers: { Authorization: `Bearer ${idToken}` },
            cache: "no-store",
          },
        );
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error ?? `Failed (${res.status}).`);
        if (!cancelled) setData(payload as PayslipsResponse);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [allowed, user, uid]);

  if (authLoading || !allowed) return <Splash />;

  const payslips = data?.payslips ?? [];
  const latest = payslips[0];
  const previous = payslips.slice(1);

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => router.push("/people/payslips")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>Back</span>
      </button>

      <h1 className={styles.title}>{data?.employeeName ?? "Payslips"}</h1>

      {/* Next Pay Date */}
      <section className={styles.metaCard}>
        <div className={styles.metaIcon} aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
        <div className={styles.metaBody}>
          <p className={styles.metaLabel}>Next Pay Date</p>
          <p className={styles.metaValue}>
            {data?.nextPayDateISO ? fmtDateLong(data.nextPayDateISO) : "—"}
          </p>
          <p className={styles.metaSub}>{data?.payFrequency ?? "Paid weekly"}</p>
        </div>
      </section>

      {loading ? (
        <p className={styles.hint}>Loading payslips…</p>
      ) : error ? (
        <p className={styles.hint}>Couldn&rsquo;t load payslips. {error}</p>
      ) : !latest ? (
        <p className={styles.hint}>
          No payslips found for this employee. Their name may not match a row
          on the payroll sheet.
        </p>
      ) : (
        <>
          <h2 className={styles.sectionTitle}>Latest Payslip</h2>
          <section className={styles.latestCard}>
            <div className={styles.latestRow}>
              <span className={styles.latestLabel}>Pay Period</span>
              <span className={styles.latestValue}>
                {fmtPeriod(latest.periodStart, latest.periodEnd)}
              </span>
            </div>
            <div className={styles.latestDivider} />
            <div className={styles.latestRow}>
              <span className={styles.latestLabel}>Net Pay</span>
              <span className={styles.latestAmountBig}>{fmtCurrency(latest.netPay)}</span>
            </div>
            <div className={styles.latestDivider} />
            <div className={styles.latestRow}>
              <span className={styles.latestLabel}>Paid</span>
              <span className={styles.latestValue}>{fmtDateLong(latest.payDate)}</span>
            </div>
          </section>

          {previous.length > 0 && (
            <>
              <h2 className={styles.sectionTitle}>Previous Payslips</h2>
              <ul className={styles.prevList}>
                {previous.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/staff/payslips/${p.id}`}
                      className={styles.prevRow}
                      prefetch={false}
                    >
                      <span className={styles.prevDate}>
                        {fmtDateLong(p.payDate).replace(/^[A-Za-z]+, /, "")}
                      </span>
                      <span className={styles.prevAmount}>{fmtCurrency(p.netPay)}</span>
                      <span className={styles.prevChev} aria-hidden="true">›</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
