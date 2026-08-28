"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwner, isChef } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import { isReadyToTerminate, noticeDaysFromToday, noticeLastWorkingDay } from "@/lib/notice-last-day";
import { readStaffRates } from "@/lib/staff-rates";
import { todayIso } from "@/lib/staff-display";
import { VISA_WINDOW_DAYS } from "@/lib/hr-windows";
import {
  ONBOARDING_STEP_ICONS,
  type OnboardingStepNumber,
} from "@/lib/onboarding-steps";
import CalendarPicker from "@/components/CalendarPicker";
import Splash from "@/components/Splash";
import styles from "./page.module.css";

/** The five sections of the onboarding form, in the order staff meet them. */
type SectionKey = "personal" | "tfn" | "bank" | "documents" | "policies";

/** Everything the review sheet can show — the five sections plus HR notes,
 *  which is not part of onboarding and so is never rejected. */
type DocKey = SectionKey | "hrNotes";

type Personal = {
  firstName: string;
  lastName: string;
  preferredName: string;
  dateOfBirth: string;
  gender: string;
  email: string;
};

type BankSuper = {
  bsb?: string;
  accountNumber?: string;
  accountName?: string;
  superFundName?: string;
  usi?: string;
  memberNumber?: string;
};

type StoredHrNote = {
  employeeUid?: string;
  category?: string;
  kind?: string;
  date?: string;
  fields?: Record<string, string>;
  checkboxes?: { label: string; checked: boolean }[];
  addedByName?: string;
  createdAt?: Timestamp;
};

type HrNote = {
  id: string;
  kind: string;
  category: string;
  date: string;
  body: string;
  addedBy: string;
};

type ActiveNotice = {
  id: string;
  noticeGivenDate: string;
  lastWorkingDay: string;
  reasonForLeaving: string;
  reasonForLeavingOther: string;
  rehireEligible: string;
  managerNotes: string;
};

type Staff = {
  uid: string;
  name: string;
  positionLabel: string;
  weekdayRate: number | null;
  saturdayRate: number | null;
  startDate: Date | null;
  visaExpiry: Date | null;
  visaType: string;
  phone: string;
  /** How far through onboarding they have got, or null on rows written
   *  before the field existed. */
  completedStep: number | null;
  personal: Personal;
  taxFileNumber: string;
  signatureDataUrl: string;
  bank: BankSuper;
  handbookSignedAt: Date | null;
  agreementSignedAt: Date | null;
  privacySignedAt: Date | null;
  documents: { label: string; url: string }[];
  isReactivated: boolean;
  rehireDate: string;
  reactivatedAt: Date | null;
  employmentType: string;
  workLocation: string;
  reportsTo: string;
  previousTermination: {
    lastWorkingDate: string;
    noticeGivenDate: string;
    terminationReason: string;
    terminatedByName: string;
    terminatedAt: string;
  } | null;
};

/** Firestore field written for each half of the rate card. */
const RATE_FIELDS = { weekday: "weekdayRate", saturday: "saturdayRate" } as const;
type RateKind = keyof typeof RATE_FIELDS;

const EMPLOYMENT_POSITIONS = ["Hall Staff", "Kitchen Staff", "Hall Manager", "Chef"] as const;
const EMPLOYMENT_VISA_TYPES = ["Student", "Resident", "Working Holiday"] as const;
const EMPLOYMENT_TYPES = ["Casual", "Part-time", "Full-time"] as const;
const WORK_LOCATIONS = ["Hall", "Kitchen"] as const;

function tsToDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const [y, m, d] = v.split("-").map(Number);
    if (y && m && d) return new Date(y, m - 1, d, 12);
    const parsed = new Date(v);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof v === "object" && v !== null && "toDate" in v) {
    try {
      return (v as Timestamp).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

function daysFromToday(d: Date | null): number | null {
  if (!d) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

/** "25 Jul 2026 (Fri)" — used inside the notice information rows so the
 *  owner can double-check the day of the week without a mental map. */
function fmtDateWithDay(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  const main = date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  const dow = date.toLocaleDateString("en-AU", { weekday: "short" });
  return `${main} (${dow})`;
}

/**
 * "12 / 03 / 1994" from the stored "1994-03-12".
 *
 * Kept as plain string surgery rather than a Date: a date of birth is a
 * calendar fact with no time zone, and parsing it into a Date would let the
 * Sydney/UTC boundary shift it by a day. Mirrors the display format the
 * employee typed it in on the onboarding form.
 *
 * Returns "" rather than a dash for a missing value — DefRow already
 * renders the dash, and doing it here too would print it twice.
 */
function fmtDobDisplay(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d} / ${m} / ${y}`;
}

function daysBetween(fromISO: string): number | null {
  if (!fromISO) return null;
  const [y, m, d] = fromISO.split("-").map(Number);
  if (!y || !m || !d) return null;
  const target = new Date(y, m - 1, d);
  target.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function positionLabelOf(raw: Record<string, unknown>): string {
  const custom = String(raw.position ?? "").trim();
  if (custom) return custom;
  const p = custom.toLowerCase();
  const role = String(raw.role ?? "").toLowerCase();
  if (role === "chef" || p.includes("kitchen")) return "Kitchen Staff";
  if (p.includes("hall") || role === "manager") return "Hall Staff";
  return "Staff";
}

function strField(raw: Record<string, unknown>, key: string): string {
  const v = raw[key];
  return typeof v === "string" ? v.trim() : "";
}

function workLocationOf(raw: Record<string, unknown>): string {
  const loc = strField(raw, "workLocation");
  if (loc) return loc;
  const pos = strField(raw, "position").toLowerCase();
  if (pos.includes("kitchen")) return "Kitchen";
  if (pos.includes("hall")) return "Hall";
  return "";
}

function reportsToOf(raw: Record<string, unknown>): string {
  return (
    strField(raw, "reportsTo") ||
    strField(raw, "approvedByName") ||
    strField(raw, "reactivatedByName") ||
    ""
  );
}

function displayOrDash(value: string): string {
  return value.trim() || "—";
}

function fullNameOf(raw: Record<string, unknown>): string {
  const fn = typeof raw.fullName === "string" ? raw.fullName.trim() : "";
  if (fn) return fn;
  const f = typeof raw.firstName === "string" ? raw.firstName.trim() : "";
  const l = typeof raw.lastName === "string" ? raw.lastName.trim() : "";
  if (f || l) return [f, l].filter(Boolean).join(" ");
  const email = typeof raw.email === "string" ? raw.email : "";
  const at = email.indexOf("@");
  const user = at === -1 ? email : email.slice(0, at);
  return user ? user.charAt(0).toUpperCase() + user.slice(1) : "Unknown";
}

/**
 * The onboarding form as the owner reviews it: one row per section the
 * employee fills in, in the order they meet them.
 *
 * `step` does double duty. Rejecting a section rolls `completedStep` back to
 * `step - 1`, which is what puts the employee back on exactly that screen —
 * so the rollback target can't drift away from the row it belongs to.
 *
 * `hasData` is the fallback for telling a submitted section from an empty
 * one — see isSectionSubmitted below.
 *
 * Kept as one table because every fact in a row has to agree with the others
 * — label, rollback target, what to clear, how to tell it is filled in — and
 * they only stay in agreement while they are written next to each other.
 */
const ONBOARDING_SECTIONS: readonly {
  key: SectionKey;
  /** Also picks the row's icon, so it matches the screen the employee saw. */
  step: OnboardingStepNumber;
  label: string;
  clearPaths: string[];
  hasData: (s: Staff) => boolean;
}[] = [
  {
    key: "personal",
    step: 1,
    label: "Personal Information",
    // Deliberately clears nothing. The employee's name, DOB and mobile are
    // what the rest of the app identifies them by — rosters, HR notes and
    // the people lists all read them — so wiping the section would turn a
    // "please fix this" into an employee who reads as Unknown everywhere
    // until they re-type it. The step rollback alone sends them back, and
    // the form pre-fills, so they correct rather than start over.
    clearPaths: [],
    hasData: (s) => Boolean(s.personal.firstName || s.personal.lastName),
  },
  {
    key: "tfn",
    step: 2,
    label: "TFN Declaration",
    clearPaths: ["tfn"],
    hasData: (s) => Boolean(s.taxFileNumber),
  },
  {
    key: "bank",
    step: 3,
    label: "Bank & Super Details",
    // `bankSuper`, not `bank` — the onboarding step writes the former, and
    // clearing the latter deleted a field that has never existed, so a
    // rejected section came back with the old account still in it.
    clearPaths: ["bankSuper"],
    hasData: (s) => Boolean(s.bank.bsb || s.bank.accountNumber || s.bank.superFundName),
  },
  {
    key: "documents",
    step: 4,
    label: "Documents (Photo ID, Visa, RSA)",
    // Named upload fields rather than the whole `documents` map: older rows
    // keep `documents.visaExpiry` in there, and that date is what the
    // dashboard and Action Required count visa warnings from.
    clearPaths: [
      "documents.passportUrl", "documents.passportUrls",
      "documents.visaUrl",     "documents.visaUrls",
      "documents.rsaUrl",      "documents.rsaUrls",
    ],
    hasData: (s) => s.documents.length > 0,
  },
  {
    key: "policies",
    step: 5,
    label: "Policies (Staff Handbook, Privacy Policy, Employee Agreement)",
    clearPaths: [
      "policies.handbookSignedAt",
      "policies.privacySignedAt",
      "policies.agreementSignedAt",
    ],
    hasData: (s) =>
      Boolean(s.handbookSignedAt || s.privacySignedAt || s.agreementSignedAt),
  },
];

/**
 * Has the employee submitted this section?
 *
 * `completedStep` is their own progress marker and the very thing Reject
 * moves, so it is the answer whenever the document carries one — that is
 * what makes a rejected row fall back to Pending straight away instead of
 * sitting there still offering a View button.
 *
 * Rows written before that field existed have no marker, and reading a
 * missing one as 0 would show a fully onboarded employee as five Pending
 * rows with nothing to open. Those fall back to asking whether the section
 * actually holds anything.
 */
function isSectionSubmitted(
  section: (typeof ONBOARDING_SECTIONS)[number],
  staff: Staff,
): boolean {
  return staff.completedStep === null
    ? section.hasData(staff)
    : staff.completedStep >= section.step;
}

/** Best effort — the visa type isn't captured explicitly today, so infer
 *  it from a `visaType` field if present and otherwise leave blank. */

function visaTypeOf(raw: Record<string, unknown>): string {
  if (typeof raw.visaType === "string" && raw.visaType.trim()) return raw.visaType.trim();
  if (typeof raw.visa === "string" && raw.visa.trim()) return raw.visa.trim();
  return "—";
}

/**
 * Read every uploaded document URL. Employees can attach multiple photos
 * per section (plural `*Urls` arrays); older docs may only carry the
 * legacy singular `*Url` string, so fall back to it when the array is
 * missing.
 */
function collectDocuments(raw: Record<string, unknown>): { label: string; url: string }[] {
  const docs = (raw.documents ?? {}) as Record<string, unknown>;
  const known: { singular: string; plural: string; label: string }[] = [
    { singular: "passportUrl", plural: "passportUrls", label: "Passport" },
    { singular: "visaUrl",     plural: "visaUrls",     label: "Visa" },
    { singular: "rsaUrl",      plural: "rsaUrls",      label: "RSA Certificate" },
  ];
  const out: { label: string; url: string }[] = [];
  for (const { singular, plural, label } of known) {
    const arr = docs[plural];
    if (Array.isArray(arr) && arr.length > 0) {
      arr.forEach((v, i) => {
        if (typeof v === "string" && v) {
          out.push({ label: arr.length > 1 ? `${label} (${i + 1})` : label, url: v });
        }
      });
      continue;
    }
    const v = docs[singular];
    if (typeof v === "string" && v) out.push({ label, url: v });
  }
  return out;
}

export default function EmployeeDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwner(user) || isChef(user);

  const [staff, setStaff] = useState<Staff | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [hrNotes, setHrNotes] = useState<HrNote[]>([]);
  const [notice, setNotice] = useState<ActiveNotice | null>(null);
  const [cancellingNotice, setCancellingNotice] = useState(false);
  const [openDoc, setOpenDoc] = useState<DocKey | null>(null);
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [terminating, setTerminating] = useState(false);
  const [termDetailsOpen, setTermDetailsOpen] = useState(false);
  const [employmentEditing, setEmploymentEditing] = useState(false);
  const [savingEmployment, setSavingEmployment] = useState(false);
  const [editRehireDate, setEditRehireDate] = useState("");
  const [editPosition, setEditPosition] = useState("");
  const [editVisaType, setEditVisaType] = useState("");
  const [editWorkLocation, setEditWorkLocation] = useState("");
  const [editEmploymentType, setEditEmploymentType] = useState("");
  const [editRate, setEditRate] = useState("");
  const [editReportsTo, setEditReportsTo] = useState("");
  const [editingRateKind, setEditingRateKind] = useState<RateKind | null>(null);
  const [rateDraft, setRateDraft] = useState("");
  const [savingRate, setSavingRate] = useState(false);
  const [calRehireOpen, setCalRehireOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [allowed, authLoading, router]);

  useEffect(() => {
    if (!allowed) return;
    const id = params?.id;
    if (!id) return;
    let cancelled = false;

    (async () => {
      try {
        const snap = await getDoc(doc(getDb(), "staff_onboarding", id));
        if (!snap.exists()) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const raw = snap.data() as Record<string, unknown>;
        if (String(raw.status ?? "").toLowerCase() === "terminated") {
          router.replace(`/people/terminated/${id}`);
          return;
        }

        const prevRaw = (raw.previousTermination ?? null) as Record<string, unknown> | null;
        const previousTermination = prevRaw
          ? {
              lastWorkingDate: String(prevRaw.lastWorkingDate ?? ""),
              noticeGivenDate: String(prevRaw.noticeGivenDate ?? ""),
              terminationReason: String(prevRaw.terminationReason ?? ""),
              terminatedByName: String(prevRaw.terminatedByName ?? ""),
              terminatedAt: String(prevRaw.terminatedAt ?? ""),
            }
          : null;
        const rehireDate = typeof raw.rehireDate === "string" ? raw.rehireDate : "";
        const reactivatedAt = tsToDate(raw.reactivatedAt);
        const isReactivated = !!rehireDate || !!reactivatedAt;

        const rates = readStaffRates(raw);

        const policies = (raw.policies ?? {}) as Record<string, unknown>;
        const bank = (raw.bankSuper ?? {}) as BankSuper;
        const documents = (raw.documents ?? {}) as Record<string, unknown>;
        // TFN declaration nests the actual TFN + signature under `tfn` —
        // the top-level field only exists on very old rows, so fall back
        // to it for completeness.
        const tfnBlock = (raw.tfn ?? {}) as Record<string, unknown>;
        const tfnValue =
          (typeof tfnBlock.taxFileNumber === "string" ? tfnBlock.taxFileNumber : "") ||
          (typeof raw.taxFileNumber === "string" ? raw.taxFileNumber : "");
        const signatureDataUrl =
          typeof tfnBlock.signatureDataUrl === "string" ? tfnBlock.signatureDataUrl : "";

        const built: Staff = {
          uid: snap.id,
          name: fullNameOf(raw),
          positionLabel: positionLabelOf(raw),
          weekdayRate: rates.weekday,
          saturdayRate: rates.saturday,
          startDate: tsToDate(raw.startDate),
          visaExpiry: tsToDate(documents.visaExpiry ?? raw.visaExpiry ?? null),
          visaType: visaTypeOf(raw),
          phone: typeof raw.mobileNumber === "string" ? raw.mobileNumber : "",
          completedStep: typeof raw.completedStep === "number" ? raw.completedStep : null,
          personal: {
            firstName: strField(raw, "firstName"),
            lastName: strField(raw, "lastName"),
            preferredName: strField(raw, "preferredName"),
            dateOfBirth: strField(raw, "dateOfBirth"),
            gender: strField(raw, "gender"),
            email: strField(raw, "email"),
          },
          taxFileNumber: tfnValue,
          signatureDataUrl,
          bank,
          handbookSignedAt: tsToDate(policies.handbookSignedAt),
          agreementSignedAt: tsToDate(policies.agreementSignedAt),
          privacySignedAt: tsToDate(policies.privacySignedAt),
          documents: collectDocuments(raw),
          isReactivated,
          rehireDate,
          reactivatedAt,
          employmentType: strField(raw, "employmentType"),
          workLocation: workLocationOf(raw),
          reportsTo: reportsToOf(raw),
          previousTermination,
        };

        if (!cancelled) setStaff(built);

        // Notice given — one active row per employee (they only appear on
        // Active while the notice is open, so we take the most recent).
        try {
          const noticeSnap = await getDocs(
            query(collection(getDb(), "notice_given"), where("employeeUid", "==", id)),
          );
          const notices = noticeSnap.docs
            .map((d) => {
              const data = d.data() as Record<string, unknown>;
              // The form calls the field "Final Shift Date" and persists it
              // as `finalShiftDate` — that's the real "last working day"
              // for the countdown. Older rows may only carry the legacy
              // `lastWorkingDay` string, so fall back to it if needed.
              const finalShift = typeof data.finalShiftDate === "string" ? data.finalShiftDate : "";
              const legacyLast = typeof data.lastWorkingDay === "string" ? data.lastWorkingDay : "";
              const lastDay = noticeLastWorkingDay({ finalShiftDate: finalShift, lastWorkingDay: legacyLast });
              return {
                id: d.id,
                noticeGivenDate: typeof data.noticeGivenDate === "string" ? data.noticeGivenDate : "",
                lastWorkingDay: lastDay,
                reasonForLeaving: typeof data.reasonForLeaving === "string" ? data.reasonForLeaving : "",
                reasonForLeavingOther: typeof data.reasonForLeavingOther === "string" ? data.reasonForLeavingOther : "",
                rehireEligible: typeof data.rehireEligible === "string" ? data.rehireEligible : "",
                managerNotes: typeof data.managerNotes === "string" ? data.managerNotes : "",
              } satisfies ActiveNotice;
            })
            // Newest first — the most recent notice is authoritative.
            .sort((a, b) => (b.noticeGivenDate || "").localeCompare(a.noticeGivenDate || ""));
          if (!cancelled) setNotice(notices[0] ?? null);
        } catch {
          /* leave notice null */
        }

        // HR notes are stored top-level, keyed by employeeUid.
        try {
          const notesSnap = await getDocs(
            query(collection(getDb(), "hr_notes"), where("employeeUid", "==", id)),
          );
          const notes: HrNote[] = notesSnap.docs.map((d) => {
            const data = d.data() as StoredHrNote;
            const fields = data.fields ?? {};
            const body = fields.summary ?? fields.details ?? fields.note ?? Object.values(fields).join(" · ");
            return {
              id: d.id,
              kind: data.kind ?? "Note",
              category: data.category ?? "",
              date: data.date ?? "",
              body: body ?? "",
              addedBy: data.addedByName ?? "",
            };
          });
          notes.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
          if (!cancelled) setHrNotes(notes);
        } catch {
          /* leave notes empty */
        }
      } catch {
        if (!cancelled) setNotFound(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allowed, params?.id]);

  useEffect(() => {
    if (!openDoc) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [openDoc]);

  useEffect(() => {
    if (!openDoc) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenDoc(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDoc]);

  const visaDays = useMemo(() => daysFromToday(staff?.visaExpiry ?? null), [staff]);
  const noticeDaysRemaining = useMemo(
    () => (notice ? noticeDaysFromToday(notice.lastWorkingDay) : null),
    [notice],
  );
  const readyToTerminate = useMemo(
    () => (notice ? isReadyToTerminate(notice.lastWorkingDay) : false),
    [notice],
  );

  async function handleConfirmTermination(lastDayISO: string) {
    if (!staff || terminating) return;
    setTerminating(true);
    try {
      // 1) Flip the staff doc into a terminated state so it drops off
      //    the active roster and lands on /people/terminated.
      const reasonBase = notice?.reasonForLeaving ?? "";
      const reasonOther = notice?.reasonForLeavingOther ?? "";
      const reasonDisplay =
        reasonBase === "Other" && reasonOther.trim()
          ? `Other — ${reasonOther.trim()}`
          : reasonBase;
      const terminatedByName =
        user?.displayName?.trim() ||
        (user?.email ? user.email.split("@")[0] : "Owner");

      await setDoc(
        doc(getDb(), "staff_onboarding", staff.uid),
        {
          status: "terminated",
          terminatedAt: serverTimestamp(),
          lastWorkingDate: lastDayISO,
          reasonForLeaving: reasonBase,
          reasonForLeavingOther: reasonBase === "Other" ? reasonOther.trim() : "",
          terminationReason: reasonDisplay,
          noticeGivenDate: notice?.noticeGivenDate ?? "",
          rehireEligible: notice?.rehireEligible ?? "",
          terminationManagerNotes: notice?.managerNotes ?? "",
          terminatedByName,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      // 2) Any open notice_given rows belong to the pre-termination
      //    flow — sweep them so the terminated list isn't cluttered
      //    with countdowns that no longer apply.
      const noticeSnap = await getDocs(
        query(collection(getDb(), "notice_given"), where("employeeUid", "==", staff.uid)),
      );
      if (!noticeSnap.empty) {
        const batch = writeBatch(getDb());
        noticeSnap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      setTerminateOpen(false);
      router.push("/people/active");
    } catch (err) {
      console.error("[terminate] failed:", err);
      alert("Failed to terminate. Please try again.");
      setTerminating(false);
    }
  }

  /**
   * Send one section back to the employee: roll `completedStep` to just
   * before it so they land on that screen again, and drop the answers it
   * holds so the section reads as unsubmitted here too.
   */
  async function handleReject(section: (typeof ONBOARDING_SECTIONS)[number]) {
    if (!staff) return;
    const ok = window.confirm(
      `Reject "${section.label}"?\n\nThe employee will have to complete this section again.`,
    );
    if (!ok) return;
    const prevStep = section.step - 1;
    try {
      const update: Record<string, unknown> = {
        completedStep: prevStep,
        step: section.step,
        status: "in_progress",
        updatedAt: serverTimestamp(),
      };
      for (const path of section.clearPaths) update[path] = deleteField();
      await updateDoc(doc(getDb(), "staff_onboarding", staff.uid), update);
      setOpenDoc(null);
      // Mirror the write locally so the row flips to Pending without a
      // reload. Only the fields clearPaths actually removed — Personal
      // Information clears nothing, so its row keeps its data and the
      // rollback is the whole effect.
      setStaff((s) => {
        if (!s) return s;
        const next = { ...s, completedStep: prevStep };
        if (section.key === "tfn") next.taxFileNumber = "";
        if (section.key === "bank") next.bank = {};
        if (section.key === "documents") next.documents = [];
        if (section.key === "policies") {
          next.handbookSignedAt = null;
          next.privacySignedAt = null;
          next.agreementSignedAt = null;
        }
        return next;
      });
    } catch (err) {
      console.error("[reject] failed:", err);
      alert("Failed to reject. Please try again.");
    }
  }

  async function handleDeleteEmployee() {
    if (!staff || deleting) return;
    setMenuOpen(false);
    const ok = window.confirm(
      `Delete ${staff.name}'s record?\n\nThis is a hard delete — the employee's onboarding data, HR notes and any open notice will be permanently removed. Use this only for mistakes; use "Terminate" for real departures.`,
    );
    if (!ok) return;
    setDeleting(true);
    try {
      const db = getDb();
      // Sweep any related rows keyed on the employee's uid so we don't
      // leave dangling notice_given / hr_notes docs behind.
      const [noticeSnap, hrSnap] = await Promise.all([
        getDocs(query(collection(db, "notice_given"), where("employeeUid", "==", staff.uid))),
        getDocs(query(collection(db, "hr_notes"), where("employeeUid", "==", staff.uid))),
      ]);
      if (!noticeSnap.empty || !hrSnap.empty) {
        const batch = writeBatch(db);
        noticeSnap.docs.forEach((d) => batch.delete(d.ref));
        hrSnap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      await deleteDoc(doc(db, "staff_onboarding", staff.uid));
      router.push("/people/active");
    } catch (err) {
      console.error("[delete-employee] failed:", err);
      alert("Failed to delete. Please try again.");
      setDeleting(false);
    }
  }

  function startRateEdit(kind: RateKind) {
    if (!staff) return;
    const current = kind === "weekday" ? staff.weekdayRate : staff.saturdayRate;
    setRateDraft(current != null ? String(current) : "");
    setEditingRateKind(kind);
  }

  async function handleSaveRate(kind: RateKind) {
    if (!staff || savingRate) return;
    const parsed = parseFloat(rateDraft);
    if (Number.isNaN(parsed) || parsed <= 0) {
      alert("Please enter a valid hourly rate.");
      return;
    }
    const value = Math.round(parsed * 100) / 100;
    setSavingRate(true);
    try {
      await setDoc(
        doc(getDb(), "staff_onboarding", staff.uid),
        { [RATE_FIELDS[kind]]: value, updatedAt: serverTimestamp() },
        { merge: true },
      );
      setStaff({
        ...staff,
        ...(kind === "weekday" ? { weekdayRate: value } : { saturdayRate: value }),
      });
      setEditingRateKind(null);
    } catch (err) {
      console.error("[rate] save failed:", err);
      alert("Failed to save the rate. Please try again.");
    } finally {
      setSavingRate(false);
    }
  }

  function startEmploymentEdit() {
    if (!staff) return;
    setEditRehireDate(staff.rehireDate || todayIso());
    setEditPosition(
      EMPLOYMENT_POSITIONS.includes(staff.positionLabel as (typeof EMPLOYMENT_POSITIONS)[number])
        ? staff.positionLabel
        : EMPLOYMENT_POSITIONS[0],
    );
    setEditVisaType(
      EMPLOYMENT_VISA_TYPES.includes(staff.visaType as (typeof EMPLOYMENT_VISA_TYPES)[number])
        ? staff.visaType
        : EMPLOYMENT_VISA_TYPES[0],
    );
    setEditWorkLocation(
      WORK_LOCATIONS.includes(staff.workLocation as (typeof WORK_LOCATIONS)[number])
        ? staff.workLocation
        : WORK_LOCATIONS[0],
    );
    setEditEmploymentType(
      EMPLOYMENT_TYPES.includes(staff.employmentType as (typeof EMPLOYMENT_TYPES)[number])
        ? staff.employmentType
        : EMPLOYMENT_TYPES[0],
    );
    setEditRate(staff.weekdayRate != null ? String(staff.weekdayRate) : "");
    setEditReportsTo(staff.reportsTo || "");
    setEmploymentEditing(true);
  }

  async function handleSaveEmployment() {
    if (!staff || savingEmployment) return;
    const parsedRate = parseFloat(editRate);
    if (Number.isNaN(parsedRate) || parsedRate <= 0) {
      alert("Please enter a valid rate.");
      return;
    }
    setSavingEmployment(true);
    try {
      await setDoc(
        doc(getDb(), "staff_onboarding", staff.uid),
        {
          rehireDate: editRehireDate,
          position: editPosition,
          visaType: editVisaType,
          workLocation: editWorkLocation,
          employmentType: editEmploymentType,
          // Same field the RATE card writes — otherwise editing here would
          // leave the timesheets still paying the old rate.
          weekdayRate: parsedRate,
          afterTrainingRate: parsedRate,
          trainingRate: parsedRate,
          reportsTo: editReportsTo.trim(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setStaff({
        ...staff,
        rehireDate: editRehireDate,
        positionLabel: editPosition,
        visaType: editVisaType,
        workLocation: editWorkLocation,
        employmentType: editEmploymentType,
        weekdayRate: parsedRate,
        reportsTo: editReportsTo.trim(),
      });
      setEmploymentEditing(false);
    } catch (err) {
      console.error("[employment] save failed:", err);
      alert("Failed to save employment details.");
    } finally {
      setSavingEmployment(false);
    }
  }

  async function handleCancelNotice() {
    if (!notice || cancellingNotice) return;
    const ok = window.confirm(
      "Cancel this notice? The employee will move back to Active status.",
    );
    if (!ok) return;
    setCancellingNotice(true);
    try {
      await deleteDoc(doc(getDb(), "notice_given", notice.id));
      setNotice(null);
    } catch (err) {
      console.error("[notice-given] cancel failed:", err);
      alert("Failed to cancel notice. Please try again.");
    } finally {
      setCancellingNotice(false);
    }
  }

  if (authLoading || !allowed) return <Splash />;

  if (notFound) {
    return (
      <div className={styles.page}>
        <TopBar onBack={() => router.back()} />
        <p className={styles.notFound}>This employee record no longer exists.</p>
      </div>
    );
  }

  if (!staff) return <Splash label="Loading…" />;

  const visaWarn = visaDays !== null && visaDays >= 0 && visaDays <= VISA_WINDOW_DAYS;
  const hasNotice = notice !== null;
  const reasonDisplay =
    notice?.reasonForLeaving === "Other" && notice.reasonForLeavingOther
      ? `Other — ${notice.reasonForLeavingOther}`
      : notice?.reasonForLeaving || "—";

  const reactivatedOnDisplay = staff.reactivatedAt
    ? fmtDateWithDay(
        `${staff.reactivatedAt.getFullYear()}-${String(staff.reactivatedAt.getMonth() + 1).padStart(2, "0")}-${String(staff.reactivatedAt.getDate()).padStart(2, "0")}`,
      )
    : fmtDateWithDay(staff.rehireDate);
  const prevTerm = staff.previousTermination;
  const prevTerminatedDisplay = prevTerm?.terminatedAt
    ? fmtDateWithDay(prevTerm.terminatedAt)
    : "—";

  // Drives the pay shown on /payroll/timesheets for this employee.
  const rateCard = (
    <>
      <p className={styles.sectionLabel}>RATE</p>
      <section className={styles.rateCard}>
        <RateRow
          label="Weekdays (Sun – Fri)"
          value={staff.weekdayRate}
          editing={editingRateKind === "weekday"}
          draft={rateDraft}
          saving={savingRate}
          onDraft={setRateDraft}
          onEdit={() => startRateEdit("weekday")}
          onSave={() => void handleSaveRate("weekday")}
          onCancel={() => setEditingRateKind(null)}
        />
        <div className={styles.rateDivider} aria-hidden="true" />
        <RateRow
          label="Saturday"
          value={staff.saturdayRate}
          editing={editingRateKind === "saturday"}
          draft={rateDraft}
          saving={savingRate}
          onDraft={setRateDraft}
          onEdit={() => startRateEdit("saturday")}
          onSave={() => void handleSaveRate("saturday")}
          onCancel={() => setEditingRateKind(null)}
        />
        <p className={styles.rateFootnote}>
          <InfoCircleIcon />
          Rates are applied before penalties and allowances.
        </p>
      </section>
    </>
  );

  return (
    <div className={styles.page}>
      <TopBar
        onBack={() => router.back()}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((v) => !v)}
        onDelete={handleDeleteEmployee}
        deleting={deleting}
      />

      {staff.isReactivated ? (
        <>
          <section className={styles.profileCard}>
            <div className={`${styles.profileTop} ${styles.profileTopReactivated}`}>
              <div className={styles.avatarWrap} aria-hidden="true">
                <div className={styles.avatar}>{initialsOf(staff.name)}</div>
                <span className={`${styles.avatarDot} ${styles.avatarDotNotice}`} />
              </div>
              <div className={styles.profileMain}>
                <h2 className={styles.profileName}>{staff.name}</h2>
                <p className={styles.profilePos}>{staff.positionLabel}</p>
                <span className={styles.activePill}>Active</span>
              </div>
              <div className={styles.reactivatedOn}>
                <p className={styles.reactivatedOnLabel}>Reactivated on</p>
                <p className={styles.reactivatedOnDate}>{reactivatedOnDisplay}</p>
              </div>
            </div>
          </section>

          {rateCard}

          {staff.phone && (
            <button
              type="button"
              className={styles.linkRow}
              onClick={() => window.open(`tel:${staff.phone.replace(/\s/g, "")}`, "_self")}
            >
              <span className={styles.linkRowIcon} aria-hidden="true"><PhoneIcon /></span>
              <span className={styles.linkRowLabel}>Phone</span>
              <span className={styles.linkRowValue}>{staff.phone}</span>
              <span className={styles.chev} aria-hidden="true">›</span>
            </button>
          )}

          <p className={styles.sectionLabel}>EMPLOYMENT INFORMATION</p>
          <section className={styles.employmentCard}>
            {employmentEditing ? (
              <>
                <EmploymentEditRow label="Rehire Date">
                  <button
                    type="button"
                    className={styles.employmentDateBtn}
                    onClick={() => setCalRehireOpen(true)}
                  >
                    <CalendarMiniIcon />
                    {fmtDateWithDay(editRehireDate)}
                  </button>
                </EmploymentEditRow>
                <EmploymentEditRow label="Position">
                  <select
                    className={styles.employmentSelect}
                    value={editPosition}
                    onChange={(e) => setEditPosition(e.target.value)}
                  >
                    {EMPLOYMENT_POSITIONS.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </EmploymentEditRow>
                <EmploymentEditRow label="Visa Type">
                  <select
                    className={styles.employmentSelect}
                    value={editVisaType}
                    onChange={(e) => setEditVisaType(e.target.value)}
                  >
                    {EMPLOYMENT_VISA_TYPES.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </EmploymentEditRow>
                <EmploymentEditRow label="Work Location">
                  <select
                    className={styles.employmentSelect}
                    value={editWorkLocation}
                    onChange={(e) => setEditWorkLocation(e.target.value)}
                  >
                    {WORK_LOCATIONS.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </EmploymentEditRow>
                <EmploymentEditRow label="Employment Type">
                  <select
                    className={styles.employmentSelect}
                    value={editEmploymentType}
                    onChange={(e) => setEditEmploymentType(e.target.value)}
                  >
                    {EMPLOYMENT_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </EmploymentEditRow>
                <EmploymentEditRow label="Rate">
                  <div className={styles.employmentRateRow}>
                    <input
                      type="number"
                      className={styles.employmentInput}
                      value={editRate}
                      onChange={(e) => setEditRate(e.target.value)}
                      min="0"
                      step="0.01"
                    />
                    <span className={styles.employmentRateSuffix}>per hour</span>
                  </div>
                </EmploymentEditRow>
                <EmploymentEditRow label="Reports To" last>
                  <input
                    type="text"
                    className={styles.employmentInput}
                    value={editReportsTo}
                    onChange={(e) => setEditReportsTo(e.target.value)}
                    placeholder="Manager name"
                  />
                </EmploymentEditRow>
                <div className={styles.employmentEditActions}>
                  <button
                    type="button"
                    className={styles.employmentCancelBtn}
                    onClick={() => setEmploymentEditing(false)}
                    disabled={savingEmployment}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.employmentSaveBtn}
                    onClick={handleSaveEmployment}
                    disabled={savingEmployment}
                  >
                    {savingEmployment ? "Saving…" : "Save"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <EmploymentRow label="Rehire Date" value={fmtDateWithDay(staff.rehireDate)} accent />
                <EmploymentRow label="Position" value={displayOrDash(staff.positionLabel)} />
                <EmploymentRow label="Visa Type" value={displayOrDash(staff.visaType)} />
                <EmploymentRow label="Work Location" value={displayOrDash(staff.workLocation)} />
                <EmploymentRow label="Employment Type" value={displayOrDash(staff.employmentType)} />
                <EmploymentRow
                  label="Rate"
                  value={
                    typeof staff.weekdayRate === "number"
                      ? `$${staff.weekdayRate.toFixed(2)} /hr`
                      : "—"
                  }
                />
                <EmploymentRow
                  label="Reports To"
                  value={staff.reportsTo ? `${staff.reportsTo} ›` : "—"}
                  last
                />
                <button type="button" className={styles.editEmploymentBtn} onClick={startEmploymentEdit}>
                  <EditIcon />
                  Edit Employment Details
                </button>
              </>
            )}
          </section>

          <section className={styles.reactivationAlert}>
            <span className={styles.reactivationAlertIcon} aria-hidden="true"><RefreshIcon /></span>
            <div>
              <p className={styles.reactivationAlertTitle}>
                This employee was reactivated. Previously terminated on {prevTerminatedDisplay}.
              </p>
              <p className={styles.reactivationAlertSub}>
                Rehire Date <span className={styles.reactivationAlertDate}>{fmtDateWithDay(staff.rehireDate)}</span>
              </p>
            </div>
            <span className={styles.activePill}>Active</span>
          </section>

          {prevTerm && (
            <>
              <p className={styles.sectionLabel}>TERMINATION SUMMARY (PREVIOUS)</p>
              <section className={styles.terminationPrevCard}>
                <EmploymentRow label="Last Working Day" value={fmtDateWithDay(prevTerm.lastWorkingDate)} />
                <EmploymentRow label="Reason for Leaving" value={prevTerm.terminationReason || "—"} />
                <EmploymentRow label="Terminated By" value={prevTerm.terminatedByName || "—"} />
                <button
                  type="button"
                  className={styles.terminationPrevToggle}
                  onClick={() => setTermDetailsOpen((v) => !v)}
                >
                  View Termination Details
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`${styles.toggleArrow} ${termDetailsOpen ? styles.toggleArrowOpen : ""}`}
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {termDetailsOpen && (
                  <>
                    <EmploymentRow label="Notice Given Date" value={fmtDateWithDay(prevTerm.noticeGivenDate)} />
                    <EmploymentRow label="Termination Date" value={prevTerminatedDisplay} accent last />
                  </>
                )}
              </section>
            </>
          )}
        </>
      ) : (
        <>
      {/* Profile card — orange notice-mode variant when the employee has
          an active notice_given row. */}
      <section className={`${styles.profileCard} ${hasNotice ? styles.profileCardNotice : ""}`}>
        <div className={styles.profileTop}>
          <div className={styles.avatarWrap} aria-hidden="true">
            <div className={styles.avatar}>{initialsOf(staff.name)}</div>
            <span className={`${styles.avatarDot} ${hasNotice ? styles.avatarDotNotice : ""}`} />
          </div>
          <div className={styles.profileMain}>
            <h2 className={styles.profileName}>{staff.name}</h2>
            <p className={styles.profilePos}>{staff.positionLabel}</p>
            {hasNotice ? (
              readyToTerminate ? (
                <span className={styles.readyPill}>Ready to Terminate</span>
              ) : (
                <span className={styles.noticePill}>Notice Given</span>
              )
            ) : (
              <span className={styles.activePill}>Active</span>
            )}
          </div>
          {hasNotice && noticeDaysRemaining !== null && noticeDaysRemaining >= 0 && (
            <div className={styles.noticeCountdown} aria-label="Days remaining">
              <span className={styles.noticeCountdownIcon} aria-hidden="true"><ClockIcon /></span>
              <div className={styles.noticeCountdownText}>
                <p className={styles.noticeCountdownDays}>{noticeDaysRemaining} days</p>
                <p className={styles.noticeCountdownSub}>remaining</p>
              </div>
            </div>
          )}
        </div>

        {hasNotice && notice && (
          <>
            <div className={styles.profileDivider} aria-hidden="true" />
            <div className={styles.noticeDateGrid}>
              <div className={styles.noticeDateCol}>
                <span className={styles.noticeDateIcon} aria-hidden="true"><CalendarMiniIcon /></span>
                <div>
                  <p className={styles.noticeDateLabel}>LAST WORKING DAY</p>
                  <p className={styles.noticeDateValue}>{fmtDateWithDay(notice.lastWorkingDay)}</p>
                </div>
              </div>
              <div className={styles.noticeDateDivider} aria-hidden="true" />
              <div className={styles.noticeDateCol}>
                <div>
                  <p className={styles.noticeDateLabel}>NOTICE GIVEN DATE</p>
                  <p className={styles.noticeDateValueMuted}>{fmtDateWithDay(notice.noticeGivenDate)}</p>
                </div>
              </div>
            </div>
          </>
        )}

        <div className={styles.profileDivider} aria-hidden="true" />
        <div className={styles.profileStats}>
          <StatCell label="Start Date" value={fmtDate(staff.startDate)} />
          <StatCell label="Visa Type" value={staff.visaType} />
          <StatCell
            label="Visa Expiry"
            value={visaWarn ? `${visaDays} days` : fmtDate(staff.visaExpiry)}
            valueSub={visaWarn ? fmtDate(staff.visaExpiry) : undefined}
            accent={visaWarn}
            warn={visaWarn}
          />
        </div>
      </section>

      {rateCard}

      {/* Phone row */}
      {staff.phone && (
        <button
          type="button"
          className={styles.linkRow}
          onClick={() => window.open(`tel:${staff.phone.replace(/\s/g, "")}`, "_self")}
        >
          <span className={styles.linkRowIcon} aria-hidden="true"><PhoneIcon /></span>
          <span className={styles.linkRowLabel}>Phone</span>
          <span className={styles.linkRowValue}>{staff.phone}</span>
          <span className={styles.chev} aria-hidden="true">›</span>
        </button>
      )}

      {/* Notice information — only when the employee is under notice. */}
      {hasNotice && notice && (
        <>
          <p className={styles.sectionLabel}>NOTICE INFORMATION</p>
          <section className={styles.noticeInfoCard}>
            <InfoRow label="Notice Given Date" value={fmtDateWithDay(notice.noticeGivenDate)} />
            <InfoRow label="Last Working Day" value={fmtDateWithDay(notice.lastWorkingDay)} accent />
            <InfoRow label="Reason for Leaving" value={reasonDisplay} />
            <InfoRow label="Rehire Eligible" value={notice.rehireEligible || "—"} />
            <InfoRow label="Manager Notes" value={notice.managerNotes || "—"} last />
          </section>
        </>
      )}
        </>
      )}

      {/* Onboarding documents — the five sections of the employee's own
          onboarding form, each either waiting on them or ready to review.
          "Active Employees" includes people still part-way through, so the
          per-section state is the point of this card rather than decoration. */}
      <p className={styles.sectionLabel}>ONBOARDING DOCUMENTS</p>
      <section className={styles.docsCard}>
        {ONBOARDING_SECTIONS.map((section, i) => {
          const submitted = isSectionSubmitted(section, staff);
          return (
            <DocRow
              key={section.key}
              // The picture the employee met this step under, rather than a
              // filing-cabinet icon repeated five times: the rows are read by
              // someone checking off sections, and five identical icons make
              // the list something to read word by word instead of scan.
              icon={ONBOARDING_STEP_ICONS[section.step]}
              label={section.label}
              submitted={submitted}
              onClick={submitted ? () => setOpenDoc(section.key) : undefined}
              onReject={submitted ? () => handleReject(section) : undefined}
              last={i === ONBOARDING_SECTIONS.length - 1}
            />
          );
        })}
      </section>

      {/* HR notes are not an onboarding document, so they sit outside that
          card rather than under a heading that would misdescribe them. Kept
          because this is the one place the notes come pre-filtered to the
          employee whose page you are already on. */}
      <p className={styles.sectionLabel}>HR RECORDS</p>
      <section className={styles.docsCard}>
        <DocRow
          icon={<DocIcon />}
          label="HR Notes"
          submitted
          onClick={() =>
            router.push(`/people/hr-notes?search=${encodeURIComponent(staff.name)}`)
          }
          last
        />
      </section>

      {/* Change status */}
      <p className={styles.sectionLabel}>CHANGE STATUS</p>
      {staff.isReactivated ? (
        <div className={styles.statusGridSingle}>
          <button
            type="button"
            className={styles.statusCard}
            onClick={() => setTerminateOpen(true)}
          >
            <StopIcon />
            <span className={styles.statusLabel}>Terminated</span>
          </button>
        </div>
      ) : (
      <div className={hasNotice ? styles.statusGrid : styles.statusGridSingle}>
        {hasNotice ? (
          <>
            <button
              type="button"
              className={styles.statusCard}
              onClick={handleCancelNotice}
              disabled={cancellingNotice}
            >
              <EditIcon />
              <span className={styles.statusLabel}>
                {cancellingNotice ? "Cancelling…" : "Cancel Notice"}
              </span>
            </button>
            <button
              type="button"
              className={styles.statusCard}
              onClick={() => setTerminateOpen(true)}
            >
              <StopIcon />
              <span className={styles.statusLabel}>Terminate Employee</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            className={styles.statusCard}
            onClick={() => setTerminateOpen(true)}
          >
            <StopIcon />
            <span className={styles.statusLabel}>Terminated</span>
          </button>
        )}
      </div>
      )}

      {openDoc && (
        <DocModal
          docKey={openDoc}
          staff={staff}
          hrNotes={hrNotes}
          onClose={() => setOpenDoc(null)}
        />
      )}

      {terminateOpen && (
        <TerminateModal
          staff={staff}
          defaultDate={notice?.lastWorkingDay || ""}
          submitting={terminating}
          onClose={() => (terminating ? undefined : setTerminateOpen(false))}
          onConfirm={handleConfirmTermination}
        />
      )}

      {calRehireOpen && (
        <CalendarPicker
          value={editRehireDate}
          maxDate="2030-12-31"
          singleOnly
          onChange={setEditRehireDate}
          onRangeChange={() => {}}
          onClose={() => setCalRehireOpen(false)}
        />
      )}
    </div>
  );
}

/* ── Subcomponents ── */

function TopBar({
  onBack,
  menuOpen,
  onToggleMenu,
  onDelete,
  deleting,
}: {
  onBack: () => void;
  menuOpen?: boolean;
  onToggleMenu?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const hasMenu = Boolean(onToggleMenu && onDelete);
  return (
    <div className={styles.topBar}>
      <button type="button" className={styles.iconBtn} onClick={onBack} aria-label="Back">
        <ChevronLeft />
      </button>
      <h1 className={styles.topTitle}>Employee Details</h1>
      <div className={styles.topMoreWrap}>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label="More"
          aria-haspopup={hasMenu ? "menu" : undefined}
          aria-expanded={hasMenu ? menuOpen : undefined}
          onClick={hasMenu ? onToggleMenu : undefined}
        >
          <DotsIcon />
        </button>
        {hasMenu && menuOpen && (
          <>
            <button
              type="button"
              className={styles.topMenuBackdrop}
              aria-label="Close menu"
              onClick={onToggleMenu}
            />
            <div className={styles.topMenu} role="menu">
              <button
                type="button"
                role="menuitem"
                className={styles.topMenuItemDanger}
                onClick={onDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete employee"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  valueSub,
  accent = false,
  warn = false,
}: {
  label: string;
  value: string;
  valueSub?: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div className={styles.statCell}>
      <p className={styles.statLabel}>{label}</p>
      <p className={`${styles.statValue} ${accent ? styles.statValueAccent : ""}`}>
        {value}
        {warn && <span className={styles.warnDot} aria-hidden="true">!</span>}
      </p>
      {valueSub && <p className={styles.statValueSub}>{valueSub}</p>}
    </div>
  );
}

/**
 * One row of the onboarding card.
 *
 * A submitted section gets the pair of actions — View to read what was sent,
 * Reject to send it back. One that hasn't arrived yet gets the word Pending
 * and nothing to press: there is no document to open and nothing to reject,
 * and a live-looking button that did neither would only invite the tap.
 */
function DocRow({
  icon,
  label,
  submitted,
  onClick,
  onReject,
  last = false,
}: {
  icon: React.ReactNode;
  label: string;
  submitted: boolean;
  onClick?: () => void;
  onReject?: () => void;
  last?: boolean;
}) {
  const interactive = submitted && Boolean(onClick);
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={`${styles.docRow} ${last ? styles.docRowLast : ""} ${
        submitted ? "" : styles.docRowPending
      }`}
    >
      <span className={styles.docRowIcon} aria-hidden="true">{icon}</span>
      <span className={styles.docRowLabel}>{label}</span>
      <span className={styles.docRowActions}>
        {submitted ? (
          <>
            <span className={styles.docRowView}>View</span>
            {onReject && (
              <button
                type="button"
                className={styles.docRowReject}
                onClick={(e) => {
                  e.stopPropagation();
                  onReject();
                }}
              >
                Reject
              </button>
            )}
          </>
        ) : (
          <span className={styles.docRowPendingLabel}>Pending</span>
        )}
      </span>
    </div>
  );
}

function DocModal({
  docKey,
  staff,
  hrNotes,
  onClose,
}: {
  docKey: DocKey;
  staff: Staff;
  hrNotes: HrNote[];
  onClose: () => void;
}) {
  const { title, body } = renderModalBody(docKey, staff, hrNotes);
  return (
    <div
      className={styles.modalBackdrop}
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{title}</h3>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className={styles.modalBody}>{body}</div>
      </div>
    </div>
  );
}

function renderModalBody(
  docKey: DocKey,
  staff: Staff,
  hrNotes: HrNote[],
): { title: string; body: React.ReactNode } {
  switch (docKey) {
    case "personal":
      return {
        title: "Personal Information",
        body: (
          <dl className={styles.modalDefs}>
            <DefRow label="Legal First Name" value={staff.personal.firstName} />
            <DefRow label="Legal Last Name" value={staff.personal.lastName} />
            <DefRow label="Preferred Name" value={staff.personal.preferredName} />
            <DefRow label="Date of Birth" value={fmtDobDisplay(staff.personal.dateOfBirth)} />
            <DefRow label="Gender" value={staff.personal.gender} />
            <DefRow label="Mobile Number" value={staff.phone} />
            <DefRow label="Email" value={staff.personal.email} />
          </dl>
        ),
      };
    case "documents":
      return {
        title: "Documents (Photo ID, Visa, RSA)",
        body:
          staff.documents.length === 0 ? (
            <p className={styles.modalHint}>No documents uploaded yet.</p>
          ) : (
            <ul className={styles.modalList}>
              {staff.documents.map((d) => (
                <li key={d.url} className={styles.modalListRow}>
                  <span className={styles.modalListName}>{d.label}</span>
                  <a
                    className={styles.modalListLink}
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open ↗
                  </a>
                </li>
              ))}
            </ul>
          ),
      };
    case "tfn":
      return {
        title: "Tax File Number",
        body: (
          <>
            <dl className={styles.modalDefs}>
              <div className={styles.modalDefRow}>
                <dt className={styles.modalDefLabel}>TFN</dt>
                <dd className={styles.modalDefValue}>{staff.taxFileNumber || "—"}</dd>
              </div>
            </dl>
            {staff.signatureDataUrl && (
              <SignatureBlock label="Signed by" name={staff.name} src={staff.signatureDataUrl} />
            )}
            <p className={styles.modalHint}>
              Submitted during onboarding. Visible to owner and manager only.
            </p>
          </>
        ),
      };
    case "bank":
      return {
        title: "Bank & Super Details",
        body: (
          <dl className={styles.modalDefs}>
            <DefRow label="BSB" value={staff.bank.bsb} />
            <DefRow label="Account Number" value={staff.bank.accountNumber} />
            <DefRow label="Account Name" value={staff.bank.accountName} />
            <DefRow label="Super Fund" value={staff.bank.superFundName} />
            <DefRow label="USI" value={staff.bank.usi} />
            <DefRow label="Member Number" value={staff.bank.memberNumber} />
          </dl>
        ),
      };
    // One sheet for all three signatures. They are collected together on the
    // single onboarding "Policies" step and rolled back together on reject,
    // so splitting them across two sheets only made the owner open both to
    // answer one question: has this person signed everything?
    case "policies":
      return {
        title: "Policies",
        body: (
          <>
            <dl className={styles.modalDefs}>
              <div className={styles.modalDefRow}>
                <dt className={styles.modalDefLabel}>Staff Handbook</dt>
                <dd className={styles.modalDefValue}>
                  {staff.handbookSignedAt ? `Signed ${fmtDate(staff.handbookSignedAt)}` : "Not signed"}
                </dd>
              </div>
              <div className={styles.modalDefRow}>
                <dt className={styles.modalDefLabel}>Privacy Policy</dt>
                <dd className={styles.modalDefValue}>
                  {staff.privacySignedAt ? `Signed ${fmtDate(staff.privacySignedAt)}` : "Not signed"}
                </dd>
              </div>
              <div className={styles.modalDefRow}>
                <dt className={styles.modalDefLabel}>Employee Agreement</dt>
                <dd className={styles.modalDefValue}>
                  {staff.agreementSignedAt ? `Signed ${fmtDate(staff.agreementSignedAt)}` : "Not signed"}
                </dd>
              </div>
            </dl>
            {staff.signatureDataUrl && (
              <SignatureBlock label="Signed by" name={staff.name} src={staff.signatureDataUrl} />
            )}
          </>
        ),
      };
    case "hrNotes":
      return {
        title: "HR Notes",
        body:
          hrNotes.length === 0 ? (
            <p className={styles.modalHint}>No HR notes recorded for this employee.</p>
          ) : (
            <ul className={styles.modalList}>
              {hrNotes.map((n) => (
                <li key={n.id} className={styles.modalNoteRow}>
                  <div className={styles.modalNoteHead}>
                    <span className={styles.modalNoteAuthor}>{n.kind}</span>
                    <span className={styles.modalNoteDate}>{n.date || "—"}</span>
                  </div>
                  {n.body && <p className={styles.modalNoteBody}>{n.body}</p>}
                  {n.addedBy && <p className={styles.modalNoteMeta}>Added by {n.addedBy}</p>}
                </li>
              ))}
            </ul>
          ),
      };
  }
}

function EmploymentRow({
  label,
  value,
  accent = false,
  last = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
  last?: boolean;
}) {
  return (
    <div className={`${styles.employmentRow} ${last ? styles.employmentRowLast : ""}`}>
      <span className={styles.employmentLabel}>{label}</span>
      <span className={`${styles.employmentValue} ${accent ? styles.employmentValueAccent : ""}`}>
        {value}
      </span>
    </div>
  );
}

function EmploymentEditRow({
  label,
  children,
  last = false,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`${styles.employmentEditRow} ${last ? styles.employmentRowLast : ""}`}>
      <span className={styles.employmentLabel}>{label}</span>
      <div className={styles.employmentEditControl}>{children}</div>
    </div>
  );
}

function RateRow({
  label,
  value,
  editing,
  draft,
  saving,
  onDraft,
  onEdit,
  onSave,
  onCancel,
}: {
  label: string;
  value: number | null;
  editing: boolean;
  draft: string;
  saving: boolean;
  onDraft: (v: string) => void;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={styles.rateRow}>
      <span className={styles.rateIcon} aria-hidden="true">
        <CalendarMiniIcon />
      </span>
      <div className={styles.rateInfo}>
        <p className={styles.rateLabel}>{label}</p>
        {editing ? (
          <div className={styles.rateEditFields}>
            <span className={styles.rateValueUnit}>$</span>
            <input
              type="number"
              inputMode="decimal"
              className={styles.rateInput}
              value={draft}
              onChange={(e) => onDraft(e.target.value)}
              min="0"
              step="0.01"
              aria-label={`${label} hourly rate`}
              autoFocus
            />
            <span className={styles.rateValueUnit}>/hr</span>
          </div>
        ) : (
          <p className={styles.rateValue}>
            {value != null ? `$${value.toFixed(2)}` : "—"}
            <span className={styles.rateValueUnit}>/hr</span>
          </p>
        )}
      </div>
      {editing ? (
        <div className={styles.rateEditActions}>
          <button
            type="button"
            className={styles.rateSaveBtn}
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className={styles.rateCancelBtn}
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className={styles.rateEditBtn} onClick={onEdit}>
          <EditIcon />
          Edit
        </button>
      )}
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function InfoRow({
  label,
  value,
  accent = false,
  last = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
  last?: boolean;
}) {
  return (
    <div className={`${styles.infoRow} ${last ? styles.infoRowLast : ""}`}>
      <span className={styles.infoLabel}>{label}</span>
      <span className={`${styles.infoValue} ${accent ? styles.infoValueAccent : ""}`}>{value}</span>
    </div>
  );
}

function TerminateModal({
  staff,
  defaultDate,
  submitting,
  onClose,
  onConfirm,
}: {
  staff: Staff;
  defaultDate: string;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (lastDayISO: string) => void;
}) {
  const [lastDayISO, setLastDayISO] = useState<string>(() => {
    if (defaultDate) return defaultDate;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const dateInputRef = useRef<HTMLInputElement | null>(null);

  function openDatePicker() {
    const el = dateInputRef.current;
    if (!el) return;
    // showPicker() opens the native OS date wheel — Safari added support
    // in 16.4, Chrome/Edge earlier. If it's missing (older iOS), fall back
    // to focusing the input which prompts the picker on tap-to-open.
    const anyEl = el as HTMLInputElement & { showPicker?: () => void };
    if (typeof anyEl.showPicker === "function") anyEl.showPicker();
    else el.focus();
  }

  return (
    <div
      className={styles.sheetBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Terminate employee"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.sheet}>
        <div className={styles.sheetGrabber} aria-hidden="true" />
        <div className={styles.sheetHeader}>
          <div className={styles.sheetIcon} aria-hidden="true">
            <AlertOctagonIcon />
          </div>
          <div className={styles.sheetHeaderText}>
            <h3 className={styles.sheetTitle}>Terminate Employee?</h3>
            <p className={styles.sheetDesc}>
              Please confirm the last working date.
              <br />
              This employee will be moved from Active Employees to Terminated Employees.
            </p>
          </div>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Close"
            disabled={submitting}
          >
            <CloseIcon />
          </button>
        </div>

        <section className={styles.sheetCard}>
          <p className={styles.sheetFieldLabel}>EMPLOYEE</p>
          <p className={styles.sheetEmployeeName}>{staff.name}</p>
          <p className={styles.sheetEmployeePos}>{staff.positionLabel}</p>

          <div className={styles.sheetDivider} aria-hidden="true" />

          <p className={styles.sheetFieldLabel}>LAST WORKING DATE</p>
          <div className={styles.sheetDateRow}>
            <span className={styles.sheetDateIcon} aria-hidden="true"><CalendarMiniIcon /></span>
            <span className={styles.sheetDateValue}>
              {fmtDateWithDay(lastDayISO)}
            </span>
            <button type="button" className={styles.sheetEditBtn} onClick={openDatePicker} disabled={submitting}>
              Edit
            </button>
            <input
              ref={dateInputRef}
              type="date"
              className={styles.sheetHiddenDate}
              value={lastDayISO}
              onChange={(e) => setLastDayISO(e.target.value)}
              disabled={submitting}
              aria-hidden="true"
              tabIndex={-1}
            />
          </div>
          <p className={styles.sheetHint}>This should be the employee&apos;s final day of work.</p>
        </section>

        <div className={styles.sheetInfoBox}>
          <span className={styles.sheetInfoIcon} aria-hidden="true"><InfoCircleIcon /></span>
          <p className={styles.sheetInfoText}>
            After termination, the employee will be removed from active schedules and payroll.
            All records and documents will be archived for reference.
          </p>
        </div>

        <div className={styles.sheetActions}>
          <button
            type="button"
            className={styles.sheetCancelBtn}
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.sheetConfirmBtn}
            onClick={() => onConfirm(lastDayISO)}
            disabled={submitting || !lastDayISO}
          >
            {submitting ? "Terminating…" : "Confirm Termination"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DefRow({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className={styles.modalDefRow}>
      <dt className={styles.modalDefLabel}>{label}</dt>
      <dd className={styles.modalDefValue}>{value?.trim() ? value : "—"}</dd>
    </div>
  );
}

function SignatureBlock({ label, name, src }: { label: string; name: string; src: string }) {
  return (
    <div className={styles.signatureBlock}>
      <p className={styles.signatureLabel}>{label}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`${name} signature`} className={styles.signatureImg} />
      <p className={styles.signatureName}>{name}</p>
    </div>
  );
}

/* ── Icons ── */

function ChevronLeft() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
}

function AlertOctagonIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function InfoCircleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CalendarMiniIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
