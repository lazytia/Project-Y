"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import { createStaffAccount } from "@/lib/staff-admin";
import Splash from "@/components/Splash";
import Toast from "@/components/Toast";
import styles from "./page.module.css";

function todayKey(): string {
  return new Date().toLocaleDateString("en-CA");
}

export default function AddStaffPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [startDate, setStartDate] = useState<string>(todayKey());

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);

  // Owner-only page.
  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [authLoading, allowed, router]);

  if (authLoading || !allowed) {
    return <Splash />;
  }

  const canSubmit =
    username.trim().length >= 3 &&
    password.length >= 6 &&
    startDate.length === 10 &&
    !saving;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const [y, m, d] = startDate.split("-").map(Number);
      const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
      await createStaffAccount({
        username: username.trim(),
        password,
        startDate: start,
      });
      setShowToast(true);
      setUsername("");
      setPassword("");
      setStartDate(todayKey());
    } catch (err) {
      // Firebase error codes are surfaced verbatim so the owner can read them.
      const msg = err instanceof Error ? err.message : "Failed to create staff.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <span className={styles.crumbDim}>People</span>
        <span className={styles.crumbSep}>›</span>
        <span className={styles.crumb}>Add Staff</span>
      </nav>

      <header className={styles.header}>
        <h1 className={styles.title}>Add Staff</h1>
        <p className={styles.subtitle}>
          Create a sign-in account and set their start date. The new staff member
          can log in immediately with this Staff ID and password.
        </p>
      </header>

      <form className={styles.card} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label htmlFor="username" className={styles.label}>Staff ID</label>
          <input
            id="username"
            type="text"
            className={styles.input}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. sarah"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
          <p className={styles.hint}>
            3–30 characters, lowercase letters / numbers / . _ -
          </p>
        </div>

        <div className={styles.field}>
          <label htmlFor="password" className={styles.label}>Password</label>
          <input
            id="password"
            type="text"
            className={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="startDate" className={styles.label}>Start Date</label>
          <input
            id="startDate"
            type="date"
            className={styles.input}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <button
          type="submit"
          className={styles.submitBtn}
          disabled={!canSubmit}
        >
          {saving ? "Creating…" : "Create Staff"}
        </button>
      </form>

      {showToast && (
        <Toast
          title="Staff account created"
          message="They can now sign in and start onboarding."
          onClose={() => setShowToast(false)}
        />
      )}
    </div>
  );
}
