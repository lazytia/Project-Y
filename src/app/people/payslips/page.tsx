"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, getDocs, type Timestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/**
 * People → Payslips index for owners and managers (yurina). Lists every
 * non-terminated employee with their name and position, and links each
 * row to a per-staff payslip history at /people/payslips/[uid].
 *
 * The per-staff detail page reuses /api/staff/payslips with an owner-
 * scoped `?uid=` query param — that endpoint now accepts a target uid
 * override when the caller is in OWNER_USERNAMES.
 */

type StoredStaff = {
  fullName?: string;
  givenName?: string;
  familyName?: string;
  position?: string;
  status?: string;
  approvedAt?: Timestamp | null;
};

type Staff = {
  uid: string;
  name: string;
  positionLabel: string;
};

function pickName(raw: StoredStaff): string {
  const full = (raw.fullName ?? "").trim();
  if (full) return full;
  return [raw.givenName, raw.familyName].filter(Boolean).join(" ").trim() || "—";
}

export default function ManagerPayslipsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);

  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [allowed, authLoading, router]);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(collection(getDb(), "staff_onboarding"));
        const parsed: Staff[] = snap.docs
          .map((d) => {
            const raw = d.data() as StoredStaff;
            const status = (raw.status ?? "").toLowerCase();
            if (status === "terminated") return null;
            return {
              uid: d.id,
              name: pickName(raw),
              positionLabel: raw.position ?? "—",
            } as Staff;
          })
          .filter((s): s is Staff => s !== null)
          .sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled) setStaff(parsed);
      } catch (err) {
        console.warn("[people/payslips] failed to load staff:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [allowed]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((s) => s.name.toLowerCase().includes(q));
  }, [staff, query]);

  if (authLoading || !allowed) return <Splash />;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Payslips</h1>
      <p className={styles.subtitle}>
        Pick an employee to view their payslip history.
      </p>

      <div className={styles.searchWrap}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <p className={styles.hint}>Loading employees…</p>
      ) : filtered.length === 0 ? (
        <p className={styles.hint}>No employees found.</p>
      ) : (
        <ul className={styles.list}>
          {filtered.map((s) => (
            <li key={s.uid}>
              <Link href={`/people/payslips/${s.uid}`} className={styles.row}>
                <span className={styles.rowName}>{s.name}</span>
                <span className={styles.rowPosition}>{s.positionLabel}</span>
                <span className={styles.rowChev} aria-hidden="true">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
