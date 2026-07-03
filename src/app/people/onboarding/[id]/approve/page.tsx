"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isStrictOwner } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import { createStaffAccount } from "@/lib/staff-admin";
import { emailToUsername, usernameToEmail, validateUsername } from "@/lib/username";
import Splash from "@/components/Splash";
import Toast from "@/components/Toast";
import styles from "./page.module.css";

type RequestData = {
  fullName: string;
  position: string;
  startDate: string;
  mobileNumber: string;
  approved: boolean;
  accountCreated: boolean;
};

function toIsoDate(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (typeof v === "object" && v !== null && "toDate" in v) {
    try {
      const d = (v as Timestamp).toDate();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    } catch {
      return "";
    }
  }
  return "";
}

function positionLabel(raw: string): string {
  const p = raw.trim().toLowerCase();
  if (p === "kitchen" || p === "kitchen_staff" || p === "kitchen staff") return "Kitchen Staff";
  if (p === "hall" || p === "hall_staff" || p === "hall staff") return "Hall Staff";
  return raw.trim() || "Staff";
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "??";
}

function loginIdFromName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  return first.toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

function toMobileLocal(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("61")) return digits.slice(2);
  if (digits.startsWith("0")) return digits.slice(1);
  return digits;
}

function fmtMobileDisplay(local: string): string {
  if (!local) return "";
  if (local.length >= 9) {
    return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`.trim();
  }
  return local;
}

function requesterName(email: string | null | undefined): string {
  const u = emailToUsername(email).toLowerCase();
  if (u === "yurina") return "Yurina";
  if (u === "yurica") return "Yurica";
  if (u === "tia") return "Tia";
  if (!u) return "Owner";
  return u.charAt(0).toUpperCase() + u.slice(1);
}

function isApproved(raw: Record<string, unknown>): boolean {
  const s = String(raw.status ?? "").toLowerCase();
  return s === "approved" || s === "active" || !!raw.approvedAt;
}

export default function CreateLoginDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const requestId = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");
  const { user, loading: authLoading } = useAuth();
  const allowed = isStrictOwner(user);

  const [loadingDoc, setLoadingDoc] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [request, setRequest] = useState<RequestData | null>(null);
  const [rawRequest, setRawRequest] = useState<Record<string, unknown> | null>(null);

  const [squareStaffId, setSquareStaffId] = useState("");
  const [useSquareClockIn, setUseSquareClockIn] = useState(true);
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [squareTeamMemberId, setSquareTeamMemberId] = useState<string | null>(null);
  const [squarePermissionSet, setSquarePermissionSet] = useState("");
  const [squareAccessUrl, setSquareAccessUrl] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [mobileLocal, setMobileLocal] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [authLoading, allowed, router]);

  useEffect(() => {
    if (!allowed || !requestId) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", requestId));
        if (cancelled) return;
        if (!snap.exists()) {
          setNotFound(true);
          setLoadingDoc(false);
          return;
        }
        const raw = snap.data() as Record<string, unknown>;
        if (isApproved(raw) && raw.accountCreated) {
          router.replace(`/people/onboarding/${requestId}`);
          return;
        }
        const fullName = String(raw.fullName ?? "").trim() || "Unnamed";
        setRawRequest(raw);
        setRequest({
          fullName,
          position: positionLabel(String(raw.position ?? "")),
          startDate: toIsoDate(raw.startDate),
          mobileNumber: String(raw.mobileNumber ?? ""),
          approved: isApproved(raw),
          accountCreated: !!raw.accountCreated,
        });
        setLoginId(loginIdFromName(fullName));
        setMobileLocal(toMobileLocal(String(raw.mobileNumber ?? "")));
        const mobileDigits = String(raw.mobileNumber ?? "").replace(/\D/g, "");
        const staffIdFromMobile = mobileDigits.length >= 4 ? mobileDigits.slice(-4) : "";
        const staffId = (String(raw.squareStaffId ?? "") || staffIdFromMobile)
          .replace(/\D/g, "")
          .slice(0, 4);
        setSquareStaffId(staffId);
        if (/^\d{4}$/.test(staffId)) setPassword(`${staffId}00`);
        setSquarePermissionSet(
          String(raw.squarePermissionSet ?? positionLabel(String(raw.position ?? ""))),
        );
        setSquareAccessUrl(
          typeof raw.squareAccessUrl === "string" ? (raw.squareAccessUrl as string) : null,
        );
        setSquareTeamMemberId(
          typeof raw.squareTeamMemberId === "string" ? (raw.squareTeamMemberId as string) : null,
        );
        setUseSquareClockIn(raw.useSquareStaffIdForClockIn !== false);
        setLoadingDoc(false);
      } catch {
        if (!cancelled) setLoadingDoc(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, requestId, router]);

  const canSubmit = useMemo(() => {
    return (
      loginId.trim().length >= 3 &&
      password.length >= 6 &&
      mobileLocal.trim().length >= 9 &&
      !validateUsername(loginId)
    );
  }, [loginId, password, mobileLocal]);

  async function persist(invite: boolean) {
    if (!request || !rawRequest || !canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      const username = loginId.trim().toLowerCase();
      const usernameError = validateUsername(username);
      if (usernameError) {
        setError(usernameError);
        setBusy(false);
        return;
      }

      const [y, m, d] = (request.startDate || new Date().toISOString().slice(0, 10)).split("-").map(Number);
      const startDate = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1));

      const { uid } = await createStaffAccount({
        username,
        password,
        startDate,
      });

      const mobileDigits = mobileLocal.replace(/\D/g, "");

      await setDoc(
        doc(getDb(), "staff_onboarding", uid),
        {
          ...rawRequest,
          uid,
          username,
          email: usernameToEmail(username),
          fullName: request.fullName,
          position: request.position,
          mobileNumber: mobileDigits,
          squareStaffId: squareStaffId.trim() || null,
          squareTeamMemberId: squareTeamMemberId,
          useSquareStaffIdForClockIn: useSquareClockIn,
          status: "approved",
          approvedAt: serverTimestamp(),
          approvedByUid: user?.uid ?? null,
          approvedByName: requesterName(user?.email),
          accountCreated: true,
          addedToScheduling: false,
          invitationStatus: invite ? "sent" : "saved",
          invitationSentAt: invite ? serverTimestamp() : null,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      if (requestId !== uid) {
        await deleteDoc(doc(getDb(), "staff_onboarding", requestId));
      }

      if (invite) {
        // Fire the SMS through our Vonage proxy. Failure is surfaced to
        // the owner but doesn't roll back the account creation — the
        // login is already usable; they can retry the SMS manually.
        const trimmedStaffId = squareStaffId.trim();
        const squareLine = trimmedStaffId
          ? ` Square staff ID: ${trimmedStaffId}.`
          : "";
        const smsText = `Hi ${request.fullName.split(" ")[0]}, YURICA employee login: ${username} / temporary password: ${password}.${squareLine}`;
        try {
          const idToken = await user?.getIdToken();
          const res = await fetch("/api/vonage/send-sms", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
            body: JSON.stringify({ to: mobileDigits, text: smsText }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error ?? `SMS failed (${res.status})`);
          setToast({
            title: "Invitation sent",
            message: `Login details texted to +61 ${fmtMobileDisplay(mobileLocal)}.`,
          });
        } catch (err) {
          setToast({
            title: "Login saved, SMS failed",
            message: err instanceof Error ? err.message : "Vonage send failed.",
          });
        }
      } else {
        setToast({
          title: "Details saved",
          message: "Employee login has been created.",
        });
      }
      window.setTimeout(() => router.push("/people/onboarding"), invite ? 1600 : 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save login details.");
      setBusy(false);
    }
  }

  if (authLoading || !allowed) return <Splash />;
  if (loadingDoc) return <Splash />;

  if (notFound || !request) {
    return (
      <div className={styles.page}>
        <div className={styles.topBar}>
          <button
            type="button"
            className={styles.backBtn}
            onClick={() => router.push("/people/onboarding")}
            aria-label="Back"
          >
            <ChevronLeft />
          </button>
        </div>
        <p className={styles.notFoundMsg}>This request no longer exists.</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => router.push(`/people/onboarding/${requestId}`)}
          aria-label="Back to request"
        >
          <ChevronLeft />
        </button>
      </div>

      <p className={styles.eyebrow}>
        <span className={styles.eyebrowCheck} aria-hidden="true">✓</span>
        APPROVE &amp; ISSUE STAFF ID
      </p>
      <h1 className={styles.title}>Create Login Details</h1>
      <p className={styles.subtitle}>
        Enter the credentials below. They will be sent to the employee by text.
      </p>

      <div className={styles.summaryCard}>
        <span className={styles.avatar}>{initialsOf(request.fullName)}</span>
        <div className={styles.summaryBody}>
          <p className={styles.summaryName}>{request.fullName}</p>
          <p className={styles.summaryRole}>{request.position}</p>
        </div>
        <span className={styles.invitePill}>Pending Invitation</span>
      </div>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>SQUARE STAFF ID</h2>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={useSquareClockIn}
            onChange={(e) => setUseSquareClockIn(e.target.checked)}
          />
          <SquareMark />
          Use this ID for all clock in/out on Square.
        </label>
        <input
          className={styles.input}
          type="text"
          inputMode="numeric"
          pattern="\d*"
          maxLength={4}
          placeholder="Enter Square Staff ID (4 digits)"
          value={squareStaffId}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
            setSquareStaffId(digits);
            // Business rule: the Project Y password is the Square 4-digit
            // passcode with "00" tacked on the end, so we auto-populate
            // the password field once the owner has typed the full PIN.
            if (digits.length === 4) setPassword(`${digits}00`);
          }}
          disabled={busy}
        />
        <p className={styles.fieldHint}>
          In Square Access: Permission set → {squarePermissionSet || request.position}, Location →
          Yurica Japnaese Kitchen NS, Passcode → mobile last 4 digits (same as above, not Generate).
        </p>
        {squareAccessUrl && (
          <a className={styles.squareLink} href={squareAccessUrl} target="_blank" rel="noopener noreferrer">
            Open Square Access
          </a>
        )}
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>PROJECT Y LOGIN</h2>
        <p className={styles.hintRow}>
          <YMark />
          Employee will use this to log in to Project Y.
        </p>
        <div>
          <p className={styles.fieldLabel}>LOGIN ID</p>
          <input
            className={styles.input}
            type="text"
            value={loginId}
            onChange={(e) => setLoginId(e.target.value.toLowerCase())}
            disabled={busy}
            autoComplete="off"
          />
          <p className={styles.fieldHint}>Prefilled from employee&apos;s first name</p>
        </div>
        <div>
          <p className={styles.fieldLabel}>PASSWORD</p>
          <div className={styles.passwordWrap}>
            <input
              className={styles.input}
              type={showPassword ? "text" : "password"}
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              autoComplete="new-password"
            />
            <button
              type="button"
              className={styles.eyeBtn}
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              <EyeIcon open={showPassword} />
            </button>
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>EMPLOYEE MOBILE NUMBER</h2>
        <p className={styles.hintRow}>
          <PhoneIcon />
          We&apos;ll send the login details via SMS.
        </p>
        <div className={styles.mobileWrap}>
          <span className={styles.countryCode}>+61</span>
          <span className={styles.mobileDivider} />
          <input
            className={styles.mobileInput}
            type="tel"
            inputMode="tel"
            value={fmtMobileDisplay(mobileLocal)}
            onChange={(e) => setMobileLocal(e.target.value.replace(/\D/g, ""))}
            disabled={busy}
          />
        </div>
      </section>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.inviteBtn}
          disabled={!canSubmit || busy}
          onClick={() => void persist(true)}
        >
          <SendIcon />
          {busy ? "Saving…" : "Invite the employee by text"}
        </button>
        <button
          type="button"
          className={styles.saveBtn}
          disabled={!canSubmit || busy}
          onClick={() => void persist(false)}
        >
          {busy ? "Saving…" : "Save Details"}
        </button>
        <p className={styles.footerNote}>
          <InfoIcon />
          The employee will receive their Staff ID and Project Y login details via SMS.
        </p>
        <button
          type="button"
          className={styles.revertBtn}
          disabled={busy}
          onClick={() => router.push(`/people/onboarding/${requestId}`)}
        >
          Revert
        </button>
      </div>

      {toast && (
        <Toast title={toast.title} message={toast.message} onClose={() => setToast(null)} />
      )}
    </div>
  );
}

function ChevronLeft() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function SquareMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" />
      <rect x="7" y="7" width="10" height="10" rx="1" fill="var(--color-bg)" />
    </svg>
  );
}

function YMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="var(--color-warm-bg)" stroke="var(--color-warm)" strokeWidth="1.5" />
      <text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="800" fill="var(--color-warm)">Y</text>
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
