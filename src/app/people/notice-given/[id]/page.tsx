"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { isOwnerOrChef, isStrictOwner, STRICT_OWNER_USERNAMES } from "@/lib/permissions";
import { emailToUsername } from "@/lib/username";
import { ROUTES } from "@/lib/routes";
import { noticeLastWorkingDay } from "@/lib/notice-last-day";
import Splash from "@/components/Splash";
import CalendarPicker from "@/components/CalendarPicker";
import NoticeDetailView, { type NoticeDetailData } from "./NoticeDetailView";
import styles from "./page.module.css";

/* ─────────────────────────────────────────────────────────────────────────
 * Notice Given — Edit / Delete page.
 * Loads `notice_given/{id}` from Firestore, pre-fills all fields,
 * and saves via updateDoc or removes via deleteDoc.
 * ───────────────────────────────────────────────────────────────────────── */

type StaffMember = { uid: string; name: string; position: string };

const REASONS = [
  "Returning Home",
  "Resigned",
  "Personal Reasons",
  "Better Opportunity",
  "Relocation",
  "Other",
] as const;

const FAR_FUTURE = "2030-12-31";
const NOTE_MAX = 300;

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtIsoShort(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function departmentOf(position: string): NoticeDetailData["department"] {
  const p = position.trim().toLowerCase();
  if (p.includes("kitchen") || p.includes("chef")) return "Kitchen";
  if (p.includes("hall") || p.includes("manager")) return "Hall";
  return "Other";
}

export default function NoticeGivenIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const allowed = isOwnerOrChef(user);
  const ownerView = isStrictOwner(user);
  const editMode = searchParams.get("edit") === "1";

  const [docId, setDocId] = useState("");
  const [detail, setDetail] = useState<NoticeDetailData | null>(null);
  const [docLoading, setDocLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) router.replace(ROUTES.home);
  }, [authLoading, allowed, router]);

  useEffect(() => {
    if (!allowed) return;
    (async () => {
      try {
        const resolved = await params;
        setDocId(resolved.id);
        const snap = await getDoc(doc(getDb(), "notice_given", resolved.id));
        if (!snap.exists()) {
          setNotFound(true);
          return;
        }
        const d = snap.data();
        const position = (d.employeePosition as string) ?? "";
        setDetail({
          id: resolved.id,
          employeeUid: (d.employeeUid as string) ?? "",
          employeeName: (d.employeeName as string) ?? "Unknown",
          employeePosition: position,
          department: departmentOf(position),
          noticeGivenDate: (d.noticeGivenDate as string) ?? "",
          lastWorkingDay: noticeLastWorkingDay({
            finalShiftDate: d.finalShiftDate as string | undefined,
            lastWorkingDay: d.lastWorkingDay as string | undefined,
          }),
          reasonForLeaving: (d.reasonForLeaving as string) ?? "",
          reasonForLeavingOther: (d.reasonForLeavingOther as string) ?? "",
          rehireEligible: (d.rehireEligible as string) ?? "",
          managerNotes: (d.managerNotes as string) ?? "",
          submittedByName: (d.createdByName as string) ?? "",
        });
      } catch {
        setNotFound(true);
      } finally {
        setDocLoading(false);
      }
    })();
  }, [allowed, params]);

  if (authLoading || docLoading) return <Splash />;
  if (!allowed) return null;
  if (notFound || !detail) {
    return (
      <div className={styles.page}>
        <p className={styles.saveHint}>Notice not found.</p>
      </div>
    );
  }

  if (ownerView && !editMode) {
    return <NoticeDetailView notice={detail} />;
  }

  return <NoticeEditForm docId={docId} initialDetail={detail} />;
}

function NoticeEditForm({
  docId,
  initialDetail,
}: {
  docId: string;
  initialDetail: NoticeDetailData;
}) {
  const router = useRouter();
  const { user } = useAuth();

  /* ── Staff picker ── */
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [staffSearch, setStaffSearch] = useState("");
  const [selectedUid, setSelectedUid] = useState(initialDetail.employeeUid);

  /* ── Notice Details ── */
  const [noticeGivenDate, setNoticeGivenDate] = useState(initialDetail.noticeGivenDate);
  const [lastWorkingDay, setLastWorkingDay] = useState(initialDetail.lastWorkingDay);
  const [reasonForLeaving, setReasonForLeaving] = useState(initialDetail.reasonForLeaving);
  const [reasonForLeavingOther, setReasonForLeavingOther] = useState(initialDetail.reasonForLeavingOther);
  const [rehireEligible, setRehireEligible] = useState<"Yes" | "No" | "Unsure" | "">(
    (["Yes", "No", "Unsure"].includes(initialDetail.rehireEligible)
      ? initialDetail.rehireEligible
      : "") as "Yes" | "No" | "Unsure" | "",
  );

  /* ── Final Shift ── */
  const [finalShiftDate, setFinalShiftDate] = useState(initialDetail.lastWorkingDay);

  /* ── Manager Notes ── */
  const [managerNotes, setManagerNotes] = useState(initialDetail.managerNotes);

  /* ── Calendar pickers ── */
  const [calNoticeOpen, setCalNoticeOpen] = useState(false);
  const [calLastDayOpen, setCalLastDayOpen] = useState(false);
  const [calFinalShiftOpen, setCalFinalShiftOpen] = useState(false);

  /* ── Save / Delete ── */
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!noticeGivenDate) setNoticeGivenDate(todayIso());
  }, [noticeGivenDate]);

  /* ── Load staff list ── */
  useEffect(() => {
    (async () => {
      try {
        // Pull the whole staff_onboarding collection and drop only the
        // real business owners (Tia, Yurica) — managers, chefs, and
        // mid-onboarding staff all belong in the picker. Filtering on
        // role="owner" would hide managers like Yurina since Auth stamps
        // her with owner-level UI access.
        const snap = await getDocs(collection(getDb(), "staff_onboarding"));
        const list: StaffMember[] = snap.docs
          .map((d) => {
            const data = d.data();
            const rawUsername =
              (typeof data.username === "string" && data.username) ||
              emailToUsername(typeof data.email === "string" ? data.email : "");
            if (STRICT_OWNER_USERNAMES.has(rawUsername.toLowerCase())) return null;
            const fullName =
              typeof data.fullName === "string" ? data.fullName.trim() : "";
            const f = ((data.firstName as string) ?? "").trim();
            const l = ((data.lastName as string) ?? "").trim();
            const name =
              fullName ||
              (f || l
                ? `${f}${f && l ? " " : ""}${l}`
                : (rawUsername || d.id.slice(0, 6)));
            const role = (data.role as string) ?? "";
            const positionField =
              typeof data.position === "string" ? data.position.trim() : "";
            const position =
              positionField ||
              (role === "manager"
                ? "Manager"
                : role === "chef"
                ? "Kitchen Staff"
                : role
                ? role.charAt(0).toUpperCase() + role.slice(1)
                : "Staff");
            return { uid: d.id, name, position };
          })
          .filter((x): x is StaffMember => x !== null);
        list.sort((a, b) => a.name.localeCompare(b.name));
        setStaff(list);
      } catch {
        /* ignore */
      } finally {
        setStaffLoading(false);
      }
    })();
  }, [user]);

  const selectedStaff = staff.find((s) => s.uid === selectedUid) ?? null;
  const filteredStaff = staffSearch.trim()
    ? staff.filter((s) => s.name.toLowerCase().includes(staffSearch.toLowerCase()))
    : staff;

  const canSave =
    !!selectedUid &&
    !!noticeGivenDate &&
    !!lastWorkingDay &&
    !!reasonForLeaving &&
    (reasonForLeaving !== "Other" || reasonForLeavingOther.trim().length > 0);

  async function handleSave() {
    if (!canSave || saving || !selectedStaff || !docId) return;
    setSaving(true);
    try {
      await updateDoc(doc(getDb(), "notice_given", docId), {
        employeeUid: selectedStaff.uid,
        employeeName: selectedStaff.name,
        employeePosition: selectedStaff.position,
        noticeGivenDate,
        lastWorkingDay,
        reasonForLeaving,
        reasonForLeavingOther: reasonForLeaving === "Other" ? reasonForLeavingOther.trim() : "",
        rehireEligible,
        finalShiftDate: lastWorkingDay,
        managerNotes: managerNotes.trim(),
        updatedAt: serverTimestamp(),
      });
      router.push(isStrictOwner(user) ? `/people/notice-given/${docId}` : "/people/notice-given");
    } catch {
      alert("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!docId || deleting) return;
    if (!confirm("Delete this notice?")) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(getDb(), "notice_given", docId));
      router.push("/people/notice-given");
    } catch {
      alert("Failed to delete.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() =>
            router.push(
              isStrictOwner(user) ? `/people/notice-given/${docId}` : "/people/notice-given",
            )
          }
          aria-label="Back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <h1 className={styles.title}>Edit Notice</h1>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={handleDelete}
          aria-label="Delete notice"
          disabled={deleting}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
      </header>

      {/* ── Section 1: Select Employee ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>1. Select Employee</h2>
        {selectedStaff ? (
          <button
            type="button"
            className={styles.employeeCard}
            onClick={() => setPickerOpen(true)}
            aria-label="Change employee"
          >
            <div className={styles.employeeAvatar}>{initials(selectedStaff.name)}</div>
            <div className={styles.employeeInfo}>
              <p className={styles.employeeName}>{selectedStaff.name}</p>
              <p className={styles.employeePos}>
                {selectedStaff.position}{" "}
                <span className={styles.activeBadge}>Active</span>
              </p>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className={styles.searchBtn}
            onClick={() => setPickerOpen(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            Search employee name
          </button>
        )}
      </section>

      {/* ── Section 2: Notice Details ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>2. Notice Details</h2>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>Notice Given Date</label>
          <button
            type="button"
            className={styles.dateBtn}
            onClick={() => setCalNoticeOpen(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.dateBtnIcon}>
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            {noticeGivenDate ? fmtIsoShort(noticeGivenDate) : "Select date"}
          </button>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>Last Working Day</label>
          <button
            type="button"
            className={`${styles.dateBtn} ${!lastWorkingDay ? styles.dateBtnEmpty : ""}`}
            onClick={() => setCalLastDayOpen(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.dateBtnIcon}>
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            {lastWorkingDay ? fmtIsoShort(lastWorkingDay) : "Select date"}
          </button>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>Reason for Leaving</label>
          <select
            className={styles.select}
            value={reasonForLeaving}
            onChange={(e) => setReasonForLeaving(e.target.value)}
          >
            <option value="">Select reason…</option>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        {reasonForLeaving === "Other" && (
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Please specify the reason</label>
            <textarea
              className={styles.select}
              value={reasonForLeavingOther}
              onChange={(e) => setReasonForLeavingOther(e.target.value)}
              placeholder="e.g. Relocating overseas, personal circumstances…"
              rows={3}
              maxLength={300}
              style={{ height: "auto", padding: "10px 14px", lineHeight: 1.5, resize: "vertical" }}
            />
          </div>
        )}

        <div className={styles.field}>
          <label className={styles.fieldLabel}>Rehire Eligible</label>
          <div className={styles.btnGroup}>
            {(["Yes", "No", "Unsure"] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                className={`${styles.groupBtn} ${rehireEligible === opt ? styles.groupBtnActive : ""}`}
                onClick={() => setRehireEligible(opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 3: Final Shift ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>3. Final Shift</h2>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>Final Shift Date</label>
          <button
            type="button"
            className={`${styles.dateBtn} ${!finalShiftDate ? styles.dateBtnEmpty : ""}`}
            onClick={() => setCalFinalShiftOpen(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.dateBtnIcon}>
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            {finalShiftDate ? fmtIsoShort(finalShiftDate) : "Select date"}
          </button>
        </div>

      </section>

      {/* ── Section 4: Manager Notes ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>4. Manager Notes</h2>
        <div className={styles.field}>
          <textarea
            className={styles.textarea}
            placeholder="Add notes…"
            value={managerNotes}
            onChange={(e) => {
              if (e.target.value.length <= NOTE_MAX) setManagerNotes(e.target.value);
            }}
            rows={4}
            maxLength={NOTE_MAX}
          />
          <p className={styles.charCount}>
            {managerNotes.length} / {NOTE_MAX}
          </p>
        </div>
      </section>

      {/* ── Save ── */}
      <div className={styles.saveWrap}>
        <button
          type="button"
          className={styles.saveBtn}
          disabled={!canSave || saving}
          onClick={handleSave}
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>

      {/* ── Staff picker bottom sheet ── */}
      {pickerOpen && (
        <div
          className={styles.pickerBackdrop}
          onClick={() => {
            setPickerOpen(false);
            setStaffSearch("");
          }}
        >
          <div className={styles.pickerSheet} onClick={(e) => e.stopPropagation()}>
            <div className={styles.pickerHandle} />
            <p className={styles.pickerTitle}>Select Employee</p>

            <div className={styles.pickerSearchWrap}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.pickerSearchIcon}>
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className={styles.pickerSearchInput}
                placeholder="Search employee name"
                value={staffSearch}
                onChange={(e) => setStaffSearch(e.target.value)}
                autoFocus
              />
            </div>

            {staffLoading && <p className={styles.pickerMeta}>Loading…</p>}
            {!staffLoading && filteredStaff.length === 0 && (
              <p className={styles.pickerMeta}>No employees found.</p>
            )}

            <ul className={styles.pickerList}>
              {filteredStaff.map((s) => (
                <li key={s.uid}>
                  <button
                    type="button"
                    className={`${styles.pickerRow} ${selectedUid === s.uid ? styles.pickerRowSelected : ""}`}
                    onClick={() => {
                      setSelectedUid(s.uid);
                      setPickerOpen(false);
                      setStaffSearch("");
                    }}
                  >
                    <div className={styles.pickerAvatar}>{initials(s.name)}</div>
                    <div className={styles.pickerInfo}>
                      <p className={styles.pickerName}>{s.name}</p>
                      <p className={styles.pickerPos}>
                        {s.position}{" "}
                        <span className={styles.activeBadge}>Active</span>
                      </p>
                    </div>
                    {selectedUid === s.uid && (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-warm)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles.pickerCheck}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── Calendar: Notice Given Date ── */}
      {calNoticeOpen && (
        <div className={styles.calOverlay} onClick={() => setCalNoticeOpen(false)}>
          <div className={styles.calSheet} onClick={(e) => e.stopPropagation()}>
            <CalendarPicker
              value={noticeGivenDate || todayIso()}
              maxDate={todayIso()}
              singleOnly
              onChange={(dateKey) => {
                setNoticeGivenDate(dateKey);
                setCalNoticeOpen(false);
              }}
              onRangeChange={() => {}}
              onClose={() => setCalNoticeOpen(false)}
            />
          </div>
        </div>
      )}

      {/* ── Calendar: Last Working Day ── */}
      {calLastDayOpen && (
        <div className={styles.calOverlay} onClick={() => setCalLastDayOpen(false)}>
          <div className={styles.calSheet} onClick={(e) => e.stopPropagation()}>
            <CalendarPicker
              value={lastWorkingDay || todayIso()}
              maxDate={FAR_FUTURE}
              singleOnly
              onChange={(dateKey) => {
                setLastWorkingDay(dateKey);
                setCalLastDayOpen(false);
              }}
              onRangeChange={() => {}}
              onClose={() => setCalLastDayOpen(false)}
            />
          </div>
        </div>
      )}

      {/* ── Calendar: Final Shift Date ── */}
      {calFinalShiftOpen && (
        <div className={styles.calOverlay} onClick={() => setCalFinalShiftOpen(false)}>
          <div className={styles.calSheet} onClick={(e) => e.stopPropagation()}>
            <CalendarPicker
              value={finalShiftDate || todayIso()}
              maxDate={FAR_FUTURE}
              singleOnly
              onChange={(dateKey) => {
                setFinalShiftDate(dateKey);
                setCalFinalShiftOpen(false);
              }}
              onRangeChange={() => {}}
              onClose={() => setCalFinalShiftOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
